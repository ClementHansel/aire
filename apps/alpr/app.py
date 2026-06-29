"""AIRE ALPR Service — FastAPI application with detection endpoints.

Provides:
- POST /detect — Process an image/frame and return plate detections
- GET /health — Health check
- GET /history — Detection history
"""

from __future__ import annotations

import base64
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException

from alpr_service import ALPRService
from models import (
    DetectRequest,
    DetectResponse,
    DetectionHistoryItem,
    HealthResponse,
)

app = FastAPI(
    title="AIRE ALPR Service",
    description="Automatic License Plate Recognition service for AIRE Operations Platform",
    version="0.1.0",
)

# Initialize the ALPR service (singleton for the app lifetime)
alpr_service = ALPRService()


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Health check endpoint.

    Returns service status and whether the ALPR model is loaded.
    """
    return HealthResponse(
        status="ok",
        service="alpr",
        model_loaded=alpr_service.is_model_loaded,
    )


@app.post("/detect", response_model=DetectResponse)
async def detect(request: DetectRequest) -> DetectResponse:
    """Process an image/frame and return license plate detections.

    Accepts either:
    - image_base64: Base64-encoded image data
    - image_url: URL pointing to an image (not yet implemented)
    - camera_id: Capture a frame from the specified RTSP camera

    At least one of these fields must be provided.
    """
    image_data: bytes | None = None

    if request.image_base64:
        try:
            image_data = base64.b64decode(request.image_base64)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid base64 image data")
    elif request.camera_id:
        # Capture from RTSP camera
        results, processing_time = alpr_service.process_frame_from_camera(
            request.camera_id
        )
        return DetectResponse(
            plates=results,
            frame_timestamp=datetime.now(timezone.utc),
            camera_id=request.camera_id,
            processing_time_ms=processing_time,
        )
    elif request.image_url:
        # URL-based fetch not yet implemented
        raise HTTPException(
            status_code=501, detail="Image URL fetch not yet implemented"
        )
    else:
        raise HTTPException(
            status_code=400,
            detail="Provide at least one of: image_base64, image_url, or camera_id",
        )

    # Process the image
    import time

    start = time.perf_counter()
    results = alpr_service.detect_plates(image_data)
    elapsed_ms = (time.perf_counter() - start) * 1000

    return DetectResponse(
        plates=results,
        frame_timestamp=datetime.now(timezone.utc),
        camera_id=request.camera_id,
        processing_time_ms=elapsed_ms,
    )


@app.get("/history", response_model=list[DetectionHistoryItem])
async def get_history(
    camera_id: str | None = None,
    limit: int = 50,
) -> list[DetectionHistoryItem]:
    """Retrieve detection history.

    Args:
        camera_id: Filter by camera (optional).
        limit: Max results to return (default 50).
    """
    return alpr_service.get_detection_history(camera_id=camera_id, limit=limit)
