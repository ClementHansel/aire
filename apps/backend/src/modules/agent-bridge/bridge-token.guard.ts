import { Injectable, CanActivate, ExecutionContext, Inject, UnauthorizedException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

/**
 * Resolved bridge context attached to the request by BridgeTokenGuard.
 */
export interface BridgeContext {
  tenantId: string;
}

/**
 * BridgeTokenGuard — machine-to-machine auth for the hosted n8n instance.
 *
 * n8n is NOT a logged-in user, so bridge endpoints are not protected by JWT.
 * Instead each tenant has an opaque `bridge_token` (agent_configs.bridge_token);
 * n8n presents it as `X-Aire-Bridge-Token` (or `?bridgeToken=`) and we resolve
 * the owning tenant server-side. All data access downstream is then scoped to
 * that tenant — the visual flow can never widen scope.
 */
@Injectable()
export class BridgeTokenGuard implements CanActivate {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header = req.headers['x-aire-bridge-token'];
    const token: string | undefined =
      (Array.isArray(header) ? header[0] : header) || req.query?.bridgeToken;

    if (!token || typeof token !== 'string' || token.trim() === '') {
      throw new UnauthorizedException('Missing bridge token');
    }

    const res = await this.pool.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM agent_configs WHERE bridge_token = $1 LIMIT 1`,
      [token.trim()],
    );
    const row = res.rows[0];
    if (!row) throw new UnauthorizedException('Invalid bridge token');

    (req as { bridge?: BridgeContext }).bridge = { tenantId: row.tenant_id };
    return true;
  }
}
