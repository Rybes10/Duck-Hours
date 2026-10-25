"""Regression checks for the merged test-generation and workspace-runner contracts."""

import json
import shutil
import time
import unittest
from unittest.mock import patch

from app.analysis import demo_analysis, generate_test_cases, meta_analysis, meta_hint, neutralize_provider_language
from app.runner import likely_non_terminating_line, run_code
from app.schemas import AnalyzeRequest, GenerateTestCasesRequest, HintRequest, RunRequest, TestTargetRequest, WorkspaceFile


class RunnerFileTests(unittest.TestCase):
    def test_run_compiles_only_the_active_cpp_file(self) -> None:
        if not shutil.which("g++"):
            self.skipTest("g++ is not installed")
        result = run_code(RunRequest(
            language="cpp",
            active_file="main.cpp",
            code="#include <iostream>\nint main() { std::cout << 7; }",
            files=[WorkspaceFile(name="unrelated.cpp", code="int broken( {" )],
        ))
        self.assertEqual(result.status, "success")
        self.assertEqual(result.output, "7")

    def test_required_cpp_header_error_names_the_dependency(self) -> None:
        if not shutil.which("g++"):
            self.skipTest("g++ is not installed")
        result = run_code(RunRequest(
            language="cpp",
            active_file="main.cpp",
            code='#include "helper.h"\nint main() { return helper(); }',
            files=[WorkspaceFile(name="helper.h", code="#error broken header")],
        ))
        self.assertEqual(result.status, "compile_error")
        self.assertEqual(result.error_source, "dependency")
        self.assertEqual(result.error_file, "helper.h")
        self.assertEqual(result.line, 1)
        self.assertIn('"helper.h"', result.error or "")

    def test_run_compiles_only_the_active_java_file_and_uses_its_declared_class(self) -> None:
        if not (shutil.which("javac") and shutil.which("java")):
            self.skipTest("Java is not installed")
        result = run_code(RunRequest(
            language="java",
            active_file="current.java",
            code="class Helper { } class Current { public static void main(String[] args) { System.out.println(7); } }",
            files=[WorkspaceFile(name="unrelated.java", code="public class Unrelated { public static void broken( {" )],
        ))
        self.assertEqual(result.status, "success")
        self.assertEqual(result.output, "7\n")

    def test_required_java_dependency_error_names_the_dependency(self) -> None:
        if not (shutil.which("javac") and shutil.which("java")):
            self.skipTest("Java is not installed")
        result = run_code(RunRequest(
            language="java",
            active_file="Main.java",
            code="public class Main { public static void main(String[] args) { System.out.println(Helper.value()); } }",
            files=[
                WorkspaceFile(name="Helper.java", code="class Helper { static int value( { return 7; } }"),
                WorkspaceFile(name="Unrelated.java", code="public class Unrelated { public static void broken( {"),
            ],
        ))
        self.assertEqual(result.status, "compile_error")
        self.assertEqual(result.error_source, "dependency")
        self.assertEqual(result.error_file, "Helper.java")
        self.assertEqual(result.line, 1)

    def test_python_runtime_dependency_error_names_the_imported_file(self) -> None:
        result = run_code(RunRequest(
            language="python",
            active_file="main.py",
            code="import helper\nprint(helper.value())",
            files=[WorkspaceFile(name="helper.py", code="def value():\n    return missing_name\n")],
        ))
        self.assertEqual(result.status, "runtime_error")
        self.assertEqual(result.error_source, "dependency")
        self.assertEqual(result.error_file, "helper.py")
        self.assertEqual(result.line, 2)

    def test_demo_analysis_does_not_flag_valid_function_names_or_parameters(self) -> None:
        result = demo_analysis(AnalyzeRequest(
            intent="Label a score and wrap text in parentheses.",
            code=(
                'def grade_label(score):\n'
                '    if score >= 90:\n'
                '        return "excellent"\n'
                '    return "passing"\n\n'
                'def parenthesize(text):\n'
                '    return f"({text})"\n\n'
                'print(grade_label(90))\n'
                'print(parenthesize("Duck Hours"))\n'
            ),
        ))
        self.assertFalse([issue for issue in result.issues if issue.category == "NameError"])

    def test_java_static_method_harness_qualifies_the_submitted_class(self) -> None:
        source = "public class Demo { public static int add(int a, int b) { return a + b; } }"
        from app.test_targets import build_harness_code, detect_test_target

        target = detect_test_target("java", source, active_file="Demo.java")
        harness = build_harness_code(target, "Demo.java", ["add(2, 3)"])
        self.assertIsNotNone(harness)
        self.assertIn("Demo.add(2, 3)", harness["code"])
        if shutil.which("javac") and shutil.which("java"):
            result = run_code(RunRequest(
                language="java",
                active_file="Demo.java",
                code=source,
                harness_file=harness["file"],
                harness_code=harness["code"],
            ))
            self.assertEqual(result.status, "success")
            self.assertIn("Office Hours Prep result 1: 5", result.output)

    def test_standalone_java_method_runs_in_a_generated_wrapper(self) -> None:
        from app.test_targets import build_harness_code, detect_test_target

        source = "static int add(int a, int b) { return a + b; }\n"
        target = detect_test_target("java", source, active_file="Demo.java")
        self.assertTrue(target["ready"])
        self.assertTrue(target["standalone_java"])
        self.assertEqual(target["class_name"], "OfficeHoursSubmission")
        harness = build_harness_code(target, "Demo.java", ["add(2, 3)"])
        self.assertIsNotNone(harness)
        self.assertIn("class OfficeHoursSubmission", harness["code"])
        self.assertIn("OfficeHoursSubmission.add(2, 3)", harness["code"])
        if shutil.which("javac") and shutil.which("java"):
            result = run_code(RunRequest(
                language="java",
                active_file="Demo.java",
                code=source,
                harness_file=harness["file"],
                harness_code=harness["code"],
            ))
            self.assertEqual(result.status, "success")
            self.assertIn("Office Hours Prep result 1: 5", result.output)

    def test_standalone_java_instance_method_runs_in_a_generated_wrapper(self) -> None:
        from app.test_targets import build_harness_code, detect_test_target

        source = "int add(int a, int b) { return a + b; }\n"
        target = detect_test_target("java", source, active_file="Demo.java")
        self.assertTrue(target["ready"])
        harness = build_harness_code(target, "Demo.java", ["add(2, 3)"])
        self.assertIsNotNone(harness)
        self.assertIn("new OfficeHoursSubmission().add(2, 3)", harness["code"])
        if shutil.which("javac") and shutil.which("java"):
            result = run_code(RunRequest(
                language="java",
                active_file="Demo.java",
                code=source,
                harness_file=harness["file"],
                harness_code=harness["code"],
            ))
            self.assertEqual(result.status, "success")
            self.assertIn("Office Hours Prep result 1: 5", result.output)

    def test_selected_cpp_function_runs_in_a_generated_wrapper(self) -> None:
        from app.test_targets import build_harness_code, detect_test_target

        source = "#include <string>\nstd::string wrap(const std::string& text) { return \"(\" + text + \")\"; }\n"
        function_line = source.splitlines()[1]
        target = detect_test_target(
            "cpp",
            source,
            active_file="main.cpp",
            selection_start_line=2,
            selection_end_line=2,
            selection_start_column=1,
            selection_end_column=len(function_line) + 1,
        )
        self.assertTrue(target["ready"])
        self.assertEqual(target["function_name"], "wrap")
        self.assertEqual(target["return_type"], "std::string")
        harness = build_harness_code(target, "main.cpp", ['wrap("Duck")', 'wrap("")'])
        self.assertIsNotNone(harness)
        self.assertIn("__office_hours_harness.cpp", harness["file"])
        self.assertIn("wrap(\"Duck\")", harness["code"])
        if shutil.which("g++"):
            result = run_code(RunRequest(
                language="cpp",
                active_file="main.cpp",
                code=source,
                harness_file=harness["file"],
                harness_code=harness["code"],
            ))
            self.assertEqual(result.status, "success")
            self.assertIn("Office Hours Prep result 1: (Duck)", result.output)
            self.assertIn("Office Hours Prep result 2: ()", result.output)

    def test_selected_cpp_integer_function_runs_in_a_generated_wrapper(self) -> None:
        from app.test_targets import build_harness_code, detect_test_target

        source = "int add(int left, int right) { return left + right; }\n"
        function_line = source.splitlines()[0]
        target = detect_test_target(
            "cpp",
            source,
            active_file="main.cpp",
            selection_start_line=1,
            selection_end_line=1,
            selection_start_column=1,
            selection_end_column=len(function_line) + 1,
        )
        self.assertTrue(target["ready"])
        self.assertEqual(target["return_type"], "int")
        harness = build_harness_code(target, "main.cpp", ["add(2, 3)"])
        self.assertIsNotNone(harness)
        if shutil.which("g++"):
            result = run_code(RunRequest(
                language="cpp",
                active_file="main.cpp",
                code=source,
                harness_file=harness["file"],
                harness_code=harness["code"],
            ))
            self.assertEqual(result.status, "success")
            self.assertIn("Office Hours Prep result 1: 5", result.output)

    def test_selected_cpp_function_can_use_a_workspace_header(self) -> None:
        from app.test_targets import build_harness_code, detect_test_target

        source = "#include <math_helpers.h>\nint double_value_for_test(int value) { return double_value(value); }\n"
        function_line = source.splitlines()[1]
        target = detect_test_target(
            "cpp",
            source,
            active_file="main.cpp",
            selection_start_line=2,
            selection_end_line=2,
            selection_start_column=1,
            selection_end_column=len(function_line) + 1,
        )
        harness = build_harness_code(target, "main.cpp", ["double_value_for_test(21)"])
        self.assertIsNotNone(harness)
        self.assertIn("#include <math_helpers.h>", harness["code"])
        if shutil.which("g++"):
            result = run_code(RunRequest(
                language="cpp",
                active_file="main.cpp",
                code=source,
                files=[WorkspaceFile(
                    name="math_helpers.h",
                    code="inline int double_value(int value) { return value * 2; }\n",
                )],
                harness_file=harness["file"],
                harness_code=harness["code"],
            ))
            self.assertEqual(result.status, "success")
            self.assertIn("Office Hours Prep result 1: 42", result.output)

    def test_snapshot_contains_existing_and_generated_files(self) -> None:
        result = run_code(RunRequest(
            code=(
                'from pathlib import Path\n'
                'value = Path("input.txt").read_text()\n'
                'Path("result.txt").write_text(value.upper())\n'
                'print(value.upper())\n'
            ),
            files=[WorkspaceFile(name="input.txt", code="hello")],
            files_to_check=["input.txt", "result.txt"],
            memory_limit_mb=256,
        ))
        self.assertEqual(result.status, "success")
        self.assertEqual(result.output.strip(), "HELLO")
        snapshot = {file.name: file.contents for file in result.workspace_files}
        self.assertEqual(snapshot["input.txt"], "hello")
        self.assertEqual(snapshot["result.txt"], "HELLO")
        self.assertIsNotNone(result.memory_usage_bytes)

    def test_requested_timeout_stops_a_non_terminating_program(self) -> None:
        started = time.monotonic()
        result = run_code(RunRequest(
            code="while True:\n    pass\n",
            timeout_seconds=1,
        ))
        elapsed = time.monotonic() - started
        self.assertEqual(result.status, "runtime_error")
        self.assertEqual(result.error_type, "TimeoutError")
        self.assertIn("1 second", result.error or "")
        self.assertLess(elapsed, 5)

    def test_recursive_runtime_points_to_function_definition(self) -> None:
        result = run_code(RunRequest(
            code="def recurse():\n    return recurse()\n\nrecurse()\n",
        ))
        self.assertEqual(result.status, "runtime_error")
        self.assertEqual(result.error_type, "RecursionError")
        self.assertEqual(result.line, 1)

    def test_non_terminating_line_finds_loop_header(self) -> None:
        self.assertEqual(likely_non_terminating_line("python", "value = 0\nwhile True:\n    value += 1\n"), 2)


