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
      await client.query(`SET LOCAL app.tenant_id = '${user.tenant_id}'`);
      await client.query(
        `SET LOCAL app.outlet_id = '${user.outlet_id ?? ''}'`,
      );
      await client.query(`SET LOCAL app.role = '${user.role}'`);

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
