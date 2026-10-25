"""Local multi-language execution and generated-file collection."""

import ast
import os
import re
import signal
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import psutil
from fastapi import HTTPException

from .schemas import GeneratedWorkspaceFile, RunRequest, RunResponse
from .test_targets import build_harness_code, default_function_invocation, detect_test_target, java_default_invocation


def safe_file_name(name: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}", name)) and name not in {".", ".."}


def _strip_source_comments_and_strings(source: str) -> str:
    """Keep identifiers while removing common comments and string literals."""
    return re.sub(
        r"//[^\n]*|/\*.*?\*/|\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*'",
        " ",
        source,
        flags=re.DOTALL,
    )


def _matching_workspace_file(reference: str, available: Dict[str, str], extensions: Sequence[str]) -> Optional[str]:
    """Find a referenced local file without allowing paths outside the workspace."""
    candidate = Path(reference).name
    names = [candidate]
    if Path(candidate).suffix == "":
        names.extend(candidate + extension for extension in extensions)
    for wanted in names:
        for name in available:
            if name.casefold() == wanted.casefold():
                return name
    return None


def _java_declared_types(source: str) -> List[str]:
    cleaned = _strip_source_comments_and_strings(source)
    return re.findall(r"\b(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)", cleaned)


def _required_source_names(language: str, active_name: str, sources: Dict[str, str]) -> List[str]:
    """Return the active file and local source files it actually references.

    Workspace files are intentionally not treated as one project-wide compile
    unit.  This prevents an unrelated scratch file from blocking Run while
    still following simple, language-native local dependencies.
    """
    if active_name not in sources:
        return []
    required: List[str] = [active_name]
    queued = [active_name]
    available = dict(sources)

    while queued:
        current_name = queued.pop(0)
        source = sources[current_name]
        cleaned = _strip_source_comments_and_strings(source)
        dependencies: List[str] = []
        if language in {"c", "cpp"}:
            references = re.findall(r"#\s*include\s*[<\"]([^>\"]+)[>\"]", source)
            for reference in references:
                match = _matching_workspace_file(reference, available, (".h", ".hpp", ".c", ".cpp"))
                if match:
                    dependencies.append(match)
        elif language == "typescript":
            references = re.findall(
                r"(?:from\s*|import\s*\(?\s*|require\s*\(\s*)[\"'](?:\./)?([^\"']+)[\"']",
                source,
            )
            for reference in references:
                match = _matching_workspace_file(reference, available, (".ts", ".tsx"))
                if match:
                    dependencies.append(match)
        elif language == "java":
            imports = re.findall(r"\bimport\s+(?:static\s+)?[\w$.]+\.([A-Za-z_$][\w$]*)\s*;", cleaned)
            for imported in imports:
                match = _matching_workspace_file(imported, available, (".java",))
                if match:
                    dependencies.append(match)
            identifiers = set(re.findall(r"\b[A-Za-z_$][\w$]*\b", cleaned))
            for candidate, candidate_source in available.items():
                if candidate == current_name or not candidate.endswith(".java"):
                    continue
                declared = _java_declared_types(candidate_source)
                if any(type_name in identifiers for type_name in declared):
                    dependencies.append(candidate)
        elif language == "go":
            declarations: Dict[str, str] = {}
            for candidate, candidate_source in available.items():
                if candidate == current_name or not candidate.endswith(".go"):
                    continue
                candidate_cleaned = _strip_source_comments_and_strings(candidate_source)
                for declared in re.findall(
                    r"\b(?:func|type|var|const)\s+([A-Za-z_][A-Za-z0-9_]*)", candidate_cleaned
                ):
                    declarations[declared] = candidate
            identifiers = set(re.findall(r"\b[A-Za-z_][A-Za-z0-9_]*\b", cleaned))
            current_declarations = set(
                re.findall(r"\b(?:func|type|var|const)\s+([A-Za-z_][A-Za-z0-9_]*)", cleaned)
            )
            dependencies.extend(
                candidate for declared, candidate in declarations.items()
                if declared in identifiers - current_declarations
            )

        for dependency in dependencies:
            if dependency not in required:
                required.append(dependency)
                queued.append(dependency)
    return required


