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
} from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { ScopeService } from '../../common/scope/scope.service';
import { OrderListService } from './order-list.service';
import { OrderService } from './order.service';

@Controller('api/orders')
@UseGuards(JwtAuthGuard)
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
   * - Cashier: scoped to own outlet via RLS (no explicit outletId filter needed)
   * - Tenant_Owner / Outlet_Admin: can filter by outletId
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
  async deleteOrder(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.orderService.deleteOrder(id, user);
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
