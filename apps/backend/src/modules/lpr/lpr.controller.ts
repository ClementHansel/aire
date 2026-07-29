import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { JWTPayload, PlateDetectionInput, PlateDetection } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { ScopeService } from '../../common/scope/scope.service';
import type { ResolvedBridge } from '../bridge';
import { LprBridgeGuard } from './lpr-bridge.guard';
import { LprBridgeCtx } from './lpr-bridge.decorator';
import { LprService, ConfirmDetectionBody } from './lpr.service';

/**
 * LprController — AIRIN-59 plate detection ingest + POS consumption.
 *
 * `POST /` is machine-to-machine (branch bridge, {@link LprBridgeGuard}); the
 * other two are normal dashboard/POS endpoints ({@link JwtAuthGuard}). No
 * class-level guard on purpose — each route's auth mechanism is different,
 * mirroring CctvController's split between JSON management and media-serving
 * guards.
 */
@Controller('api/lpr/detections')
export class LprController {
  constructor(
    private readonly lprService: LprService,
    private readonly scopeService: ScopeService,
  ) {}

  /**
   * POST /api/lpr/detections — the branch bridge forwards a raw device
   * reading here. Body's outletId (if present) is only cross-checked against
   * the token-resolved outlet, never trusted as scope.
   */
  @Post()
  @UseGuards(LprBridgeGuard)
  @HttpCode(HttpStatus.CREATED)
  async ingest(
    @LprBridgeCtx() bridge: ResolvedBridge,
    @Body() body: PlateDetectionInput,
  ): Promise<PlateDetection> {
    if (body?.outletId && body.outletId !== bridge.outletId) {
      throw new BadRequestException('outletId does not match the paired bridge');
    }
    return this.lprService.ingest(bridge.tenantId, bridge.outletId, body);
  }

  /**
   * GET /api/lpr/detections?outletId= — recent, still-offerable detections
   * for the POS. Branch scope resolved the same way every other management
   * read does (ScopeService), never from the query param alone.
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async list(
    @CurrentUser() user: JWTPayload,
    @Query('outletId') outletId?: string,
  ): Promise<PlateDetection[]> {
    const outletIds = await this.scopeService.resolveOutletIds(user, outletId);
    return this.lprService.listRecent(user.tenant_id, outletIds);
  }

  /**
   * POST /api/lpr/detections/:id/confirm — cashier accepts (or corrects) a
   * suggestion onto an order. Consumes it: excluded from `list` afterwards.
   */
  @Post(':id/confirm')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async confirm(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Body() body: ConfirmDetectionBody,
  ): Promise<PlateDetection> {
    const outletIds = await this.scopeService.resolveOutletIds(user);
    return this.lprService.confirm(user.tenant_id, outletIds, id, body ?? {});
  }
}
