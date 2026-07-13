import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JWTPayload, ERR_AUTH_INSUFFICIENT_ROLE } from '@aire/shared';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { PermissionsService } from './permissions.service';

/**
 * Enforces @RequirePermission() — the granular RBAC layer. Runs after
 * JwtAuthGuard (which populates request.user) and, by convention, RolesGuard.
 * Endpoints without @RequirePermission() are unaffected.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRE_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as JWTPayload | undefined;
    if (!user) throw new ForbiddenException(ERR_AUTH_INSUFFICIENT_ROLE);

    const allowed = await this.permissions.hasAny(user.sub, required);
    if (!allowed) {
      throw new ForbiddenException({
        error: 'Insufficient permissions',
        details: { required },
      });
    }
    return true;
  }
}
