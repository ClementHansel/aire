"""Pydantic models for the ALPR service requests and responses."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class BoundingBox(BaseModel):
    """Bounding box coordinates for a detected plate."""

    x: int = Field(..., description="X coordinate of top-left corner")
    y: int = Field(..., description="Y coordinate of top-left corner")
    width: int = Field(..., ge=0, description="Width of the bounding box")
    height: int = Field(..., ge=0, description="Height of the bounding box")


class DetectionResult(BaseModel):
    """Single plate detection result."""

    text: str = Field(..., description="Detected plate text")
    confidence: float = Field(
        ..., ge=0.0, le=1.0, description="Detection confidence score (0.0-1.0)"
    )
    crop_image_url: str = Field(..., description="URL to stored crop image")
    bounding_box: BoundingBox = Field(..., description="Bounding box of detected plate")


class DetectRequest(BaseModel):
    """Request body for the /detect endpoint."""

    image_base64: Optional[str] = Field(
        None, description="Base64-encoded image data"
    )
    image_url: Optional[str] = Field(
        None, description="URL of the image to process"
    )
    camera_id: Optional[str] = Field(
        None, description="Camera identifier for RTSP feed capture"
    )


class DetectResponse(BaseModel):
    """Response from the /detect endpoint."""

    plates: list[DetectionResult] = Field(
        default_factory=list, description="List of detected plates"
    )
    frame_timestamp: datetime = Field(
        ..., description="Timestamp when the frame was captured"
    )
    camera_id: Optional[str] = Field(None, description="Camera that produced the frame")
    processing_time_ms: float = Field(
        ..., description="Time taken to process the frame in milliseconds"
    )


class HealthResponse(BaseModel):
    """Health check response."""

    status: str = Field(..., description="Service status")
    service: str = Field(default="alpr", description="Service name")
    model_loaded: bool = Field(
        ..., description="Whether the ALPR model is loaded and ready"
    )


class DetectionHistoryItem(BaseModel):
    """A stored detection history entry."""

    id: str = Field(..., description="Detection record ID")
    camera_id: str = Field(..., description="Camera identifier")
    detected_text: str = Field(..., description="Detected plate text")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence score")
    confirmed_plate: Optional[str] = Field(
        None, description="Cashier-confirmed plate text"
    )
    crop_image_url: Optional[str] = Field(None, description="URL to crop image")
    bounding_box: Optional[BoundingBox] = Field(None, description="Detection bounding box")
    detected_at: datetime = Field(..., description="When the detection occurred")
