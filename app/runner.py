"""Local multi-language execution and generated-file collection."""

import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

from fastapi import HTTPException

from .schemas import GeneratedWorkspaceFile, RunRequest, RunResponse


def safe_file_name(name: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}", name)) and name not in {".", ".."}


def command_for(language: str, active_path: Path, workspace: Path) -> Tuple[Optional[List[str]], Optional[List[str]]]:
    """Return compile and run commands for the selected source file."""
    if language == "python":
        return [sys.executable, "-m", "py_compile", str(active_path)], [sys.executable, str(active_path)]
    if language == "javascript":
        executable = shutil.which("node")
        if not executable:
            return None, None
        return [executable, "--check", str(active_path)], [executable, str(active_path)]
    if language == "typescript":
        compiler = shutil.which("tsc")
        executable = shutil.which("node")
        sources = sorted(str(path) for path in workspace.glob("*.ts"))
        if not compiler or not executable:
            return None, None
        compiled = workspace / (active_path.stem + ".js")
        return [compiler, "--target", "ES2020", "--module", "commonjs", "--outDir", str(workspace), *sources], [executable, str(compiled)]
    if language == "ruby":
        executable = shutil.which("ruby")
        if not executable:
            return None, None
        return [executable, "-c", str(active_path)], [executable, str(active_path)]
    if language == "go":
        executable = shutil.which("go")
        sources = sorted(str(path) for path in workspace.glob("*.go"))
        if not executable or not sources:
            return None, None
        return None, [executable, "run", *sources]
    if language == "java":
        compiler = shutil.which("javac")
        executable = shutil.which("java")
        sources = sorted(str(path) for path in workspace.glob("*.java"))
        if not compiler or not executable or not sources:
            return None, None
        return [compiler, "-d", str(workspace), *sources], [executable, "-cp", str(workspace), active_path.stem]
    if language in {"c", "cpp"}:
        compiler = shutil.which("gcc" if language == "c" else "g++")
        extension = ".c" if language == "c" else ".cpp"
        sources = sorted(str(path) for path in workspace.glob("*" + extension))
        executable = str(workspace / ("program.exe" if os.name == "nt" else "program"))
        if not compiler or not sources:
            return None, None
        return [compiler, *sources, "-o", executable], [executable]
    return None, None


def invoke(command: Sequence[str], workspace: Path, stdin: str = "") -> subprocess.CompletedProcess:
    batch_file = os.name == "nt" and Path(command[0]).suffix.lower() in {".bat", ".cmd"}
    return subprocess.run(
        list(command), cwd=str(workspace), input=stdin, capture_output=True,
        text=True, timeout=10, check=False, shell=batch_file)


def response_line(text: str) -> Optional[int]:
    patterns = (r'File ".*?", line (\d+)', r"\.\w+:(\d+):")
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return int(match.group(1))
    return None


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
    sources[payload.active_file] = payload.code

    try:
        with tempfile.TemporaryDirectory(prefix="office-hours-prep-") as directory:
            workspace = Path(directory)
            for name, source in sources.items():
                (workspace / name).write_text(source, encoding="utf-8")
            active_path = workspace / payload.active_file
            compile_command, run_command = command_for(payload.language, active_path, workspace)
            if run_command is None:
                message = "The required compiler or interpreter is not installed for {}.".format(payload.language)
                return RunResponse(language=payload.language, status="unavailable", output=message, error=message)
            if compile_command:
                compiled = invoke(compile_command, workspace)
                if compiled.returncode != 0:
                    detail = (compiled.stderr or compiled.stdout).strip()
                    return RunResponse(language=payload.language, status="compile_error",
                                       output=detail, error="The source files could not be compiled.",
                                       line=response_line(detail))
            existing_names = {path.name for path in workspace.iterdir()}
            completed = invoke(run_command, workspace, payload.stdin)
            generated_files = collect_generated_files(workspace, existing_names)
    except subprocess.TimeoutExpired as exc:
        output = exc.stdout or ""
        if isinstance(output, bytes):
            output = output.decode("utf-8", errors="replace")
        message = "Execution exceeded the 10 second limit."
        return RunResponse(language=payload.language, status="runtime_error", output=output,
                           error=message)
    except FileNotFoundError as exc:
        missing = Path(exc.filename).name if exc.filename else "the selected executable"
        message = "Could not start {}. Check that the required tool is installed and available on PATH.".format(missing)
        return RunResponse(language=payload.language, status="unavailable", output=message, error=message)
    except OSError as exc:
        raise HTTPException(status_code=500, detail="The local runner could not start: {}".format(exc)) from exc

    if completed.returncode == 0:
        return RunResponse(language=payload.language, status="success", output=completed.stdout,
                           error=completed.stderr or None, generated_files=generated_files)
    detail = completed.stderr.strip() or completed.stdout.strip() or "The program exited with a non-zero status."
    return RunResponse(language=payload.language, status="runtime_error", output=completed.stdout,
                       error=detail, line=response_line(detail), generated_files=generated_files)


