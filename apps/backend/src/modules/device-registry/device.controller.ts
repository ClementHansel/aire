import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import {
  DeviceRegistryService,
  DeviceDTO,
  DeviceCategory,
} from './device-registry.service';
import { TopologyService, TopologyTree } from './topology.service';

/**
 * Camera hint attached to `GET /api/devices/:id` when the device is a camera.
 * The frontend uses `cameraId` + these relative URLs to build the live
 * HlsPlayer and recordings list against the existing `/api/cctv/...` endpoints
 * (see DeviceDetailModal in contract 08).
 */
interface CameraHint {
  cameraId: string | null;
  livePlaylistUrl: string | null;
  segmentUrlTemplate: string | null;
  recordingsUrl: string | null;
}

/** `GET /api/devices/:id` response — the device, plus a camera hint when relevant. */
interface DeviceDetailResponse extends DeviceDTO {
  camera?: CameraHint;
}

/**
 * DeviceController — read surface for the device registry + topology tree.
 *
 * All endpoints are JWT-guarded and tenant-scoped from the JWT (never the
 * request), so an operator only ever sees their own tenant's devices. Writes go
 * through discovery confirmation / the bridge event bus, not this controller.
 */
@Controller('api')
@UseGuards(JwtAuthGuard)
export class DeviceController {
  constructor(
    private readonly deviceRegistry: DeviceRegistryService,
    private readonly topology: TopologyService,
  ) {}

  /**
   * GET /api/topology            → the whole tenant tree.
   * GET /api/topology?outletId=  → a single branch subtree (length-1 branches).
   */
  @Get('topology')
  @HttpCode(HttpStatus.OK)
  getTopology(
    @CurrentUser() user: JWTPayload,
    @Query('outletId') outletId?: string,
  ): Promise<TopologyTree> {
    return this.topology.build(user.tenant_id, outletId || undefined);
  }

  /** GET /api/devices?outletId=&category= → flat registry list. */
  @Get('devices')
  @HttpCode(HttpStatus.OK)
  listDevices(
    @CurrentUser() user: JWTPayload,
    @Query('outletId') outletId?: string,
    @Query('category') category?: DeviceCategory,
  ): Promise<DeviceDTO[]> {
    return this.deviceRegistry.listByOutlet(user.tenant_id, {
      outletId: outletId || undefined,
      category: category || undefined,
    });
  }

  /**
   * GET /api/devices/:id → one device. When it is a camera, the response also
   * carries a {@link CameraHint} the frontend uses to build `/api/cctv` URLs.
   */
  @Get('devices/:id')
  @HttpCode(HttpStatus.OK)
  async getDevice(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
  ): Promise<DeviceDetailResponse> {
    const device = await this.deviceRegistry.get(user.tenant_id, id);
    if (device.category !== 'camera') return device;

    // `ref_id` points at the `cameras.id` this device was confirmed from.
    const cameraId = device.refId;
    const camera: CameraHint = {
      cameraId,
      livePlaylistUrl: cameraId ? `/api/cctv/cameras/${cameraId}/live.m3u8` : null,
      segmentUrlTemplate: cameraId ? `/api/cctv/cameras/${cameraId}/seg/{name}` : null,
      recordingsUrl: cameraId ? `/api/cctv/recordings?cameraId=${cameraId}` : null,
    };
    return { ...device, camera };
  }
}
