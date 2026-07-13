import { Controller, Get, UseGuards } from '@nestjs/common';
import type { JWTPayload } from '@aire/shared';
import { CurrentUser } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/auth.guard';
import { PlatformAnnouncementService } from './platform-announcement.service';

/**
 * Tenant-facing read of platform announcements. Unlike the admin endpoints
 * (super-admin only), this is available to ANY authenticated tenant user so the
 * dashboard can surface published announcements targeted to their tenant/plan.
 * No RolesGuard — just a valid session.
 */
@Controller('api/announcements')
@UseGuards(JwtAuthGuard)
export class PlatformFeedController {
  constructor(private readonly announcements: PlatformAnnouncementService) {}

  /** GET /api/announcements/feed — published announcements for the caller's tenant. */
  @Get('feed')
  async feed(@CurrentUser() user: JWTPayload) {
    return this.announcements.listForTenant(user.tenant_id);
  }
}
