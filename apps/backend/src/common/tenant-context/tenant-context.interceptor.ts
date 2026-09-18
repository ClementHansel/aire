import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Role } from '@aire/shared';
import { runAsTenant, runPrivileged } from './tenant-context';

/**
 * Puts the authenticated request's tenant into the async context, so
 * {@link TenantScopedPool} can scope its queries.
 *
 * An INTERCEPTOR rather than middleware, deliberately: middleware runs before
 * guards, when `request.user` does not exist yet. By the time an interceptor
 * runs, JwtAuthGuard has attached the decoded token.
 *
 * Three cases:
 *  - a tenant user           -> scoped to their tenant.
 *  - a platform super-admin  -> privileged. Their endpoints read across tenants
 *                               by definition (the ops feed, cross-tenant
 *                               metrics, the gateway registry).
 *  - no authenticated user   -> privileged. Public routes (login, webhooks,
 *                               the kiosk menu, public receipts) resolve their
 *                               own tenant from a token or a parameter and must
 *                               not be blocked before they get the chance;
 *                               those queries are audited individually, which
 *                               is how the kiosk leak was found.
 *
 * Note what this does NOT do: it never trusts a tenant id from the request
 * body or query string. Only the signed token's `tenant_id`.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<{
      user?: { tenant_id?: string; role?: string; outlet_id?: string | null };
      method?: string;
      url?: string;
    }>();
    const user = req?.user;
    const origin = `${req?.method ?? '?'} ${req?.url ?? '?'}`;

    if (user?.role === Role.PlatformSuperAdmin) {
      return runPrivileged(() => next.handle(), origin);
    }
    if (user?.tenant_id) {
      // role and outlet_id matter: several policies grant the whole tenant to an
      // owner and otherwise confine the caller to one outlet.
      return runAsTenant(user.tenant_id, () => next.handle(), origin, {
        role: user.role,
        outletId: user.outlet_id ?? null,
      });
    }
    return runPrivileged(() => next.handle(), `unauthenticated ${origin}`);
  }
}
