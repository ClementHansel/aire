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
} from '@nestjs/common';
import { KioskService, KioskQueueStatus, KioskQueueEntry, PublicMenu } from './kiosk.service';
import { KioskOrderService, KioskOrderDto } from './kiosk-order.service';
import { KioskTokenGuard, KioskCtx, KioskContext } from './kiosk-token.guard';
import { VehicleCatalogService } from '../vehicle-catalog/vehicle-catalog.service';

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
  constructor(
    private readonly kioskService: KioskService,
    private readonly kioskOrderService: KioskOrderService,
    private readonly vehicleCatalog: VehicleCatalogService,
  ) {}

  /** GET /api/kiosk/vehicle-brands — brand→type catalog for the kiosk's tenant. */
  @Get('vehicle-brands')
  @UseGuards(KioskTokenGuard)
  vehicleBrands(@KioskCtx() ctx: KioskContext) {
    return this.vehicleCatalog.listBrandsWithTypes(ctx.tenantId);
  }

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

  // --- Self-service ordering (kiosk-token authorized) ------------------------

  /**
   * GET /api/kiosk/identify?q=
   * Resolve a member from a scanned/typed identifier (plate / phone / membership id)
   * to prefill the kiosk order. Returns null for walk-ins.
   */
  @Get('identify')
  @UseGuards(KioskTokenGuard)
  identify(@KioskCtx() ctx: KioskContext, @Query('q') q: string) {
    return this.kioskOrderService.identify(ctx.tenantId, q);
  }

  /**
   * POST /api/kiosk/orders
   * Create a self-service order for this kiosk's outlet and place the car on the
   * queue board (unpaid). Pricing matches the POS. Pay now via /charge or at cashier.
   */
  @Post('orders')
  @UseGuards(KioskTokenGuard)
  @HttpCode(HttpStatus.CREATED)
  createOrder(@KioskCtx() ctx: KioskContext, @Body() dto: KioskOrderDto) {
    return this.kioskOrderService.createOrder(ctx, dto);
  }

  /**
   * POST /api/kiosk/orders/:id/charge
   * Start a QRIS charge (pay-now). Gateway webhook flips the order to paid.
   */
  @Post('orders/:id/charge')
  @UseGuards(KioskTokenGuard)
  @HttpCode(HttpStatus.OK)
  charge(@KioskCtx() ctx: KioskContext, @Param('id') id: string) {
    return this.kioskOrderService.charge(ctx, id);
  }

  /**
   * GET /api/kiosk/orders/:id/status
   * Poll payment status while waiting for QRIS confirmation.
   */
  @Get('orders/:id/status')
  @UseGuards(KioskTokenGuard)
  status(@KioskCtx() ctx: KioskContext, @Param('id') id: string) {
    return this.kioskOrderService.status(ctx, id);
  }
}