def _java_main_class(source: str, fallback: str) -> str:
    class_matches = list(re.finditer(r"\bclass\s+([A-Za-z_$][\w$]*)", source))
    main_match = re.search(r"\bstatic\s+void\s+main\s*\(", source)
    if main_match:
        containing_classes = [match for match in class_matches if match.start() < main_match.start()]
        class_name = containing_classes[-1].group(1) if containing_classes else fallback
    else:
        public_match = re.search(r"\bpublic\s+class\s+([A-Za-z_$][\w$]*)", source)
        if public_match:
            class_name = public_match.group(1)
        else:
            class_name = class_matches[0].group(1) if class_matches else fallback
    package_match = re.search(r"\bpackage\s+([A-Za-z_$][\w$.]*)\s*;", source)
    return f"{package_match.group(1)}.{class_name}" if package_match else class_name


def command_for(
    language: str,
    active_path: Path,
    workspace: Path,
    run_path: Optional[Path] = None,
    source_names: Optional[Sequence[str]] = None,
    main_class: Optional[str] = None,
) -> Tuple[Optional[List[str]], Optional[List[str]]]:
    """Return compile and run commands for the selected source file."""
    execution_path = run_path or active_path
    source_paths = [workspace / name for name in (source_names or [])]
    if language == "python":
        compile_paths = source_paths or ([active_path] if run_path is None else [active_path, execution_path])
        return [sys.executable, "-m", "py_compile", *(str(path) for path in compile_paths)], [sys.executable, str(execution_path)]
    if language == "javascript":
        executable = shutil.which("node")
        if not executable:
            return None, None
        compile_path = execution_path if run_path else active_path
        return [executable, "--check", str(compile_path)], [executable, str(execution_path)]
    if language == "typescript":
        compiler = shutil.which("tsc")
        executable = shutil.which("node")
        sources = [str(path) for path in source_paths if path.suffix == ".ts"] or [str(active_path)]
        if not compiler or not executable:
            return None, None
        compiled = workspace / (active_path.stem + ".js")
        return [compiler, "--target", "ES2020", "--module", "commonjs", "--noEmitOnError", "--outDir", str(workspace), *sources], [executable, str(compiled)]
    if language == "ruby":
        executable = shutil.which("ruby")
        if not executable:
            return None, None
        return [executable, "-c", str(active_path)], [executable, str(execution_path)]
    if language == "go":
        executable = shutil.which("go")
        sources = [str(path) for path in source_paths if path.suffix == ".go"] or ([str(run_path)] if run_path else [str(active_path)])
        if not executable or not sources:
            return None, None
        return None, [executable, "run", *sources]
    if language == "java":
        compiler = shutil.which("javac")
        executable = shutil.which("java")
        sources = [str(path) for path in source_paths if path.suffix == ".java"] or ([str(run_path)] if run_path else [str(active_path)])
        if not compiler or not executable or not sources:
            return None, None
        empty_sourcepath = workspace / "__office_hours_empty_sourcepath__"
        empty_sourcepath.mkdir(exist_ok=True)
        execution_class = execution_path.stem if run_path else (main_class or execution_path.stem)
        return [compiler, "-implicit:none", "-sourcepath", str(empty_sourcepath), "-d", str(workspace), *sources], [executable, "-cp", str(workspace), execution_class]
    if language in {"c", "cpp"}:
        compiler = shutil.which("gcc" if language == "c" else "g++")
        extension = ".c" if language == "c" else ".cpp"
        sources = [str(path) for path in source_paths if path.suffix == extension]
        if not sources:
            sources = [str(run_path)] if run_path else [str(active_path)]
        executable = str(workspace / ("program.exe" if os.name == "nt" else "program"))
        if not compiler or not sources:
            return None, None
        # Workspace headers are written beside the source files.  Adding the
        # workspace as an include directory lets both quoted and angle-bracket
        # includes resolve to files the user imported into the workspace.
        return [compiler, "-I", str(workspace), *sources, "-o", executable], [executable]
    return None, None


