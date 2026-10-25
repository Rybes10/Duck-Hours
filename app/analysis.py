"""Demo analysis and Meta-backed analysis, hint, and testcase services."""

import ast
import json
import os
import re
from typing import List, Optional

import httpx
from dotenv import load_dotenv
from fastapi import HTTPException

from .schemas import (Analysis, AnalyzeRequest, FixRequest, FixResponse, GenerateTestCasesRequest, GenerateTestCasesResponse, GeneratedCaseStrategy, GeneratedTestCase, HintRequest, HintResponse, Issue)
from .test_targets import build_harness_code, detect_test_target, java_default_invocation

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
    try:
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
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="Meta did not respond before the request timed out.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Could not connect to the Meta model service.") from exc
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail="Meta returned an error: {}".format(response.text[:300]))
    try:
        return response.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Meta returned an unexpected response.") from exc


async def meta_analysis(payload: AnalyzeRequest) -> Analysis:
    prompt = """You are a kind beginner-friendly programming teaching assistant. The code has already run successfully.
Look for remaining logic or requirements issues based on the program purpose and run setup.
Always inspect the code and the available run information. Do not report syntax or runtime errors because the runner already checked those. Return an empty issues array when
the code appears to meet its stated purpose and constraints. Return no more than FIVE issues, ordered from most
important to least important, and make each line number the most relevant line when possible. Keep explanations
specific and explain why each behavior may not match the purpose.
The student may provide a predicted output. Treat it as the student's explicit expected result, not as a suggestion.
If the predicted output is empty, do not guess what the output should be and do not report a logic or output issue
only because the expected result is unknown. Use the supplied purpose, constraints, and actual observed output only
when they prove a different, concrete requirement violation beyond reasonable doubt. If the wording is unclear,
return an empty issues array. If predicted output is present, compare it closely with the actual observed output and
report an output/logic issue only when the mismatch is clear and supported by the purpose. Do not invent missing
lines, punctuation, inputs, or requirements. An empty actual output can be correct when the predicted output is also
empty or when the program is not expected to print anything.
Return ONLY valid JSON with this shape: {{"summary": str, "issues": [{{"category": str, "title": str,
"explanation": str, "fix": str, "line": integer|null, "severity": "error"|"warning"}}],
"walkthrough": [str]}}. Use an empty walkthrough when there is no issue.
Intent: {intent}
Predicted output:
{predicted_output}
Actual output observed by the local runner:
{actual_output}
Code:\n{code}
Problem: {problem}""".format(
        intent=payload.intent or "Not specified",
        predicted_output=payload.predicted_output or "(empty — no predicted output was provided)",
        actual_output=payload.actual_output or "(empty output)",
        code=payload.code,
        problem=payload.problem or "Not specified")
    try:
        text = await meta_completion(prompt)
        text = re.sub(r"^```json\s*|\s*```$", "", text.strip())
        result = Analysis(mode="meta", **json.loads(text))
        result.issues = result.issues[:5]
        return result
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail="Meta returned an unexpected response.") from exc




async def meta_hint(payload: HintRequest) -> HintResponse:
    prompt = """You are giving a beginner a specific but incomplete debugging hint. Do not reveal a full fix.
Return ONLY valid JSON in this exact shape: {{"hints": [{{"line": integer, "message": string}}]}}.
Return exactly one hint when a likely line exists. Use only one line number from the supplied code. Explain the
likely error category and why that line is suspicious in one or two clear sentences, but do not write the corrected code.
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
        raise HTTPException(status_code=502, detail="Meta returned an unexpected response.") from exc


async def meta_fix(payload: FixRequest) -> FixResponse:
    prompt = """You are helping a beginner repair one programming issue. Return a complete replacement for the supplied active file.
