import { Controller, Get, Put, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { OnboardingService } from './onboarding.service';

/**
 * Tenant onboarding wizard API, scoped to the caller's tenant.
 *
 * Reads are open to any authenticated tenant user (staff see a "waiting for the
 * owner" screen driven off the same status); writes are owner-only. Platform
 * super-admins pre-fill a tenant's data through the admin module, not here.
 */
@Controller('api/onboarding')
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(private readonly service: OnboardingService) {}

  @Get('me')
  async status(@CurrentUser() user: JWTPayload) {
    return this.service.getStatus(user.tenant_id);
  }

  @Put('me/state')
  @UseGuards(RolesGuard)
  @Roles(Role.TenantOwner)
  async saveState(@CurrentUser() user: JWTPayload, @Body() patch: Record<string, unknown>) {
    return this.service.saveState(user.tenant_id, patch ?? {});
  }

  @Post('me/complete')
  @UseGuards(RolesGuard)
  @Roles(Role.TenantOwner)
  @HttpCode(HttpStatus.OK)
  async complete(@CurrentUser() user: JWTPayload) {
    return this.service.complete(user.tenant_id);
  }
}
