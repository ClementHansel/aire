import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { KioskService, KioskQueueStatus, KioskQueueEntry, PublicMenu } from './kiosk.service';

/**
 * Request body for joining the queue.
 */
export interface JoinQueueRequest {
  orderId: string;
  outletId: string;
}

/**
 * Self-service kiosk controller.
 *
 * Provides public-facing endpoints for customers to check queue status
 * and join the queue after payment. No authentication required since
 * these are accessed via QR code scan on the kiosk.
 *
 * Endpoints:
 *   GET  /api/kiosk/queue-status?orderNumber= — Check queue position
 *   POST /api/kiosk/join-queue                — Join queue for a paid order
 *
 * Requirements: 27.1, 27.2, 27.3
 */
@Controller('api/kiosk')
export class KioskController {
  constructor(private readonly kioskService: KioskService) {}

  /**
   * GET /api/kiosk/menu?tenantId=&outletId=
   * Public customer-facing eMenu (no auth).
   */
  @Get('menu')
  @HttpCode(HttpStatus.OK)
  async getMenu(
    @Query('tenantId') tenantId: string,
    @Query('outletId') outletId?: string,
  ): Promise<PublicMenu> {
    return this.kioskService.getMenu(tenantId, outletId);
  }

  /**
   * GET /api/kiosk/queue-status?orderNumber=
   *
   * Check queue position and estimated wait time by order number.
   * Accessible via QR code scan without authentication.
   *
   * Requirement 27.3: Display queue position and estimated wait time.
   */
  @Get('queue-status')
  @HttpCode(HttpStatus.OK)
  async getQueueStatus(
    @Query('orderNumber') orderNumber: string,
  ): Promise<KioskQueueStatus> {
    return this.kioskService.getQueueStatus(orderNumber);
  }

  /**
   * POST /api/kiosk/join-queue
   *
   * Join the queue for a paid order. Only orders in 'paid' or 'confirmed'
   * status can join. Customers interact with this after completing payment
   * on the kiosk interface.
   *
   * Requirement 27.2: Self-check-in, service selection, QRIS payment flow.
   */
  @Post('join-queue')
  @HttpCode(HttpStatus.CREATED)
  async joinQueue(
    @Body() dto: JoinQueueRequest,
  ): Promise<KioskQueueEntry> {
    return this.kioskService.joinQueue(dto.orderId, dto.outletId);
  }
}
