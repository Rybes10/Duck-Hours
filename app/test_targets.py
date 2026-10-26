"""Small, language-aware helpers for deciding what a submission can test."""

from __future__ import annotations

import ast
import json
import re
import textwrap
from typing import Any, Dict, Iterable, List, Optional


JAVA_MAIN_NOTICE = "Input main method."
JAVA_MAIN_EXPLANATION = (
    "You can add your own main method or test this method using an automatically generated test harness."
)
HARNESS_LANGUAGES = {"python", "javascript", "java", "ruby", "go", "cpp"}


def _line_slice(source: str, start: Optional[int], end: Optional[int]) -> str:
    """Return a bounded, 1-based inclusive slice of source lines."""
    lines = source.splitlines()
    if not lines:
        return ""
    first = max(1, start or 1)
    last = min(len(lines), end or len(lines))
    return "\n".join(lines[first - 1:last])


def _target(kind: str, label: str, *, ready: bool = True, **details: Any) -> Dict[str, Any]:
    return {"kind": kind, "label": label, "ready": ready, **details}


def _python_target(
    code: str,
    label: str,
    selection_start_line: Optional[int],
    selection_end_line: Optional[int],
    selection_start_column: Optional[int],
    selection_end_column: Optional[int],
) -> Dict[str, Any]:
    """Use Python's AST to recognize a whole function or an observable fragment."""
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        return _target(
            "invalid",
            label,
            ready=False,
            validation_error="Python cannot parse this code yet. Fix the syntax before generating tests.",
            validation_line=exc.lineno or 1,
        )

    functions = [
        node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    ]
    class_methods = [
        (owner, node)
        for owner in tree.body if isinstance(owner, ast.ClassDef)
        for node in owner.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    ]
    if selection_start_line is not None and selection_end_line is not None:
        start = min(selection_start_line, selection_end_line)
        end = max(selection_start_line, selection_end_line)
        selected_functions = [
            (owner, node)
            for owner, node in [(None, function) for function in functions] + class_methods
            if node.lineno == start
            and getattr(node, "end_lineno", node.lineno) == end
            and (selection_start_column or 1) <= node.col_offset + 1
            # Monaco's end column is normally exclusive, but a selection that
            # ends exactly on the final character can report the line length.
            # Accept both forms while still requiring the whole AST node.
            and (selection_end_column or 10**6) >= len(code.splitlines()[end - 1])
        ]
        if len(selected_functions) == 1:
            owner, node = selected_functions[0]
            context_nodes = [
                candidate
                for candidate in tree.body
                if candidate is not node and candidate is not owner
                and isinstance(candidate, (ast.Import, ast.ImportFrom, ast.Assign, ast.AnnAssign, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
            ]
            context_code = "\n\n".join(
                segment
                for segment in (ast.get_source_segment(code, candidate) or "" for candidate in context_nodes)
                if segment.strip()
            )
            if owner is not None:
                constructor = next((member for member in owner.body if isinstance(member, ast.FunctionDef)
                                    and member.name == "__init__"), None)
                static_method = any(isinstance(decorator, ast.Name) and decorator.id in {"staticmethod", "classmethod"}
                                    for decorator in node.decorator_list)
                required_constructor = False
                if constructor is not None and not static_method:
                    arguments = constructor.args.posonlyargs + constructor.args.args
                    required_constructor = len(arguments) - len(constructor.args.defaults) > 1
                context_code = "\n\n".join(part for part in (
                    context_code, ast.get_source_segment(code, owner) or ""
                ) if part.strip())
                if required_constructor:
                    return _target("method", "selected code", ready=False,
                                   missing_information="This class needs constructor inputs before its method can be tested.",
                                   class_name=owner.name, method_name=node.name)
                return _target(
                    "method", "selected code", class_name=owner.name, method_name=node.name,
                    static_method=static_method, context_code=context_code,
                    async_function=isinstance(node, ast.AsyncFunctionDef),
                    is_main=node.name.lower() == "main",
                )
            return _target(
                "function",
                "selected code",
                function_name=node.name,
                function_line=node.lineno,
                async_function=isinstance(node, ast.AsyncFunctionDef),
                selected_function_code=ast.get_source_segment(code, node) or "",
                context_code=context_code,
                is_main=node.name.lower() == "main",
            )
        selected_code = _line_slice(code, start, end)
        try:
            selected_tree = ast.parse(selected_code)
        except SyntaxError:
            return _target(
                "fragment",
                "selected code",
                ready=False,
                missing_information=(
                    "The selection is incomplete Python. Select the whole function or include the missing "
                    "imports, variables, and surrounding block."
                ),
            )
        defined_names = set(dir(__builtins__)) if not isinstance(__builtins__, dict) else set(__builtins__)
        defined_names.update({"True", "False", "None"})
        context_nodes = [
            node
            for node in tree.body
            if not (
                getattr(node, "lineno", 0) >= start
                and getattr(node, "end_lineno", getattr(node, "lineno", 0)) <= end
            )
            and isinstance(node, (ast.Import, ast.ImportFrom, ast.Assign, ast.AnnAssign, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
        ]
        context_parts = [ast.get_source_segment(code, node) or "" for node in context_nodes]
        context_code = "\n\n".join(part for part in context_parts if part.strip())
        context_tree = ast.parse(context_code) if context_code else None
        if context_tree:
            for child in ast.walk(context_tree):
                if isinstance(child, ast.Name) and isinstance(child.ctx, ast.Store):
                    defined_names.add(child.id)
                elif isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    defined_names.add(child.name)
                elif isinstance(child, (ast.Import, ast.ImportFrom)):
                    for alias in child.names:
                        defined_names.add(alias.asname or alias.name.split(".")[0])
        observable = False
        loaded_names = set()
        for child in ast.walk(selected_tree):
            if isinstance(child, ast.Name) and isinstance(child.ctx, ast.Store):
                defined_names.add(child.id)
            elif isinstance(child, ast.Name) and isinstance(child.ctx, ast.Load):
                loaded_names.add(child.id)
            elif isinstance(child, ast.Call) and isinstance(child.func, ast.Name) and child.func.id == "print":
                observable = True
        missing = sorted(loaded_names - defined_names)
        if not missing and observable:
            return _target(
                "fragment",
                "selected code",
                fragment_code=selected_code,
                context_code=context_code,
                selection_start_line=start,
                ready=True,
            )
        if missing:
            explanation = "The selection uses names that are defined outside it: {}.".format(", ".join(missing[:5]))
        else:
            explanation = "The selection does not show an observable result, such as printed output."
        return _target(
            "fragment",
            "selected code",
            ready=False,
            missing_information=(
                f"{explanation} Select the surrounding imports, variables, and helpers, or choose a complete function."
            ),
        )

    has_top_level_work = any(
        not isinstance(node, (ast.Import, ast.ImportFrom, ast.Assign, ast.AnnAssign, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
        for node in tree.body
    )
    has_main_guard = any(
        isinstance(node, ast.If)
        and isinstance(node.test, ast.Compare)
        and any(
            isinstance(comparison, ast.Constant) and comparison.value == "__main__"
            for comparison in [node.test.left, *node.test.comparators]
        )
        for node in tree.body
    )
    if functions and not has_top_level_work and not has_main_guard:
        node = functions[0]
        return _target(
            "function",
            "whole submission",
            function_name=node.name,
            function_line=node.lineno,
            async_function=isinstance(node, ast.AsyncFunctionDef),
            is_main=node.name.lower() == "main",
        )
    return _target("program", "whole submission")


def _java_methods(code: str) -> List[Dict[str, Any]]:
    """Extract method spans so selections can be checked for completeness."""
    method_pattern = re.compile(
        r"(?P<prefix>(?:(?:public|private|protected|static|final|synchronized|abstract)\s+)*)"
        r"(?P<return>[A-Za-z_$][\w$]*(?:\s*\[\])*)\s+"
        r"(?P<name>[A-Za-z_$][\w$]*)\s*\((?P<params>[^)]*)\)\s*\{",
        re.MULTILINE,
    )
    methods: List[Dict[str, Any]] = []
    for match in method_pattern.finditer(code):
        line = code.count("\n", 0, match.start()) + 1
        line_start = code.rfind("\n", 0, match.start()) + 1
        start_column = match.start() - line_start + 1
        depth = 1
        closing_index = match.end()
        for index in range(match.end(), len(code)):
            if code[index] == "{":
                depth += 1
            elif code[index] == "}":
                depth -= 1
                if depth == 0:
                    closing_index = index
                    break
        methods.append(
            {
                "name": match.group("name"),
                "return_type": match.group("return"),
                "params": match.group("params").strip(),
                "static": "static" in match.group("prefix").split(),
                "line": line,
                "start_column": start_column,
                "end_line": code.count("\n", 0, closing_index) + 1,
                "end_column": closing_index - code.rfind("\n", 0, closing_index),
                "complete": depth == 0,
            }
        )
    return [method for method in methods if method["name"] not in {"if", "for", "while", "switch", "catch"}]


def _java_target(
    code: str,
    label: str,
    selection_start_line: Optional[int],
    selection_end_line: Optional[int],
    selection_start_column: Optional[int],
    selection_end_column: Optional[int],
) -> Dict[str, Any]:
    class_match = re.search(r"\bclass\s+([A-Za-z_$][\w$]*)", code)
    class_name = class_match.group(1) if class_match else None
    methods = _java_methods(code)
    has_main = bool(re.search(r"\bstatic\s+void\s+main\s*\(\s*String\s*(?:\[\]|\.\.\.)", code))
    selected_methods = methods
    if selection_start_line is not None and selection_end_line is not None:
        start = min(selection_start_line, selection_end_line)
        end = max(selection_start_line, selection_end_line)
        selected_methods = [method for method in methods if start <= method["line"] <= end
                            and method["end_line"] <= end and method["complete"]
                            and (method["end_line"] < end or (selection_end_column or 10**6) >= method["end_column"])]
        if len(selected_methods) != 1 or (selection_start_column or 1) > selected_methods[0]["start_column"]:
            return _target(
                "fragment",
                "selected code",
                ready=False,
                missing_information=(
                    "Select one complete Java method, including its closing brace and the class around it, "
                    "or provide the missing class and input details."
                ),
            )

    if has_main and selection_start_line is None:
        return _target("program", label, class_name=class_name, has_main=True)
    if selected_methods:
        method = selected_methods[0]
        constructor_pattern = re.compile(
            r"(?:public|protected|private)?\s*" + re.escape(class_name or "") + r"\s*\(([^)]*)\)"
        )
        constructors = constructor_pattern.findall(code) if class_name else []
        needs_constructor = any(arguments.strip() for arguments in constructors)
        details: Dict[str, Any] = {
            "class_name": class_name,
            "method_name": method["name"],
            "return_type": method["return_type"],
            "static_method": method["static"],
            "params": method["params"],
            "method_line": method["line"],
            "has_main": has_main,
            "is_main": method["name"].lower() == "main",
            "banner": JAVA_MAIN_NOTICE if not has_main else None,
            "explanation": JAVA_MAIN_EXPLANATION if not has_main else None,
        }
        if not class_name:
            # A Java method is valid input for Office Hours Prep even when the
            # user has not written the surrounding class yet.  The generated
            # harness supplies that class in a separate file, so the editor
            # contents remain exactly as submitted.
            details.update(
                {
                    "class_name": "OfficeHoursSubmission",
                    "standalone_java": True,
                    "selected_method_code": textwrap.dedent(
                        _line_slice(code, method["line"], method["end_line"])
                    ).strip(),
                    "java_imports": re.findall(
                        r"^\s*import\s+[^;]+;\s*$", code, flags=re.MULTILINE
                    ),
                }
            )
        elif needs_constructor and not method["static"]:
            details["ready"] = False
            details["missing_information"] = (
                "This instance method needs constructor arguments. Add the constructor values in the test setup "
                "so the generated harness can create the object."
            )
        return _target("method", label, **details)
    if re.search(r"\b(class|interface|enum)\b", code):
        return _target(
            "invalid",
            label,
            ready=False,
            validation_error="Java needs a valid main method or a complete method to test.",
        )
    return _target(
        "fragment",
        label,
        ready=False,
        missing_information="This Java selection is not a complete class or method. Select more surrounding code.",
    )


def _split_cpp_parameters(parameters: str) -> List[str]:
    """Split C++ parameters without treating template commas as separators."""
    if not parameters.strip():
        return []
    parts: List[str] = []
    start = 0
    angle_depth = 0
    paren_depth = 0
    bracket_depth = 0
    for index, character in enumerate(parameters):
        if character == "<":
            angle_depth += 1
        elif character == ">" and angle_depth:
            angle_depth -= 1
        elif character == "(":
            paren_depth += 1
        elif character == ")" and paren_depth:
            paren_depth -= 1
        elif character == "[":
            bracket_depth += 1
        elif character == "]" and bracket_depth:
            bracket_depth -= 1
        elif character == "," and not angle_depth and not paren_depth and not bracket_depth:
            parts.append(parameters[start:index].strip())
            start = index + 1
    parts.append(parameters[start:].strip())
    return [part for part in parts if part]


def _cpp_function_details(source: str, function_name: str) -> Dict[str, Any]:
    """Extract the small amount of C++ signature data the test UI needs."""
    signature = re.search(
        r"\b{}\s*\((?P<params>[^;{{}}()]*)\)".format(re.escape(function_name)),
        source,
    )
    if not signature:
        return {}
    prefix = source[:signature.start()].splitlines()[-1].strip()
    prefix = re.sub(
        r"^(?:(?:const|static|inline|constexpr|consteval|virtual|explicit|friend|extern)\s+)+",
        "",
        prefix,
    ).strip()
    # For a qualified free-function definition, keep only the return type.
    prefix = re.sub(r"(?:[A-Za-z_]\w*::)+$", "", prefix).strip()
    parameters = signature.group("params").strip()
    return {
        "return_type": prefix or None,
        "params": parameters,
        "parameter_count": len(_split_cpp_parameters(parameters)),
    }


def _cpp_supporting_code(source: str) -> Dict[str, List[str]]:
    """Keep harmless headers and using declarations for a selected C++ function."""
    includes = re.findall(
        r"^\s*#\s*include\s*(?:<[^>\n]+>|\"[^\"\n]+\")\s*(?://.*)?$",
        source,
        flags=re.MULTILINE,
    )
    preamble = re.findall(
        r"^\s*(?:using\s+namespace\s+[^;]+;|using\s+[A-Za-z_]\w*(?:::\w+)*\s*=\s*[^;]+;)\s*$",
        source,
        flags=re.MULTILINE,
    )
    return {"cpp_includes": list(dict.fromkeys(includes)), "cpp_preamble": list(dict.fromkeys(preamble))}


def _generic_target(
    language: str,
    code: str,
    label: str,
    selection_start_line: Optional[int],
    selection_end_line: Optional[int],
    selection_start_column: Optional[int],
    selection_end_column: Optional[int],
) -> Dict[str, Any]:
    """Apply lightweight signature and selection checks for non-AST languages."""
    function_pattern = {
        "javascript": r"\bfunction\s+([A-Za-z_$][\w$]*)\s*\(",
        "typescript": r"\bfunction\s+([A-Za-z_$][\w$]*)\s*\(",
        "ruby": r"\bdef\s+([A-Za-z_][\w!?=]*)",
        "go": r"\bfunc\s+([A-Za-z_][\w]*)\s*\(",
        "c": r"\b[A-Za-z_][\w\s*]+\s+([A-Za-z_][\w]*)\s*\([^;]*\)\s*\{",
        "cpp": r"\b[A-Za-z_][\w:\s*&<>,~]*\s+([A-Za-z_][\w]*)\s*\([^;{}()]*\)\s*\{",
    }.get(language)
    names = re.findall(function_pattern, code) if function_pattern else []
    has_top_level_call = bool(re.search(r"\b(?:console\.log|puts|printf|fmt\.Print|println)\s*\(", code))
    if selection_start_line is not None and selection_end_line is not None:
        selected_lines = _line_slice(code, selection_start_line, selection_end_line).splitlines()
        if selected_lines:
            selected_lines[0] = selected_lines[0][max(0, (selection_start_column or 1) - 1):]
            if len(selected_lines) == 1:
                width = (selection_end_column or len(code) + 1) - (selection_start_column or 1)
                selected_lines[0] = selected_lines[0][:max(0, width)]
            elif selection_end_column is not None:
                selected_lines[-1] = selected_lines[-1][:max(0, selection_end_column - 1)]
        selected = "\n".join(selected_lines).strip()
        selected_names = re.findall(function_pattern, selected) if function_pattern else []
        if len(selected_names) != 1:
            return _target("invalid", label, ready=False, missing_information=
                           "Highlight one complete function or method. Use Run for the full program.")
        if language in {"javascript", "typescript", "go", "c", "cpp"}:
            opening = selected.find("{")
            depth = 0
            closing = -1
            for index in range(opening, len(selected)):
                if selected[index] == "{":
                    depth += 1
                elif selected[index] == "}":
                    depth -= 1
                    if depth == 0:
                        closing = index
                        break
            if opening < 0 or closing < 0 or selected[closing + 1:].strip():
                return _target("invalid", label, ready=False, missing_information=
                               "Highlight only the complete function, including its closing brace.")
        if language == "ruby" and not re.search(r"\bend\s*$", selected):
            return _target("invalid", label, ready=False, missing_information=
                           "Include the entire method, through its end line.")
        signature = re.search(r"(?:function|def|func)\s+" + re.escape(selected_names[0]) + r"\s*\(([^)]*)\)", selected)
        parameter_count = 0 if not signature or not signature.group(1).strip() else len(signature.group(1).split(","))
        details = {"function_name": selected_names[0], "parameter_count": parameter_count,
                   "selected_function_code": selected, "function_line": selection_start_line,
                   "is_main": selected_names[0].lower() == "main"}
        if language == "cpp":
            details.update(_cpp_function_details(selected, selected_names[0]))
            details.update(_cpp_supporting_code(code))
        if language == "go":
            imports = re.findall(r'"[A-Za-z0-9_./-]+"', "\n".join(re.findall(
                r"(?ms)^\s*import\s*(?:\([^)]*\)|\"[^\"]+\")", code
            )))
            details["go_imports"] = list(dict.fromkeys(imports))
        return _target("function", label, **details)
    if names and not has_top_level_call and selection_start_line is None:
        signature = re.search(
            r"(?:function|def|func)\s+" + re.escape(names[0]) + r"\s*\(([^)]*)\)", code
        )
        parameter_count = 0 if not signature or not signature.group(1).strip() else len(signature.group(1).split(","))
        details = {"function_name": names[0], "parameter_count": parameter_count, "method_line": None,
                   "is_main": names[0].lower() == "main"}
        if language == "cpp":
            details.update(_cpp_function_details(code, names[0]))
            details.update(_cpp_supporting_code(code))
        return _target(
            "function", label, **details
        )
    if selection_start_line is not None and selection_end_line is not None and not names:
        return _target(
            "fragment",
            label,
            ready=False,
            missing_information="The selected code is not a complete function. Select the whole function and its helpers.",
        )
    return _target("program", label)


def detect_test_target(
    language: str,
    code: str,
    *,
    active_file: str = "main.py",
    selection_start_line: Optional[int] = None,
    selection_end_line: Optional[int] = None,
    selection_start_column: Optional[int] = None,
    selection_end_column: Optional[int] = None,
) -> Dict[str, Any]:
    """Return conservative metadata; execution still validates with the real compiler/interpreter."""
    label = "selected code" if selection_start_line is not None and selection_end_line is not None else "whole submission"
    if language == "python":
        result = _python_target(code, label, selection_start_line, selection_end_line, selection_start_column, selection_end_column)
    elif language == "java":
        result = _java_target(code, label, selection_start_line, selection_end_line, selection_start_column, selection_end_column)
    else:
        result = _generic_target(language, code, label, selection_start_line, selection_end_line, selection_start_column, selection_end_column)
    result["language"] = language
    result["active_file"] = active_file
    if result.get("kind") in {"function", "method"} and language not in HARNESS_LANGUAGES:
        result["ready"] = False
        result["missing_information"] = (
            "Automatic method testing is not available for this language yet. Add a small entry point that calls "
            "the function, or use Run for the whole program instead."
        )
    if result.get("kind") == "program" and label == "selected code":
        result["ready"] = False
        result["missing_information"] = "Highlight one complete function or method instead. Use Run for the whole program."
    return result


def _java_sample_arguments(params: str) -> Optional[List[str]]:
    if not params.strip():
        return []
    arguments: List[str] = []
    for parameter in params.split(","):
        pieces = parameter.strip().split()
        if len(pieces) < 2:
            return None
        parameter_type = " ".join(pieces[:-1])
        lowered = parameter_type.lower()
        if lowered in {"string[]", "string..."}:
            arguments.append("new String[]{}")
        elif "string" in lowered:
            arguments.append('"office hours"')
        elif lowered in {"int", "short", "byte", "long"}:
            arguments.append("2")
        elif lowered in {"double", "float"}:
            arguments.append("2.5")
        elif lowered == "boolean":
            arguments.append("true")
        elif lowered.endswith("[]") and lowered[:-2] in {"int", "long", "double", "float"}:
            arguments.append("new int[]{1, 2, 3}")
        else:
            return None
    return arguments


def build_harness_code(target: Dict[str, Any], active_file: str, invocations: Iterable[str]) -> Optional[Dict[str, str]]:
    """Build an inspectable wrapper without modifying the submitted source."""
    calls = [str(invocation).strip() for invocation in invocations if str(invocation).strip()]
    if target.get("kind") == "fragment" and target.get("language") == "python" and target.get("fragment_code"):
        padding = "\n" * max(0, int(target.get("selection_start_line") or 1) - 1)
        source = padding + str(target["fragment_code"]) + "\n"
        code_literal = json.dumps(source)
        context_literal = json.dumps(str(target.get("context_code") or ""))
        code = "\n".join(
            [
                "# Office Hours Prep generated test harness",
                "import sys",
                f"__ohp_context = compile({context_literal}, {active_file!r}, 'exec')",
                "__ohp_namespace = {'__name__': '__office_hours_context__'}",
                "exec(__ohp_context, __ohp_namespace)",
                f"__ohp_fragment = compile({code_literal}, {active_file!r}, 'exec')",
                "try:",
                "    __ohp_namespace['__name__'] = '__main__'",
                "    exec(__ohp_fragment, __ohp_namespace)",
                "except Exception:",
                "    raise",
            ]
        ) + "\n"
        return {"file": "__office_hours_fragment_harness.py", "code": code}
    if target.get("kind") != "function" and target.get("kind") != "method":
        return None
    if not calls:
        return None
    language = target.get("language")
    if language == "python":
        async_call = "asyncio.run(__ohp_value)" if target.get("async_function") else "__ohp_value"
        lines = ["# Office Hours Prep generated test harness", "import asyncio"]
        if target.get("class_name") and target.get("context_code"):
            context_literal = json.dumps(str(target["context_code"]))
            lines.extend([
                "__ohp_namespace = {'__name__': '__office_hours_submission__'}",
                f"__ohp_context = compile({context_literal}, {active_file!r}, 'exec')",
                "exec(__ohp_context, __ohp_namespace)",
            ])
        elif target.get("selected_function_code"):
            context_literal = json.dumps(str(target.get("context_code") or ""))
            function_padding = "\n" * max(0, int(target.get("function_line") or 1) - 1)
            function_literal = json.dumps(function_padding + str(target["selected_function_code"]) + "\n")
            lines.extend([
                f"__ohp_namespace = {{'__name__': '__office_hours_submission__'}}",
                f"__ohp_context = compile({context_literal}, {active_file!r}, 'exec')",
                "exec(__ohp_context, __ohp_namespace)",
                f"__ohp_function_source = compile({function_literal}, {active_file!r}, 'exec')",
                "exec(__ohp_function_source, __ohp_namespace)",
            ])
        else:
            namespace_file = json.dumps(active_file)
            lines.extend([
                "import runpy",
                f"__ohp_namespace = runpy.run_path({namespace_file}, run_name='__office_hours_submission__')",
            ])
        if target.get("function_name"):
            lines.append(f"__ohp_function = __ohp_namespace[{target['function_name']!r}]")
        for index, call in enumerate(calls, 1):
            lines.extend(
                [
                    "try:",
                    f"    __ohp_value = eval({call!r}, __ohp_namespace)",
                    f"    __ohp_value = {async_call}",
                    f"    print('Office Hours Prep result {index}: ' + repr(__ohp_value))",
                    "except Exception as __ohp_error:",
                    f"    print('Office Hours Prep test {index} failed: ' + type(__ohp_error).__name__ + ': ' + str(__ohp_error))",
                    "    raise",
                ]
            )
        return {"file": "__office_hours_harness.py", "code": "\n".join(lines) + "\n"}
    if language == "javascript":
        source_file = json.dumps(active_file)
        lines = [
            "// Office Hours Prep generated test harness",
            "const vm = require('vm');",
            f"const __ohp_source = {json.dumps(target.get('selected_function_code'))};" if target.get("selected_function_code") else
            f"const __ohp_source = require('fs').readFileSync({source_file}, 'utf8');",
            "const __ohp_tests = [];",
        ]
        for index, call in enumerate(calls, 1):
            lines.append(
                f"__ohp_tests.push(`try {{ const value = ({call}); console.log('Office Hours Prep result {index}: ' + String(value)); }} catch (error) {{ console.error('Office Hours Prep test {index} failed: ' + error.name + ': ' + error.message); process.exitCode = 1; }}`);"
            )
        lines.extend([
            "try {",
            "  vm.runInThisContext(__ohp_source + '\\n' + __ohp_tests.join('\\n'), {filename: '" + active_file.replace("'", "\\'") + "'});",
            "} catch (error) {",
            "  console.error('Office Hours Prep generated harness failed: ' + error.name + ': ' + error.message);",
            "  process.exitCode = 1;",
            "}",
        ])
        return {"file": "__office_hours_harness.js", "code": "\n".join(lines) + "\n"}
    if language == "ruby":
        source_file = active_file.replace("'", "\\'")
        lines = [
            "# Office Hours Prep generated test harness",
            f"eval({json.dumps(str(target['selected_function_code']))})" if target.get("selected_function_code") else f"load '{source_file}'",
        ]
        for index, call in enumerate(calls, 1):
            lines.extend([
                "begin",
                f"  value = eval({call!r})",
                f"  puts 'Office Hours Prep result {index}: ' + value.inspect",
                "rescue StandardError => error",
                f"  warn 'Office Hours Prep test {index} failed: ' + error.class.to_s + ': ' + error.message",
                "  exit 1",
                "end",
            ])
        return {"file": "__office_hours_harness.rb", "code": "\n".join(lines) + "\n"}
    if language == "go":
        imports = list(target.get("go_imports") or [])
        submitted_function_code = str(target.get("selected_function_code") or "")
        submitted_main_name = "__office_hours_submitted_main"
        if target.get("is_main"):
            # The wrapper owns the executable entry point, so rename the selected one.
            submitted_function_code = re.sub(
                r"\bfunc\s+main\s*\(",
                f"func {submitted_main_name}(",
                submitted_function_code,
                count=1,
            )
        if '"fmt"' not in imports and (not target.get("is_main") or re.search(r"\bfmt\s*\.", submitted_function_code)):
            imports.insert(0, '"fmt"')
        lines = [
            "// Office Hours Prep generated test harness",
            "package main",
            "",
        ]
        if imports:
            lines.extend([
                "import (" + "\n".join("\n\t" + item for item in imports) + "\n)",
                "",
            ])
        if submitted_function_code:
            lines.extend([
                f"//line {active_file}:{target.get('function_line') or 1}",
                submitted_function_code,
                "",
            ])
        lines.append("func main() {")
        for index, call in enumerate(calls, 1):
            expression = str(call).strip().rstrip(";").strip()
            if target.get("is_main"):
                expression = re.sub(r"^main\s*\(", f"{submitted_main_name}(", expression, count=1)
                lines.append(f"\t{expression}")
            else:
                lines.append(f'\tfmt.Printf("Office Hours Prep result {index}: %v\\n", {expression})')
        lines.extend(["}", ""])
        return {"file": "__office_hours_harness.go", "code": "\n".join(lines)}
    if language == "cpp" and target.get("function_name"):
        includes = [
            "#include <array>",
            "#include <cstddef>",
            "#include <iomanip>",
            "#include <iostream>",
            "#include <string>",
            "#include <vector>",
        ]
        for include in target.get("cpp_includes") or []:
            if include not in includes:
                includes.append(include)
        preamble = list(target.get("cpp_preamble") or [])
        submitted_function_code = textwrap.dedent(str(target.get("selected_function_code") or "")).strip()
        lines = [
            "// Office Hours Prep generated test harness",
            *includes,
            *preamble,
            "",
        ]
        if submitted_function_code:
            lines.extend([
                f"//line {active_file}:{target.get('function_line') or 1}",
                submitted_function_code,
                "",
            ])
        lines.extend([
            "template <typename T>",
            "void __ohp_print_value(const T& value) { std::cout << value; }",
            "",
            "template <typename T>",
            "void __ohp_print_value(const std::vector<T>& values) {",
            "  std::cout << \"[\";",
            "  for (std::size_t index = 0; index < values.size(); ++index) {",
            "    if (index) std::cout << \", \";",
            "    __ohp_print_value(values[index]);",
            "  }",
            "  std::cout << \"]\";",
            "}",
            "",
            "template <typename T, std::size_t N>",
            "void __ohp_print_value(const std::array<T, N>& values) {",
            "  std::cout << \"[\";",
            "  for (std::size_t index = 0; index < N; ++index) {",
            "    if (index) std::cout << \", \";",
            "    __ohp_print_value(values[index]);",
            "  }",
            "  std::cout << \"]\";",
            "}",
            "",
            "int main() {",
            "  std::boolalpha;",
            "  std::setprecision(17);",
        ])
        return_type = str(target.get("return_type") or "").replace(" ", "").lower()
        for index, call in enumerate(calls, 1):
            expression = str(call).strip().rstrip(";").strip()
            if return_type in {"void", "none"}:
                lines.extend([
                    f"  {expression};",
                    f'  std::cout << "Office Hours Prep result {index}: void\\n";',
                ])
            else:
                lines.extend([
                    f"  auto __ohp_value_{index} = ({expression});",
                    f'  std::cout << "Office Hours Prep result {index}: ";',
                    f"  __ohp_print_value(__ohp_value_{index});",
                    '  std::cout << "\\n";',
                ])
        lines.extend(["}", ""])
        return {"file": "__office_hours_harness.cpp", "code": "\n".join(lines)}
    if language == "java" and target.get("method_name"):
        class_name = target.get("class_name") or "OfficeHoursSubmission"
        method_name = target["method_name"]
        # The harness is a separate class, so static methods still need the
        # submitted class qualifier.  Instance methods are called on a new
        # object when the class has a usable no-argument constructor.
        receiver = f"{class_name}." if target.get("static_method") else f"new {class_name}()."
        return_type = str(target.get("return_type") or "").replace(" ", "")
        lines = ["// Office Hours Prep generated test harness"]
        if target.get("standalone_java"):
            lines.extend(target.get("java_imports") or [])
            lines.extend([
                "",
                f"class {class_name} {{",
                textwrap.dedent(str(target.get("selected_method_code") or "")).strip(),
                "}",
            ])
        lines.extend([
            "",
            "public class OfficeHoursHarness {",
            "  public static void main(String[] args) {",
        ])
        for index, call in enumerate(calls, 1):
            expression = str(call).strip().rstrip(";").strip()
            expression = expression if expression.startswith((f"{class_name}.", "new ")) else f"{receiver}{expression}"
            if return_type in {"void", "none"}:
                lines.append(f"    {expression};")
                continue
            if return_type.endswith("[]"):
                # Primitive arrays need Arrays.toString; nested/object arrays use the deep variant.
                element_type = return_type[:-2]
                if element_type.endswith("[]"):
                    rendered = f"java.util.Arrays.deepToString((Object[]) ({expression}))"
                elif element_type in {"int", "long", "short", "byte", "double", "float", "boolean", "char"}:
                    rendered = f"java.util.Arrays.toString(({return_type}) ({expression}))"
                else:
                    rendered = f"java.util.Arrays.deepToString((Object[]) ({expression}))"
            else:
                rendered = f"String.valueOf({expression})"
            lines.append(f"    System.out.println(\"Office Hours Prep result {index}: \" + {rendered});")
        lines.extend(["  }", "}"])
        return {"file": "OfficeHoursHarness.java", "code": "\n".join(lines) + "\n"}
    return None


def java_default_invocation(target: Dict[str, Any]) -> Optional[str]:
    """Provide a conservative first invocation for a Java method when no AI case exists."""
    if target.get("language") != "java" or not target.get("method_name"):
        return None
    args = _java_sample_arguments(target.get("params", ""))
    if args is None:
        return None
    class_name = target.get("class_name")
    if not class_name:
        return None
    prefix = f"{class_name}." if target.get("static_method") else f"new {class_name}()."
    return f"{prefix}{target['method_name']}({', '.join(args)})"


def default_function_invocation(target: Dict[str, Any]) -> Optional[str]:
    """Return a small safe starter call for languages with a simple function syntax."""
    if target.get("kind") != "function" or target.get("language") not in {"javascript", "ruby", "go"}:
        return None
    name = target.get("function_name")
    if not name:
        return None
    count = int(target.get("parameter_count") or 0)
    values = ["2", "3", "5"][:count]
    return f"{name}({', '.join(values)})"
