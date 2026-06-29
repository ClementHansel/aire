"""Pytest configuration and shared fixtures for ALPR tests."""

import sys
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

# Add the parent directory to sys.path so test imports work
sys.path.insert(0, str(Path(__file__).parent.parent))

from app import app  # noqa: E402


@pytest.fixture
def client():
    """Create an async test client for the FastAPI app."""
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")
