import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { Pool } from 'pg';
import { JWTPayload, resolveTenantModules } from '@aire/shared';
import { CurrentUser } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/auth.guard';
import { DATABASE_POOL } from '../auth/database.provider';

/**
 * Tenant-facing module resolution.
 *
 * Any authenticated user can read which modules are enabled for their own
 * tenant. The dashboard uses this to hide navigation for disabled modules.
 * Enable/disable is controlled by the platform super-admin (see AdminController).
 */
@Controller('api/modules')
@UseGuards(JwtAuthGuard)
export class TenantModulesController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /** GET /api/modules/me — modules enabled for the current user's tenant. */
  @Get('me')
  async myModules(
    @CurrentUser() user: JWTPayload,
  ): Promise<{ modules: Record<string, boolean> }> {
    const result = await this.pool.query<{ settings: Record<string, unknown> }>(
      `SELECT settings FROM tenants WHERE id = $1`,
      [user.tenant_id],
    );
    const settings = (result.rows[0]?.settings ?? {}) as {
      featureFlags?: Record<string, boolean>;
    };
    return { modules: resolveTenantModules(settings.featureFlags ?? {}) };
  }
}
