import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Pool } from 'pg';
import { Role, JWTPayload } from '@aire/shared';
import { DATABASE_POOL } from '../../modules/auth/database.provider';
import { REQUIRES_ONBOARDING_KEY } from '../decorators/requires-onboarding.decorator';

/** Returned to the client so the frontend can redirect into the wizard. */
export const ERR_ONBOARDING_INCOMPLETE = 'ONBOARDING_INCOMPLETE';

/**
 * Blocks OPERATIONAL endpoints (those marked with @RequiresOnboarding()) for a
 * tenant whose owner hasn't finished the setup wizard. Setup endpoints are
 * unmarked and stay reachable. Platform super-admins are never gated.
 *
 * Completion is monotonic, so once a tenant is complete it is cached in-memory
 * and never re-queried — the common (post-onboarding) path costs nothing.
 */
@Injectable()
export class OnboardingCompleteGuard implements CanActivate {
  private readonly completed = new Set<string>();

  constructor(
    private readonly reflector: Reflector,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requires = this.reflector.getAllAndOverride<boolean>(REQUIRES_ONBOARDING_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requires) return true; // not an operational endpoint

    const user = context.switchToHttp().getRequest().user as JWTPayload | undefined;
    if (!user) return true; // auth guard handles missing user
    if (user.role === Role.PlatformSuperAdmin) return true; // never gate the platform

    const tenantId = user.tenant_id;
    if (!tenantId) return true;
    if (this.completed.has(tenantId)) return true;

    const res = await this.pool.query<{ onboarding_completed_at: Date | null }>(
      `SELECT onboarding_completed_at FROM tenants WHERE id = $1`,
      [tenantId],
    );
    if (res.rows[0]?.onboarding_completed_at) {
      this.completed.add(tenantId);
      return true;
    }
    throw new ForbiddenException({
      statusCode: 403,
      error: ERR_ONBOARDING_INCOMPLETE,
      message: 'Finish tenant onboarding before using this feature.',
    });
  }
}
