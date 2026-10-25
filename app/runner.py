"""Local multi-language execution and generated-file collection."""

import os
import re
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


def safe_file_name(name: str) -> bool:
    # Restrict workspace files to flat names so student-supplied paths cannot escape the temporary run directory.
    return bool(re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}", name)) and name not in {".", ".."}


def command_for(language: str, active_path: Path, workspace: Path) -> Tuple[Optional[List[str]], Optional[List[str]]]:
    """Map each supported language to its installed local compile/run tools."""
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


def _kill_process_tree(process: subprocess.Popen, tracked: Sequence[psutil.Process] = ()) -> None:
    try:
        root = psutil.Process(process.pid)
        children = root.children(recursive=True)
        for child in children:
            try:
                child.kill()
            except psutil.Error:
                pass
    except psutil.Error:
        pass
    for child in tracked:
        if child.pid == process.pid:
            continue
        try:
            child.kill()
        except psutil.Error:
            pass
    try:
        process.kill()
    except OSError:
        pass


def invoke_with_memory_limit(
    command: Sequence[str], workspace: Path, stdin: str, memory_limit_mb: int
) -> Tuple[subprocess.CompletedProcess, Optional[int], bool]:
    """Run one testcase while sampling the process tree's peak resident memory and enforcing its per-case cap."""
    batch_file = os.name == "nt" and Path(command[0]).suffix.lower() in {".bat", ".cmd"}
    process = subprocess.Popen(
        list(command), cwd=str(workspace), stdin=subprocess.PIPE,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, shell=batch_file)
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
    timed_out = False
    deadline = time.monotonic() + 10
    limit_bytes = memory_limit_mb * 1024 * 1024
    try:
        root = psutil.Process(process.pid)
    except psutil.Error:
        root = None
    tracked: Dict[int, psutil.Process] = {root.pid: root} if root is not None else {}
    while reader.is_alive():
        if root is not None:
            try:
                tracked.update({item.pid: item for item in root.children(recursive=True)})
            except psutil.Error:
                pass
        current_bytes = 0
        for item in tracked.values():
            try:
                if item.is_running():
                    current_bytes += item.memory_info().rss
            except psutil.Error:
                continue
        if current_bytes > 0:
            peak_bytes = max(peak_bytes or 0, current_bytes)
        if peak_bytes is not None and peak_bytes > limit_bytes:
            exceeded = True
            _kill_process_tree(process, tuple(tracked.values()))
            break
        if time.monotonic() >= deadline:
            timed_out = True
            _kill_process_tree(process, tuple(tracked.values()))
            break
        reader.join(0.01)
    reader.join()
    if "error" in communication:
        raise communication["error"]
    stdout, stderr = communication.get("output", ("", ""))
    completed = subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
    if timed_out:
        raise subprocess.TimeoutExpired(command, 10, output=stdout, stderr=stderr)
    return completed, peak_bytes, exceeded


def response_line(text: str) -> Optional[int]:
    patterns = (r'File ".*?", line (\d+)', r"\.\w+:(\d+):")
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return int(match.group(1))
    return None


def collect_workspace_files(workspace: Path, requested_names: Sequence[str] = ()) -> List[GeneratedWorkspaceFile]:
    # Return a post-run snapshot so callers can tell whether named output targets exist and compare their contents.
    collected: List[GeneratedWorkspaceFile] = []
    paths_by_name = {path.name.casefold(): path for path in workspace.iterdir()}
    requested_keys: set[str] = set()
    ordered_paths: List[Path] = []
    for name in requested_names:
        key = name.casefold()
        path = paths_by_name.get(key)
        if path is not None and key not in requested_keys:
            ordered_paths.append(path)
            requested_keys.add(key)
    ordered_paths.extend(path for path in sorted(workspace.iterdir()) if path.name.casefold() not in requested_keys)
    for path in ordered_paths:
        if len(collected) >= 40 or not safe_file_name(path.name):
            continue
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 50000:
            continue
        contents = path.read_text(encoding="utf-8", errors="replace")
        if "\x00" in contents:
            continue
        collected.append(GeneratedWorkspaceFile(name=path.name, contents=contents))
    return collected


def collect_generated_files(workspace: Path, existing_names: set[str]) -> List[GeneratedWorkspaceFile]:
    # Separate new files from the pre-run workspace so the UI can mark true program outputs in green tabs.
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
    # Each run gets an isolated temporary workspace; the snapshot lets the browser compare named outputs after execution.
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
            memory_usage_bytes: Optional[int] = None
            memory_limit_exceeded = False
            if payload.memory_limit_mb:
                completed, memory_usage_bytes, memory_limit_exceeded = invoke_with_memory_limit(
                    run_command, workspace, payload.stdin, payload.memory_limit_mb)
            else:
                completed = invoke(run_command, workspace, payload.stdin)
            workspace_files = collect_workspace_files(workspace, payload.files_to_check)
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

    if memory_limit_exceeded:
        detail = "Memory limit exceeded: sampled process-tree memory peaked at {:.1f} MB, above the {} MB per-case limit.".format(
            (memory_usage_bytes or 0) / (1024 * 1024), payload.memory_limit_mb)
        return RunResponse(language=payload.language, status="runtime_error", output=completed.stdout,
                           error=detail, generated_files=generated_files, workspace_files=workspace_files,
                           memory_usage_bytes=memory_usage_bytes, memory_limit_exceeded=True)

    if completed.returncode == 0:
        return RunResponse(language=payload.language, status="success", output=completed.stdout,
                           error=completed.stderr or None, generated_files=generated_files,
                           workspace_files=workspace_files, memory_usage_bytes=memory_usage_bytes)
    detail = completed.stderr.strip() or completed.stdout.strip() or "The program exited with a non-zero status."
    return RunResponse(language=payload.language, status="runtime_error", output=completed.stdout,
                       error=detail, line=response_line(detail), generated_files=generated_files,
                       workspace_files=workspace_files, memory_usage_bytes=memory_usage_bytes)


