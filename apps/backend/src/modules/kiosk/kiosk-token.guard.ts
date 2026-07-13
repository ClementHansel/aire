import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Inject,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

/** Resolved kiosk device context, attached to the request by KioskTokenGuard. */
export interface KioskContext {
  deviceId: string;
  tenantId: string;
  outletId: string;
}

/**
 * Authorizes public kiosk endpoints via an opaque device token
 * (`x-kiosk-token` header, or `kioskToken` query param for QR launches).
 * Resolves the device's tenant + outlet so the customer stays unauthenticated
 * while only provisioned kiosks can create orders / start charges.
 */
@Injectable()
export class KioskTokenGuard implements CanActivate {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token =
      (req.headers?.['x-kiosk-token'] as string) ||
      (req.query?.kioskToken as string) ||
      '';
    if (!token) throw new UnauthorizedException('Missing kiosk token');

    const res = await this.pool.query<{ id: string; tenant_id: string; outlet_id: string }>(
      `SELECT id, tenant_id, outlet_id FROM kiosk_devices
       WHERE token = $1 AND is_active = true LIMIT 1`,
      [token],
    );
    const row = res.rows[0];
    if (!row) throw new UnauthorizedException('Invalid kiosk token');

    req.kiosk = { deviceId: row.id, tenantId: row.tenant_id, outletId: row.outlet_id };
    // Best-effort liveness timestamp; never blocks the request.
    void this.pool
      .query(`UPDATE kiosk_devices SET last_seen_at = NOW() WHERE id = $1`, [row.id])
      .catch(() => undefined);
    return true;
  }
}

/** Injects the resolved KioskContext into a controller handler param. */
export const KioskCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): KioskContext =>
    ctx.switchToHttp().getRequest().kiosk,
);
