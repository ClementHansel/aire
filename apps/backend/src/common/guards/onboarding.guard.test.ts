import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { Role } from '@aire/shared';
import { OnboardingCompleteGuard, ERR_ONBOARDING_INCOMPLETE } from './onboarding.guard';

/** Build a mock ExecutionContext carrying `user` on the HTTP request. */
function ctx(user: unknown) {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

function makeGuard(marked: boolean, poolResult: { onboarding_completed_at: Date | null } | undefined) {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(marked) } as any;
  const query = vi.fn().mockResolvedValue({ rows: poolResult ? [poolResult] : [] });
  const pool = { query } as any;
  return { guard: new OnboardingCompleteGuard(reflector, pool), query };
}

describe('OnboardingCompleteGuard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows endpoints that are not marked @RequiresOnboarding (no DB hit)', async () => {
    const { guard, query } = makeGuard(false, undefined);
    await expect(guard.canActivate(ctx({ role: Role.Cashier, tenant_id: 't1' }))).resolves.toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it('never gates a platform super-admin (no DB hit)', async () => {
    const { guard, query } = makeGuard(true, undefined);
    await expect(guard.canActivate(ctx({ role: Role.PlatformSuperAdmin, tenant_id: null }))).resolves.toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it('allows a tenant user whose onboarding is complete', async () => {
    const { guard, query } = makeGuard(true, { onboarding_completed_at: new Date() });
    await expect(guard.canActivate(ctx({ role: Role.TenantOwner, tenant_id: 't1' }))).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('blocks a tenant user whose onboarding is incomplete with ONBOARDING_INCOMPLETE', async () => {
    const { guard } = makeGuard(true, { onboarding_completed_at: null });
    await expect(guard.canActivate(ctx({ role: Role.Cashier, tenant_id: 't1' }))).rejects.toMatchObject({
      response: expect.objectContaining({ error: ERR_ONBOARDING_INCOMPLETE }),
    });
    await expect(guard.canActivate(ctx({ role: Role.Cashier, tenant_id: 't1' }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('caches completion so a second request skips the DB (completion is monotonic)', async () => {
    const { guard, query } = makeGuard(true, { onboarding_completed_at: new Date() });
    const user = { role: Role.TenantOwner, tenant_id: 't-cache' };
    await guard.canActivate(ctx(user));
    await guard.canActivate(ctx(user));
    expect(query).toHaveBeenCalledTimes(1); // second call served from cache
  });

  it('does not gate when there is no authenticated user (auth guard handles that)', async () => {
    const { guard, query } = makeGuard(true, undefined);
    await expect(guard.canActivate(ctx(undefined))).resolves.toBe(true);
    expect(query).not.toHaveBeenCalled();
  });
});
