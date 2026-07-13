import {
  Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { PaymentMethodService, UpsertPaymentMethodDto } from './payment-method.service';

/**
 * Payment-method catalog. Reads allowed for any authenticated user (POS needs them);
 * writes restricted to outlet admins and above.
 */
@Controller('api/payment-methods')
@UseGuards(JwtAuthGuard)
export class PaymentMethodController {
  constructor(private readonly service: PaymentMethodService) {}

  @Get()
  async findAll(
    @CurrentUser() user: JWTPayload,
    @Query('outletId') outletId?: string,
    @Query('active') active?: string,
  ) {
    return this.service.findAll(user.tenant_id, outletId, active === 'true');
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: JWTPayload, @Body() dto: UpsertPaymentMethodDto) {
    return this.service.create(user.tenant_id, dto);
  }

  /** One-click onboarding: seed a starter set if the tenant has none yet. */
  @Post('seed-defaults')
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  async seedDefaults(@CurrentUser() user: JWTPayload) {
    return this.service.seedDefaults(user.tenant_id);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  async update(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Body() dto: Partial<UpsertPaymentMethodDto>,
  ) {
    return this.service.update(user.tenant_id, id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    await this.service.remove(user.tenant_id, id);
  }
}
