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
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { PosCheckoutService } from '../order/pos-checkout.service';
import { MembershipPlanService } from './membership-plan.service';
import { MembershipSellService } from './membership-sell.service';
import { PlateRegistrationDto } from './dto';

interface SellMembershipBody {
  planId: string;
  customer: { name: string; phone: string };
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
  ) {}

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

    // Create the customer + pending order atomically.
    const client = await this.checkout.db.connect();
    let order: { id: string; orderNumber: string; total: number };
    let customerId: string;
    try {
      await client.query('BEGIN');
      customerId = await this.checkout.upsertCustomer(
        client,
        user.tenant_id,
        body.customer.name.trim(),
        body.customer.phone.trim(),
      );
      order = await this.checkout.createPackOrder(client, user, {
        customerId,
        customerName: body.customer.name.trim(),
        customerPhone: body.customer.phone.trim(),
        total: plan.price,
        note: `Membership: ${plan.name}`,
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
  async activate(@Param('id') id: string, @Body() body: ActivateBody) {
    if (!Array.isArray(body.plates) || body.plates.length === 0) {
      throw new BadRequestException('At least one plate is required to activate the membership');
    }
    return this.sellService.activateMembership(id, { plates: body.plates });
  }
}
