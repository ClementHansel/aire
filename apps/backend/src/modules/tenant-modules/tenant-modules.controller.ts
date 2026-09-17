import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { Pool } from 'pg';
import {
  JWTPayload,
  MODULES_BLOCKED_BY_VERTICAL,
  TenantCapabilities,
  TenantVertical,
  resolveTenantModules,
} from '@aire/shared';
import { CurrentUser } from '../../common/decorators';
import { TenantFeaturesService } from '../../common/tenant-features';
import { JwtAuthGuard } from '../auth/auth.guard';
import { DATABASE_POOL } from '../auth/database.provider';

export interface TenantModulesResponse {
  modules: Record<string, boolean>;
  /** What shape of business this tenant runs. Drives which concepts exist. */
  vertical: TenantVertical;
  /** Resolved capability flags (vehicles/bays/lpr + the subject noun). */
  capabilities: TenantCapabilities;
}

/**
 * Tenant-facing module + capability resolution.
 *
 * Any authenticated user can read this for their own tenant. The dashboard uses
 * `modules` to hide navigation for disabled modules and `capabilities` to decide
 * whether vehicle concepts exist at all (a lab-services tenant has no plates).
 *
 * Modules are enable/disabled by the platform super-admin; the vertical is set
 * when the tenant is created.
 */
@Controller('api/modules')
@UseGuards(JwtAuthGuard)
export class TenantModulesController {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly features: TenantFeaturesService,
  ) {}

  /** GET /api/modules/me — modules + capabilities for the current user's tenant. */
  @Get('me')
  async myModules(@CurrentUser() user: JWTPayload): Promise<TenantModulesResponse> {
    const result = await this.pool.query<{ settings: Record<string, unknown> }>(
      `SELECT settings FROM tenants WHERE id = $1`,
      [user.tenant_id],
    );
    const settings = (result.rows[0]?.settings ?? {}) as {
      featureFlags?: Record<string, boolean>;
    };

    const { vertical, capabilities } = await this.features.getProfile(user.tenant_id);
    const modules = resolveTenantModules(settings.featureFlags ?? {});

    // A module that cannot mean anything for this vertical is forced off even if
    // an admin left it on — otherwise a laundry tenant gets a "CCTV & LPR" nav
    // item that can only ever show an empty plate-detection log.
    for (const key of MODULES_BLOCKED_BY_VERTICAL[vertical] ?? []) {
      modules[key] = false;
    }

    return { modules, vertical, capabilities };
  }
}