Change only what is needed to address the reported issue and preserve the user's purpose, style, and working code.
Do not invent features or rewrite unrelated lines. Return ONLY valid JSON in this exact shape:
{{"code": string, "explanation": string}}.
The code value must contain only source code, without Markdown fences. The explanation should briefly say what changed
and why, using beginner-friendly language. If the issue is uncertain, make the smallest safe correction and explain
what the user should check.
Language: {language}
Program purpose and setup:
{intent}
Issue context: {problem}
Compiler or runtime message: {error}
Code:
{code}""".format(language=payload.language, intent=payload.intent or "Not specified",
                            problem=payload.problem or "Not specified", error=payload.compiler_error or "Not specified",
                            code=payload.code)
    try:
        text = await meta_completion(prompt)
        text = re.sub(r"^```json\s*|\s*```$", "", text.strip())
        return FixResponse(**json.loads(text))
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail="Meta returned an unexpected response.") from exc


async def generate_test_cases(payload: GenerateTestCasesRequest) -> GenerateTestCasesResponse:
    generation_count = payload.count
    file_names = sorted({workspace_file.name for workspace_file in payload.files} | {payload.active_file})
    target = detect_test_target(
        payload.language,
        payload.code,
        active_file=payload.active_file,
        selection_start_line=payload.selection_start_line,
        selection_end_line=payload.selection_end_line,
        selection_start_column=payload.selection_start_column,
        selection_end_column=payload.selection_end_column,
    )
    base_response = dict(
        requested_count=payload.count,
        target_kind=target["kind"],
        target_label=target["label"],
        target_ready=target.get("ready", True),
        target_banner=target.get("banner"),
        target_explanation=target.get("explanation"),
        missing_information=target.get("missing_information"),
        validation_error=target.get("validation_error"),
        validation_line=target.get("validation_line"),
        return_type=target.get("return_type"),
    )
    if payload.selection_start_line is None or payload.selection_end_line is None:
        return GenerateTestCasesResponse(
            cases=[], message="Highlight one complete function or method in the editor first.",
            target_ready=False, requested_count=payload.count,
            target_kind="invalid", target_label="no selection",
        )
    if target["kind"] not in {"function", "method"} or target.get("function_name", target.get("method_name", "")).lower() == "main":
        return GenerateTestCasesResponse(
            cases=[], message=target.get("validation_error") or target.get("missing_information") or "Select one complete function or method other than main.",
            **{**base_response, "target_ready": False},
        )
    if not target.get("ready", True):
        message = target.get("validation_error") or target.get("missing_information") or "This code is not ready to test yet."
        return GenerateTestCasesResponse(cases=[], message=message, **base_response)

    source = "\n".join([payload.code] + [workspace_file.code for workspace_file in payload.files])
    source_lines = [line for line in source.splitlines() if line.strip() and not line.lstrip().startswith(("#", "//"))]
    branches = len(re.findall(r"\b(if|elif|else|switch|case|match|catch|except)\b", source))
    loops = len(re.findall(r"\b(for|while|do)\b", source))
    functions = len(re.findall(r"\b(def|function|func)\b", source))
    input_calls = len(re.findall(r"\b(input|readline|scanf|Scanner)\b", source))
    complexity_score = branches + (2 * loops) + functions + input_calls + max(0, len(payload.files) - 1)
    complexity = "simple" if complexity_score <= 3 else "moderate" if complexity_score <= 7 else "complex"
    existing_cases = "\n".join(
        "- {name}: stdin={stdin!r}; invocation={invocation!r}; expected_return={expected_return!r}; files={files}; expected_stdout={expected!r}".format(
            name=test_case.name,
            stdin=test_case.stdin[:300],
            invocation=test_case.invocation,
            expected_return=test_case.expected_return,
            files=[(fixture.file_name, fixture.contents[:200]) for fixture in test_case.files],
            expected=test_case.expected_output[:300],
        )
        for test_case in payload.existing_cases
    ) or "None"
    selected_code = payload.code
    if payload.selection_start_line is not None and payload.selection_end_line is not None:
        lines = payload.code.splitlines()
        selected_code = "\n".join(lines[payload.selection_start_line - 1:payload.selection_end_line])
    method_target = target["kind"] in {"function", "method"}
    case_shape = (
        '{"name":string,"description":string,"invocation":string,"expected_return":string|null,"stdin":"","files":[],"expected_output":""}'
        if method_target
        else '{"name":string,"description":string,"invocation":null,"expected_return":null,"stdin":string,"files":[{"file_name":string,"contents":string}],"expected_output":string}'
    )
    expected_guidance = (
        "For a function or method, invocation must be a complete call expression using only the submitted code, "
        "and expected_return must be reasoned from the program purpose and constraints, never by executing or copying "
        "the buggy implementation. If the purpose is ambiguous, use null for expected_return and explain that in message."
        if method_target
        else "Expected output must be reasoned from the stated purpose and constraints, not copied from the buggy implementation."
    )
    prompt = """Generate exactly {count} DISTINCT additional test cases for the target below.
