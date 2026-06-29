import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CctvService, CameraStream, RecordingSession, RecordingResult } from './cctv.service';

/**
 * Request body for starting a recording session.
 */
interface StartRecordingRequest {
  orderId: string;
}

/**
 * CctvController exposes CCTV streaming and recording endpoints.
 *
 * Requirement 25.1: Live camera feeds via HLS for browser playback.
 * Requirement 25.2: Event-based recording linked to specific orders.
 */
@Controller('api/cctv')
@UseGuards(JwtAuthGuard)
export class CctvController {
  constructor(private readonly cctvService: CctvService) {}

  /**
   * GET /api/cctv/cameras?outletId=
   * Lists all configured cameras for a given outlet.
   */
  @Get('cameras')
  @HttpCode(HttpStatus.OK)
  getCameras(@Query('outletId') outletId?: string): CameraStream[] {
    if (!outletId) {
      throw new BadRequestException('outletId query parameter is required');
    }
    return this.cctvService.getStreams(outletId);
  }

  /**
   * GET /api/cctv/cameras/:id/stream
   * Gets the HLS stream URL for a specific camera.
   */
  @Get('cameras/:id/stream')
  @HttpCode(HttpStatus.OK)
  getStream(@Param('id') cameraId: string): { hlsUrl: string } {
    return this.cctvService.getStreamUrl(cameraId);
  }

  /**
   * POST /api/cctv/cameras/:id/record
   * Starts an event-based recording linked to a specific order.
   */
  @Post('cameras/:id/record')
  @HttpCode(HttpStatus.CREATED)
  startRecording(
    @Param('id') cameraId: string,
    @Body() body: StartRecordingRequest,
  ): RecordingSession {
    if (!body.orderId) {
      throw new BadRequestException('orderId is required');
    }
    return this.cctvService.startRecording(cameraId, body.orderId);
  }

  /**
   * DELETE /api/cctv/recordings/:id
   * Stops an active recording session.
   */
  @Delete('recordings/:id')
  @HttpCode(HttpStatus.OK)
  stopRecording(@Param('id') sessionId: string): RecordingResult {
    return this.cctvService.stopRecording(sessionId);
  }
}
