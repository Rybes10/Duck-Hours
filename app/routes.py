"""HTTP endpoints for the web application."""

import os
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter
from fastapi.responses import FileResponse

from .analysis import demo_analysis, generate_test_cases, meta_analysis, meta_hint
from .runner import run_code
from .schemas import (Analysis, AnalyzeRequest, GenerateTestCasesRequest, GenerateTestCasesResponse, HintRequest, HintResponse, RunRequest, RunResponse)

STATIC = Path(__file__).resolve().parent.parent / "static"
router = APIRouter()


@router.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


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


@router.post("/api/testcases", response_model=GenerateTestCasesResponse)
async def generate_cases(payload: GenerateTestCasesRequest) -> GenerateTestCasesResponse:
    return await generate_test_cases(payload)
