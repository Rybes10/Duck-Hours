"""Re-export the route definitions through the ``app.api`` import path."""

from .routes import router

__all__ = ["router"]
