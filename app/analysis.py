"""Demo analysis and Meta-backed analysis, hint, and testcase services."""

import ast
import json
import os
import re
from typing import List, Optional

import httpx
from dotenv import load_dotenv
from fastapi import HTTPException

from .schemas import (Analysis, AnalyzeRequest, GenerateTestCasesRequest, GenerateTestCasesResponse, HintRequest, HintResponse, Issue)

load_dotenv()


def make_issue(category: str, title: str, explanation: str, fix: str,
               line: Optional[int] = None, severity: str = "warning") -> Issue:
    return Issue(category=category, title=title, explanation=explanation,
                 fix=fix, line=line, severity=severity)


def make_result(mode: str, issues: List[Issue], payload: AnalyzeRequest) -> Analysis:
    if issues and issues[0].severity == "error":
        summary = "I found a likely {} problem on line {}.".format(
            issues[0].category, issues[0].line or "?")
    elif issues:
        summary = "I found {} likely issue{} to investigate.".format(
            len(issues), "s" if len(issues) != 1 else "")
    else:
        summary = "No likely issue was found."

    walkthrough = ["Start with the highlighted line and say what value you expected there."]
    walkthrough.append("Then trace the value backward: where was it created, and what type does it have?")
    if payload.problem:
        walkthrough.append("Finally, compare that trace with the symptom you described: {}".format(
            payload.problem.strip()))
    return Analysis(mode=mode, summary=summary, issues=issues[:5], walkthrough=walkthrough)


def demo_analysis(payload: AnalyzeRequest) -> Analysis:
    """Return deterministic beginner-friendly checks without an external API."""
    try:
        tree = ast.parse(payload.code)
    except SyntaxError as exc:
        issue = make_issue(
            "Compile error", "Python cannot understand this line yet",
            "Python found an unfinished or incorrectly structured expression.",
            "Check for a missing colon, quote, parenthesis, or indentation near this line.",
            exc.lineno or 1, "error")
        return make_result("demo", [issue], payload)

    issues: List[Issue] = []
    assigned = set(dir(__builtins__)) if not isinstance(__builtins__, dict) else set(__builtins__)
    assigned.update({"True", "False", "None"})
    seen_names = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                if isinstance(target, ast.Name):
                    assigned.add(target.id)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
            if node.id not in assigned and node.id not in seen_names:
                issues.append(make_issue(
                    "NameError", "This name may not exist yet",
                    "Python looks for a value named '{}', but no assignment or import was found.".format(node.id),
                    "Define or import '{}' before using it, or check its spelling.".format(node.id),
                    node.lineno, "error"))
                seen_names.add(node.id)
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "input":
            issues.append(make_issue(
                "Type", "input() always returns text",
                "Values read with input() are strings, even when they look like numbers.",
                "Convert the value with int() or float() before numeric operations.", node.lineno))
        elif isinstance(node, ast.Compare) and any(isinstance(op, ast.Is) for op in node.ops):
            issues.append(make_issue(
                "Logic", "Use == for value comparison",
                "is checks object identity rather than ordinary value equality.",
                "Replace is with == when comparing values.", node.lineno))
        elif isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
            if isinstance(node.right, ast.Constant) and node.right.value == 0:
                issues.append(make_issue(
                    "Runtime", "This division is by zero",
                    "The expression will raise ZeroDivisionError when it runs.",
                    "Check that the denominator is not zero before dividing.", node.lineno, "error"))

    if "index" in payload.problem.lower() and "list" in payload.problem.lower():
        issues.append(make_issue(
            "Runtime", "The index may be outside the list",
            "A list index error means the requested position is not present in the list.",
            "Print len(your_list) and check that the index is between 0 and len(list) - 1."))
    if not issues:
        issues.append(make_issue(
            "Understand", "No obvious issue found",
            "The demo checks common syntax, name, type, logic, and runtime patterns.",
            "Compare expected and actual values with a print() or debugger breakpoint."))
    return make_result("demo", issues, payload)


async def meta_completion(prompt: str) -> str:
    key = os.getenv("META_API_KEY") or os.getenv("MODEL_API_KEY")
    if not key:
        raise HTTPException(status_code=400, detail="META_API_KEY is not configured. Use Demo mode or add it to .env.")
    model = os.getenv("META_MODEL", "muse-spark-1.3")
    url = "https://api.meta.ai/v1/chat/completions"
    async with httpx.AsyncClient(timeout=45) as client:
        response = await client.post(
            url,
            headers={"Authorization": "Bearer " + key},
            json={
                "model": model,
                "messages": [
                    {"role": "developer", "content": "You are a kind beginner-friendly programming tutor."},
                    {"role": "user", "content": prompt},
                ],
            },
        )
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail="Meta returned an error: {}".format(response.text[:300]))
    try:
        return response.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Meta returned an unexpected response.") from exc