Return only JSON with this shape: {{"strategies":[{{"name":string,"description":string,"code":string,"cases":[{case_shape}]}}],"message":string|null}}.
If it is impossible to determine a safe expected result or to create all requested distinct cases, return fewer cases and explain why in message. Never pad the list with duplicates or guesses.
Include normal, boundary, and relevant edge cases that remain within the stated preconditions. Do not count invalid inputs as bugs unless the purpose says they must be handled.
Group cases by testing strategy. When useful, include a short inspectable Python 3 recipe for how the concrete inputs were chosen: seeded random values within stated bounds, boundary sweeps, repeated values, or combinations. Expand the recipe into the exact concrete cases; the recipe will be displayed but never executed. Never put file/network access, external packages, or unbounded loops in a recipe.
{expected_guidance}
For a complete program, use stdin and expected_output. For a method/function, use invocation and expected_return; keep stdin and expected_output empty.
Do not silently test code outside the selected target. The surrounding code is provided only to understand imports, helpers, variables, and class context.
Never invent file names; use only these exact names: {file_names}.
Target metadata: {target}
Target code:
{selected_code}
Full active file:
{code}
Other files:
{files}
Existing cases:
{existing_cases}
Language: {language}
Active file: {active_file}
Program purpose: {intent}
Constraints: {constraints}
Complexity signals: {complexity_score} across {line_count} non-empty lines ({complexity}).""".format(
        count=generation_count,
        case_shape=case_shape,
        expected_guidance=expected_guidance,
        file_names=", ".join(file_names),
        target=json.dumps(target, sort_keys=True),
        selected_code=selected_code,
        code=payload.code,
        files="\n\n".join("--- {} ---\n{}".format(file.name, file.code) for file in payload.files) or "None",
        existing_cases=existing_cases,
        language=payload.language,
        active_file=payload.active_file,
        intent=payload.intent or "Not specified",
        constraints=payload.constraints or "Not specified",
        complexity_score=complexity_score,
        line_count=len(source_lines),
        complexity=complexity,
    )
    try:
        text = await meta_completion(prompt)
        text = re.sub(r"^```json\s*|\s*```$", "", text.strip())
        raw = json.loads(text)
        if not isinstance(raw, dict):
            raise ValueError("the response must be an object")
        raw_strategies = raw.get("strategies", [])
        if not isinstance(raw_strategies, list):
            raise ValueError("strategies must be a list")
        strategies = [GeneratedCaseStrategy(**item) for item in raw_strategies]
        raw_cases = raw.get("cases", [])
        if not isinstance(raw_cases, list):
            raise ValueError("cases must be a list")
        result_cases = [case for strategy in strategies for case in strategy.cases]
        if not result_cases:
            result_cases = [GeneratedTestCase(**item) for item in raw_cases]
        message = raw.get("message")
    except HTTPException as exc:
        return GenerateTestCasesResponse(
            cases=[],
            message="Test generation could not finish: {}".format(exc.detail),
            **base_response,
        )
    except (KeyError, IndexError, TypeError, json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Meta returned unexpected test cases.") from exc

    allowed_names = set(file_names)
    unique_cases = []
    unique_strategies = []
    seen = {
        (
            case.invocation,
            case.stdin,
            tuple((fixture.file_name, fixture.contents) for fixture in case.files),
            case.expected_output,
            case.expected_return,
        )
        for case in payload.existing_cases
    }
    def accept_case(test_case: GeneratedTestCase) -> bool:
        if any(fixture.file_name not in allowed_names for fixture in test_case.files):
            raise HTTPException(status_code=502, detail="Meta referenced a file outside this workspace.")
        if method_target and not test_case.invocation:
            return False
        key = (
            test_case.invocation,
            test_case.stdin,
            tuple((fixture.file_name, fixture.contents) for fixture in test_case.files),
            test_case.expected_output,
            test_case.expected_return,
        )
        if key in seen or len(unique_cases) >= generation_count:
            return False
        seen.add(key)
        unique_cases.append(test_case)
        return True

    if strategies:
        for strategy in strategies:
            accepted = [case for case in strategy.cases if accept_case(case)]
            if accepted:
                strategy.cases = accepted
                unique_strategies.append(strategy)
    else:
        for test_case in result_cases:
            accept_case(test_case)
    result_cases = unique_cases
    if method_target:
        if target["language"] == "java" and not result_cases:
            fallback = java_default_invocation(target)
            if fallback:
                result_cases = [GeneratedTestCase(name="Starter case", invocation=fallback)]
    # Keep the displayed AI strategies in sync with cases that can actually run.
    accepted_ids = {id(case) for case in result_cases}
    for strategy in unique_strategies:
        strategy.cases = [case for case in strategy.cases if id(case) in accepted_ids]
    unique_strategies = [strategy for strategy in unique_strategies if strategy.cases]
    harness = build_harness_code(
        target,
        payload.active_file,
        [case.invocation for case in result_cases if case.invocation],
    ) if method_target else build_harness_code(target, payload.active_file, []) if target["kind"] == "fragment" else None
    for case in result_cases:
        if case.invocation:
            single_harness = build_harness_code(target, payload.active_file, [case.invocation])
            if single_harness:
                case.harness_file = single_harness["file"]
                case.harness_code = single_harness["code"]
        elif target["kind"] == "fragment" and harness:
            case.harness_file = harness["file"]
            case.harness_code = harness["code"]
    generated_count = len(result_cases)
    complete = generated_count == payload.count
    if method_target and any(case.expected_return is None for case in result_cases):
        complete = False
        message = message or "Some expected return values are ambiguous. Review them before treating the results as definitive."
    if not complete:
        message = message or "Only {} of {} requested test cases could be generated. Review the target and try again.".format(
            generated_count, payload.count
        )
    return GenerateTestCasesResponse(
        cases=result_cases,
        strategies=unique_strategies,
        generated_count=generated_count,
        complete=complete,
        message=message,
        harness_file=harness["file"] if harness else None,
        harness_code=harness["code"] if harness else None,
        **base_response,
    )
