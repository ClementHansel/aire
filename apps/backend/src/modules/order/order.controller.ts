import {
  Controller,
  Get,
  Query,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import {
  JWTPayload,
  OrderQueryParams,
  OrderListResponse,
  OrderStatus,
  VALID_ORDER_STATUSES,
  Role,
} from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { OrderListService } from './order-list.service';

@Controller('api/orders')
@UseGuards(JwtAuthGuard)
export class OrderController {
  constructor(private readonly orderListService: OrderListService) {}

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

    // Cashier cannot filter by outletId (they're already scoped by RLS)
    // Tenant_Owner / Outlet_Admin can filter by outletId
    const effectiveOutletId =
      user.role === Role.Cashier || user.role === Role.OutletAdmin
        ? undefined
        : outletId;

    const params: OrderQueryParams = {
      status: status as OrderStatus | undefined,
      search,
      dateFrom,
      dateTo,
      outletId: effectiveOutletId,
      page,
      pageSize,
    };

    return this.orderListService.listOrders(params);
  }
}