def execution_environment() -> Dict[str, str]:
    """Keep application credentials out of submitted-program subprocesses."""
    environment = os.environ.copy()
    secret_markers = ("API_KEY", "TOKEN", "SECRET", "PASSWORD", "CREDENTIAL")
    for key in list(environment):
        if any(marker in key.upper() for marker in secret_markers):
            environment.pop(key, None)
    return environment


def _limit_child_process(timeout_seconds: int = 10) -> None:
    if os.name != "posix":
        return
    try:
        import resource

        cpu_limit = max(2, int(timeout_seconds) + 1)
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_limit, cpu_limit))
        resource.setrlimit(resource.RLIMIT_FSIZE, (5 * 1024 * 1024, 5 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    except (ImportError, OSError, ValueError):
        # The outer execution timeout still protects execution on platforms
        # where these optional POSIX limits are unavailable.
        return


def invoke(
    command: Sequence[str], workspace: Path, stdin: str = "", timeout_seconds: int = 10
) -> subprocess.CompletedProcess:
    batch_file = os.name == "nt" and Path(command[0]).suffix.lower() in {".bat", ".cmd"}
    return subprocess.run(
        list(command), cwd=str(workspace), input=stdin, capture_output=True,
        text=True, timeout=timeout_seconds, check=False, shell=batch_file,
        env=execution_environment(),
        preexec_fn=(lambda: _limit_child_process(timeout_seconds)) if os.name == "posix" else None,
    )


def _stop_process_tree(process: subprocess.Popen) -> None:
    if os.name == "posix":
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    else:
        try:
            children = psutil.Process(process.pid).children(recursive=True)
        except psutil.Error:
            children = []
        for child in children:
            try:
                child.kill()
            except psutil.Error:
                pass
        try:
            process.kill()
        except OSError:
            pass


def invoke_with_memory_limit(
    command: Sequence[str], workspace: Path, stdin: str, memory_limit_mb: int, timeout_seconds: int = 10
) -> Tuple[subprocess.CompletedProcess, Optional[int], bool]:
    """Measure and cap the submitted process tree without running it in the web server."""
    batch_file = os.name == "nt" and Path(command[0]).suffix.lower() in {".bat", ".cmd"}
    process = subprocess.Popen(
        list(command), cwd=str(workspace), stdin=subprocess.PIPE,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, shell=batch_file,
        env=execution_environment(),
        preexec_fn=(lambda: _limit_child_process(timeout_seconds)) if os.name == "posix" else None,
        start_new_session=os.name == "posix",
    )
    communication: Dict[str, object] = {}

    def communicate() -> None:
        try:
            communication["output"] = process.communicate(stdin)
        except BaseException as exc:
            communication["error"] = exc

    reader = threading.Thread(target=communicate, daemon=True)
    reader.start()
    peak_bytes: Optional[int] = None
    exceeded = False
    deadline = time.monotonic() + timeout_seconds
    tracked: Dict[int, psutil.Process] = {}
    try:
        tracked[process.pid] = psutil.Process(process.pid)
    except psutil.Error:
        pass
    while reader.is_alive():
        root = tracked.get(process.pid)
        if root is not None:
            try:
                tracked.update((child.pid, child) for child in root.children(recursive=True))
            except psutil.Error:
                pass
        current_bytes = 0
        for item in tracked.values():
            try:
                current_bytes += item.memory_info().rss
            except psutil.Error:
                pass
        if current_bytes:
            peak_bytes = max(peak_bytes or 0, current_bytes)
        if peak_bytes is not None and peak_bytes > memory_limit_mb * 1024 * 1024:
            exceeded = True
            _stop_process_tree(process)
            break
        if time.monotonic() >= deadline:
            _stop_process_tree(process)
            reader.join(timeout=2)
            raise subprocess.TimeoutExpired(command, timeout_seconds)
        reader.join(timeout=0.01)
    reader.join(timeout=2)
    if "error" in communication:
        raise communication["error"]
    stdout, stderr = communication.get("output", ("", ""))
    return subprocess.CompletedProcess(command, process.returncode, stdout, stderr), peak_bytes, exceeded


def response_line(text: str, preferred_file: Optional[str] = None) -> Optional[int]:
    if preferred_file:
        preferred_patterns = (
            r'File "[^"]*(?:/|\\)' + re.escape(preferred_file) + r'", line (\d+)',
            r"(?<![A-Za-z0-9_.-])" + re.escape(preferred_file) + r":(\d+)(?::\d+)?",
            r"\(" + re.escape(preferred_file) + r":(\d+)(?::\d+)?\)",
        )
        for pattern in preferred_patterns:
            preferred_matches = re.findall(pattern, text, flags=re.MULTILINE)
            if preferred_matches:
                return int(preferred_matches[-1])
        # Do not fall back to an arbitrary diagnostic line from another file.
        return None
    patterns = (r'File ".*?", line (\d+)', r"\.\w+:(\d+):")
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return int(match.group(1))
    return None


def response_file(
    text: str,
    preferred_file: Optional[str] = None,
    known_files: Sequence[str] = (),
) -> Optional[str]:
    """Identify the source file named by a compiler/interpreter diagnostic."""
    if preferred_file and response_line(text, preferred_file) is not None:
        return preferred_file
    for name in sorted(set(known_files), key=len, reverse=True):
        escaped = re.escape(name)
        if re.search(r'File "[^"]*(?:/|\\)' + escaped + r'", line \d+', text):
            return name
        if re.search(r"(?<![A-Za-z0-9_.-])" + escaped + r":\d+(?::\d+)?", text, flags=re.MULTILINE):
            return name
        if re.search(r"\(" + escaped + r":\d+(?::\d+)?\)", text):
            return name
    return None


def _sample_values(argument: ast.arg) -> List[str]:
    annotation = ""
    if argument.annotation is not None:
        try:
            annotation = ast.unparse(argument.annotation).lower()
        except AttributeError:
            annotation = ""
    name = argument.arg.lower()
    if "bool" in annotation or name.startswith(("is_", "has_", "should_")):
        return ["True", "False"]
    if any(token in annotation for token in ("str", "text", "string")) or name in {"name", "text", "word", "message"}:
        return [repr("office hours"), repr("")]
    if any(token in annotation for token in ("list", "tuple", "set", "sequence")) or name.endswith("s") or name in {"items", "values", "numbers"}:
        return ["[1, 2, 3]", "[]"]
    if any(token in annotation for token in ("dict", "mapping")) or name in {"data", "mapping", "lookup"}:
        return [repr({"example": 1}), "{}"]
    if "float" in annotation or name in {"average", "amount", "price", "ratio"}:
        return ["2.5", "0.0"]
    return ["2", "0"]


def standalone_python_plan(source: str) -> Optional[Tuple[str, List[str], int, bool]]:
    """Return a hidden call plan when a top-level function has no caller."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return None

    functions = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))]
    if not functions:
        return None

    calls_by_function: Dict[Optional[str], set[str]] = {}

    class CallCollector(ast.NodeVisitor):
        def __init__(self) -> None:
            self.current_function: Optional[str] = None

        def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
            previous = self.current_function
            self.current_function = node.name
            self.generic_visit(node)
            self.current_function = previous

        def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
            previous = self.current_function
            self.current_function = node.name
            self.generic_visit(node)
            self.current_function = previous

        def visit_Call(self, node: ast.Call) -> None:
            if isinstance(node.func, ast.Name):
                calls_by_function.setdefault(self.current_function, set()).add(node.func.id)
            self.generic_visit(node)

    CallCollector().visit(tree)
    top_level_calls = calls_by_function.get(None, set())
    called_by_other_function = {
        name for caller, names in calls_by_function.items() if caller is not None
        for name in names if name != caller
    }
    candidates = [
        function for function in functions
        if function.name not in top_level_calls and function.name not in called_by_other_function
    ]
    if not candidates:
        return None

    function = candidates[0]
    positional = function.args.posonlyargs + function.args.args
    required_positional = positional[:len(positional) - len(function.args.defaults)]
    required_keyword = [
        argument for argument, default in zip(function.args.kwonlyargs, function.args.kw_defaults)
        if default is None
    ]
    arguments = required_positional + required_keyword
    value_options = [_sample_values(argument) for argument in arguments]
    case_count = 1 if not arguments else min(2, max(len(options) for options in value_options))
    calls: List[str] = []
    for case_index in range(case_count):
        parts: List[str] = []
        for argument, options in zip(required_positional, value_options):
            parts.append(options[case_index % len(options)])
        keyword_offset = len(required_positional)
        for index, argument in enumerate(required_keyword):
            options = value_options[keyword_offset + index]
            parts.append(f"{argument.arg}={options[case_index % len(options)]}")
        calls.append(f"{function.name}({', '.join(parts)})")
    return function.name, calls, function.lineno, isinstance(function, ast.AsyncFunctionDef)


def build_python_auto_harness(
    active_file: str, plan: Tuple[str, List[str], int, bool]
) -> Optional[Dict[str, str]]:
    """Create a separate wrapper; the submitted editor file remains untouched."""
    function_name, calls, _, is_async = plan
    target = {
        "kind": "function",
        "language": "python",
        "function_name": function_name,
        "async_function": is_async,
    }
    return build_harness_code(target, active_file, calls)


def response_error_type(text: str) -> Optional[str]:
    match = re.search(r"\b([A-Za-z_][A-Za-z0-9_]*(?:Error|Exception))\b", text)
    return match.group(1) if match else None


def likely_non_terminating_line(
    language: str, code: str, error_type: Optional[str] = None
) -> Optional[int]:
    """Find a loop header or recursive definition to highlight after a run stops."""
    lines = code.splitlines()
    recursive_error = error_type in {"RecursionError", "StackOverflowError", "SystemStackError", "RangeError"}

    if language == "python":
        try:
            tree = ast.parse(code)
        except SyntaxError:
            tree = None
        if tree is not None:
            recursive_definitions: List[int] = []
            for node in ast.walk(tree):
                if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                if any(
                    isinstance(call, ast.Call)
                    and (
                        isinstance(call.func, ast.Name) and call.func.id == node.name
                        or isinstance(call.func, ast.Attribute) and call.func.attr == node.name
                    )
                    for call in ast.walk(node)
                ):
                    recursive_definitions.append(node.lineno)
            if recursive_error and recursive_definitions:
                return recursive_definitions[0]
            loops = [
                node for node in ast.walk(tree)
                if isinstance(node, (ast.While, ast.For, ast.AsyncFor))
            ]
            if loops:
                return loops[0].lineno
            if recursive_definitions:
                return recursive_definitions[0]

    if recursive_error or language != "python":
        definition_pattern = re.compile(
            r"^\s*(?:(?:public|private|protected|static|final|async|export|inline|virtual)\s+)*"
            r"(?:[A-Za-z_$][\w$<>\[\], ?]*\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?:\{|=>)?"
        )
        for number, line in enumerate(lines, 1):
            match = definition_pattern.search(line)
            if not match:
                continue
            name = match.group(1)
            if re.search(r"\b{}\s*\(".format(re.escape(name)), "\n".join(lines[number:])):
                return number

    loop_pattern = re.compile(r"^\s*(?:while|for|until|do)\b", re.IGNORECASE)
    for number, line in enumerate(lines, 1):
        if loop_pattern.search(line):
            return number
    return next((number for number, line in enumerate(lines, 1) if line.strip()), None)


def collect_generated_files(workspace: Path, existing_names: set[str]) -> List[GeneratedWorkspaceFile]:
    generated: List[GeneratedWorkspaceFile] = []
    for path in sorted(workspace.iterdir()):
        if len(generated) >= 20 or path.name in existing_names or not safe_file_name(path.name):
            continue
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 50000:
            continue
        contents = path.read_text(encoding="utf-8", errors="replace")
        if "\x00" in contents:
            continue
        generated.append(GeneratedWorkspaceFile(name=path.name, contents=contents))
    return generated


def collect_workspace_files(workspace: Path, requested_names: Sequence[str]) -> List[GeneratedWorkspaceFile]:
    """Return safe text files present after execution, including pre-existing files."""
    available = {path.name.casefold(): path for path in workspace.iterdir()}
    ordered = list(dict.fromkeys(
        [available[name.casefold()] for name in requested_names if name.casefold() in available]
        + sorted(workspace.iterdir())
    ))
    collected: List[GeneratedWorkspaceFile] = []
    for path in ordered:
        if len(collected) >= 40 or not safe_file_name(path.name):
            continue
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 50000:
            continue
        contents = path.read_text(encoding="utf-8", errors="replace")
        if "\x00" not in contents:
            collected.append(GeneratedWorkspaceFile(name=path.name, contents=contents))
    return collected


def run_code(payload: RunRequest) -> RunResponse:
    if len(payload.files) > 20:
        raise HTTPException(status_code=413, detail="A workspace can contain at most 20 files.")

    sources: Dict[str, str] = {}
    for workspace_file in payload.files:
        if not safe_file_name(workspace_file.name):
            raise HTTPException(status_code=400, detail="File names must be simple names without directories.")
        if workspace_file.name in sources:
            raise HTTPException(status_code=400, detail="File names must be unique.")
        sources[workspace_file.name] = workspace_file.code

    if not safe_file_name(payload.active_file):
        raise HTTPException(status_code=400, detail="The active file name is invalid.")
    if any(not safe_file_name(name) for name in payload.files_to_check):
        raise HTTPException(status_code=400, detail="Output file names must be simple names without directories.")
    sources[payload.active_file] = payload.code
    target = detect_test_target(payload.language, payload.code, active_file=payload.active_file)
    auto_plan = standalone_python_plan(payload.code) if payload.language == "python" and not payload.harness_code else None
    auto_java_call = None
    auto_function_call = None
    if not auto_plan and payload.language == "java" and not payload.harness_code and target.get("kind") == "method" and target.get("ready"):
        auto_java_call = java_default_invocation(target)
    if not auto_plan and not auto_java_call and not payload.harness_code and target.get("kind") == "function" and target.get("ready"):
        auto_function_call = default_function_invocation(target)
    generated_harness = (
        build_python_auto_harness(payload.active_file, auto_plan)
        if auto_plan
        else build_harness_code(target, payload.active_file, [auto_java_call or auto_function_call]) if auto_java_call or auto_function_call else None
    )
    harness_file = payload.harness_file or (generated_harness["file"] if generated_harness else None)
    harness_code = payload.harness_code or (generated_harness["code"] if generated_harness else None)
    if harness_code:
        if not harness_file or not safe_file_name(harness_file):
            raise HTTPException(status_code=400, detail="The generated test harness file name is invalid.")
        if harness_file in sources:
            raise HTTPException(status_code=400, detail="The generated test harness must use a separate file name.")
        sources[harness_file] = harness_code
        # A method submitted without its Java class is compiled inside the
        # generated wrapper.  Exclude the editor file from this compile so a
        # bare method is not reported as a user compile error.
        if payload.language == "java" and target.get("standalone_java"):
            sources.pop(payload.active_file, None)
    required_source_names = _required_source_names(payload.language, payload.active_file, sources)
    if harness_file:
        if payload.language == "python":
            compile_source_names = [name for name in (required_source_names + [harness_file]) if name in sources]
        elif payload.language == "java" and not target.get("standalone_java"):
            compile_source_names = [name for name in (required_source_names + [harness_file]) if name in sources]
        else:
            # Other generated wrappers contain the selected code or load it at
            # runtime.  The wrapper is the only compilation unit needed here.
            compile_source_names = [harness_file]
    else:
        compile_source_names = required_source_names
    auto_fields = {
        "auto_tested": bool(auto_plan or auto_java_call or auto_function_call),
        "auto_test_function": auto_plan[0] if auto_plan else target.get("method_name") if auto_java_call else target.get("function_name") if auto_function_call else None,
        "auto_test_cases": auto_plan[1] if auto_plan else [auto_java_call or auto_function_call] if auto_java_call or auto_function_call else [],
    }
    target_fields = {
        "target_kind": target.get("kind", "program"),
        "target_ready": target.get("ready", True),
        "target_is_main": bool(target.get("is_main")),
        "target_banner": target.get("banner"),
        "target_explanation": target.get("explanation"),
        "harness_file": harness_file,
        "harness_code": harness_code,
    }

    try:
        with tempfile.TemporaryDirectory(prefix="office-hours-prep-") as directory:
            workspace = Path(directory)
            for name, source in sources.items():
                (workspace / name).write_text(source, encoding="utf-8")
            active_path = workspace / payload.active_file
            run_path = workspace / harness_file if harness_file else None
            main_class = (
                _java_main_class(payload.code, active_path.stem)
                if payload.language == "java" and not run_path
                else None
            )
            compile_command, run_command = command_for(
                payload.language,
                active_path,
                workspace,
                run_path,
                compile_source_names,
                main_class,
            )
            if run_command is None:
                message = "The required compiler or interpreter is not installed for {}.".format(payload.language)
                return RunResponse(language=payload.language, status="unavailable", output=message, error=message,
                                   error_type="Unavailable", **auto_fields, **target_fields)
            if compile_command:
                compiled = invoke(compile_command, workspace)
                if compiled.returncode != 0:
                    detail = (compiled.stderr or compiled.stdout).strip()
                    harness_error = bool(harness_file and harness_file in detail and payload.active_file not in detail)
                    error_file = response_file(
                        detail,
                        harness_file if harness_error else None,
                        compile_source_names,
                    )
                    if error_file == payload.active_file and not harness_error:
                        # Compilers sometimes print an active-file follow-up
                        # before the included file's actual diagnostic. Prefer
                        # the required dependency when it is named anywhere
                        # in the diagnostic (including an include note).
                        for candidate in compile_source_names:
                            if candidate == payload.active_file:
                                continue
                            if response_file(detail, candidate, (candidate,)):
                                error_file = candidate
                                break
                    error_source = "harness" if harness_error else (
                        "dependency" if error_file and error_file != payload.active_file else "user"
                    )
                    error_message = (
                        "The generated test harness could not be compiled."
                        if harness_error
                        else f'The required file "{error_file}" could not be compiled.'
                        if error_source == "dependency" and error_file
                        else "The current file could not be compiled."
                    )
                    return RunResponse(
                        language=payload.language,
                        status="harness_error" if harness_error else "compile_error",
                        **auto_fields,
                        **target_fields,
                        output=detail,
                        error=error_message,
                        error_type="HarnessError" if harness_error else response_error_type(detail) or "CompileError",
                        error_source=error_source,
                        error_file=error_file,
                        line=response_line(detail, error_file or (harness_file if harness_error else payload.active_file)),
                    )
            existing_names = {path.name for path in workspace.iterdir()}
            memory_usage_bytes: Optional[int] = None
            memory_limit_exceeded = False
            if payload.memory_limit_mb:
                completed, memory_usage_bytes, memory_limit_exceeded = invoke_with_memory_limit(
                    run_command, workspace, payload.stdin, payload.memory_limit_mb, payload.timeout_seconds
                )
            else:
                completed = invoke(run_command, workspace, payload.stdin, payload.timeout_seconds)
            generated_files = collect_generated_files(workspace, existing_names)
            workspace_files = collect_workspace_files(workspace, payload.files_to_check)
    except subprocess.TimeoutExpired as exc:
        output = exc.stdout or ""
        if isinstance(output, bytes):
            output = output.decode("utf-8", errors="replace")
        message = "Execution exceeded the {} second limit.".format(payload.timeout_seconds)
        return RunResponse(language=payload.language, status="runtime_error", output=output,
                           error=message, error_type="TimeoutError", error_source="user",
                           error_file=payload.active_file,
                           line=likely_non_terminating_line(payload.language, payload.code, "TimeoutError"),
                           **auto_fields, **target_fields)
    except FileNotFoundError as exc:
        missing = Path(exc.filename).name if exc.filename else "the selected executable"
        message = "Could not start {}. Check that the required tool is installed and available on PATH.".format(missing)
        return RunResponse(language=payload.language, status="unavailable", output=message, error=message,
                           error_type="Unavailable", **auto_fields, **target_fields)
    except OSError as exc:
        raise HTTPException(status_code=500, detail="The local runner could not start: {}".format(exc)) from exc

    if memory_limit_exceeded:
        detail = "Memory limit exceeded: the run used about {:.1f} MB, above the {} MB limit.".format(
            (memory_usage_bytes or 0) / (1024 * 1024), payload.memory_limit_mb
        )
        return RunResponse(language=payload.language, status="runtime_error", output=completed.stdout,
                           error=detail, error_type="MemoryLimitError", error_source="user",
                           error_file=payload.active_file,
                           generated_files=generated_files, workspace_files=workspace_files,
                           memory_usage_bytes=memory_usage_bytes, memory_limit_exceeded=True,
                           **auto_fields, **target_fields)
    if completed.returncode == 0:
        return RunResponse(language=payload.language, status="success", output=completed.stdout,
                           error=completed.stderr or None, generated_files=generated_files,
                           workspace_files=workspace_files, memory_usage_bytes=memory_usage_bytes,
                           **auto_fields, **target_fields)
    detail = completed.stderr.strip() or completed.stdout.strip() or "The program exited with a non-zero status."
    harness_error = bool(harness_file and harness_file in detail and payload.active_file not in detail)
    error_file = response_file(detail, harness_file if harness_error else None, list(sources))
    if not error_file:
        error_file = harness_file if harness_error else payload.active_file
    source_file = error_file
    error_type = "HarnessError" if harness_error else response_error_type(detail) or "RuntimeError"
    error_source = "harness" if harness_error else (
        "dependency" if error_file != payload.active_file else "user"
    )
    recursive_failure = bool(re.search(
        r"\b(?:RecursionError|StackOverflowError|SystemStackError|RangeError|maximum recursion|maximum call stack|stack overflow)\b",
        detail,
        re.IGNORECASE,
    ))
    if not harness_error and recursive_failure and error_type == "RuntimeError":
        error_type = "StackOverflowError"
    line = response_line(detail, source_file)
    if not harness_error and recursive_failure:
        line = likely_non_terminating_line(payload.language, payload.code, error_type)
    return RunResponse(language=payload.language, status="runtime_error", output=completed.stdout,
                       error=("The generated test harness failed." if harness_error else detail),
                       error_type=error_type,
                       error_source=error_source, error_file=error_file,
                       line=line, generated_files=generated_files,
                       workspace_files=workspace_files, memory_usage_bytes=memory_usage_bytes,
                       **auto_fields, **target_fields)
