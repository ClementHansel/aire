import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION_KEY = 'require_permission';

/**
 * Restrict an endpoint to users holding at least one of the given granular
 * permission keys (see PERMISSION_CATALOG). Enforced by PermissionsGuard, which
 * must be listed in the controller's @UseGuards after JwtAuthGuard.
 *
 * Permission keys are an ADDITIVE layer over @Roles(): a route should still
 * declare its minimum role. Users without a custom role hold all permissions,
 * so this only bites once a tenant owner assigns a restricted custom role.
 *
 * @example
 *   @RequirePermission('reports.export')
 *   @Roles(Role.OutletAdmin)
 *   @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
 */
export const RequirePermission = (...keys: string[]) => SetMetadata(REQUIRE_PERMISSION_KEY, keys);
