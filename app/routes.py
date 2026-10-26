"""HTTP endpoints for the web application."""

import os
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from .analysis import demo_analysis, generate_test_cases, meta_analysis, meta_fix, meta_hint
from .runner import run_code
from .schemas import (Analysis, AnalyzeRequest, BuildTestHarnessRequest, BuildTestHarnessResponse, FixRequest, FixResponse, GenerateTestCasesRequest, GenerateTestCasesResponse, HintRequest, HintResponse, RunRequest, RunResponse, TestTargetRequest)
from .test_targets import build_harness_code, detect_test_target

STATIC = Path(__file__).resolve().parent.parent / "static"
DUCK_HOURS_LOGO = STATIC.parent / "duckhourslogo.png"
router = APIRouter()


@router.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


@router.get("/about")
async def about() -> FileResponse:
    return FileResponse(STATIC / "about.html")


@router.get("/duckhourslogo.png")
async def duck_hours_logo() -> FileResponse:
    return FileResponse(DUCK_HOURS_LOGO, media_type="image/png")


@router.get("/learn/errors")
async def error_guide() -> FileResponse:
    return FileResponse(STATIC / "error-guide.html")


@router.get("/api/health")
async def health() -> Dict[str, Any]:
    return {"ok": True, "meta_configured": bool(os.getenv("META_API_KEY") or os.getenv("MODEL_API_KEY"))}


@router.post("/api/analyze", response_model=Analysis)
async def analyze(payload: AnalyzeRequest) -> Analysis:
    if payload.mode != "gemini":
        return demo_analysis(payload)
    try:
        return await meta_analysis(payload)
    except HTTPException:
        # A successful local run must still receive a logic result when the
        # external analysis service is unavailable or returns an invalid reply.
        # The deterministic checks are narrower, but they are preferable to
        # reporting that logic was not checked at all.
        return demo_analysis(payload)


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


@router.post("/api/testcase-target")
async def testcase_target(payload: TestTargetRequest) -> Dict[str, Any]:
    target = detect_test_target(
        payload.language,
        payload.code,
        active_file=payload.active_file,
        selection_start_line=payload.selection_start_line,
        selection_end_line=payload.selection_end_line,
        selection_start_column=payload.selection_start_column,
        selection_end_column=payload.selection_end_column,
    )
    return {
        **target,
        "target_kind": target.get("kind", "invalid"),
        "target_label": target.get("label", "selected code"),
        "target_ready": bool(target.get("ready", False)),
        "target_is_main": bool(target.get("is_main")),
        "message": target.get("validation_error") or target.get("missing_information"),
    }


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
    # Harnesses are only meaningful for complete callable targets.
    if target.get("kind") not in {"function", "method"} or not target.get("ready"):
        return BuildTestHarnessResponse(
            ready=False,
            message=target.get("validation_error") or target.get("missing_information") or "Select one complete function or method first.",
            target_kind=target.get("kind", "invalid"),
            target_is_main=bool(target.get("is_main")),
            return_type=target.get("return_type"),
        )
    harness = build_harness_code(target, payload.active_file, [payload.invocation])
    if not harness:
        return BuildTestHarnessResponse(
            ready=False,
            message="A test harness could not be created for this selected method.",
            target_kind=target.get("kind", "invalid"),
            target_is_main=bool(target.get("is_main")),
            return_type=target.get("return_type"),
        )
    return BuildTestHarnessResponse(
        ready=True,
        target_kind=target.get("kind", "invalid"),
        target_is_main=bool(target.get("is_main")),
        return_type=target.get("return_type"),
        harness_file=harness["file"],
        harness_code=harness["code"],
    )
