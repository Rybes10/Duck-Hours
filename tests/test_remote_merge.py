"""Regression checks for the merged test-generation and workspace-runner contracts."""

import json
import shutil
import unittest
from unittest.mock import patch

from app.analysis import generate_test_cases, meta_analysis
from app.runner import run_code
from app.schemas import AnalyzeRequest, GenerateTestCasesRequest, RunRequest, WorkspaceFile


class RunnerFileTests(unittest.TestCase):
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


class LogicAnalysisTests(unittest.IsolatedAsyncioTestCase):
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


class GeneratedStrategyTests(unittest.IsolatedAsyncioTestCase):
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

    async def test_selected_main_is_not_a_test_target(self) -> None:
        async def unavailable_model(prompt: str) -> str:
            self.fail("A selected main function must not call the model")

        with patch("app.analysis.meta_completion", unavailable_model):
            result = await generate_test_cases(GenerateTestCasesRequest(
                code="def main():\n    return 2\n", count=1,
                selection_start_line=1, selection_end_line=2,
                selection_start_column=1, selection_end_column=13,
            ))
        self.assertFalse(result.target_ready)
        self.assertEqual(result.generated_count, 0)

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
