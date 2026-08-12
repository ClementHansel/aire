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
  const routeQueries = (opts: { packRow?: unknown; ticketRow?: unknown; serviceRows?: unknown[] }) => {
    pool.query.mockImplementation((sql: string) => {
      const s = String(sql);
      if (s.includes('parent_code_hash')) return Promise.resolve({ rows: [] });
      if (s.includes('FROM voucher_codes')) return Promise.resolve({ rows: opts.packRow ? [opts.packRow] : [] });
      if (s.includes('FROM voucher_tickets')) return Promise.resolve({ rows: opts.ticketRow ? [opts.ticketRow] : [] });
      if (s.includes('FROM services')) return Promise.resolve({ rows: opts.serviceRows ?? [] });
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

  it('tells the cashier an already-redeemed ticket was USED, not that it does not exist', async () => {
    // AIRIN-158. This assertion used to be a bare `not.toBe('valid_applicable')`,
    // which passed while the code answered "Voucher not found or not active" —
    // the redeemed state was folded into isActive, so evaluateVoucher stopped at
    // rule 3 and never reached 'fully_redeemed'. Caught by live-testing prod.
    routeQueries({
      ticketRow: {
        ticket_status: 'redeemed',
        ticket_expiry: null,
        benefit_type: 'fixed',
        benefit_value: '25000',
        benefit_service_id: null,
        used_at: '2026-08-05T09:00:00.000Z',
      },
    });

    const res = await service.validate('tenant-1', 'KCL-082026-000024', ctx);

    expect(res.status).toBe('fully_redeemed');
    expect(res.message).toMatch(/sudah digunakan/i);
    expect(res.usedAt).toBe('2026-08-05T09:00:00.000Z');
  });

  it('still treats a VOID ticket as dead rather than as merely spent', async () => {
    // A cancelled ticket is not "already used" — saying so would send the
    // cashier hunting for a redemption that never happened.
    routeQueries({
      ticketRow: {
        ticket_status: 'void',
        ticket_expiry: null,
        benefit_type: 'fixed',
        benefit_value: '25000',
        benefit_service_id: null,
      },
    });

    const res = await service.validate('tenant-1', 'KCL-082026-000024', ctx);

    expect(res.status).toBe('inactive');
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

  /**
   * AIRIN-161 (re-opened): the POS puts the covered service in the cart itself,
   * which it can only do for a service in its catalogue. A voucher covering a
   * service that has since been deactivated added nothing and the cashier was
   * told "not valid for the services in cart" — the cart blamed for the
   * catalogue's doing. The verdict now carries the covered service BY NAME, and
   * says whether this till can sell it, so the POS can explain itself.
   */
  describe('what the voucher covers (AIRIN-161)', () => {
    const emptyCart = { ...ctx, serviceIdsInCart: [], orderSubtotal: 0 };

    it('names a covered service that is no longer sold, and flags it unavailable', async () => {
      routeQueries({
        ticketRow: {
          ticket_status: 'active', ticket_expiry: '2027-02-08',
          benefit_type: 'service', benefit_value: '0', benefit_service_id: 'svc-express',
        },
        serviceRows: [{ id: 'svc-express', name: 'Express Wash', is_active: false, available_here: true }],
      });

      const res = await service.validate('tenant-1', 'KCL-082026-000143', emptyCart);

      expect(res.status).toBe('valid_not_applicable');
      expect(res.benefitServices).toEqual([
        { id: 'svc-express', name: 'Express Wash', isActive: false, availableHere: false },
      ]);
    });

    it('flags a service that is active but belongs to another branch', async () => {
      routeQueries({
        ticketRow: {
          ticket_status: 'active', ticket_expiry: null,
          benefit_type: 'service', benefit_value: '0', benefit_service_id: 'svc-bsd',
        },
        serviceRows: [{ id: 'svc-bsd', name: 'BSD Detailing', is_active: true, available_here: false }],
      });

      const res = await service.validate('tenant-1', 'BSD-082026-000001', emptyCart);

      expect(res.benefitServices).toEqual([
        { id: 'svc-bsd', name: 'BSD Detailing', isActive: true, availableHere: false },
      ]);
    });

    it('reports a sellable covered service as available, so the POS adds it', async () => {
      routeQueries({
        ticketRow: {
          ticket_status: 'active', ticket_expiry: null,
          benefit_type: 'service', benefit_value: '0', benefit_service_id: 'svc-wax',
        },
        serviceRows: [{ id: 'svc-wax', name: '+ Spray Wax', is_active: true, available_here: true }],
      });

      const res = await service.validate('tenant-1', 'KCL-082026-000155', emptyCart);

      expect(res.benefitServices?.[0]?.availableHere).toBe(true);
      expect(res.benefitServiceIds).toEqual(['svc-wax']);
    });

    it('leaves a cash voucher without covered services alone', async () => {
      routeQueries({
        ticketRow: {
          ticket_status: 'active', ticket_expiry: null,
          benefit_type: 'fixed', benefit_value: '1000000', benefit_service_id: null,
        },
      });

      const res = await service.validate('tenant-1', 'KCL-082026-000129', emptyCart);

      expect(res.status).toBe('valid_applicable');
      expect(res.benefitServices).toBeUndefined();
    });
  });
});
