"""ALPR processing logic — stub implementation with defined interface.

This module defines the ALPRService class that handles frame capture from
RTSP camera feeds and license plate detection using the fast-alpr library.
The actual model integration is stubbed; the interface is what matters for
integration with the rest of the platform.
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from typing import Optional, Protocol

from models import BoundingBox, DetectionHistoryItem, DetectionResult


class ALPRProcessor(Protocol):
    """Protocol defining the ALPR processing interface."""

    def detect_plates(self, image_data: bytes) -> list[DetectionResult]:
        """Process an image and return detected license plates."""
        ...

    def capture_frame(self, camera_id: str) -> Optional[bytes]:
        """Capture a single frame from an RTSP camera feed."""
        ...

    @property
    def is_model_loaded(self) -> bool:
        """Whether the ALPR model is loaded and ready."""
        ...


class ALPRService:
    """ALPR service handling plate detection and history storage.

    This is a stub implementation that returns mock data.
    Replace the detect_plates method with actual fast-alpr integration.
    """

    def __init__(self) -> None:
        self._model_loaded = True
        self._detection_history: list[DetectionHistoryItem] = []

    @property
    def is_model_loaded(self) -> bool:
        """Whether the ALPR model is loaded and ready."""
        return self._model_loaded

    def detect_plates(self, image_data: bytes) -> list[DetectionResult]:
        """Process an image and return detected license plates.

        Stub implementation: returns mock detection data.
        In production, this would use fast-alpr to process the image.

        Args:
            image_data: Raw image bytes (JPEG/PNG).

        Returns:
            List of DetectionResult with detected plate text, confidence,
            crop image URL, and bounding box.
        """
        # Stub: simulate detection processing time
        start = time.perf_counter()

        # Mock detection result — in production, call fast-alpr model here
        mock_results = [
            DetectionResult(
                text="B1234XYZ",
                confidence=0.95,
                crop_image_url=f"/crops/{uuid.uuid4().hex}.jpg",
                bounding_box=BoundingBox(x=120, y=80, width=200, height=60),
            )
        ]

        elapsed_ms = (time.perf_counter() - start) * 1000

        # Store in detection history
        for result in mock_results:
            history_item = DetectionHistoryItem(
                id=uuid.uuid4().hex,
                camera_id="stub-camera",
                detected_text=result.text,
                confidence=result.confidence,
                confirmed_plate=None,
                crop_image_url=result.crop_image_url,
                bounding_box=result.bounding_box,
                detected_at=datetime.now(timezone.utc),
            )
            self._detection_history.append(history_item)

        return mock_results

    def capture_frame(self, camera_id: str) -> Optional[bytes]:
        """Capture a single frame from an RTSP camera feed.

        Stub implementation: returns None (no real camera connected).
        In production, this would use OpenCV to connect to the RTSP feed
        and grab a frame.

        Args:
            camera_id: Identifier of the RTSP camera to capture from.

        Returns:
            Raw image bytes if capture successful, None otherwise.
        """
        # Stub: in production, use cv2.VideoCapture with RTSP URL
        # rtsp_url = self._get_camera_url(camera_id)
        # cap = cv2.VideoCapture(rtsp_url)
        # ret, frame = cap.read()
        # cap.release()
        # if ret:
        #     _, buffer = cv2.imencode('.jpg', frame)
        #     return buffer.tobytes()
        return None

    def get_detection_history(
        self,
        camera_id: Optional[str] = None,
        limit: int = 50,
    ) -> list[DetectionHistoryItem]:
        """Retrieve detection history, optionally filtered by camera.

        Args:
            camera_id: Filter by specific camera (None = all cameras).
            limit: Maximum number of records to return.

        Returns:
            List of detection history items, newest first.
        """
        history = self._detection_history
        if camera_id:
            history = [h for h in history if h.camera_id == camera_id]
        return sorted(history, key=lambda h: h.detected_at, reverse=True)[:limit]

    def process_frame_from_camera(self, camera_id: str) -> tuple[list[DetectionResult], float]:
        """Capture and process a frame from a specific camera.

        Combines capture_frame and detect_plates into a single operation.

        Args:
            camera_id: Camera identifier to capture from.

        Returns:
            Tuple of (detection results, processing time in ms).
        """
        start = time.perf_counter()

        frame = self.capture_frame(camera_id)
        if frame is None:
            # Stub: use empty bytes to trigger mock detection
            frame = b""

        results = self.detect_plates(frame)
        elapsed_ms = (time.perf_counter() - start) * 1000

        return results, elapsed_ms