class LogicAnalysisTests(unittest.IsolatedAsyncioTestCase):
    def test_provider_language_is_removed_from_explanations(self) -> None:
        cleaned = neutralize_provider_language("Meta found this. As an AI, I think the model should check it. The AI-generated note is short.")
        self.assertNotIn("meta", cleaned.lower())
        self.assertNotIn("as an ai", cleaned.lower())
        self.assertNotIn("ai-generated", cleaned.lower())
        self.assertNotIn("i think", cleaned.lower())

    async def test_analysis_does_not_expose_provider_name(self) -> None:
        async def fake_completion(prompt: str) -> str:
            return json.dumps({
                "summary": "Meta found a likely issue.",
                "issues": [{
                    "category": "Logic", "title": "Meta noticed this", "explanation": "As an AI, I think this is suspicious.",
                    "fix": "I recommend checking the value.", "line": 1, "severity": "warning"
                }],
                "walkthrough": ["I found the likely line."]
            })

        with patch("app.analysis.meta_completion", fake_completion):
            result = await meta_analysis(AnalyzeRequest(
                mode="gemini", code="print('hello')\n", actual_output="hello\n"
            ))
        visible_text = json.dumps({
            "summary": result.summary,
            "issues": [issue.model_dump() for issue in result.issues],
            "walkthrough": result.walkthrough,
        }).lower()
        self.assertNotIn("meta", visible_text)
        self.assertNotIn("as an ai", visible_text)
        self.assertNotIn("i think", visible_text)

    async def test_logic_check_still_runs_without_predicted_output(self) -> None:
        async def fake_completion(prompt: str) -> str:
            self.assertIn("always inspect", prompt.lower())
            self.assertIn("empty", prompt.lower())
            return json.dumps({"summary": "No likely issue was found.", "issues": [], "walkthrough": []})

        with patch("app.analysis.meta_completion", fake_completion):
            result = await meta_analysis(AnalyzeRequest(
                mode="gemini",
                intent="Print a greeting",
                code="print('hello')\n",
                actual_output="hello\n",
                predicted_output="",
            ))
        self.assertEqual(result.issues, [])

    async def test_timeout_hint_has_a_fallback_line_when_model_returns_none(self) -> None:
        async def empty_completion(prompt: str) -> str:
            return json.dumps({"hints": []})

        with patch("app.analysis.meta_completion", empty_completion):
            result = await meta_hint(HintRequest(
                language="python",
                code="while True:\n    pass\n",
                compiler_error="TimeoutError: Execution exceeded the 1 second limit.",
            ))
        self.assertEqual(len(result.hints), 1)
        self.assertEqual(result.hints[0].line, 1)

    async def test_recursion_hint_has_a_fallback_method_line(self) -> None:
        async def empty_completion(prompt: str) -> str:
            return "{}"

        with patch("app.analysis.meta_completion", empty_completion):
            result = await meta_hint(HintRequest(
                language="python",
                code="def recurse():\n    return recurse()\n\nrecurse()\n",
                compiler_error="RecursionError: maximum recursion depth exceeded",
            ))
        self.assertEqual(len(result.hints), 1)
        self.assertEqual(result.hints[0].line, 1)

    async def test_hint_keeps_the_authoritative_issue_line_when_model_moves_it(self) -> None:
        prompts = []

        async def wrong_line_completion(prompt: str) -> str:
            prompts.append(prompt)
            return json.dumps({"hints": [{"line": 3, "message": "The third line is the problem."}]})

        with patch("app.analysis.meta_completion", wrong_line_completion):
            result = await meta_hint(HintRequest(
                language="python",
                code="value = 1\nprint(value + 'x')\nprint('after')\n",
                issue_line=2,
                issue_category="Type",
                compiler_error="TypeError: unsupported operand types",
            ))
        self.assertEqual(len(result.hints), 1)
        self.assertEqual(result.hints[0].line, 2)
        self.assertIn("print('after')", prompts[0])
        self.assertIn("Authoritative issue line: 2", prompts[0])
        self.assertNotIn("third line", result.hints[0].message)

    async def test_hint_uses_the_runner_diagnostic_line_when_no_line_is_sent(self) -> None:
        async def wrong_line_completion(prompt: str) -> str:
            return json.dumps({"hints": [{"line": 1, "message": "The first line is the problem."}]})

        with patch("app.analysis.meta_completion", wrong_line_completion):
            result = await meta_hint(HintRequest(
                language="python",
                code="value = 1\nprint(value + 'x')\n",
                issue_category="Runtime",
                compiler_error='File "main.py", line 2, in <module>\nTypeError: bad value',
            ))
        self.assertEqual(len(result.hints), 1)
        self.assertEqual(result.hints[0].line, 2)

    async def test_hint_replaces_explicit_fix_instructions_with_an_explanation(self) -> None:
        async def directive_completion(prompt: str) -> str:
            return json.dumps({"hints": [{"line": 2, "message": "Change the value before using it."}]})

        with patch("app.analysis.meta_completion", directive_completion):
            result = await meta_hint(HintRequest(
                language="python",
                code="value = 1\nprint(value + 'x')\n",
                issue_line=2,
                issue_category="Type",
                compiler_error="TypeError: bad value",
            ))
        self.assertEqual(result.hints[0].line, 2)
        self.assertNotIn("change", result.hints[0].message.lower())


