import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoucherRedemptionService } from './voucher-redemption.service';

/**
 * AIRIN-149 — /vouchers/validate must accept BOTH voucher models.
 *
 * The endpoint hashed the submitted code and searched voucher_codes only, so a
 * plaintext shareable BOOK ticket always came back "not found". That silently
 * broke every code a campaign bonus had granted since migration 086, and every
 * code a pack purchase issued after AIRIN-145 moved sales onto books — a cashier
 * could not apply a voucher the customer had legitimately bought. The order
 * pipeline already redeemed both models, so validation was the step out of step;
 * these tests pin both paths down.
 */
describe('VoucherRedemptionService.validate — hashed pack codes AND book tickets', () => {
  let pool: { query: ReturnType<typeof vi.fn> };
  let service: VoucherRedemptionService;

  const ctx = {
    outletId: 'outlet-1',
    serviceIdsInCart: ['svc-wash'],
    orderSubtotal: 100000,
    currentDate: '2026-08-06',
  };

  /** Routes by SQL fragment, so adding a query cannot invalidate these tests. */
  const routeQueries = (opts: { packRow?: unknown; ticketRow?: unknown }) => {
    pool.query.mockImplementation((sql: string) => {
      const s = String(sql);
      if (s.includes('parent_code_hash')) return Promise.resolve({ rows: [] });
      if (s.includes('FROM voucher_codes')) return Promise.resolve({ rows: opts.packRow ? [opts.packRow] : [] });
      if (s.includes('FROM voucher_tickets')) return Promise.resolve({ rows: opts.ticketRow ? [opts.ticketRow] : [] });
      return Promise.resolve({ rows: [] });
    });
  };

  beforeEach(() => {
    pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    service = new VoucherRedemptionService(pool as any);
  });

  it('accepts a plaintext BOOK ticket for a free-service benefit', async () => {
    routeQueries({
      ticketRow: {
        ticket_status: 'active',
        ticket_expiry: '2026-11-04',
        benefit_type: 'service',
        benefit_value: '0',
        benefit_service_id: 'svc-wash',
      },
    });

    const res = await service.validate('tenant-1', 'KCL-082026-000024', ctx);

    expect(res.status).toBe('valid_applicable');
    expect(res.type).toBe('service_pack');
  });

  it('accepts a BOOK ticket carrying a fixed-Rupiah benefit and computes the discount', async () => {
    routeQueries({
      ticketRow: {
        ticket_status: 'active',
        ticket_expiry: null,
        benefit_type: 'fixed',
        benefit_value: '25000',
        benefit_service_id: null,
      },
    });

    const res = await service.validate('tenant-1', 'KCL-082026-000099', ctx);

    expect(res.status).toBe('valid_applicable');
    expect(res.discountAmount).toBe(25000);
  });

  it('rejects an already-redeemed ticket', async () => {
    routeQueries({
      ticketRow: {
        ticket_status: 'redeemed',
        ticket_expiry: null,
        benefit_type: 'fixed',
        benefit_value: '25000',
        benefit_service_id: null,
      },
    });

    const res = await service.validate('tenant-1', 'KCL-082026-000024', ctx);

    expect(res.status).not.toBe('valid_applicable');
  });

  it('rejects an expired ticket', async () => {
    routeQueries({
      ticketRow: {
        ticket_status: 'active',
        ticket_expiry: '2026-08-01', // before ctx.currentDate
        benefit_type: 'fixed',
        benefit_value: '25000',
        benefit_service_id: null,
      },
    });

    const res = await service.validate('tenant-1', 'KCL-082026-000024', ctx);

    expect(res.status).toBe('expired');
  });

  it('still reports a genuinely unknown code as not found', async () => {
    routeQueries({});

    const res = await service.validate('tenant-1', 'NOPE-000000-000000', ctx);

    expect(res.status).toBe('not_found');
  });

  it('checks the hashed pack model FIRST, so legacy codes keep working', async () => {
    routeQueries({
      packRow: {
        code_id: 'code-1', code_status: 'active',
        pack_status: 'active', pack_expiry: null,
        type: 'fixed', value: '10000',
        template_start: null, template_expiry: null,
        outlet_ids: null, brand_scope: null, service_ids: null,
        min_order_amount: '0', template_active: true,
      },
    });

    const res = await service.validate('tenant-1', 'AIRE-ABC123', ctx);

    expect(res.status).toBe('valid_applicable');
    expect(res.discountAmount).toBe(10000);
    // The ticket table is never consulted when the hashed lookup hits.
    const consulted = pool.query.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(consulted.some((s) => s.includes('FROM voucher_tickets'))).toBe(false);
  });
});
