"""Request and response models shared by the application services."""

from typing import List, Optional

from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    intent: str = Field("", max_length=5000)
    code: str = Field(..., min_length=1, max_length=50000)
    problem: str = Field("", max_length=5000)
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


class GeneratedWorkspaceFile(BaseModel):
    name: str
    contents: str


class RunResponse(BaseModel):
    language: str
    status: str
    output: str
    error: Optional[str] = None
    line: Optional[int] = None
    generated_files: List[GeneratedWorkspaceFile] = Field(default_factory=list)


class HintRequest(BaseModel):
    language: str = Field("python", max_length=30)
    code: str = Field(..., min_length=1, max_length=50000)
    intent: str = Field("", max_length=5000)
    compiler_error: str = Field("", max_length=5000)


class Hint(BaseModel):
    line: int
    message: str


class HintResponse(BaseModel):
    hints: List[Hint]


class GeneratedFileOverride(BaseModel):
    file_name: str = Field(..., min_length=1, max_length=100)
    contents: str = Field("", max_length=50000)


class GeneratedTestCase(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    stdin: str = Field("", max_length=10000)
    files: List[GeneratedFileOverride] = Field(default_factory=list, max_length=20)
    expected_output: str = Field("", max_length=50000)


class GenerateTestCasesRequest(BaseModel):
    language: str = Field("python", max_length=30)
    active_file: str = Field("main.py", min_length=1, max_length=100)
    code: str = Field(..., min_length=1, max_length=50000)
    files: List[WorkspaceFile] = Field(default_factory=list, max_length=20)
    existing_cases: List[GeneratedTestCase] = Field(default_factory=list, max_length=50)
    intent: str = Field("", max_length=5000)
    constraints: str = Field("", max_length=5000)


class GenerateTestCasesResponse(BaseModel):
    cases: List[GeneratedTestCase]


