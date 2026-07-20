import { CanActivate, Injectable, mixin, type Type } from '@nestjs/common';
import { assertNotLean } from '../lean';

/**
 * Controller/handler guard that blocks a route while lean mode is on.
 *
 * Usage: `@UseGuards(LeanDisabledGuard('Employee self-service'))`. When lean mode
 * is off (or `LEAN_MODE=false` in the environment) the guard is a no-op, so
 * restoring a held surface is a single flag flip — no routes are removed.
 */
export function LeanDisabledGuard(feature: string): Type<CanActivate> {
  @Injectable()
  class MixinLeanGuard implements CanActivate {
    canActivate(): boolean {
      assertNotLean(feature);
      return true;
    }
  }
  return mixin(MixinLeanGuard);
}
