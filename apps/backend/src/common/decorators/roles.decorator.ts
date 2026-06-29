import { SetMetadata } from '@nestjs/common';
import { Role } from '@aire/shared';

export const ROLES_KEY = 'roles';

/**
 * Decorator to restrict endpoint access to users with at minimum the specified role level.
 * Uses role hierarchy: Platform_Super_Admin > Tenant_Owner > Outlet_Admin > Cashier.
 *
 * @example
 * @Roles(Role.TenantOwner)
 * @UseGuards(JwtAuthGuard, RlsContextGuard, RolesGuard)
 * async getOutlets() { ... }
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
