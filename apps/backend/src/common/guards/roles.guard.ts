import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  Role,
  JWTPayload,
  ROLE_HIERARCHY,
  OUTLET_SCOPED_ROLES,
  ERR_AUTH_INSUFFICIENT_ROLE,
  ERR_AUTH_OUTLET_MISMATCH,
} from '@aire/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Roles Guard.
 *
 * Checks if the authenticated user's role meets the minimum required privilege level
 * defined by the @Roles() decorator. Uses ROLE_HIERARCHY for numeric comparison.
 *
 * Also enforces outlet scoping: Cashier and Outlet_Admin roles are restricted to
 * their assigned outlet_id. If a request targets a different outlet, access is denied
 * unless the user has tenant-wide access (TenantOwner or PlatformSuperAdmin).
 *
 * Usage:
 *   @Roles(Role.OutletAdmin)
 *   @UseGuards(JwtAuthGuard, RlsContextGuard, RolesGuard)
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no @Roles() decorator is present, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as JWTPayload;

    if (!user) {
      throw new ForbiddenException(ERR_AUTH_INSUFFICIENT_ROLE);
    }

    const userRoleLevel = ROLE_HIERARCHY[user.role as Role] ?? 0;

    // Check if user's role level meets the minimum required role level
    const hasRequiredRole = requiredRoles.some(
      (role) => userRoleLevel >= ROLE_HIERARCHY[role],
    );

    if (!hasRequiredRole) {
      throw new ForbiddenException(ERR_AUTH_INSUFFICIENT_ROLE);
    }

    // Enforce outlet scoping for outlet-bound roles
    if (OUTLET_SCOPED_ROLES.includes(user.role as Role)) {
      const targetOutletId =
        request.params?.outletId ?? request.body?.outletId ?? request.query?.outletId;

      if (targetOutletId && targetOutletId !== user.outlet_id) {
        throw new ForbiddenException(ERR_AUTH_OUTLET_MISMATCH);
      }
    }

    return true;
  }
}
