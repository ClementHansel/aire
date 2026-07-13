import { Body, Controller, Get, Post, Patch, Delete, Param, Query, HttpCode, HttpStatus, UseGuards, BadRequestException } from '@nestjs/common';
import { MemberLookupService } from '../membership/member-lookup.service';
import { PortalAuthService } from './portal-auth.service';
import { PortalDataService } from './portal-data.service';
import { PortalRenewService } from './portal-renew.service';
import { PortalBookingService, CreatePortalBookingDto } from './portal-booking.service';
import { PortalGuard, PortalCtx, PortalIdentity } from './portal.guard';

/**
 * Customer portal API. OTP endpoints are public (a walk-in customer authenticates
 * with their WhatsApp); everything else requires the customer token (PortalGuard).
 */
@Controller('api/portal')
export class PortalController {
  constructor(
    private readonly auth: PortalAuthService,
    private readonly members: MemberLookupService,
    private readonly data: PortalDataService,
    private readonly renew: PortalRenewService,
    private readonly booking: PortalBookingService,
  ) {}

  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  async requestOtp(@Body() body: { tenantId: string; phone: string }) {
    if (!body?.tenantId || !body?.phone) throw new BadRequestException('tenantId and phone are required');
    return this.auth.requestOtp(body.tenantId, body.phone);
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() body: { tenantId: string; phone: string; code: string }) {
    if (!body?.tenantId || !body?.phone || !body?.code) throw new BadRequestException('tenantId, phone and code are required');
    return this.auth.verifyOtp(body.tenantId, body.phone, body.code);
  }

  /** GET /api/portal/me — the signed-in customer's full account (memberships, card number, plates, vouchers, usage). */
  @Get('me')
  @UseGuards(PortalGuard)
  async me(@PortalCtx() ctx: PortalIdentity) {
    return this.members.buildMemberResponse(ctx.customerId, ctx.tenantId);
  }

  /** PATCH /api/portal/me — update the customer's own editable profile (name). */
  @Patch('me')
  @UseGuards(PortalGuard)
  async updateMe(@PortalCtx() ctx: PortalIdentity, @Body() body: { name?: string }) {
    return this.data.updateProfile(ctx.tenantId, ctx.customerId, body);
  }

  /** POST /api/portal/vehicles — register a vehicle/plate on the member's membership. */
  @Post('vehicles')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PortalGuard)
  async addVehicle(@PortalCtx() ctx: PortalIdentity, @Body() body: { plate?: string; brand?: string; model?: string }) {
    return this.data.addVehicle(ctx.tenantId, ctx.customerId, body);
  }

  /** DELETE /api/portal/vehicles/:plate — remove one of the member's registered plates. */
  @Delete('vehicles/:plate')
  @UseGuards(PortalGuard)
  async deleteVehicle(@PortalCtx() ctx: PortalIdentity, @Param('plate') plate: string) {
    return this.data.deleteVehicle(ctx.tenantId, ctx.customerId, decodeURIComponent(plate));
  }

  /** GET /api/portal/orders — the customer's visit/order history. */
  @Get('orders')
  @UseGuards(PortalGuard)
  async orders(@PortalCtx() ctx: PortalIdentity) {
    return this.data.orders(ctx.tenantId, ctx.customerId);
  }

  /** GET /api/portal/branches — active branches (for the queue/booking dropdowns). */
  @Get('branches')
  @UseGuards(PortalGuard)
  async branches(@PortalCtx() ctx: PortalIdentity) {
    return this.data.branches(ctx.tenantId);
  }

  /** GET /api/portal/queue?outletId= — the live queue at a branch. */
  @Get('queue')
  @UseGuards(PortalGuard)
  async queue(@PortalCtx() ctx: PortalIdentity, @Query('outletId') outletId: string) {
    if (!outletId) throw new BadRequestException('outletId is required');
    return this.data.queue(ctx.tenantId, outletId, ctx.customerId);
  }

  /** GET /api/portal/plans — membership plans available to renew onto. */
  @Get('plans')
  @UseGuards(PortalGuard)
  async plans(@PortalCtx() ctx: PortalIdentity) {
    return this.renew.listPlans(ctx.tenantId);
  }

  /** POST /api/portal/renew — start an online renewal (fee order + QRIS charge). */
  @Post('renew')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PortalGuard)
  async doRenew(@PortalCtx() ctx: PortalIdentity, @Body() body: { membershipId: string; planId: string }) {
    if (!body?.membershipId || !body?.planId) throw new BadRequestException('membershipId and planId are required');
    return this.renew.renew(ctx.tenantId, ctx.customerId, body.membershipId, body.planId);
  }

  /** GET /api/portal/renew/status?orderId= — poll + apply once paid. */
  @Get('renew/status')
  @UseGuards(PortalGuard)
  async renewStatus(@PortalCtx() ctx: PortalIdentity, @Query('orderId') orderId: string) {
    if (!orderId) throw new BadRequestException('orderId is required');
    return this.renew.status(ctx.tenantId, orderId);
  }

  /** POST /api/portal/membership/buy — buy a FIRST membership online (fee order + QRIS). */
  @Post('membership/buy')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PortalGuard)
  async buyMembership(@PortalCtx() ctx: PortalIdentity, @Body() body: { planId: string }) {
    if (!body?.planId) throw new BadRequestException('planId is required');
    return this.renew.buy(ctx.tenantId, ctx.customerId, body.planId);
  }

  /** GET /api/portal/membership/buy/status?orderId= — poll the purchase order. */
  @Get('membership/buy/status')
  @UseGuards(PortalGuard)
  async buyStatus(@PortalCtx() ctx: PortalIdentity, @Query('orderId') orderId: string) {
    if (!orderId) throw new BadRequestException('orderId is required');
    return this.renew.buyStatus(ctx.tenantId, orderId);
  }

  /** POST /api/portal/membership/activate — activate the bought membership after payment. */
  @Post('membership/activate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PortalGuard)
  async activateBought(
    @PortalCtx() ctx: PortalIdentity,
    @Body() body: { membershipId: string; plates: { plate: string; brand?: string; model?: string }[] },
  ) {
    if (!body?.membershipId) throw new BadRequestException('membershipId is required');
    return this.renew.activateBought(ctx.tenantId, ctx.customerId, body.membershipId, body.plates ?? []);
  }

  /** POST /api/portal/bookings — request a booking (pending cashier confirm). */
  @Post('bookings')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PortalGuard)
  async createBooking(@PortalCtx() ctx: PortalIdentity, @Body() body: CreatePortalBookingDto) {
    return this.booking.create(ctx.tenantId, ctx.customerId, body);
  }

  /** GET /api/portal/bookings — the customer's bookings + statuses. */
  @Get('bookings')
  @UseGuards(PortalGuard)
  async listBookings(@PortalCtx() ctx: PortalIdentity) {
    return this.booking.list(ctx.tenantId, ctx.customerId);
  }
}

/**
 * Public booking confirm/reject — reached from the link sent to the branch
 * cashier's WhatsApp. The unguessable token is the credential (no login).
 */
@Controller('api/public/bookings')
export class PublicBookingController {
  constructor(private readonly booking: PortalBookingService) {}

  @Get(':token')
  async detail(@Param('token') token: string) {
    return this.booking.getByToken(token);
  }

  @Post(':token/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(@Param('token') token: string) {
    return this.booking.confirm(token);
  }

  @Post(':token/reject')
  @HttpCode(HttpStatus.OK)
  async reject(@Param('token') token: string) {
    return this.booking.reject(token);
  }
}
