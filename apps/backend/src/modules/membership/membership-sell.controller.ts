import {
  Controller,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../../common/guards';
import { CurrentUser, Roles } from '../../common/decorators';
import { PosCheckoutService, resolveServiceBusinessUnit } from '../order/pos-checkout.service';
import { MembershipPlanService } from './membership-plan.service';
import { MembershipSellService } from './membership-sell.service';
import { MembershipRenewalService } from './membership-renewal.service';
import { MembershipIdentityService } from './membership-identity.service';
import { PlateRegistrationDto } from './dto';
import { TenantFeaturesService } from '../../common/tenant-features';

interface SellMembershipBody {
  planId: string;
  customer: {
    name: string;
    phone: string;
    email?: string;
    /** Optional vehicle captured at sale time — stored on the fee order so the
     *  plate-registration step can pre-fill its first row from it. */
    licensePlate?: string;
    vehicleBrand?: string;
    vehicleModel?: string;
  };
}

interface ActivateBody {
  plates: PlateRegistrationDto[];
}

/**
 * Sell Pack — membership sales endpoints.
 *
 * Flow:
 *   1. POST /api/memberships/sell    → creates customer + order + pending membership
 *   2. POS settles the order via the standard payment flow (cash/QRIS/EDC/transfer)
 *   3. POST /api/memberships/:id/activate → registers plates and activates
 *
 * Requirements: 14.1, 14.2, 14.4
 */
@Controller('api/memberships')
@UseGuards(JwtAuthGuard)
export class MembershipSellController {
  constructor(
    private readonly planService: MembershipPlanService,
    private readonly sellService: MembershipSellService,
    private readonly checkout: PosCheckoutService,
    private readonly renewalService: MembershipRenewalService,
    private readonly identity: MembershipIdentityService,
    private readonly features: TenantFeaturesService,
  ) {}

  /**
   * POST /api/memberships/backfill-numbers — one-time: assign membership numbers
   * to existing members of the caller's tenant who don't have one yet. Idempotent.
   */
  @Post('backfill-numbers')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  async backfillNumbers(@CurrentUser() user: JWTPayload) {
    return this.identity.backfillNumbers(user.tenant_id);
  }

  /**
   * POST /api/memberships/:id/renew — renew an existing membership on a plan.
   * Creates the renewal fee order and extends (active/grace) or creates a new
   * membership (revoked). Returns the unpaid order to collect payment on.
   */
  @Post(':id/renew')
  @HttpCode(HttpStatus.OK)
  async renew(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Body() body: { planId: string; nextStartDate?: string },
  ) {
    if (!body?.planId) throw new BadRequestException('planId is required');
    return this.renewalService.renewByMembershipId(user, id, body.planId, body.nextStartDate);
  }

  /**
   * POST /api/memberships/apply-renewal — apply a pending renewal after its fee
   * order is paid (extends/creates). Called by POS/CRM once payment succeeds.
   */
  @Post('apply-renewal')
  @HttpCode(HttpStatus.OK)
  async applyRenewal(@CurrentUser() user: JWTPayload, @Body() body: { orderId: string }) {
    if (!body?.orderId) throw new BadRequestException('orderId is required');
    return this.renewalService.applyRenewal(user.tenant_id, body.orderId);
  }

  @Post('sell')
  @HttpCode(HttpStatus.CREATED)
  async sell(@CurrentUser() user: JWTPayload, @Body() body: SellMembershipBody) {
    if (!body.planId || !body.customer?.name?.trim() || !body.customer?.phone?.trim()) {
      throw new BadRequestException('planId and customer name/phone are required');
    }
    if (!user.outlet_id) {
      throw new BadRequestException('Cashier must be assigned to an outlet to sell packs');
    }

    const plan = await this.planService.getPlan(body.planId);

    // A membership plan carries no business_unit of its own — derive it from
    // whichever services it actually grants (free or member-discounted), so
    // the fee order's revenue lands in the right AIRE/LEAD bucket instead of
    // defaulting to AIRE by accident (see PosCheckoutService.createPackOrder).
    const planServiceIds = [
      ...(plan.freeServiceIds ?? []),
      ...plan.discountedServices.map((d) => d.serviceId),
    ];
    const businessUnit = await resolveServiceBusinessUnit(this.checkout.db, planServiceIds);

    // Create the customer + pending order atomically.
    const client = await this.checkout.db.connect();
    let order: {
      id: string; orderNumber: string; total: number;
      licensePlate?: string; vehicleBrand?: string; vehicleModel?: string;
    };
    let customerId: string;
    try {
      await client.query('BEGIN');
      customerId = await this.checkout.upsertCustomer(
        client,
        user.tenant_id,
        body.customer.name.trim(),
        body.customer.phone.trim(),
        body.customer.email,
      );
      order = await this.checkout.createPackOrder(client, user, {
        customerId,
        customerName: body.customer.name.trim(),
        customerPhone: body.customer.phone.trim(),
        total: plan.price,
        note: `Membership: ${plan.name}`,
        licensePlate: body.customer.licensePlate,
        vehicleBrand: body.customer.vehicleBrand,
        vehicleModel: body.customer.vehicleModel,
        businessUnit,
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Create the pending membership tied to the order.
    const membership = await this.sellService.sellMembership({
      planId: body.planId,
      customerId,
      orderId: order.id,
      tenantId: user.tenant_id,
    });

    return {
      order,
      membershipId: membership.id,
      maxPlates: plan.maxPlates,
      planName: plan.name,
    };
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  async activate(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() body: ActivateBody) {
    const plates = Array.isArray(body.plates) ? body.plates : [];
    // A vehicle business must name at least one car, because that plate is what
    // every later benefit check matches on. For a tenant with no vehicles the
    // membership belongs to the CUSTOMER, so an empty list is the normal case
    // and demanding a plate would make memberships unsellable.
    if (plates.length === 0 && (await this.features.can(user.tenant_id, 'vehicles'))) {
      throw new BadRequestException('At least one plate is required to activate the membership');
    }
    return this.sellService.activateMembership(id, { plates }, user.tenant_id, user.sub);
  }
}
