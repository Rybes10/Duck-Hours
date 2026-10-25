"""Request and response models shared by the application services."""

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    intent: str = Field("", max_length=5000)
    code: str = Field(..., min_length=1, max_length=50000)
    problem: str = Field("", max_length=5000)
    predicted_output: str = Field("", max_length=50000)
    actual_output: str = Field("", max_length=50000)
    mode: str = Field("demo", pattern="^(demo|gemini)$")


class Issue(BaseModel):
    category: str
    title: str
    explanation: str
    fix: str
    line: Optional[int] = None
    severity: str = "warning"


class Analysis(BaseModel):
    mode: str
    summary: str
    issues: List[Issue]
    walkthrough: List[str]


class WorkspaceFile(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    code: str = Field("", max_length=50000)


class RunRequest(BaseModel):
    language: str = Field("python", pattern="^(python|javascript|typescript|ruby|go|java|c|cpp)$")
    code: str = Field(..., min_length=1, max_length=50000)
    stdin: str = Field("", max_length=10000)
    intent: str = Field("", max_length=5000)
    active_file: str = Field("main.py", min_length=1, max_length=100)
    files: List[WorkspaceFile] = Field(default_factory=list, max_length=20)
    # A generated wrapper is kept separate from the user's source file.
    harness_file: Optional[str] = Field(None, max_length=100)
    harness_code: Optional[str] = Field(None, max_length=50000)
    files_to_check: List[str] = Field(default_factory=list, max_length=20)
    memory_limit_mb: Optional[int] = Field(None, ge=1, le=4096)
    timeout_seconds: int = Field(10, ge=1, le=30)


class GeneratedWorkspaceFile(BaseModel):
    name: str
    contents: str


class RunResponse(BaseModel):
    language: str
    status: str
    output: str
    error: Optional[str] = None
    error_type: Optional[str] = None
    line: Optional[int] = None
    error_file: Optional[str] = None
    auto_tested: bool = False
    auto_test_function: Optional[str] = None
    auto_test_cases: List[str] = Field(default_factory=list)
    target_kind: str = "program"
    target_ready: bool = True
    target_is_main: bool = False
    target_banner: Optional[str] = None
    target_explanation: Optional[str] = None
    error_source: Optional[str] = None
    harness_file: Optional[str] = None
    harness_code: Optional[str] = None
    generated_files: List[GeneratedWorkspaceFile] = Field(default_factory=list)
    workspace_files: List[GeneratedWorkspaceFile] = Field(default_factory=list, max_length=40)
    memory_usage_bytes: Optional[int] = None
    memory_limit_exceeded: bool = False


class HintRequest(BaseModel):
    language: str = Field("python", max_length=30)
    code: str = Field(..., min_length=1, max_length=50000)
    intent: str = Field("", max_length=5000)
    compiler_error: str = Field("", max_length=5000)
    # The runner or the completed whole-code check may already know the most
    # trustworthy source line. The hint service must preserve that location.
    issue_line: Optional[int] = Field(None, ge=1)
    issue_category: str = Field("", max_length=60)


class Hint(BaseModel):
    line: int
    message: str


class HintResponse(BaseModel):
    hints: List[Hint]


class FixRequest(BaseModel):
    language: str = Field("python", max_length=30)
    code: str = Field(..., min_length=1, max_length=50000)
    intent: str = Field("", max_length=5000)
    problem: str = Field("", max_length=5000)
    compiler_error: str = Field("", max_length=5000)


class FixResponse(BaseModel):
    code: str = Field(..., min_length=1, max_length=50000)
    explanation: str = Field(..., max_length=5000)


class GeneratedFileOverride(BaseModel):
    file_name: str = Field(..., min_length=1, max_length=100)
    contents: str = Field("", max_length=50000)


class GeneratedTestCase(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    description: Optional[str] = Field(None, max_length=500)
    stdin: str = Field("", max_length=10000)
    files: List[GeneratedFileOverride] = Field(default_factory=list, max_length=20)
    expected_output: str = Field("", max_length=50000)
    invocation: Optional[str] = Field(None, max_length=1000)
    expected_return: Optional[str] = Field(None, max_length=5000)
    return_type: Optional[str] = Field(None, max_length=100)
    harness_file: Optional[str] = Field(None, max_length=100)
    harness_code: Optional[str] = Field(None, max_length=50000)


class GenerateTestCasesRequest(BaseModel):
    language: str = Field("python", max_length=30)
    active_file: str = Field("main.py", min_length=1, max_length=100)
    code: str = Field(..., min_length=1, max_length=50000)
    files: List[WorkspaceFile] = Field(default_factory=list, max_length=20)
    existing_cases: List[GeneratedTestCase] = Field(default_factory=list, max_length=50)
    intent: str = Field("", max_length=5000)
    constraints: str = Field("", max_length=5000)
    test_style: Literal["edge", "stress", "general"] = "general"
    method_description: str = Field("", max_length=5000)
    preconditions: str = Field("", max_length=5000)
    count: int = Field(5, ge=1, le=20)
    selection_start_line: Optional[int] = Field(None, ge=1)
    selection_end_line: Optional[int] = Field(None, ge=1)
    selection_start_column: Optional[int] = Field(None, ge=1)
    selection_end_column: Optional[int] = Field(None, ge=1)


class TestTargetRequest(BaseModel):
    language: str = Field("python", max_length=30)
    active_file: str = Field("main.py", min_length=1, max_length=100)
    code: str = Field(..., min_length=1, max_length=50000)
    selection_start_line: Optional[int] = Field(None, ge=1)
    selection_end_line: Optional[int] = Field(None, ge=1)
    selection_start_column: Optional[int] = Field(None, ge=1)
    selection_end_column: Optional[int] = Field(None, ge=1)


class GeneratedCaseStrategy(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    description: str = Field("", max_length=500)
    code: str = Field("", max_length=4000)
    cases: List[GeneratedTestCase] = Field(default_factory=list, max_length=20)


class GenerateTestCasesResponse(BaseModel):
    cases: List[GeneratedTestCase]
    strategies: List[GeneratedCaseStrategy] = Field(default_factory=list, max_length=10)
    requested_count: int = 5
    generated_count: int = 0
    complete: bool = False
    message: Optional[str] = None
    target_kind: str = "program"
    target_label: str = "whole submission"
    target_ready: bool = True
    target_is_main: bool = False
    target_banner: Optional[str] = None
    target_explanation: Optional[str] = None
    missing_information: Optional[str] = None
    validation_error: Optional[str] = None
    validation_line: Optional[int] = None
    return_type: Optional[str] = None
    harness_file: Optional[str] = None
    harness_code: Optional[str] = None


class BuildTestHarnessRequest(BaseModel):
    language: str = Field("python", max_length=30)
    active_file: str = Field("main.py", min_length=1, max_length=100)
    code: str = Field(..., min_length=1, max_length=50000)
    invocation: str = Field(..., min_length=1, max_length=1000)
    selection_start_line: Optional[int] = Field(None, ge=1)
    selection_end_line: Optional[int] = Field(None, ge=1)
    selection_start_column: Optional[int] = Field(None, ge=1)
    selection_end_column: Optional[int] = Field(None, ge=1)


class BuildTestHarnessResponse(BaseModel):
    ready: bool
    message: Optional[str] = None
    target_kind: str = "invalid"
    target_is_main: bool = False
    return_type: Optional[str] = None
    harness_file: Optional[str] = None
    harness_code: Optional[str] = None
