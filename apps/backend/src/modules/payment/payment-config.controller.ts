import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { PaymentService } from './payment.service';

/**
 * Per-tenant payment gateway configuration (provider + API keys), set in the UI.
 * Secrets are never returned — only whether they're present. OutletAdmin+.
 */
@Controller('api/payment-config')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentConfigController {
  constructor(private readonly service: PaymentService) {}

  @Get()
  @Roles(Role.OutletAdmin)
  get(@CurrentUser() user: JWTPayload) {
    return this.service.getPublicConfig(user.tenant_id);
  }

  @Put()
  @Roles(Role.OutletAdmin)
  set(@CurrentUser() user: JWTPayload, @Body() body: { provider: string; apiKey?: string; webhookSecret?: string }) {
    return this.service.setTenantConfig(user.tenant_id, body);
  }
}
