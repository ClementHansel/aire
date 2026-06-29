import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JWTPayload, BayStatusDTO, BayStatus, AssignBayRequest } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { BayService, UpdateBayStatusParams } from './bay.service';

/**
 * Bay management and monitoring controller.
 * Provides endpoints for bay status, assignment, and gate control.
 *
 * Endpoints:
 *   GET   /api/bays?outletId=&status=   — List bays for an outlet
 *   GET   /api/bays/:id                  — Get single bay with sensor data
 *   POST  /api/bays/:id/assign           — Assign order to bay
 *   POST  /api/bays/:id/gate-open        — Send gate open command
 *   PATCH /api/bays/:id/status           — Update bay status
 *
 * Requirements: 26.3, 26.4, 26.5
 */
@Controller('api/bays')
@UseGuards(JwtAuthGuard)
export class BayController {
  constructor(private readonly bayService: BayService) {}

  /**
   * GET /api/bays?outletId=&status=
   * Lists bays for an outlet with optional status filter.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async listBays(
    @CurrentUser() user: JWTPayload,
    @Query('outletId') outletId?: string,
    @Query('status') status?: string,
  ): Promise<BayStatusDTO[]> {
    return this.bayService.listBays({
      tenantId: user.tenant_id,
      outletId: outletId ?? undefined,
      status: status as BayStatus | undefined,
    });
  }

  /**
   * GET /api/bays/:id
   * Gets a single bay with current sensor data.
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getBay(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
  ): Promise<BayStatusDTO> {
    return this.bayService.getBay(user.tenant_id, id);
  }

  /**
   * POST /api/bays/:id/assign
   * Assigns an order to a bay.
   */
  @Post(':id/assign')
  @HttpCode(HttpStatus.NO_CONTENT)
  async assignOrder(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Body() body: AssignBayRequest,
  ): Promise<void> {
    await this.bayService.assignOrder(user.tenant_id, id, body.orderId);
  }

  /**
   * POST /api/bays/:id/gate-open
   * Sends gate open command to bay controller.
   */
  @Post(':id/gate-open')
  @HttpCode(HttpStatus.NO_CONTENT)
  async openGate(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.bayService.openGate(user.tenant_id, id);
  }

  /**
   * PATCH /api/bays/:id/status
   * Updates bay status and optionally sensor data.
   */
  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  async updateStatus(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Body() body: UpdateBayStatusParams,
  ): Promise<BayStatusDTO> {
    return this.bayService.updateStatus(user.tenant_id, id, body);
  }
}
