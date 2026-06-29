import { Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

/**
 * Represents a configured CCTV camera for an outlet.
 */
export interface CameraStream {
  id: string;
  outletId: string;
  name: string;
  rtspUrl: string;
  location: string;
  isActive: boolean;
}

/**
 * Represents an active recording session linked to a specific order.
 */
export interface RecordingSession {
  id: string;
  cameraId: string;
  orderId: string;
  startedAt: string;
  status: 'recording' | 'stopped' | 'failed';
}

/**
 * Represents the result of a completed recording.
 */
export interface RecordingResult {
  id: string;
  cameraId: string;
  orderId: string;
  startedAt: string;
  stoppedAt: string;
  storagePath: string;
  durationSeconds: number;
  status: 'completed' | 'failed';
}

/**
 * CctvService provides CCTV streaming and event-based recording capabilities.
 *
 * This is a stub implementation with proper interfaces. Actual RTSP-to-HLS
 * conversion via FFmpeg and stream management is infrastructure-level and
 * would be handled by a media server (e.g., MediaMTX, Nginx-RTMP).
 *
 * Requirement 25.1: Live camera feeds by converting RTSP streams to HLS for browser playback.
 * Requirement 25.2: Event-based recording linked to specific orders.
 */
@Injectable()
export class CctvService {
  // In-memory store for stub implementation (would be database-backed in production)
  private cameras: Map<string, CameraStream> = new Map();
  private recordings: Map<string, RecordingSession> = new Map();

  /**
   * Lists configured cameras for a given outlet.
   *
   * Requirement 25.1: Provide live camera feeds from configured RTSP cameras.
   */
  getStreams(outletId: string): CameraStream[] {
    return Array.from(this.cameras.values()).filter(
      (camera) => camera.outletId === outletId && camera.isActive,
    );
  }

  /**
   * Gets the HLS stream URL for a specific camera.
   * In production, this would return the URL of the transcoded HLS stream
   * served by the media server (RTSP → HLS conversion).
   *
   * Requirement 25.1: Convert RTSP streams to HLS for browser-compatible playback.
   */
  getStreamUrl(cameraId: string): { hlsUrl: string } {
    const camera = this.cameras.get(cameraId);
    if (!camera) {
      throw new NotFoundException(`Camera ${cameraId} not found`);
    }

    // In production, this URL would point to the HLS output from a media server
    // (e.g., MediaMTX or Nginx-RTMP module) that converts the RTSP feed in real-time.
    const hlsUrl = `/streams/${cameraId}/index.m3u8`;

    return { hlsUrl };
  }

  /**
   * Starts event-based recording for a camera, linked to a specific order.
   * In production, this would trigger FFmpeg to begin recording the RTSP stream
   * and save to MinIO object storage.
   *
   * Requirement 25.2: Event-based recording linked to specific orders.
   */
  startRecording(cameraId: string, orderId: string): RecordingSession {
    const camera = this.cameras.get(cameraId);
    if (!camera) {
      throw new NotFoundException(`Camera ${cameraId} not found`);
    }

    const session: RecordingSession = {
      id: uuidv4(),
      cameraId,
      orderId,
      startedAt: new Date().toISOString(),
      status: 'recording',
    };

    this.recordings.set(session.id, session);
    return session;
  }

  /**
   * Stops an active recording session and returns the result with storage path.
   * In production, this would stop the FFmpeg process and finalize the file in MinIO.
   *
   * Requirement 25.2: Event-based recording linked to specific orders.
   * Requirement 25.4: Store recordings on self-hosted object storage (MinIO).
   */
  stopRecording(sessionId: string): RecordingResult {
    const session = this.recordings.get(sessionId);
    if (!session) {
      throw new NotFoundException(`Recording session ${sessionId} not found`);
    }

    if (session.status !== 'recording') {
      throw new NotFoundException(`Recording session ${sessionId} is not active`);
    }

    const stoppedAt = new Date().toISOString();
    const startTime = new Date(session.startedAt).getTime();
    const stopTime = new Date(stoppedAt).getTime();
    const durationSeconds = Math.round((stopTime - startTime) / 1000);

    // Mark session as stopped
    session.status = 'stopped';
    this.recordings.set(sessionId, session);

    // In production, storagePath would be the MinIO object path
    const storagePath = `recordings/${session.cameraId}/${session.orderId}/${sessionId}.mp4`;

    return {
      id: session.id,
      cameraId: session.cameraId,
      orderId: session.orderId,
      startedAt: session.startedAt,
      stoppedAt,
      storagePath,
      durationSeconds,
      status: 'completed',
    };
  }

  /**
   * Registers a camera (used for testing and initial configuration).
   * In production, this would be managed via database and admin UI.
   */
  registerCamera(camera: CameraStream): void {
    this.cameras.set(camera.id, camera);
  }
}
