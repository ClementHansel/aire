import { ForbiddenException } from '@nestjs/common';
import { LEAN_MODE } from '@aire/shared';

/**
 * Lean-mode gate for backend routes.
 *
 * While lean mode is on (see `@aire/shared` LEAN_MODE), the interlinked surfaces
 * held from the tenant product — customer self-order, employee self-service, and
 * the customer portal — must also be disabled at the API so a client cannot reach
 * a half-configured flow by calling the endpoint directly. Handlers guard-throw
 * rather than being deleted, so restoring is a single flag flip.
 *
 * Tests can force it off with `LEAN_MODE=false` in the environment.
 */
export function leanModeEnabled(): boolean {
  if (process.env.LEAN_MODE === 'false') return false;
  return LEAN_MODE;
}

/** Throw a 403 when the given feature is held by lean mode. No-op otherwise. */
export function assertNotLean(feature: string): void {
  if (leanModeEnabled()) {
    throw new ForbiddenException(`${feature} is temporarily disabled while the product is in focus mode.`);
  }
}
