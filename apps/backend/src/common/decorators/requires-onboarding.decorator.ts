import { SetMetadata } from '@nestjs/common';

export const REQUIRES_ONBOARDING_KEY = 'requiresOnboarding';

/**
 * Marks an endpoint/controller as OPERATIONAL — a tenant-scoped user may only
 * reach it once their onboarding is complete. Enforced by OnboardingCompleteGuard
 * (a global guard). Platform super-admins are never gated. Setup endpoints
 * (legal-entities, outlets, services, users, hr, accounting, onboarding) omit
 * this so the tenant can actually complete the wizard.
 *
 * @example
 *   @RequiresOnboarding()
 *   @Controller('api/orders')
 */
export const RequiresOnboarding = () => SetMetadata(REQUIRES_ONBOARDING_KEY, true);
