import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  BadRequestException,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  JWTPayload,
  OrderQueryParams,
  OrderListResponse,
  OrderStatus,
  VALID_ORDER_STATUSES,
  Role,
  CreateOrderRequest,
  PayOrderRequest,
  PromoPreviewRequest,
} from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles, RequirePermission, RequiresOnboarding } from '../../common/decorators';
import { RolesGuard, PermissionsGuard, OnboardingCompleteGuard } from '../../common/guards';
import { ScopeService } from '../../common/scope/scope.service';
import { OrderListService } from './order-list.service';
import { OrderService } from './order.service';

@Controller('api/orders')
@UseGuards(JwtAuthGuard, PermissionsGuard, OnboardingCompleteGuard)
@RequiresOnboarding()
export class OrderController {
  constructor(
    private readonly orderListService: OrderListService,
    private readonly orderService: OrderService,
    private readonly scope: ScopeService,
  ) {}

  /**
   * POST /api/orders
   * Creates a new order from the POS cart.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createOrder(
    @CurrentUser() user: JWTPayload,
    @Body() body: CreateOrderRequest,
  ) {
    if (!body.customer?.name || !body.customer?.phone || !body.items?.length) {
      throw new BadRequestException('customer name, phone, and at least one item are required');
    }
    return this.orderService.createOrder(body, user);
  }

  /**
   * POST /api/orders/promotions/preview
   * Lists the promotions applicable to the current cart with their computed
   * discount + eligibility, so the cashier can CONFIRM which to apply. Promotions
   * are no longer auto-applied — the selected ids are sent back on createOrder.
   */
  @Post('promotions/preview')
  @HttpCode(HttpStatus.OK)
  async previewPromotions(
    @CurrentUser() user: JWTPayload,
    @Body() body: PromoPreviewRequest,
  ) {
    if (!body?.items?.length) return [];
    const outletId = body.operatingOutletId ?? user.outlet_id ?? undefined;
    return this.orderService.previewPromotionsForCart(user.tenant_id, outletId, body.items, body.membershipId);
  }

  /**
   * POST /api/orders/:id/pay
   * Settles an order (cash/QRIS/EDC/transfer) and marks it paid.
   */
  @Post(':id/pay')
  @HttpCode(HttpStatus.OK)
  async payOrder(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Body() body: PayOrderRequest,
  ) {
    if (!body.method) {
      throw new BadRequestException('payment method is required');
    }
    return this.orderService.payOrder(id, user, body);
  }

  /**
   * GET /api/orders
   *
   * List orders with filtering, searching, and pagination.
   * Tenant isolation is enforced explicitly (params.tenantId), and branch scope
   * is resolved from the caller's role via ScopeService (this endpoint does not
   * attach RlsContextGuard, so it must not rely on Postgres RLS).
   * - Cashier / Outlet_Admin: restricted to their assigned branches
   * - Tenant_Owner / Super_Admin: all branches, optionally narrowed by outletId
   *
   * Query params:
   *   status   - filter by order status
   *   search   - search by order_number, customer_name, or customer_phone (ILIKE)
   *   dateFrom - ISO date for start of range
   *   dateTo   - ISO date for end of range
   *   outletId - filter by specific outlet (Tenant_Owner use case)
   *   page     - page number (default 1)
   *   pageSize - page size (default 20, max 100)
   *
   * Requirements: 20.2, 20.3, 20.4, 20.5, 20.6
   */
  @Get()
  async listOrders(
    @CurrentUser() user: JWTPayload,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('outletId') outletId?: string,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
  ): Promise<OrderListResponse> {
    // Validate status if provided
    if (status && !VALID_ORDER_STATUSES.includes(status as OrderStatus)) {
      throw new BadRequestException(
        `Invalid status. Must be one of: ${VALID_ORDER_STATUSES.join(', ')}`,
      );
    }

    // Validate date formats if provided
    if (dateFrom && isNaN(Date.parse(dateFrom))) {
      throw new BadRequestException('Invalid dateFrom format. Use ISO date string.');
    }
    if (dateTo && isNaN(Date.parse(dateTo))) {
      throw new BadRequestException('Invalid dateTo format. Use ISO date string.');
    }

    // Parse pagination
    const page = pageStr ? parseInt(pageStr, 10) : undefined;
    const pageSize = pageSizeStr ? parseInt(pageSizeStr, 10) : undefined;

    if (page !== undefined && (isNaN(page) || page < 1)) {
      throw new BadRequestException('page must be a positive integer.');
    }
    if (pageSize !== undefined && (isNaN(pageSize) || pageSize < 1)) {
      throw new BadRequestException('pageSize must be a positive integer.');
    }

    // Owners/super-admins span branches (optionally narrowed by outletId);
    // outlet-bound roles are restricted to the branches assigned to them.
    const outletIds = await this.scope.resolveOutletIds(user, outletId);

    const params: OrderQueryParams = {
      tenantId: user.tenant_id,
      status: status as OrderStatus | undefined,
      search,
      dateFrom,
      dateTo,
      outletIds,
      page,
      pageSize,
    };

    return this.orderListService.listOrders(params);
  }

  /**
   * PATCH /api/orders/:id — edit limited fields (admin+, audit-logged, day-lock).
   */
  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  @RequirePermission('transactions.write')
  async editOrder(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Body() body: { customerName?: string; customerPhone?: string; note?: string },
  ) {
    return this.orderService.editOrder(id, user, body);
  }

  /**
   * DELETE /api/orders/:id — cancel an order (admin+, audit-logged, day-lock).
   */
  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  @RequirePermission('transactions.delete')
  async deleteOrder(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.orderService.deleteOrder(id, user);
  }

  /**
   * POST /api/orders/:id/void-pin — issues a one-time 6-digit PIN (emailed to
   * the tenant owner) authorizing a void of this order past the free-window.
   * Same authorization posture as /void: no fixed role gate — any signed-in
   * operator may request one; voidOrder is what actually enforces who needs it.
   */
  @Post(':id/void-pin')
  @HttpCode(HttpStatus.OK)
  async requestVoidPin(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.orderService.requestVoidPin(id, user);
  }

  /**
   * POST /api/orders/:id/void — cashier-facing void. Authorization (reason /
   * free-window / admin PIN) is enforced inside the service via the shared
   * void-authorization rules, so no fixed role gate here (any signed-in operator
   * may attempt it; the rules decide). On a 400 with { requiresPin: true } the
   * POS should reveal the admin-PIN field and retry.
   */
  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  async voidOrder(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Body() body: { reason?: string; adminPin?: string },
  ) {
    return this.orderService.voidOrder(id, user, { reason: body?.reason ?? '', adminPin: body?.adminPin });
  }

  /**
   * GET /api/orders/:id
   * Lightweight status lookup for POS payment polling.
   */
  @Get(':id')
  async getOrder(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
  ) {
    const order = await this.orderService.getOrderStatus(id, user);
    if (!order) throw new BadRequestException('Order not found');
    return order;
  }
}
