import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemberLookupService } from './member-lookup.service';

describe('MemberLookupService', () => {
  let service: MemberLookupService;
  let mockPool: { query: ReturnType<typeof vi.fn> };

  const tenantId = 'tenant-001';
  const customerId = 'cust-001';

  const mockCustomerRow = {
    id: customerId,
    name: 'John Doe',
    phone: '6281234567890',
  };

  const mockMembershipRow = {
    id: 'mem-001',
    plan_name: 'Gold Plan',
    status: 'active',
    start_date: '2024-01-01',
    end_date: '2024-04-01',
    uses_count: 5,
    max_uses: 30,
    daily_limit: 1,
    max_plates: 3,
    free_service_ids: ['svc-1', 'svc-2'],
    discounted_services: [{ serviceId: 'svc-3', discountPct: 20 }],
  };

  const mockMembershipRow2 = {
    id: 'mem-002',
    plan_name: 'Premium Plan',
    status: 'active',
    start_date: '2024-02-01',
    end_date: '2024-05-01',
    uses_count: 2,
    max_uses: 60,
    daily_limit: 2,
    max_plates: 5,
    free_service_ids: ['svc-4'],
    discounted_services: null,
  };

  const mockPlateRows = [
    { membership_id: 'mem-001', plate: 'B1234ABC', brand: 'Toyota', model: 'Avanza' },
    { membership_id: 'mem-001', plate: 'B5678DEF', brand: 'Honda', model: 'Jazz' },
  ];

  const mockUsageRows = [
    { membership_id: 'mem-001', plate_normalized: 'B1234ABC', usage_count: '1' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    // Default every un-stubbed query to an empty result. The tests below stub the
    // queries they care about with mockResolvedValueOnce chains, and without this
    // baseline ANY newly-added query (e.g. the non-member vehicle-history fallback
    // from AIRIN-147) makes the next call resolve to undefined and blows up tests
    // whose assertions all still hold.
    mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    service = new MemberLookupService(mockPool as any);
  });

  describe('lookupByPhone', () => {
    it('should normalize phone and find customer', async () => {
      // 1. Customer lookup by normalized phone
      mockPool.query.mockResolvedValueOnce({ rows: [mockCustomerRow] });
      // 2. Customer info for buildMemberResponse
      mockPool.query.mockResolvedValueOnce({ rows: [mockCustomerRow] });
      // 3. Memberships
      mockPool.query.mockResolvedValueOnce({ rows: [mockMembershipRow] });
      // 4. Plates
      mockPool.query.mockResolvedValueOnce({ rows: mockPlateRows });
      // 5. Daily usage
      mockPool.query.mockResolvedValueOnce({ rows: mockUsageRows });
      // 6. Vouchers
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.lookupByPhone(tenantId, '081234567890');

      expect(result).not.toBeNull();
      expect(result!.customer.id).toBe(customerId);
      expect(result!.customer.name).toBe('John Doe');
      expect(result!.customer.phone).toBe('6281234567890');
      expect(result!.memberships).toHaveLength(1);
      expect(result!.memberships[0]!.planName).toBe('Gold Plan');
      expect(result!.memberships[0]!.maxPlates).toBe(3);

      // Verify the normalized phone was used in the query
      const firstQuery = mockPool.query.mock.calls[0];
      expect(firstQuery[1][1]).toBe('6281234567890'); // normalized from 081234567890
    });

    it('should handle +62 prefix normalization', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockCustomerRow] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockCustomerRow] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.lookupByPhone(tenantId, '+6281234567890');

      expect(result).not.toBeNull();
      const firstQuery = mockPool.query.mock.calls[0];
      expect(firstQuery[1][1]).toBe('6281234567890');
    });

    it('should return null when phone is invalid', async () => {
      const result = await service.lookupByPhone(tenantId, '123');

      expect(result).toBeNull();
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should return null when customer not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.lookupByPhone(tenantId, '081234567890');

      expect(result).toBeNull();
    });

    it('should normalize input before searching', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.lookupByPhone(tenantId, '0812-3456-7890');

      // Should strip non-digit characters and normalize
      const firstQuery = mockPool.query.mock.calls[0];
      expect(firstQuery[1][1]).toBe('6281234567890');
    });
  });

  describe('lookupByPlate', () => {
    it('should normalize plate and find customer via membership', async () => {
      // 1. Find customer via plate → membership → customer
      mockPool.query.mockResolvedValueOnce({ rows: [{ customer_id: customerId }] });
      // 2. Customer info for buildMemberResponse
      mockPool.query.mockResolvedValueOnce({ rows: [mockCustomerRow] });
      // 3. Memberships
      mockPool.query.mockResolvedValueOnce({ rows: [mockMembershipRow] });
      // 4. Plates
      mockPool.query.mockResolvedValueOnce({ rows: mockPlateRows });
      // 5. Daily usage
      mockPool.query.mockResolvedValueOnce({ rows: mockUsageRows });
      // 6. Vouchers
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.lookupByPlate(tenantId, 'B 1234 ABC');

      expect(result).not.toBeNull();
      expect(result!.customer.id).toBe(customerId);
      expect(result!.memberships).toHaveLength(1);

      // Verify normalized plate was used
      const firstQuery = mockPool.query.mock.calls[0];
      expect(firstQuery[1][0]).toBe('B1234ABC'); // normalized: uppercase, no spaces
    });

    it('should return null for invalid plate input', async () => {
      const result = await service.lookupByPlate(tenantId, '   ');

      expect(result).toBeNull();
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should return null when plate not found in any membership', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.lookupByPlate(tenantId, 'Z9999ZZZ');

      expect(result).toBeNull();
    });

    it('should normalize lowercase plate to uppercase', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.lookupByPlate(tenantId, 'b 1234 abc');

      const firstQuery = mockPool.query.mock.calls[0];
      expect(firstQuery[1][0]).toBe('B1234ABC');
    });
  });

  describe('buildMemberResponse', () => {
    it('should return multiple active memberships for one customer', async () => {
      // Customer info
      mockPool.query.mockResolvedValueOnce({ rows: [mockCustomerRow] });
      // Memberships - two active plans
      mockPool.query.mockResolvedValueOnce({ rows: [mockMembershipRow, mockMembershipRow2] });
      // Plates for both memberships
      mockPool.query.mockResolvedValueOnce({
        rows: [
          ...mockPlateRows,
          { membership_id: 'mem-002', plate: 'B1234ABC', brand: 'Toyota', model: 'Avanza' },
        ],
      });
      // Daily usage
      mockPool.query.mockResolvedValueOnce({ rows: mockUsageRows });
      // Vouchers
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.buildMemberResponse(customerId, tenantId);

      expect(result.memberships).toHaveLength(2);
      expect(result.memberships[0]!.planName).toBe('Gold Plan');
      expect(result.memberships[1]!.planName).toBe('Premium Plan');

      // Verify each membership has its own plates
      expect(result.memberships[0]!.plates).toHaveLength(2);
      expect(result.memberships[1]!.plates).toHaveLength(1);

      // Check dailyUsageToday is populated correctly
      expect(result.memberships[0]!.dailyUsageToday['B1234ABC']).toBe(1);
    });

    it('falls back to order-history vehicles for a customer with no membership plates', async () => {
      // AIRIN-147: a returning NON-member has no membership_plates rows, so the POS
      // could autofill nothing and the cashier retyped the same car every visit.
      // Their vehicles live on their past orders.
      mockPool.query.mockResolvedValueOnce({ rows: [mockCustomerRow] });  // customer
      mockPool.query.mockResolvedValueOnce({ rows: [] });                 // no memberships
      mockPool.query.mockResolvedValueOnce({                              // order history
        rows: [{ plate: 'B9199XYZ', brand: 'Honda', model: 'Brio' }],
      });

      const result = await service.buildMemberResponse(customerId, tenantId);

      expect(result.memberships).toHaveLength(0);
      expect(result.customer.plates).toEqual([
        { plate: 'B9199XYZ', brand: 'Honda', model: 'Brio' },
      ]);
      const historyQuery = mockPool.query.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .find((sql) => sql.includes('FROM orders'));
      expect(historyQuery).toBeDefined();
      // Never resurrect a cancelled order's car.
      expect(historyQuery).toContain("status <> 'cancelled'");
    });

    it('does NOT mix order-history vehicles into a real member\'s plate list', async () => {
      // Membership plates decide which car the plan actually covers, so a car the
      // member once drove but never registered must not appear as covered.
      mockPool.query.mockResolvedValueOnce({ rows: [mockCustomerRow] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockMembershipRow] });
      mockPool.query.mockResolvedValueOnce({ rows: mockPlateRows });
      mockPool.query.mockResolvedValueOnce({ rows: mockUsageRows });
      mockPool.query.mockResolvedValueOnce({ rows: [] });                 // vouchers

      const result = await service.buildMemberResponse(customerId, tenantId);

      const sqls = mockPool.query.mock.calls.map((c: unknown[]) => String(c[0]));
      // The PLATE-history fallback must not run. (Orders are still read for the
      // last-visit note — AIRIN-155 — so the assertion names the vehicle columns
      // rather than the table.)
      expect(sqls.some((s) => s.includes('vehicle_brand'))).toBe(false);
      expect(result.customer.plates.length).toBe(mockPlateRows.length);
    });

    it('should return empty memberships when customer has none', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockCustomerRow] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      // No memberships → vouchers query still runs
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.buildMemberResponse(customerId, tenantId);

      expect(result.customer.id).toBe(customerId);
      expect(result.memberships).toHaveLength(0);
      expect(result.customer.plates).toHaveLength(0);
    });

    it('should deduplicate customer-level plates', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockCustomerRow] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockMembershipRow, mockMembershipRow2] });
      // Same plate appears in both memberships
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { membership_id: 'mem-001', plate: 'B1234ABC', brand: 'Toyota', model: 'Avanza' },
          { membership_id: 'mem-002', plate: 'B1234ABC', brand: 'Toyota', model: 'Avanza' },
        ],
      });
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.buildMemberResponse(customerId, tenantId);

      // Customer-level plates should be deduplicated
      expect(result.customer.plates).toHaveLength(1);
      expect(result.customer.plates[0]!.plate).toBe('B1234ABC');
    });

    it('should include vouchers when campaign grants exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockCustomerRow] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockMembershipRow] });
      mockPool.query.mockResolvedValueOnce({ rows: mockPlateRows });
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      // Vouchers
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'vc-001',
            code_display: 'AIRE-PK-GOLD',
            type: 'fixed',
            value: '50000.00',
            expires_at: '2024-12-31',
            is_used: false,
          },
        ],
      });

      const result = await service.buildMemberResponse(customerId, tenantId);

      expect(result.vouchers).toBeDefined();
      expect(result.vouchers).toHaveLength(1);
      expect(result.vouchers![0]!.code).toBe('AIRE-PK-GOLD');
      expect(result.vouchers![0]!.type).toBe('fixed');
      expect(result.vouchers![0]!.value).toBe(50000);
      expect(result.vouchers![0]!.isUsed).toBe(false);
    });

    it('should not include vouchers field when none exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockCustomerRow] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockMembershipRow] });
      mockPool.query.mockResolvedValueOnce({ rows: mockPlateRows });
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.buildMemberResponse(customerId, tenantId);

      expect(result.vouchers).toBeUndefined();
    });

    it('should handle null free_service_ids and discounted_services', async () => {
      const membershipWithNulls = {
        ...mockMembershipRow,
        free_service_ids: null,
        discounted_services: null,
      };

      mockPool.query.mockResolvedValueOnce({ rows: [mockCustomerRow] });
      mockPool.query.mockResolvedValueOnce({ rows: [membershipWithNulls] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.buildMemberResponse(customerId, tenantId);

      expect(result.memberships[0]!.freeServices).toEqual([]);
      expect(result.memberships[0]!.discountedServices).toEqual([]);
    });
  });

  /**
   * resolveIdentifier — one typed value, server decides what it is.
   *
   * The formats overlap: an Indonesian mobile is very often EXACTLY 12 digits
   * (08xx xxxx xxxx) and a membership number is 12 base-36 chars, which can also
   * be all digits. The POS used to guess from length and looked a real phone up as
   * a member number, so a customer at the counter came back "not found". The
   * tie-breaker is structural — a membership number starts with this tenant's
   * `tenant_code` — and lives here because only the server knows that code.
   */
  describe('resolveIdentifier', () => {
    const TENANT_CODE = '000001';

    /** Routes by SQL fragment so an added query cannot invalidate these tests. */
    const routeQueries = (opts: { phoneHit?: boolean; numberHit?: boolean; plateHit?: boolean }) => {
      mockPool.query.mockImplementation((sql: string, params?: unknown[]) => {
        const s = String(sql);
        if (s.includes('tenant_code')) return Promise.resolve({ rows: [{ tenant_code: TENANT_CODE }] });
        // buildMemberResponse's own customer read — checked FIRST because it also
        // selects membership_number and would otherwise be swallowed by the
        // number-lookup branch below.
        if (s.includes('FROM customers WHERE id = $1')) {
          return Promise.resolve({ rows: [{ id: customerId, name: 'Resolved', phone: '628', membership_number: null }] });
        }
        if (s.includes('phone_normalized')) {
          return Promise.resolve({ rows: opts.phoneHit ? [{ id: customerId, name: 'By Phone', phone: '628' }] : [] });
        }
        if (s.includes('membership_number = $2')) {
          return Promise.resolve({ rows: opts.numberHit ? [{ id: customerId }] : [] });
        }
        if (s.includes('membership_plates mp')) {
          return Promise.resolve({ rows: opts.plateHit ? [{ customer_id: customerId }] : [] });
        }
        return Promise.resolve({ rows: [] });
      });
    };

    it('treats a 12-DIGIT phone as a phone, not a membership number', async () => {
      // The regression, exactly: 081200000091 is 12 digits and does NOT start with
      // the tenant code, so it cannot be one of our membership numbers.
      routeQueries({ phoneHit: true });

      const res = await service.resolveIdentifier(tenantId, '081200000091');

      expect(res?.matchedBy).toBe('phone');
    });

    it('treats a 12-char value starting with the tenant code as a membership number', async () => {
      routeQueries({ numberHit: true });

      const res = await service.resolveIdentifier(tenantId, `${TENANT_CODE}01000A`);

      expect(res?.matchedBy).toBe('number');
    });

    it('treats a plate as a plate', async () => {
      routeQueries({ plateHit: true });

      const res = await service.resolveIdentifier(tenantId, 'B 9091 VRF');

      expect(res?.matchedBy).toBe('plate');
    });

    it('falls back to the other interpretations rather than dead-ending', async () => {
      // Looks like a phone, but only the membership-number table has it. A guess
      // must never be the end of the road.
      routeQueries({ numberHit: true });

      const res = await service.resolveIdentifier(tenantId, '081200000091');

      expect(res?.matchedBy).toBe('number');
    });

    it('returns null when no interpretation matches', async () => {
      routeQueries({});

      expect(await service.resolveIdentifier(tenantId, '081200000091')).toBeNull();
    });

    it('ignores a blank value without querying', async () => {
      routeQueries({});

      expect(await service.resolveIdentifier(tenantId, '   ')).toBeNull();
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('is case-insensitive about the tenant prefix', async () => {
      routeQueries({ numberHit: true });

      const res = await service.resolveIdentifier(tenantId, '000001010 00a'.replace(/\s/g, ''));

      expect(res?.matchedBy).toBe('number');
    });
  });
});
