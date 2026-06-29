"""AIRE ALPR Service entry point.

Re-exports the FastAPI app from app.py for uvicorn compatibility.
"""

from app import app  # noqa: F401

__all__ = ["app"]
