import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JWTPayload, Role } from '@aire/shared';
import { MembershipAdminController } from './membership-admin.controller';

/**
 * The AIRIN-133 reporting filters must not quietly restrict the day-to-day member
 * list. A membership is tenant-scoped by design — a member who signs up at one
 * branch washes at any of them — and this endpoint is the member-management
 * surface for every staff role, including cashiers.
 *
 * Resolving the caller's branches unconditionally would filter by the *purchase*
 * order's branch, so a cashier could not manage a member who signed up elsewhere,
 * and memberships with no linked fee order would disappear entirely. Branch
 * scoping is therefore applied only when a branch is explicitly requested.
 */
describe('MembershipAdminController.list — branch scoping is explicit-only', () => {
  let controller: MembershipAdminController;
  let service: { list: ReturnType<typeof vi.fn> };
  let scope: { resolveOutletIds: ReturnType<typeof vi.fn> };

  const cashier: JWTPayload = {
    sub: 'u1', tenant_id: 't1', outlet_id: 'branch-a', role: Role.Cashier, iat: 1, exp: 2,
  } as JWTPayload;

  beforeEach(() => {
    vi.clearAllMocks();
    service = { list: vi.fn().mockResolvedValue([]) };
    scope = { resolveOutletIds: vi.fn().mockResolvedValue(['branch-a']) };
    controller = new MembershipAdminController(service as never, scope as never);
  });

  const filtersPassed = () => service.list.mock.calls[0]![2] as { outletIds?: string[] };

  it('does NOT resolve or apply branch scoping when no outletId is given', async () => {
    await controller.list(cashier);
    expect(scope.resolveOutletIds).not.toHaveBeenCalled();
    expect(filtersPassed().outletIds).toBeUndefined();
  });

  it('leaves the list tenant-wide for a cashier with no outletId', async () => {
    // The regression this guards: a cashier seeing only members who signed up at
    // their own branch, unable to manage anyone else's plates.
    await controller.list(cashier, 'active');
    expect(filtersPassed().outletIds).toBeUndefined();
  });

  it('applies scoping when a branch IS explicitly requested', async () => {
    await controller.list(cashier, undefined, undefined, undefined, 'branch-b');
    expect(scope.resolveOutletIds).toHaveBeenCalledWith(cashier, 'branch-b');
    expect(filtersPassed().outletIds).toEqual(['branch-a']);
  });

  it('still routes an explicit branch through ScopeService, so it cannot be widened', async () => {
    // ScopeService returns the caller's OWN branches when they request one they
    // are not assigned to — the authz guarantee must survive the explicit-only rule.
    scope.resolveOutletIds.mockResolvedValueOnce(['branch-a']);
    await controller.list(cashier, undefined, undefined, undefined, 'branch-not-mine');
    expect(filtersPassed().outletIds).toEqual(['branch-a']);
  });

  it('passes date filters straight through', async () => {
    await controller.list(cashier, undefined, '2026-07-01', '2026-07-31');
    expect(service.list).toHaveBeenCalledWith('t1', undefined,
      expect.objectContaining({ dateFrom: '2026-07-01', dateTo: '2026-07-31' }));
  });

  it('rejects a malformed date rather than silently ignoring it', async () => {
    await expect(controller.list(cashier, undefined, 'not-a-date')).rejects.toThrow();
  });
});