async def meta_analysis(payload: AnalyzeRequest) -> Analysis:
    prompt = """You are a kind Python teaching assistant. Analyze the student's code and symptom.
Return ONLY valid JSON with this shape: {{"summary": str, "issues": [{{"category": str, "title": str,
"explanation": str, "fix": str, "line": integer|null, "severity": "error"|"warning"}}],
"walkthrough": [str]}}. Mention no more than five issues. Be specific and beginner-friendly.
Intent: {intent}
Code:\n{code}
Problem: {problem}""".format(
        intent=payload.intent, code=payload.code, problem=payload.problem)
    try:
        text = await meta_completion(prompt)
        text = re.sub(r"^```json\s*|\s*```$", "", text.strip())
        result = Analysis(mode="meta", **json.loads(text))
        result.issues = result.issues[:5]
        return result
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail="Gemini returned an unexpected response.") from exc




async def meta_hint(payload: HintRequest) -> HintResponse:
    prompt = """You are giving a beginner a gentle, vague debugging hint. Do not reveal a full fix.
Return ONLY valid JSON in this exact shape: {{"hints": [{{"line": integer, "message": string}}]}}.
Return no more than three hints. Use only line numbers from the supplied code. Keep each message to one short sentence.
Language: {language}
Program purpose: {intent}
Compiler or runtime message: {error}
Code:\n{code}""".format(language=payload.language, intent=payload.intent,
                            error=payload.compiler_error, code=payload.code)
    try:
        text = await meta_completion(prompt)
        text = re.sub(r"^```json\s*|\s*```$", "", text.strip())
        return HintResponse(**json.loads(text))
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail="Gemini returned an unexpected response.") from exc


async def generate_test_cases(payload: GenerateTestCasesRequest) -> GenerateTestCasesResponse:
    file_names = sorted({workspace_file.name for workspace_file in payload.files} | {payload.active_file})
    source = "\n".join([payload.code] + [workspace_file.code for workspace_file in payload.files])
    source_lines = [line for line in source.splitlines() if line.strip() and not line.lstrip().startswith(("#", "//"))]
    branches = len(re.findall(r"\b(if|elif|else|switch|case|match|catch|except)\b", source))
    loops = len(re.findall(r"\b(for|while|do)\b", source))
    functions = len(re.findall(r"\b(def|function|func)\b", source))
    input_calls = len(re.findall(r"\b(input|readline|scanf|Scanner)\b", source))
    complexity_score = branches + (2 * loops) + functions + input_calls + max(0, len(payload.files) - 1)
    if len(source_lines) <= 6 and complexity_score <= 1 and input_calls == 0:
        complexity, max_cases = "very simple", 1
    elif complexity_score <= 3:
        complexity, max_cases = "simple", 1
    elif complexity_score <= 7:
        complexity, max_cases = "moderate", 3
    else:
        complexity, max_cases = "complex", 6

    existing_cases = "\n".join(
        "- {name}: stdin={stdin!r}; files={files}; expected={expected!r}".format(
            name=test_case.name,
            stdin=test_case.stdin[:300],
            files=[(fixture.file_name, fixture.contents[:200]) for fixture in test_case.files],
            expected=test_case.expected_output[:300],
        )
        for test_case in payload.existing_cases
    ) or "None"
    prompt = """Generate up to {max_cases} useful ADDITIONAL test cases for the provided program.
Return only JSON with this shape: {{"cases":[{{"name":string,"stdin":string,"files":[{{"file_name":string,"contents":string}}],"expected_output":string}}]}}.
Program complexity estimate: {complexity} ({complexity_score} structural signals across {line_count} non-empty source lines).
Scale the number and sophistication of cases to that complexity. A simple greeting or constant-output program usually needs at most one case; do not generate repetitive cases merely to fill the limit.
Existing cases are listed below. Add only meaningful cases that test behavior not already covered. Return an empty cases array if no useful additional case remains.
Use concise names. Include normal and boundary cases that follow the provided constraints.
Use stdin for standard input. Use files only to override files from the available file list.
Never invent file names; use only these exact names: {file_names}.
Expected output must match stdout exactly, excluding trailing newlines.
Existing cases:\n{existing_cases}
Language: {language}
Active file: {active_file}
Program purpose: {intent}
Constraints: {constraints}
Code:\n{code}
Files:\n{files}""".format(
        max_cases=max_cases,
        complexity=complexity,
        complexity_score=complexity_score,
        line_count=len(source_lines),
        file_names=", ".join(file_names),
        language=payload.language,
        active_file=payload.active_file,
        intent=payload.intent or "Not specified",
        constraints=payload.constraints or "Not specified",
        existing_cases=existing_cases,
        code=payload.code,
        files="\n\n".join("--- {} ---\n{}".format(file.name, file.code) for file in payload.files))
    try:
        text = await meta_completion(prompt)
        text = re.sub(r"^```json\s*|\s*```$", "", text.strip())
        result = GenerateTestCasesResponse(**json.loads(text))
    except (KeyError, IndexError, TypeError, json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Gemini returned unexpected test cases.") from exc

    allowed_names = set(file_names)
    for test_case in result.cases:
        if any(fixture.file_name not in allowed_names for fixture in test_case.files):
            raise HTTPException(status_code=502, detail="Gemini referenced a file outside this workspace.")
    result.cases = result.cases[:max_cases]
    return result