class GeneratedStrategyTests(unittest.IsolatedAsyncioTestCase):
    async def test_target_preflight_rejects_partial_method_without_calling_model(self) -> None:
        from app.routes import testcase_target

        result = await testcase_target(TestTargetRequest(
            language="python",
            code="def double(n):\n    return n * 2\n",
            selection_start_line=1,
            selection_end_line=1,
            selection_start_column=1,
            selection_end_column=14,
        ))
        self.assertFalse(result["target_ready"])
        self.assertNotEqual(result["target_kind"], "function")
        self.assertIn("whole function", result["message"])

    async def test_target_preflight_accepts_a_complete_cpp_method(self) -> None:
        from app.routes import testcase_target

        source = "int add(int left, int right) { return left + right; }\n"
        result = await testcase_target(TestTargetRequest(
            language="cpp",
            active_file="main.cpp",
            code=source,
            selection_start_line=1,
            selection_end_line=1,
            selection_start_column=1,
            selection_end_column=len(source.rstrip()) + 1,
        ))
        self.assertTrue(result["target_ready"])
        self.assertEqual(result["target_kind"], "function")

    async def test_generation_styles_use_method_contract_and_preconditions(self) -> None:
        source = "def double(n):\n    return n * 2\n"
        for style, phrase in (("edge", "Integer.MAX_VALUE"), ("stress", "high-workload"), ("general", "representative normal")):
            with self.subTest(style=style):
                async def fake_completion(prompt: str) -> str:
                    self.assertIn(f"Testing style: {style}.", prompt)
                    self.assertIn(phrase, prompt)
                    self.assertIn("Method description (optional): Return twice n", prompt)
                    self.assertIn("Method preconditions (optional; these define valid inputs, not test cases): n >= 0", prompt)
                    return json.dumps({"cases": [{"name": "zero", "invocation": "double(0)", "expected_return": "0"}]})

                with patch("app.analysis.meta_completion", fake_completion):
                    result = await generate_test_cases(GenerateTestCasesRequest(
                        code=source, count=1, test_style=style,
                        method_description="Return twice n", preconditions="n >= 0",
                        selection_start_line=1, selection_end_line=2,
                        selection_start_column=1, selection_end_column=17,
                    ))
                self.assertEqual(result.generated_count, 1)
                self.assertEqual(result.cases[0].expected_return, "0")

    async def test_uncertain_expected_result_requires_review(self) -> None:
        async def fake_completion(prompt: str) -> str:
            return json.dumps({"cases": [{"name": "unknown behavior", "invocation": "mystery(1)", "expected_return": None}]})

        with patch("app.analysis.meta_completion", fake_completion):
            result = await generate_test_cases(GenerateTestCasesRequest(
                code="def mystery(n):\n    return n\n", count=1,
                selection_start_line=1, selection_end_line=2,
                selection_start_column=1, selection_end_column=13,
            ))
        self.assertEqual(result.generated_count, 1)
        self.assertFalse(result.complete)
        self.assertIsNone(result.cases[0].expected_return)
        self.assertIn("ambiguous", result.message)

    async def test_python_selection_accepts_last_character_endpoint(self) -> None:
        from app.test_targets import detect_test_target

        source = "def double(n):\n    return n * 2\n"
        result = detect_test_target(
            "python", source,
            selection_start_line=1, selection_end_line=2,
            selection_start_column=1, selection_end_column=len("    return n * 2"),
        )
        self.assertTrue(result["ready"])
        self.assertEqual(result["function_name"], "double")

    async def test_java_selection_accepts_method_closing_brace_endpoint(self) -> None:
        from app.test_targets import detect_test_target

        source = "class Demo {\n  static int add(int a, int b) { return a + b; }\n}\n"
        result = detect_test_target(
            "java", source,
            selection_start_line=2, selection_end_line=2,
            selection_start_column=1, selection_end_column=len("  static int add(int a, int b) { return a + b; }"),
        )
        self.assertTrue(result["ready"])
        self.assertEqual(result["method_name"], "add")

    async def test_java_selection_can_start_at_indented_method_text(self) -> None:
        from app.test_targets import detect_test_target

        source = "class Demo {\n  static int add(int a, int b) { return a + b; }\n}\n"
        result = detect_test_target(
            "java", source,
            selection_start_line=2, selection_end_line=2,
            selection_start_column=3, selection_end_column=48,
        )
        self.assertTrue(result["ready"])
        self.assertEqual(result["method_name"], "add")

    async def test_generation_requires_a_selected_method(self) -> None:
        async def unavailable_model(prompt: str) -> str:
            self.fail("Whole-program test generation must not call the model")

        with patch("app.analysis.meta_completion", unavailable_model):
            result = await generate_test_cases(GenerateTestCasesRequest(
                code="def double(n):\n    return n * 2\n", count=2
            ))
        self.assertFalse(result.target_ready)
        self.assertEqual(result.generated_count, 0)

    async def test_selected_main_is_a_test_target(self) -> None:
        async def fake_completion(prompt: str) -> str:
            return json.dumps({"strategies": [{"name": "Main call", "cases": [
                {"name": "default", "invocation": "main()", "expected_return": "2"}
            ]}]})

        with patch("app.analysis.meta_completion", fake_completion):
            result = await generate_test_cases(GenerateTestCasesRequest(
                code="def main():\n    return 2\n", count=1,
                selection_start_line=1, selection_end_line=2,
                selection_start_column=1, selection_end_column=13,
            ))
        self.assertTrue(result.target_ready)
        self.assertTrue(result.target_is_main)
        self.assertEqual(result.target_kind, "function")
        self.assertEqual(result.generated_count, 1)
        self.assertIn("main()", result.cases[0].harness_code or "")
        run = run_code(RunRequest(
            language="python", active_file="main.py", code="def main():\n    return 2\n",
            harness_file=result.cases[0].harness_file,
            harness_code=result.cases[0].harness_code,
        ))
        self.assertEqual(run.status, "success")
        self.assertIn("Office Hours Prep result 1: 2", run.output)

    async def test_selected_java_main_uses_printed_output_without_void_expression(self) -> None:
        source = (
            "class Main {\n"
            "  public static void main(String[] args) { System.out.println(\"hello\"); }\n"
            "}\n"
        )

        async def fake_completion(prompt: str) -> str:
            return json.dumps({"strategies": [{"name": "Entry point", "cases": [
                {"name": "default", "invocation": "Main.main(new String[]{})", "expected_return": None, "expected_output": "hello\n"}
            ]}]})

        with patch("app.analysis.meta_completion", fake_completion):
            result = await generate_test_cases(
                GenerateTestCasesRequest(
                    language="java", active_file="Main.java", code=source, count=1,
                    selection_start_line=2, selection_end_line=2,
                    selection_start_column=3, selection_end_column=84,
                )
            )
        self.assertTrue(result.target_ready)
        self.assertTrue(result.target_is_main)
        self.assertEqual(result.cases[0].expected_output, "hello\n")
        self.assertNotIn("String.valueOf(Main.main", result.cases[0].harness_code or "")
        if shutil.which("javac") and shutil.which("java"):
            run = run_code(RunRequest(
                language="java", active_file="Main.java", code=source,
                harness_file=result.cases[0].harness_file,
                harness_code=result.cases[0].harness_code,
            ))
            self.assertEqual(run.status, "success")
            self.assertEqual(run.output.strip(), "hello")

    async def test_python_instance_method_runs_without_main_block(self) -> None:
        source = (
            "class Greeter:\n"
            "    def greet(self, name):\n"
            "        return f'Hi, {name}'\n"
            "\n"
            "if __name__ == '__main__':\n"
            "    print('outside selection')\n"
        )

        async def fake_completion(prompt: str) -> str:
            return json.dumps({"strategies": [{"name": "Name", "cases": [
                {"name": "Sam", "invocation": "Greeter().greet('Sam')", "expected_return": "'Hi, Sam'"}
            ]}]})

        with patch("app.analysis.meta_completion", fake_completion):
            generated = await generate_test_cases(GenerateTestCasesRequest(
                code=source, count=1, selection_start_line=2, selection_end_line=3,
                selection_start_column=1, selection_end_column=29,
            ))
        self.assertTrue(generated.target_ready)
        self.assertEqual(generated.target_kind, "method")
        case = generated.cases[0]
        run = run_code(RunRequest(
            code=source, harness_file=case.harness_file, harness_code=case.harness_code
        ))
        self.assertEqual(run.status, "success")
        self.assertIn("Office Hours Prep result 1: 'Hi, Sam'", run.output)
        self.assertNotIn("outside selection", run.output)

    async def test_selecting_an_entire_program_is_not_a_method_test(self) -> None:
        async def unavailable_model(prompt: str) -> str:
            self.fail("Whole-program selection must not call the model")

        source = "def double(n):\n    return n * 2\n\nprint(double(2))\n"
        with patch("app.analysis.meta_completion", unavailable_model):
            result = await generate_test_cases(GenerateTestCasesRequest(
                code=source, count=1, selection_start_line=1,
                selection_end_line=4, selection_start_column=1, selection_end_column=17,
            ))
        self.assertFalse(result.target_ready)

    async def test_javascript_selection_cannot_include_top_level_call(self) -> None:
        async def unavailable_model(prompt: str) -> str:
            self.fail("Program code in the selection must not call the model")

        source = "function double(n) { return n * 2; }\nconsole.log(double(2));\n"
        with patch("app.analysis.meta_completion", unavailable_model):
            result = await generate_test_cases(GenerateTestCasesRequest(
                language="javascript", active_file="main.js", code=source, count=1,
                selection_start_line=1, selection_end_line=2,
                selection_start_column=1, selection_end_column=24,
            ))
        self.assertFalse(result.target_ready)

    async def test_selected_java_method_can_be_tested_even_with_main_present(self) -> None:
        source = (
            "class Main {\n"
            "  static int doubleIt(int n) { return n * 2; }\n"
            "  public static void main(String[] args) { }\n"
            "}\n"
        )

        async def fake_completion(prompt: str) -> str:
            return json.dumps({"strategies": [{"name": "One input", "cases": [
                {"name": "two", "invocation": "Main.doubleIt(2)", "expected_return": "4"}
            ]}]})

        with patch("app.analysis.meta_completion", fake_completion):
            result = await generate_test_cases(GenerateTestCasesRequest(
                language="java", active_file="Main.java", code=source, count=1,
                selection_start_line=2, selection_end_line=2,
                selection_start_column=1, selection_end_column=49,
            ))
        self.assertTrue(result.target_ready)
        self.assertEqual(result.target_kind, "method")
        if shutil.which("javac") and shutil.which("java"):
            case = result.cases[0]
            run = run_code(RunRequest(
                language="java", active_file="Main.java", code=source,
                harness_file=case.harness_file, harness_code=case.harness_code,
            ))
            self.assertEqual(run.status, "success")
            self.assertIn("Office Hours Prep result 1: 4", run.output)

    async def test_javascript_selection_does_not_run_program_code(self) -> None:
        if not shutil.which("node"):
            self.skipTest("Node.js is not installed")
        source = "function double(n) {\n  return n * 2;\n}\nconsole.log('outside selection');\n"

        async def fake_completion(prompt: str) -> str:
            return json.dumps({"strategies": [{"name": "one input", "cases": [
                {"name": "two", "invocation": "double(2)", "expected_return": "4"}
            ]}]})

        with patch("app.analysis.meta_completion", fake_completion):
            generated = await generate_test_cases(GenerateTestCasesRequest(
                language="javascript", active_file="main.js", code=source, count=1,
                selection_start_line=1, selection_end_line=3,
                selection_start_column=1, selection_end_column=2,
            ))
        self.assertTrue(generated.target_ready)
        case = generated.cases[0]
        run = run_code(RunRequest(
            language="javascript", active_file="main.js", code=source,
            harness_file=case.harness_file, harness_code=case.harness_code,
        ))
        self.assertEqual(run.status, "success")
        self.assertIn("Office Hours Prep result 1: 4", run.output)
        self.assertNotIn("outside selection", run.output)

    async def test_ruby_selection_does_not_run_program_code(self) -> None:
        if not shutil.which("ruby"):
            self.skipTest("Ruby is not installed")
        source = "def double(n)\n  n * 2\nend\nputs 'outside selection'\n"

        async def fake_completion(prompt: str) -> str:
            return json.dumps({"strategies": [{"name": "one input", "cases": [
                {"name": "two", "invocation": "double(2)", "expected_return": "4"}
            ]}]})

        with patch("app.analysis.meta_completion", fake_completion):
            generated = await generate_test_cases(GenerateTestCasesRequest(
                language="ruby", active_file="main.rb", code=source, count=1,
                selection_start_line=1, selection_end_line=3,
                selection_start_column=1, selection_end_column=4,
            ))
        self.assertTrue(generated.target_ready)
        case = generated.cases[0]
        run = run_code(RunRequest(
            language="ruby", active_file="main.rb", code=source,
            harness_file=case.harness_file, harness_code=case.harness_code,
        ))
        self.assertEqual(run.status, "success")
        self.assertIn("Office Hours Prep result 1: 4", run.output)
        self.assertNotIn("outside selection", run.output)

    async def test_strategy_list_only_contains_accepted_cases(self) -> None:
        async def fake_completion(prompt: str) -> str:
            return json.dumps({"strategies": [{
                "name": "Seeded and boundary values",
                "code": "for n in [0, 1, 2]: print(n)",
                "cases": [
                    {"name": "zero", "invocation": "double(0)", "expected_return": "0"},
                    {"name": "duplicate zero", "invocation": "double(0)", "expected_return": "0"},
                    {"name": "missing call", "expected_return": "4"},
                    {"name": "one", "invocation": "double(1)", "expected_return": "2"},
                    {"name": "two", "invocation": "double(2)", "expected_return": "4"},
                ],
            }]})

        with patch("app.analysis.meta_completion", fake_completion):
            result = await generate_test_cases(GenerateTestCasesRequest(
                code="def double(n):\n    return n * 2\n", count=2,
                selection_start_line=1, selection_end_line=2,
                selection_start_column=1, selection_end_column=17,
            ))
        self.assertEqual(result.generated_count, 2)
        self.assertTrue(result.complete)
        self.assertEqual([case.name for case in result.strategies[0].cases], [case.name for case in result.cases])

    async def test_function_strategies_keep_separate_harnesses(self) -> None:
        async def fake_completion(prompt: str) -> str:
            self.assertIn("exactly 2 distinct", prompt.lower())
            return json.dumps({
                "strategies": [{
                    "name": "Boundary values",
                    "description": "Zero and one",
                    "code": "for n in [0, 1]: print(n)",
                    "cases": [
                        {"name": "zero", "invocation": "double(0)", "expected_return": "0"},
                        {"name": "one", "invocation": "double(1)", "expected_return": "2"},
                    ],
                }],
            })

        with patch("app.analysis.meta_completion", fake_completion):
            result = await generate_test_cases(GenerateTestCasesRequest(
                code="def double(n):\n    return n * 2\n",
                intent="Double a number",
                count=2,
                selection_start_line=1, selection_end_line=2,
                selection_start_column=1, selection_end_column=17,
            ))
        self.assertTrue(result.complete)
        self.assertEqual(result.generated_count, 2)
        self.assertEqual(len(result.strategies), 1)
        self.assertEqual(len(result.strategies[0].cases), 2)
        self.assertTrue(all(case.harness_code for case in result.cases))

    async def test_selected_function_still_runs_with_generated_strategy(self) -> None:
        source = "def double(n):\n    return n * 2\n\nprint('outside selection')\n"

        async def fake_completion(prompt: str) -> str:
            return json.dumps({"strategies": [{
                "name": "Small inputs", "code": "for n in [2]: print(n)",
                "cases": [{"name": "two", "invocation": "double(2)", "expected_return": "4"}],
            }]})

        with patch("app.analysis.meta_completion", fake_completion):
            generated = await generate_test_cases(GenerateTestCasesRequest(
                code=source, count=1,
                selection_start_line=1, selection_end_line=2,
                selection_start_column=1, selection_end_column=17,
            ))
        self.assertTrue(generated.complete)
        self.assertEqual(generated.target_kind, "function")
        case = generated.cases[0]
        run = run_code(RunRequest(
            code=source, harness_file=case.harness_file, harness_code=case.harness_code
        ))
        self.assertEqual(run.status, "success")
        self.assertIn("Office Hours Prep result 1: 4", run.output)
        self.assertNotIn("outside selection", run.output)
