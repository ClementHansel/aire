import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CampaignGrantService } from './campaign-grant.service';
import { DomainEventType } from '../events/event.types';

/**
 * CampaignGrantService now issues bonus vouchers onto voucher_books/
 * voucher_tickets (via VoucherTicketService.issueBonusBook) instead of the
 * old hashed voucher_packs/voucher_codes model — that model split is why
 * campaign-granted vouchers never showed up in the dashboard's Issued
 * Vouchers tab (AIRIN-138). AIRIN-102 adds a second trigger: a voucher-pack
 * purchase (VoucherPackIssued), not just a membership activation.
 */
describe('CampaignGrantService', () => {
  let pool: { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> };
  let client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
  let templates: { getTemplate: ReturnType<typeof vi.fn> };
  let tickets: { issueBonusBook: ReturnType<typeof vi.fn> };
  let eventBus: { on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn> };
  let service: CampaignGrantService;

  const tenantId = 'tenant-1';
  const campaignRow = {
    id: 'campaign-1',
    tenant_id: tenantId,
    name: 'New Member Bonus',
    plan_id: 'plan-1',
    trigger_type: 'membership_plan',
    trigger_template_id: null,
    bonus_template_id: 'template-bonus-1',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    cap: null,
    per_customer_limit: 1,
    grants_count: 0,
    status: 'active',
  };
  const templateRow = {
    id: 'template-bonus-1',
    type: 'service_pack',
    value: '0',
    max_uses: 3,
    validity_days: 30,
    expiry_date: null,
    service_ids: ['service-spray-wax'],
  };

  beforeEach(() => {
    client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    pool = {
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue(client),
    };
    templates = { getTemplate: vi.fn().mockResolvedValue(templateRow) };
    tickets = { issueBonusBook: vi.fn().mockResolvedValue({ bookId: 'book-1', codes: ['BTR-072026-000001', 'BTR-072026-000002', 'BTR-072026-000003'] }) };
    eventBus = { on: vi.fn().mockReturnValue(() => {}), emit: vi.fn() };
    service = new CampaignGrantService(
      pool as any,
      templates as any,
      tickets as any,
      eventBus as any,
    );
  });

  describe('onModuleInit', () => {
    it('subscribes to both MembershipActivated and VoucherPackIssued', () => {
      service.onModuleInit();
      const subscribedTypes = eventBus.on.mock.calls.map((c) => c[0]);
      expect(subscribedTypes).toContain(DomainEventType.MembershipActivated);
      expect(subscribedTypes).toContain(DomainEventType.VoucherPackIssued);
    });
  });

  describe('membership_plan trigger (onMembershipActivated)', () => {
    const membershipRow = {
      order_id: 'order-1',
      outlet_id: 'outlet-1',
      customer_name: 'Budi',
      customer_phone: '0811',
    };

    const wireMembershipQueries = () => {
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM memberships m')) return Promise.resolve({ rows: [membershipRow] });
        if (sql.includes("trigger_type = 'membership_plan'")) return Promise.resolve({ rows: [campaignRow] });
        if (sql.includes('FROM campaign_grants WHERE campaign_id = $1 AND order_id')) return Promise.resolve({ rows: [] });
        if (sql.includes('COUNT(*) AS count')) return Promise.resolve({ rows: [{ count: '0' }] });
        return Promise.resolve({ rows: [] });
      });
    };

    it('issues a bonus book onto voucher_books/voucher_tickets, not voucher_packs', async () => {
      wireMembershipQueries();

      await (service as any).onMembershipActivated(tenantId, {
        membershipId: 'membership-1',
        planId: 'plan-1',
        customerId: 'customer-1',
      });

      expect(tickets.issueBonusBook).toHaveBeenCalledWith(
        client,
        tenantId,
        expect.objectContaining({
          outletId: 'outlet-1',
          quantity: 3, // template.max_uses
          benefitType: 'service',
          benefitServiceId: 'service-spray-wax',
          orderId: 'order-1',
        }),
      );

      // Grant row references the book, not a pack.
      const grantInsert = client.query.mock.calls.find((c: unknown[]) => String(c[0]).includes('INSERT INTO campaign_grants'));
      expect(grantInsert).toBeDefined();
      expect(String(grantInsert![0])).toContain('voucher_book_id');
      expect(grantInsert![1]).toEqual(['campaign-1', 'customer-1', 'book-1', 'order-1']);

      expect(client.query).toHaveBeenCalledWith('COMMIT');
      expect(client.query).not.toHaveBeenCalledWith('ROLLBACK');

      const granted = eventBus.emit.mock.calls.map((c) => c[0]).find((e: any) => e.type === DomainEventType.CampaignBonusGranted);
      expect(granted.payload).toMatchObject({ campaignId: 'campaign-1', orderId: 'order-1', bookId: 'book-1', codes: 3 });
    });

    it('skips when the membership has no order_id (no idempotency key to dedupe on)', async () => {
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM memberships m')) return Promise.resolve({ rows: [{ ...membershipRow, order_id: null }] });
        return Promise.resolve({ rows: [] });
      });

      await (service as any).onMembershipActivated(tenantId, { membershipId: 'membership-1', planId: 'plan-1', customerId: 'customer-1' });

      expect(tickets.issueBonusBook).not.toHaveBeenCalled();
    });

    it('does not double-grant the same campaign for the same order (idempotency)', async () => {
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM memberships m')) return Promise.resolve({ rows: [membershipRow] });
        if (sql.includes("trigger_type = 'membership_plan'")) return Promise.resolve({ rows: [campaignRow] });
        if (sql.includes('FROM campaign_grants WHERE campaign_id = $1 AND order_id')) return Promise.resolve({ rows: [{ id: 'existing-grant' }] });
        return Promise.resolve({ rows: [] });
      });

      await (service as any).onMembershipActivated(tenantId, { membershipId: 'membership-1', planId: 'plan-1', customerId: 'customer-1' });

      expect(tickets.issueBonusBook).not.toHaveBeenCalled();
    });

    it('skips an ineligible campaign (e.g. per-customer limit reached) without issuing a book', async () => {
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM memberships m')) return Promise.resolve({ rows: [membershipRow] });
        if (sql.includes("trigger_type = 'membership_plan'")) return Promise.resolve({ rows: [campaignRow] });
        if (sql.includes('FROM campaign_grants WHERE campaign_id = $1 AND order_id')) return Promise.resolve({ rows: [] });
        if (sql.includes('COUNT(*) AS count')) return Promise.resolve({ rows: [{ count: '1' }] }); // == per_customer_limit
        return Promise.resolve({ rows: [] });
      });

      await (service as any).onMembershipActivated(tenantId, { membershipId: 'membership-1', planId: 'plan-1', customerId: 'customer-1' });

      expect(tickets.issueBonusBook).not.toHaveBeenCalled();
    });
  });

  describe('voucher_pack trigger (onVoucherPackIssued) — AIRIN-102', () => {
    const packCampaignRow = { ...campaignRow, plan_id: null, trigger_type: 'voucher_pack', trigger_template_id: 'template-wash-10x' };
    const orderRow = {
      customer_id: 'customer-1',
      customer_name: 'Sari',
      customer_phone: '0812',
      outlet_id: 'outlet-1',
    };

    it('grants the bonus when the purchased template matches a voucher_pack-triggered campaign', async () => {
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM orders WHERE id')) return Promise.resolve({ rows: [orderRow] });
        if (sql.includes("trigger_type = 'voucher_pack'")) return Promise.resolve({ rows: [packCampaignRow] });
        if (sql.includes('FROM campaign_grants WHERE campaign_id = $1 AND order_id')) return Promise.resolve({ rows: [] });
        if (sql.includes('COUNT(*) AS count')) return Promise.resolve({ rows: [{ count: '0' }] });
        return Promise.resolve({ rows: [] });
      });

      await (service as any).onVoucherPackIssued(tenantId, 'outlet-1', {
        packId: 'pack-1',
        orderId: 'order-2',
        templateId: 'template-wash-10x',
      });

      expect(tickets.issueBonusBook).toHaveBeenCalledWith(
        client,
        tenantId,
        expect.objectContaining({ outletId: 'outlet-1', orderId: 'order-2', buyerPhone: '0812' }),
      );
    });

    it('does nothing when the order has no customer (nothing to key the per-customer limit on)', async () => {
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM orders WHERE id')) return Promise.resolve({ rows: [{ ...orderRow, customer_id: null }] });
        return Promise.resolve({ rows: [] });
      });

      await (service as any).onVoucherPackIssued(tenantId, 'outlet-1', { packId: 'pack-1', orderId: 'order-2', templateId: 'template-wash-10x' });

      expect(tickets.issueBonusBook).not.toHaveBeenCalled();
    });

    it('does nothing when no campaign is configured for this trigger template', async () => {
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM orders WHERE id')) return Promise.resolve({ rows: [orderRow] });
        if (sql.includes("trigger_type = 'voucher_pack'")) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [] });
      });

      await (service as any).onVoucherPackIssued(tenantId, 'outlet-1', { packId: 'pack-1', orderId: 'order-2', templateId: 'template-unrelated' });

      expect(tickets.issueBonusBook).not.toHaveBeenCalled();
    });
  });
});
