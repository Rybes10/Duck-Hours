"""FastAPI application setup for Office Hours Prep."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .api import router

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
app = FastAPI(title="Office Hours Prep", version="0.1.0")
app.mount("/static", StaticFiles(directory=STATIC), name="static")
app.include_router(router)
