import { describe, it, expect } from 'vitest';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { VoucherPackController, VoucherTemplateController } from './voucher.controller';

/** Granular permission keys declared on a controller method, if any. */
const permsOn = (ctor: abstract new (...args: never[]) => unknown, method: string): string[] | undefined =>
  Reflect.getMetadata(REQUIRE_PERMISSION_KEY, (ctor.prototype as Record<string, unknown>)[method] as object);

/**
 * AIRIN-128: "Insufficient permissions ketika melakukan transaksi pembelian
 * voucher pack."
 *
 * `POST /api/voucher-packs/sell` (and its `issue` follow-up) are POS till
 * actions. They used to require `vouchers.write` — the key that gates voucher
 * TEMPLATE management on the dashboard — so any tenant who built a restricted
 * cashier role without "manage voucher templates" silently lost the ability to
 * sell voucher packs. Confirmed against real data: a custom role named
 * "POS Only" holds ["transactions.read", "customers.read"] and 403s there, while
 * `POST /orders` and `POST /memberships/sell` (both JwtAuthGuard-only) work.
 *
 * These tests lock in the split: till actions ungated, dashboard management
 * gated. If POS selling should ever be gated it needs its own key applied to all
 * three sale endpoints consistently — not reusing an admin one on just this path.
 */
describe('VoucherPackController — POS till actions are not gated by a dashboard permission', () => {
  it('does not require a granular permission to sell a voucher pack', () => {
    expect(permsOn(VoucherPackController, 'sell')).toBeUndefined();
  });

  it('does not require a granular permission to issue codes after payment', () => {
    // `issue` is the second half of the same till flow — gating it would break
    // the sale after the customer has already paid.
    expect(permsOn(VoucherPackController, 'issue')).toBeUndefined();
  });

  it('specifically does not require vouchers.write anywhere in the till flow', () => {
    for (const method of ['sell', 'issue', 'catalog']) {
      expect(permsOn(VoucherPackController, method) ?? []).not.toContain('vouchers.write');
    }
  });
});

describe('VoucherTemplateController — dashboard management stays gated', () => {
  it('still requires vouchers.write to create a template', () => {
    expect(permsOn(VoucherTemplateController, 'create')).toContain('vouchers.write');
  });

  it('still requires vouchers.write to mutate templates', () => {
    // Guards against "fix the 403 by deleting every decorator in the file".
    const gated = ['update', 'remove'].filter(
      (m) => (permsOn(VoucherTemplateController, m) ?? []).includes('vouchers.write'),
    );
    expect(gated.length).toBeGreaterThan(0);
  });
});
