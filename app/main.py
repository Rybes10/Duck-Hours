"""FastAPI application setup for Duck Hours."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .api import router

ROOT = Path(__file__).resolve().parent.parent
# Resolve assets from the repository layout rather than the server's working directory.
STATIC = ROOT / "static"
app = FastAPI(title="Duck Hours", version="0.1.0")
app.mount("/static", StaticFiles(directory=STATIC), name="static")
app.include_router(router)
