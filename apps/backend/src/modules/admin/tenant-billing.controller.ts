import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Role } from '@aire/shared';
import type { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { TenantBillingService } from './tenant-billing.service';
import { PlatformBillingPaymentService } from './platform-billing-payment.service';
import { PaymentProviderRegistry } from '../payment/payment-provider.registry';

/**
 * Self-serve tenant billing. Every endpoint is scoped to the caller's own tenant
 * (user.tenant_id) — a tenant owner manages THEIR subscription here; no super-admin
 * needed. Distinct from the super-admin billing console under /api/admin.
 */
@Controller('api/billing/me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TenantOwner)
export class TenantBillingController {
  constructor(private readonly billing: TenantBillingService) {}

  /** GET /api/billing/me/summary — plan, status, usage-vs-limits, outstanding count. */
  @Get('summary')
  summary(@CurrentUser() user: JWTPayload) {
    return this.billing.summary(user.tenant_id);
  }

  /** GET /api/billing/me/invoices — the tenant's own subscription invoices. */
  @Get('invoices')
  invoices(@CurrentUser() user: JWTPayload) {
    return this.billing.listInvoices(user.tenant_id);
  }

  /** GET /api/billing/me/plans — active plans available to switch to. */
  @Get('plans')
  plans() {
    return this.billing.availablePlans();
  }

  /** POST /api/billing/me/invoices/:id/pay — open a gateway checkout for own invoice. */
  @Post('invoices/:id/pay')
  @HttpCode(HttpStatus.OK)
  pay(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.billing.payInvoice(user.tenant_id, id);
  }

  /** POST /api/billing/me/change-plan — self-serve upgrade/downgrade. */
  @Post('change-plan')
  @HttpCode(HttpStatus.OK)
  changePlan(@CurrentUser() user: JWTPayload, @Body() body: { plan: string }) {
    return this.billing.changePlan(user.tenant_id, body?.plan, user.sub);
  }
}

/**
 * Gateway callbacks for PLATFORM subscription payments (distinct from the POS
 * order webhooks). Validates the signature with the platform's own gateway
 * credentials, then confirms the matching invoice. Public (no auth) — a gateway
 * calls it — but signature-verified.
 */
@Controller('api/payments/webhook/platform')
export class PlatformPaymentWebhookController {
  constructor(
    private readonly billingPayment: PlatformBillingPaymentService,
    private readonly registry: PaymentProviderRegistry,
  ) {}

  @Post(':provider')
  @HttpCode(HttpStatus.OK)
  async handle(
    @Param('provider') providerName: string,
    @Body() payload: unknown,
    @Headers('x-callback-token') xenditSig?: string,
    @Headers('x-signature-key') midtransSig?: string,
    @Headers('stripe-signature') stripeSig?: string,
  ) {
    const signature = xenditSig || midtransSig || stripeSig || '';
    if (!signature) throw new UnauthorizedException('Missing webhook signature');
    const cfg = this.billingPayment.platformConfig();
    const provider = this.registry.getProviderByName(providerName, cfg);
    const result = await provider.handleWebhook(payload, signature);
    if (!result.valid) throw new UnauthorizedException('Invalid webhook signature');
    if (result.status === 'completed' && result.transactionId) {
      await this.billingPayment.confirmInvoiceByReference(result.transactionId);
    }
    return { received: true, transactionId: result.transactionId, status: result.status };
  }
}
