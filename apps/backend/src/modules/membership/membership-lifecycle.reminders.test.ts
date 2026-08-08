import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MembershipLifecycleService } from './membership-lifecycle.service';
import { NotificationType } from '../notification/notification.service';

/**
 * Expiry-reminder idempotency.
 *
 * The guard that stops a milestone being reminded twice must be scoped to the
 * membership's CURRENT TERM. Two production defects came from scoping it to the
 * milestone alone:
 *
 *   - a renewal extends the same membership row, so a member reminded at H-30
 *     once could never be reminded at H-30 again, in any later term;
 *   - reminders recorded while delivery was broken kept suppressing a message
 *     that had never actually arrived.
 */
describe('MembershipLifecycleService — expiry reminders', () => {
  let pool: { query: ReturnType<typeof vi.fn> };
  let notifications: { queueNotification: ReturnType<typeof vi.fn> };
  let service: MembershipLifecycleService;

  const dueRow = {
    id: 'mem-1',
    tenant_id: 'tenant-1',
    end_date: '2026-09-07',
    days_left: 30,
    customer_name: 'Budi',
    customer_phone: '628123456789',
    plan_name: 'Unlimited',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    pool = { query: vi.fn() };
    notifications = { queueNotification: vi.fn().mockResolvedValue('job-1') };
    service = new MembershipLifecycleService(pool as any, undefined, notifications as any);
  });

  /** The SELECT that finds due memberships, as issued by sendExpiryReminders. */
  const dueQuery = () => String(pool.query.mock.calls[0]![0]);

  it('scopes the "already reminded" check to the membership\'s current term', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await service.sendExpiryReminders();

    const sql = dueQuery();
    expect(sql).toContain("e.payload->>'milestone'");
    // Without this the guard spans every term the membership ever had.
    expect(sql).toContain("e.payload->>'endDate' = m.end_date::text");
  });

  it('only ever considers memberships sitting on a milestone today', async () => {
    // This is what makes releasing old suppression rows safe: a member who
    // lapsed weeks ago can never be picked up, however the guard changes.
    pool.query.mockResolvedValueOnce({ rows: [] });

    await service.sendExpiryReminders();

    expect(dueQuery()).toContain('(m.end_date - CURRENT_DATE) IN (30, 7, 0)');
    expect(dueQuery()).toContain("m.status = 'active'");
  });

  it('stamps the term on the event it records, so the next term is not suppressed', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [dueRow] }) // due memberships
      .mockResolvedValueOnce({ rows: [] });      // recordEvent insert

    const sent = await service.sendExpiryReminders();

    expect(sent).toBe(1);
    const insertParams = pool.query.mock.calls[1]![1] as unknown[];
    const payload = JSON.parse(String(insertParams.find((p) => String(p).includes('milestone'))));
    expect(payload).toMatchObject({ milestone: 30, endDate: '2026-09-07', source: 'system' });
  });

  it('queues the reminder with the tenant that routes it to a WhatsApp line', async () => {
    // A reminder without tenantId cannot be routed and silently fails — the
    // defect that made every one of these messages disappear.
    pool.query
      .mockResolvedValueOnce({ rows: [dueRow] })
      .mockResolvedValueOnce({ rows: [] });

    await service.sendExpiryReminders();

    expect(notifications.queueNotification).toHaveBeenCalledWith(
      NotificationType.ExpiryReminder,
      expect.objectContaining({
        tenantId: 'tenant-1',
        phone: '628123456789',
        daysRemaining: '30',
        endDate: '2026-09-07',
      }),
    );
  });

  it('keeps going when one membership fails, so one bad row cannot stop the sweep', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [dueRow, { ...dueRow, id: 'mem-2' }] })
      .mockRejectedValueOnce(new Error('insert blew up'))
      .mockResolvedValueOnce({ rows: [] });

    const sent = await service.sendExpiryReminders();

    expect(sent).toBe(1);
    expect(notifications.queueNotification).toHaveBeenCalledTimes(2);
  });

  it('does nothing at all when notifications are not wired', async () => {
    const bare = new MembershipLifecycleService(pool as any);
    expect(await bare.sendExpiryReminders()).toBe(0);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
