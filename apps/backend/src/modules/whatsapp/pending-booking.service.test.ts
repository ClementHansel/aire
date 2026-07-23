import { describe, it, expect, vi } from 'vitest';
import { PendingBookingService, type PendingBooking } from './pending-booking.service';
import type { BookingService } from '../booking/booking.service';

const TENANT = 'tenant-1';
const PHONE = '628111@c.us';

function pendingPayload(overrides?: Partial<PendingBooking>): PendingBooking {
  return {
    serviceName: 'Cuci Premium', scheduledAt: '2026-08-01T10:00:00.000Z',
    licensePlate: null, notes: null, customerName: 'Budi', customerPhone: '628111',
    outletId: null, proposedAt: new Date().toISOString(), ...overrides,
  };
}

/** Pool stub: SELECT returns the given row; UPDATEs are recorded. */
function makePool(row: Record<string, unknown> | null) {
  const updates: { sql: string; params: unknown[] }[] = [];
  const pool = {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      if (/SELECT/i.test(sql)) return { rows: row ? [{ id: 'conv-1', ...row }] : [], rowCount: row ? 1 : 0 };
      updates.push({ sql, params });
      return { rows: [], rowCount: 1 };
    }),
  };
  return { pool, updates };
}

describe('PendingBookingService.tryConfirm (customer side)', () => {
  it('does nothing when there is no pending booking', async () => {
    const { pool } = makePool(null);
    const booking = { create: vi.fn() } as unknown as BookingService;
    const svc = new PendingBookingService(pool as never, booking);
    const out = await svc.tryConfirm(TENANT, PHONE, 'ya');
    expect(out.handled).toBe(false);
    expect(booking.create).not.toHaveBeenCalled();
  });

  it('creates a booked booking on "ya" and returns a staffApproval handoff', async () => {
    const { pool, updates } = makePool({ pending_booking: pendingPayload() });
    const create = vi.fn().mockResolvedValue({ id: 'bk-1' });
    const svc = new PendingBookingService(pool as never, { create } as unknown as BookingService);

    const out = await svc.tryConfirm(TENANT, PHONE, 'Ya betul');
    expect(out.handled).toBe(true);
    expect(out.committed).toBe(true);
    // Not yet "confirmed" — staff still must acknowledge.
    expect(out.staffApproval).toMatchObject({ bookingId: 'bk-1', customerPhone: PHONE });
    expect(create).toHaveBeenCalledWith(TENANT, expect.objectContaining({ serviceName: 'Cuci Premium', customerName: 'Budi' }));
    expect(updates.some((u) => /pending_booking = NULL/i.test(u.sql))).toBe(true);
  });

  it('cancels on a negative reply without booking', async () => {
    const { pool } = makePool({ pending_booking: pendingPayload() });
    const create = vi.fn();
    const svc = new PendingBookingService(pool as never, { create } as unknown as BookingService);
    const out = await svc.tryConfirm(TENANT, PHONE, 'batal');
    expect(out.handled).toBe(true);
    expect(out.committed).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });

  it('lets ambiguous replies fall through to the agent (keeps proposal)', async () => {
    const { pool } = makePool({ pending_booking: pendingPayload() });
    const create = vi.fn();
    const svc = new PendingBookingService(pool as never, { create } as unknown as BookingService);
    const out = await svc.tryConfirm(TENANT, PHONE, 'jam berapa buka?');
    expect(out.handled).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('expires stale proposals instead of booking on a late yes', async () => {
    const stale = pendingPayload({ proposedAt: new Date(Date.now() - 48 * 3600_000).toISOString() });
    const { pool } = makePool({ pending_booking: stale });
    const create = vi.fn();
    const svc = new PendingBookingService(pool as never, { create } as unknown as BookingService);
    const out = await svc.tryConfirm(TENANT, PHONE, 'ya');
    expect(out.handled).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('PendingBookingService.tryStaffAck (staff side)', () => {
  const staffAck = { bookingId: 'bk-1', ref: 'B1', summary: 'Cuci Premium — date', customerPhone: PHONE, proposedAt: new Date().toISOString() };

  it('confirms the sole pending booking on a bare TERIMA and notifies the customer', async () => {
    const { pool } = makePool({ pending_staff_ack: staffAck });
    const update = vi.fn().mockResolvedValue({});
    const svc = new PendingBookingService(pool as never, { update } as unknown as BookingService);

    const out = await svc.tryStaffAck(TENANT, '628999', 'TERIMA');
    expect(out.handled).toBe(true);
    expect(update).toHaveBeenCalledWith(TENANT, 'bk-1', { status: 'confirmed' });
    expect(out.notifyCustomer?.phone).toBe(PHONE);
  });

  it('cancels the booking on TOLAK and notifies the customer', async () => {
    const { pool } = makePool({ pending_staff_ack: staffAck });
    const update = vi.fn().mockResolvedValue({});
    const svc = new PendingBookingService(pool as never, { update } as unknown as BookingService);

    const out = await svc.tryStaffAck(TENANT, '628999', 'TOLAK');
    expect(out.handled).toBe(true);
    expect(update).toHaveBeenCalledWith(TENANT, 'bk-1', { status: 'cancelled' });
  });

  it('ignores staff chatter when nothing is pending', async () => {
    const { pool } = makePool(null);
    const update = vi.fn();
    const svc = new PendingBookingService(pool as never, { update } as unknown as BookingService);
    const out = await svc.tryStaffAck(TENANT, '628999', 'TERIMA');
    expect(out.handled).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  describe('queue (multiple pending)', () => {
    const two = [
      { bookingId: 'bk-1', ref: 'B1', summary: 'Cuci — A', customerPhone: '628111', proposedAt: new Date().toISOString() },
      { bookingId: 'bk-2', ref: 'B2', summary: 'Detailing — B', customerPhone: '628222', proposedAt: new Date().toISOString() },
    ];

    it('asks staff to specify a code when a bare TERIMA is ambiguous', async () => {
      const { pool } = makePool({ pending_staff_ack: two });
      const update = vi.fn();
      const svc = new PendingBookingService(pool as never, { update } as unknown as BookingService);
      const out = await svc.tryStaffAck(TENANT, '628999', 'TERIMA');
      expect(out.handled).toBe(true);
      expect(out.reply).toMatch(/B1|B2/);
      expect(update).not.toHaveBeenCalled(); // nothing resolved without a code
    });

    it('resolves the targeted booking when the code is given', async () => {
      const { pool } = makePool({ pending_staff_ack: two });
      const update = vi.fn().mockResolvedValue({});
      const svc = new PendingBookingService(pool as never, { update } as unknown as BookingService);
      const out = await svc.tryStaffAck(TENANT, '628999', 'TERIMA B2');
      expect(out.handled).toBe(true);
      expect(update).toHaveBeenCalledWith(TENANT, 'bk-2', { status: 'confirmed' });
      expect(out.notifyCustomer?.phone).toBe('628222');
    });
  });

  it('appends to the queue on setStaffAck without dropping existing acks', async () => {
    const existing = [{ bookingId: 'bk-1', ref: 'B1', summary: 'A', customerPhone: '628111', proposedAt: new Date().toISOString() }];
    const { pool, updates } = makePool({ pending_staff_ack: existing });
    const svc = new PendingBookingService(pool as never, {} as unknown as BookingService);
    await svc.setStaffAck('conv-1', { bookingId: 'bk-2', ref: 'B2', summary: 'B', customerPhone: '628222' });
    const write = updates.find((u) => /pending_staff_ack/i.test(u.sql));
    const stored = JSON.parse(write!.params[1] as string);
    expect(stored.map((a: { bookingId: string }) => a.bookingId)).toEqual(['bk-1', 'bk-2']);
  });
});

describe('PendingBookingService.sweepExpired (SLA)', () => {
  it('auto-cancels stale approvals and returns the customers to notify', async () => {
    const stale = { bookingId: 'bk-x', ref: 'BX', summary: 'Cuci — X', customerPhone: '628777', proposedAt: new Date(Date.now() - 48 * 3600_000).toISOString() };
    const { pool } = makePool({ tenant_id: TENANT, pending_staff_ack: [stale] });
    const update = vi.fn().mockResolvedValue({});
    const svc = new PendingBookingService(pool as never, { update } as unknown as BookingService);

    const res = await svc.sweepExpired();
    expect(update).toHaveBeenCalledWith(TENANT, 'bk-x', { status: 'cancelled' });
    expect(res).toEqual([{ tenantId: TENANT, customerPhone: '628777', summary: 'Cuci — X' }]);
  });

  it('leaves fresh approvals untouched', async () => {
    const fresh = { bookingId: 'bk-y', ref: 'BY', summary: 'Cuci — Y', customerPhone: '628888', proposedAt: new Date().toISOString() };
    const { pool } = makePool({ tenant_id: TENANT, pending_staff_ack: [fresh] });
    const update = vi.fn();
    const svc = new PendingBookingService(pool as never, { update } as unknown as BookingService);

    const res = await svc.sweepExpired();
    expect(update).not.toHaveBeenCalled();
    expect(res).toEqual([]);
  });
});

describe('PendingBookingService.resolveByBookingId (dashboard)', () => {
  const staffAck = { bookingId: 'bk-9', summary: 'Detailing — date', customerPhone: PHONE, proposedAt: new Date().toISOString() };

  it('approves a booking by id and returns a customer notification', async () => {
    const { pool } = makePool({ pending_staff_ack: staffAck });
    const update = vi.fn().mockResolvedValue({});
    const svc = new PendingBookingService(pool as never, { update } as unknown as BookingService);

    const out = await svc.resolveByBookingId(TENANT, 'bk-9', true, 'user-1');
    expect(update).toHaveBeenCalledWith(TENANT, 'bk-9', { status: 'confirmed' });
    expect(out?.notifyCustomer?.phone).toBe(PHONE);
  });

  it('writes an audit row when resolving from the dashboard', async () => {
    const { pool, updates } = makePool({ pending_staff_ack: staffAck });
    const update = vi.fn().mockResolvedValue({});
    const svc = new PendingBookingService(pool as never, { update } as unknown as BookingService);

    await svc.resolveByBookingId(TENANT, 'bk-9', true, 'user-1');
    const audit = updates.find((u) => /wa_booking_approvals/i.test(u.sql));
    expect(audit).toBeTruthy();
    expect(audit!.params).toEqual(expect.arrayContaining([TENANT, 'bk-9', 'confirmed', 'dashboard', 'user-1']));
  });

  it('returns null when no pending approval matches the booking id', async () => {
    const { pool } = makePool(null);
    const update = vi.fn();
    const svc = new PendingBookingService(pool as never, { update } as unknown as BookingService);
    const out = await svc.resolveByBookingId(TENANT, 'missing', false, 'user-1');
    expect(out).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it('self-heals a stale approval when the booking row is gone (no dead 404)', async () => {
    const { pool, updates } = makePool({ pending_staff_ack: staffAck });
    const update = vi.fn().mockRejectedValue(new Error('Booking not found')); // booking deleted/voided
    const svc = new PendingBookingService(pool as never, { update } as unknown as BookingService);

    const out = await svc.resolveByBookingId(TENANT, 'bk-9', true, 'user-1');
    // Resolves (does not throw), and CLEARS the stale ack so the panel updates.
    expect(out?.handled).toBe(true);
    expect(out?.notifyCustomer).toBeUndefined(); // don't message the customer about a gone booking
    const cleared = updates.find((u) => /pending_staff_ack/i.test(u.sql));
    expect(cleared).toBeTruthy();
  });
});
