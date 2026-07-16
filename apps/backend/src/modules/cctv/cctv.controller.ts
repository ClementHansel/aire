import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { CctvService, CameraDTO, RecordingDTO } from './cctv.service';
import { StreamAuthGuard } from './stream-auth.guard';

const M3U8_CONTENT_TYPE = 'application/vnd.apple.mpegurl';
const TS_CONTENT_TYPE = 'video/mp2t';

/** Body for creating a camera. */
interface CreateCameraBody {
  outletId: string;
  name: string;
  rtspUrl: string;
  location?: string;
  bridgeId?: string;
  deviceId?: string;
}

/** Body for patching a camera. */
interface UpdateCameraBody {
  name?: string;
  location?: string;
  rtspUrl?: string;
  isActive?: boolean;
}

/** Body for starting a recording (order link optional). */
interface StartRecordingBody {
  orderId?: string;
}

/**
 * CctvController — camera management + HLS live/VOD serving.
 *
 * JSON management endpoints use the normal {@link JwtAuthGuard}. The media
 * endpoints (`.m3u8` / `.ts`) instead use {@link StreamAuthGuard}, which also
 * accepts the JWT via `?access_token=` so hls.js and native players (which
 * cannot set headers on media sub-requests) can authenticate. Media responses
 * are written directly through Express `res` with the correct HLS content-types.
 *
 * Requirements: 25.1 (live HLS), 25.2 (recordings), 25.4 (MinIO).
 */
@Controller('api/cctv')
export class CctvController {
  constructor(private readonly cctvService: CctvService) {}

  // ─── Camera management (JSON, header-auth) ───────────────────────────────────

  @Get('cameras')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getCameras(
    @CurrentUser() user: JWTPayload,
    @Query('outletId') outletId?: string,
  ): Promise<CameraDTO[]> {
    if (!outletId) throw new BadRequestException('outletId query parameter is required');
    return this.cctvService.listByOutlet(user.tenant_id, outletId);
  }

  @Post('cameras')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createCamera(
    @CurrentUser() user: JWTPayload,
    @Body() body: CreateCameraBody,
  ): Promise<CameraDTO> {
    if (!body.outletId || !body.name || !body.rtspUrl) {
      throw new BadRequestException('outletId, name and rtspUrl are required');
    }
    return this.cctvService.createCamera(user.tenant_id, body);
  }

  @Patch('cameras/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  updateCamera(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Body() body: UpdateCameraBody,
  ): Promise<CameraDTO> {
    return this.cctvService.updateCamera(user.tenant_id, id, body);
  }

  // ─── Recording management (JSON, header-auth) ────────────────────────────────

  @Get('recordings')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  listRecordings(
    @CurrentUser() user: JWTPayload,
    @Query('outletId') outletId?: string,
    @Query('cameraId') cameraId?: string,
  ): Promise<RecordingDTO[]> {
    return this.cctvService.listRecordings(user.tenant_id, { outletId, cameraId });
  }

  @Post('cameras/:id/record')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  startRecording(
    @CurrentUser() user: JWTPayload,
    @Param('id') cameraId: string,
    @Body() body: StartRecordingBody,
  ): Promise<RecordingDTO> {
    return this.cctvService.startRecording(user.tenant_id, cameraId, body?.orderId);
  }

  @Delete('recordings/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  stopRecording(
    @CurrentUser() user: JWTPayload,
    @Param('id') recordingId: string,
  ): Promise<RecordingDTO> {
    return this.cctvService.stopRecording(user.tenant_id, recordingId);
  }

  // ─── NVR archive playback (on-demand) ────────────────────────────────────────

  /** Start playing the NVR's own recorded archive for a camera + time window. */
  @Post('cameras/:id/playback')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async startPlayback(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Body() body: { start?: string; end?: string },
  ): Promise<{ sessionId: string }> {
    if (!body?.start || !body?.end) {
      throw new BadRequestException('start and end (ISO timestamps) are required');
    }
    if (isNaN(Date.parse(body.start)) || isNaN(Date.parse(body.end))) {
      throw new BadRequestException('start/end must be ISO timestamps');
    }
    const camera = await this.cctvService.getCamera(user.tenant_id, id);
    const sessionId = await this.cctvService.startPlayback(camera, body.start, body.end);
    return { sessionId };
  }

  @Delete('playback/:sessionId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  stopPlayback(@Param('sessionId') sessionId: string): { ok: true } {
    this.cctvService.stopPlayback(sessionId);
    return { ok: true };
  }

  // ─── Live HLS serving (media, stream-auth) ───────────────────────────────────

  @Get('cameras/:id/live.m3u8')
  @UseGuards(StreamAuthGuard)
  async livePlaylist(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const camera = await this.cctvService.getCamera(user.tenant_id, id);
    const playlist = await this.cctvService.getLivePlaylist(camera);
    this.sendPlaylist(res, playlist);
  }

  @Get('cameras/:id/seg/:name')
  @UseGuards(StreamAuthGuard)
  liveSegment(
    @Param('id') id: string,
    @Param('name') name: string,
    @Res() res: Response,
  ): void {
    const buffer = this.cctvService.getLiveSegment(id, name);
    if (!buffer) throw new NotFoundException('Segment not available');
    this.sendSegment(res, buffer);
  }

  // ─── VOD (recording) serving (media, stream-auth) ────────────────────────────

  @Get('recordings/:id/index.m3u8')
  @UseGuards(StreamAuthGuard)
  async recordingPlaylist(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const playlist = await this.cctvService.getRecordingPlaylist(user.tenant_id, id);
    if (playlist === null) throw new NotFoundException('Recording playlist not available');
    this.sendPlaylist(res, playlist);
  }

  @Get('recordings/:id/seg/:name')
  @UseGuards(StreamAuthGuard)
  async recordingSegment(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Param('name') name: string,
    @Res() res: Response,
  ): Promise<void> {
    const buffer = await this.cctvService.getRecordingSegment(user.tenant_id, id, name);
    if (!buffer) throw new NotFoundException('Segment not available');
    this.sendSegment(res, buffer);
  }

  // ─── NVR playback serving (media, stream-auth) ───────────────────────────────

  @Get('playback/:sessionId/index.m3u8')
  @UseGuards(StreamAuthGuard)
  playbackPlaylist(@Param('sessionId') sessionId: string, @Res() res: Response): void {
    this.sendPlaylist(res, this.cctvService.getPlaybackPlaylist(sessionId));
  }

  @Get('playback/:sessionId/seg/:name')
  @UseGuards(StreamAuthGuard)
  playbackSegment(
    @Param('sessionId') sessionId: string,
    @Param('name') name: string,
    @Res() res: Response,
  ): void {
    const buffer = this.cctvService.getPlaybackSegment(sessionId, name);
    if (!buffer) throw new NotFoundException('Segment not available');
    this.sendSegment(res, buffer);
  }

  private sendPlaylist(res: Response, playlist: string): void {
    res.set({
      'Content-Type': M3U8_CONTENT_TYPE,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.send(playlist);
  }

  private sendSegment(res: Response, buffer: Buffer): void {
    res.set({
      'Content-Type': TS_CONTENT_TYPE,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-cache',
    });
    res.send(buffer);
  }
}
