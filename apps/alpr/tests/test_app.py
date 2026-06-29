"""Tests for the ALPR FastAPI application endpoints."""

import base64

import pytest
from httpx import ASGITransport, AsyncClient

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app import app  # noqa: E402


@pytest.fixture
def client():
    """Create an async test client for the FastAPI app."""
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_health_returns_ok(client: AsyncClient):
    """Health endpoint should return status ok and model_loaded flag."""
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "alpr"
    assert data["model_loaded"] is True


# ---------------------------------------------------------------------------
# POST /detect — with base64 image
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_detect_with_base64_image(client: AsyncClient):
    """Detect endpoint should accept base64 image and return plates."""
    # Create a small fake image (1x1 pixel PNG)
    fake_image = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100).decode()

    response = await client.post("/detect", json={"image_base64": fake_image})
    assert response.status_code == 200

    data = response.json()
    assert "plates" in data
    assert "frame_timestamp" in data
    assert "processing_time_ms" in data
    assert isinstance(data["plates"], list)
    assert len(data["plates"]) > 0

    plate = data["plates"][0]
    assert "text" in plate
    assert "confidence" in plate
    assert "crop_image_url" in plate
    assert "bounding_box" in plate
    assert 0.0 <= plate["confidence"] <= 1.0

    bbox = plate["bounding_box"]
    assert "x" in bbox
    assert "y" in bbox
    assert "width" in bbox
    assert "height" in bbox


@pytest.mark.anyio
async def test_detect_with_invalid_base64(client: AsyncClient):
    """Detect endpoint should return 400 for invalid base64 data."""
    response = await client.post("/detect", json={"image_base64": "!!!invalid!!!"})
    assert response.status_code == 400
    assert "Invalid base64" in response.json()["detail"]


# ---------------------------------------------------------------------------
# POST /detect — with camera_id
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_detect_with_camera_id(client: AsyncClient):
    """Detect endpoint should accept camera_id and return plates."""
    response = await client.post("/detect", json={"camera_id": "cam-entrance-01"})
    assert response.status_code == 200

    data = response.json()
    assert data["camera_id"] == "cam-entrance-01"
    assert isinstance(data["plates"], list)
    assert len(data["plates"]) > 0


# ---------------------------------------------------------------------------
# POST /detect — with image_url (not implemented)
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_detect_with_image_url_returns_501(client: AsyncClient):
    """Detect endpoint should return 501 for image_url (not yet implemented)."""
    response = await client.post(
        "/detect", json={"image_url": "http://example.com/image.jpg"}
    )
    assert response.status_code == 501


# ---------------------------------------------------------------------------
# POST /detect — no input provided
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_detect_with_no_input_returns_400(client: AsyncClient):
    """Detect endpoint should return 400 when no image source is provided."""
    response = await client.post("/detect", json={})
    assert response.status_code == 400
    assert "Provide at least one of" in response.json()["detail"]


# ---------------------------------------------------------------------------
# GET /history
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_history_initially_empty_or_populated(client: AsyncClient):
    """History endpoint should return a list."""
    response = await client.get("/history")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.anyio
async def test_history_populates_after_detection(client: AsyncClient):
    """Detection should add items to history."""
    # Trigger a detection first
    fake_image = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 50).decode()
    await client.post("/detect", json={"image_base64": fake_image})

    # Now check history
    response = await client.get("/history")
    assert response.status_code == 200
    history = response.json()
    assert len(history) > 0

    item = history[0]
    assert "detected_text" in item
    assert "confidence" in item
    assert "detected_at" in item


@pytest.mark.anyio
async def test_history_filter_by_camera_id(client: AsyncClient):
    """History endpoint should support camera_id filtering."""
    # Trigger detection from a specific camera
    await client.post("/detect", json={"camera_id": "cam-filter-test"})

    # Filter by that camera
    response = await client.get("/history", params={"camera_id": "cam-filter-test"})
    assert response.status_code == 200
    history = response.json()
    for item in history:
        assert item["camera_id"] == "cam-filter-test"


@pytest.mark.anyio
async def test_detect_response_model_structure(client: AsyncClient):
    """Verify the detection response matches the expected schema."""
    fake_image = base64.b64encode(b"fake-image-bytes").decode()
    response = await client.post("/detect", json={"image_base64": fake_image})
    assert response.status_code == 200

    data = response.json()
    # Validate top-level fields
    assert isinstance(data["processing_time_ms"], (int, float))
    assert data["processing_time_ms"] >= 0

    # Validate plate structure matches DetectionResult model
    for plate in data["plates"]:
        assert isinstance(plate["text"], str)
        assert len(plate["text"]) > 0
        assert isinstance(plate["confidence"], float)
        assert isinstance(plate["crop_image_url"], str)
        assert plate["crop_image_url"].startswith("/crops/")
        assert isinstance(plate["bounding_box"], dict)
        assert all(k in plate["bounding_box"] for k in ["x", "y", "width", "height"])
