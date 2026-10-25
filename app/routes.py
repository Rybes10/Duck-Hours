"""HTTP endpoints for the web application."""

import os
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter
from fastapi.responses import FileResponse

from .analysis import demo_analysis, generate_test_cases, meta_analysis, meta_fix, meta_hint
from .runner import run_code
from .schemas import (Analysis, AnalyzeRequest, BuildTestHarnessRequest, BuildTestHarnessResponse, FixRequest, FixResponse, GenerateTestCasesRequest, GenerateTestCasesResponse, HintRequest, HintResponse, RunRequest, RunResponse)
from .test_targets import build_harness_code, detect_test_target

STATIC = Path(__file__).resolve().parent.parent / "static"
router = APIRouter()


@router.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


@router.get("/learn/errors")
async def error_guide() -> FileResponse:
    return FileResponse(STATIC / "error-guide.html")


@router.get("/api/health")
async def health() -> Dict[str, Any]:
    return {"ok": True, "meta_configured": bool(os.getenv("META_API_KEY") or os.getenv("MODEL_API_KEY"))}


@router.post("/api/analyze", response_model=Analysis)
async def analyze(payload: AnalyzeRequest) -> Analysis:
    return await meta_analysis(payload) if payload.mode == "gemini" else demo_analysis(payload)


@router.post("/api/run", response_model=RunResponse)
async def run(payload: RunRequest) -> RunResponse:
    return run_code(payload)


@router.post("/api/hint", response_model=HintResponse)
async def hint(payload: HintRequest) -> HintResponse:
    return await meta_hint(payload)


@router.post("/api/fix", response_model=FixResponse)
async def fix(payload: FixRequest) -> FixResponse:
    return await meta_fix(payload)


@router.post("/api/testcases", response_model=GenerateTestCasesResponse)
async def generate_cases(payload: GenerateTestCasesRequest) -> GenerateTestCasesResponse:
    return await generate_test_cases(payload)


@router.post("/api/testcase-harness", response_model=BuildTestHarnessResponse)
async def build_test_harness(payload: BuildTestHarnessRequest) -> BuildTestHarnessResponse:
    target = detect_test_target(
        payload.language,
        payload.code,
        active_file=payload.active_file,
        selection_start_line=payload.selection_start_line,
        selection_end_line=payload.selection_end_line,
        selection_start_column=payload.selection_start_column,
        selection_end_column=payload.selection_end_column,
    )
    if target.get("kind") not in {"function", "method"} or not target.get("ready"):
        return BuildTestHarnessResponse(
            ready=False,
            message=target.get("validation_error") or target.get("missing_information") or "Select one complete function or method first.",
            target_kind=target.get("kind", "invalid"),
            return_type=target.get("return_type"),
        )
    harness = build_harness_code(target, payload.active_file, [payload.invocation])
    if not harness:
        return BuildTestHarnessResponse(
            ready=False,
            message="A test harness could not be created for this selected method.",
            target_kind=target.get("kind", "invalid"),
            return_type=target.get("return_type"),
        )
    return BuildTestHarnessResponse(
        ready=True,
        target_kind=target.get("kind", "invalid"),
        return_type=target.get("return_type"),
        harness_file=harness["file"],
        harness_code=harness["code"],
    )
