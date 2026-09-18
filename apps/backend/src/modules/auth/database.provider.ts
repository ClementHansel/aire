import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { TenantScopedPool } from '../../common/tenant-context';

export const DATABASE_POOL = 'DATABASE_POOL';

/**
 * `DATABASE_POOL` provides a {@link TenantScopedPool}, not a bare `pg.Pool`.
 *
 * It implements the only two members of the Pool surface this codebase uses —
 * `query()` and `connect()` — so all 568 query sites and 29 transaction sites
 * are scoped without being touched.
 *
 * Row-level security only binds to a role that is neither SUPERUSER nor
 * BYPASSRLS (migration 104 creates `aire_app`), so enforcement needs a second
 * connection and BOTH of these to turn on:
 *
 *   RLS_ENFORCE=true      explicit opt-in, so the switch is visible in ops
 *   DATABASE_URL_APP=…    a connection string for the RLS-bound role
 *
 * With either missing the wrapper hands every call to the owner pool, and
 * behaviour is exactly what it was before this wrapper existed — which is what
 * makes it safe to ship ahead of the rollout.
 *
 * Both pools are built here rather than injected as separate tokens because
 * this provider is registered by 69 modules; a second token would mean editing
 * all of them. `pg.Pool` opens connections lazily, so the unused pool costs
 * nothing (measured: 7 live connections across all 69 registrations).
 *
 * See docs/DEPLOYMENT.md section 8 for the rollout and its two traps: never set
 * `app.tenant_id` to the empty string, and never inherit it across a checkout.
 */
export const DatabasePoolProvider: Provider = {
  provide: DATABASE_POOL,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): TenantScopedPool => {
    const logger = new Logger('DatabasePool');
    const ownerUrl = configService.get<string>(
      'DATABASE_URL',
      'postgresql://aire:aire@localhost:5432/aire',
    );
    const owner = new Pool({ connectionString: ownerUrl });

    const appUrl = configService.get<string>('DATABASE_URL_APP', '');
    const optedIn = configService.get<string>('RLS_ENFORCE', '') === 'true';

    if (!optedIn || !appUrl) {
      if (appUrl && !optedIn) {
        logger.warn('DATABASE_URL_APP is set but RLS_ENFORCE is not "true" — row-level security is NOT enforced.');
      }
      if (optedIn && !appUrl) {
        logger.error('RLS_ENFORCE=true but DATABASE_URL_APP is empty — row-level security is NOT enforced.');
      }
      return new TenantScopedPool(owner, owner, false);
    }

    const strict = configService.get<string>('RLS_STRICT', '') === 'true';
    logger.log(
      `Row-level security ENFORCED (strict=${strict}): queries run as the RLS-bound role, scoped per request.`,
    );
    return new TenantScopedPool(new Pool({ connectionString: appUrl }), owner, true, strict);
  },
};
