import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Inject,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { JWTPayload } from '@aire/shared';
import { DATABASE_POOL } from '../../modules/auth/database.provider';

/**
 * RLS Context Guard.
 *
 * Runs AFTER JwtAuthGuard to set PostgreSQL session variables for Row-Level Security.
 * Executes SET LOCAL statements on a dedicated connection for the request,
 * enabling RLS policies to filter data by tenant_id, outlet_id, and role.
 *
 * SET LOCAL is transaction-scoped, so it works safely with connection pooling
 * as long as queries within the same request use the same connection/transaction.
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, RlsContextGuard)
 */
@Injectable()
export class RlsContextGuard implements CanActivate {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as JWTPayload;

    if (!user) {
      return false;
    }

    const client: PoolClient = await this.pool.connect();

    try {
      await client.query('BEGIN');
      // Use set_config(name, value, is_local=true) with BOUND parameters instead
      // of interpolating JWT values into a `SET LOCAL ... = '...'` string. SET does
      // not accept bind parameters, but set_config() does — so a crafted claim can
      // never break out of the value and inject SQL. is_local = true makes it
      // transaction-scoped, exactly like SET LOCAL.
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        user.tenant_id ?? '',
      ]);
      await client.query(`SELECT set_config('app.outlet_id', $1, true)`, [
        user.outlet_id ?? '',
      ]);
      await client.query(`SELECT set_config('app.role', $1, true)`, [
        user.role ?? '',
      ]);

      // Attach the client to the request so downstream services can use
      // the same connection with RLS variables already set.
      request.dbClient = client;
    } catch {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      return false;
    }

    return true;
  }
}
