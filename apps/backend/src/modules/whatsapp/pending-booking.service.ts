import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { BookingService } from '../booking/booking.service';
import { AuditService } from '../audit/audit.service';
import type { ResolvedCustomer } from './customer-context.service';
import { NotificationRendererService, renderNotification } from '../notification/notification-renderer.service';

/** A booking the AI has proposed but the customer has not yet confirmed. */
export interface PendingBooking {
  serviceName: string;
  scheduledAt: string;
  licensePlate: string | null;
  notes: string | null;
  customerName: string;
  customerPhone: string | null;
  outletId: string | null;
  proposedAt: string;
}

export interface ConfirmOutcome {
  /** True if this message resolved a pending booking (caller should stop here). */
  handled: boolean;
  /** Reply to send the customer, if handled. */
  reply?: string;
  /** True when a booking row was created (status 'booked', awaiting staff ack). */
  committed?: boolean;
  /** When committed, the details the caller needs to notify staff for approval. */
  staffApproval?: { bookingId: string; summary: string; customerPhone: string };
}

/** What a booking pending staff acknowledgement holds (on the STAFF conversation). */
export interface PendingStaffAck {
  bookingId: string;
  summary: string;
  customerPhone: string;
  /** Short code (last 4 of bookingId) so staff can disambiguate multiple pending. */
  ref: string;
  proposedAt: string;
}

export interface StaffAckOutcome {
  handled: boolean;
  /** Reply to send the staff member. */
  reply?: string;
  /** If set, also notify the original customer of the decision. */
  notifyCustomer?: { phone: string; text: string };
}

// Staff accept / reject keywords (buttons send their title back as text).
const ACCEPT = /(^|\b)(terima|accept|acc|ok|oke|setuju|konfirmasi|approve|approved|ya)(\b|$)/i;
const REJECT = /(^|\b)(tolak|reject|batal(kan)?|cancel|no|tidak)(\b|$)/i;

// Affirmatives / negatives in Bahasa Indonesia + English. A pending booking is
// only committed on a clear "yes"; a clear "no" cancels it; anything ambiguous
// leaves the proposal in place and flows to the normal agent.
const AFFIRM = /(^|\b)(ya+|iya+|yes|ok|oke|okay|okey|betul|benar|setuju|konfirmasi|confirm(ed)?|sip|boleh|lanjut|gas|deal)(\b|$)/i;
const NEGATIVE = /(^|\b)(tidak|ga|gak|nggak|enggak|engga|batal(kan)?|cancel|no|jangan|belum)(\b|$)/i;

const EXPIRY_HOURS = 24;

const dateFmt = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' });
};

/**
 * PendingBookingService — the human-confirmation gate for WhatsApp bookings.
 *
 * `propose()` stores a proposal on the conversation (one at a time) and returns
 * a summary the agent reads back to the customer. `tryConfirm()` runs at the top
 * of the inbound pipeline: if a proposal is pending and the customer affirms, the
 * booking is committed to `bookings`; a "no" cancels it. Because the gate lives
 * server-side (not in the model or the flow), it behaves identically for the
 * built-in runtime and for n8n flows calling the bridge.
 */
@Injectable()
export class PendingBookingService {
  private readonly logger = new Logger(PendingBookingService.name);

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly booking?: BookingService,
    @Optional() private readonly audit?: AuditService,
    @Optional() @Inject(NotificationRendererService) private readonly renderer?: NotificationRendererService,
  ) {}

  /** Normalize the stored ack column (array now; tolerate a legacy single object). */
  private toAckList(v: unknown): PendingStaffAck[] {
    if (Array.isArray(v)) return v as PendingStaffAck[];
    if (v && typeof v === 'object') return [v as PendingStaffAck];
    return [];
  }

  /** Write an ack queue back to a conversation (NULL when empty). */
  private async writeAckList(convId: string, list: PendingStaffAck[]): Promise<void> {
    await this.pool.query(
      `UPDATE wa_conversations SET pending_staff_ack = $2 WHERE id = $1`,
      [convId, list.length ? JSON.stringify(list) : null],
    );
  }

  /** Store a proposal on the conversation and return a human-readable summary. */
  async propose(args: {
    tenantId: string;
    fromPhone: string;
    customer: ResolvedCustomer | null;
    outletId: string | null;
    serviceName: string;
    scheduledAt: string;
    licensePlate: string | null;
    notes: string | null;
  }): Promise<{ summary: string }> {
    const phone = (args.fromPhone || '').replace(/@.*/, '').replace(/\D/g, '');
    const pending: PendingBooking = {
      serviceName: args.serviceName,
      scheduledAt: args.scheduledAt,
      licensePlate: args.licensePlate,
      notes: args.notes ?? 'Created via WhatsApp AI agent',
      customerName: args.customer?.name ?? 'WhatsApp Customer',
      customerPhone: phone || null,
      outletId: args.outletId,
      proposedAt: new Date().toISOString(),
    };
    await this.pool.query(
      `UPDATE wa_conversations SET pending_booking = $3::jsonb
       WHERE tenant_id = $1 AND chat_id = $2`,
      [args.tenantId, args.fromPhone, JSON.stringify(pending)],
    );
    return { summary: `${args.serviceName} — ${dateFmt(args.scheduledAt)}` };
  }

  /**
   * If a booking is pending for this conversation, resolve it against the
   * customer's message. Returns handled=false when there is nothing pending or
   * the reply is ambiguous (so the normal agent runs).
   */
  async tryConfirm(tenantId: string, fromPhone: string, text: string): Promise<ConfirmOutcome> {
    const row = await this.pool.query<{ id: string; pending_booking: PendingBooking | null }>(
      `SELECT id, pending_booking FROM wa_conversations WHERE tenant_id = $1 AND chat_id = $2`,
      [tenantId, fromPhone],
    );
    const conv = row.rows[0];
    const pending = conv?.pending_booking;
    if (!conv || !pending) return { handled: false };

    // Expire stale proposals so a very old "ya" can't silently book.
    const ageMs = Date.now() - new Date(pending.proposedAt).getTime();
    if (Number.isNaN(ageMs) || ageMs > EXPIRY_HOURS * 3600_000) {
      await this.clear(conv.id);
      return { handled: false };
    }

    const t = (text || '').trim();
    const affirm = AFFIRM.test(t);
    const negative = NEGATIVE.test(t);

    // Clear "no" → cancel. Clear "yes" → commit. Both/neither → leave for the agent.
    if (negative && !affirm) {
      await this.clear(conv.id);
      return { handled: true, reply: 'Baik, booking dibatalkan. Ada lagi yang bisa kami bantu?' };
    }
    if (affirm && !negative) {
      if (!this.booking) return { handled: false };
      try {
        // Customer confirmed → create the booking as 'booked' (NOT yet confirmed);
        // it becomes 'confirmed' only after staff acknowledge (two-sided approval).
        const record = await this.booking.create(tenantId, {
          outletId: pending.outletId,
          customerName: pending.customerName,
          customerPhone: pending.customerPhone,
          serviceName: pending.serviceName,
          scheduledAt: pending.scheduledAt,
          licensePlate: pending.licensePlate,
          notes: pending.notes,
        });
        await this.clear(conv.id);
        const summary = `${pending.serviceName} — ${dateFmt(pending.scheduledAt)}`;
        return {
          handled: true,
          committed: true,
          reply: (await renderNotification(this.renderer, tenantId, 'booking_received', {
            bookingSummary: summary,
          })) ?? '',
          staffApproval: { bookingId: record.id, summary, customerPhone: fromPhone },
        };
      } catch (e) {
        this.logger.error(`Failed to commit pending booking for ${fromPhone}: ${String(e)}`);
        await this.clear(conv.id);
        return { handled: true, reply: 'Maaf, terjadi kendala saat menyimpan booking. Tim kami akan membantu Anda.' };
      }
    }
    return { handled: false };
  }

  /** A short disambiguation code for a booking (last 4 of its id, uppercased). */
  static refFor(bookingId: string): string {
    return bookingId.replace(/-/g, '').slice(-4).toUpperCase();
  }

  /** Enqueue a staff-acknowledgement request on the staff (escalation) conversation. */
  async setStaffAck(staffConvId: string, ack: Omit<PendingStaffAck, 'proposedAt'>): Promise<void> {
    const cur = await this.pool.query<{ pending_staff_ack: unknown }>(
      `SELECT pending_staff_ack FROM wa_conversations WHERE id = $1`,
      [staffConvId],
    );
    const list = this.toAckList(cur.rows[0]?.pending_staff_ack)
      .filter((a) => a.bookingId !== ack.bookingId); // de-dupe re-proposals
    list.push({ ...ack, proposedAt: new Date().toISOString() });
    await this.writeAckList(staffConvId, list);
  }

  /**
   * Resolve a staff acknowledgement from a WhatsApp reply. Supports a QUEUE of
   * pending approvals: staff can reply "TERIMA" when only one is pending, or
   * "TERIMA <ref>" / "TOLAK <ref>" to target a specific booking. TERIMA →
   * 'confirmed' (+ notify customer), TOLAK → 'cancelled'. handled=false when
   * nothing is pending or the reply is ambiguous (normal staff chat flows through).
   */
  async tryStaffAck(tenantId: string, staffPhone: string, text: string): Promise<StaffAckOutcome> {
    const row = await this.pool.query<{ id: string; pending_staff_ack: unknown }>(
      `SELECT id, pending_staff_ack FROM wa_conversations WHERE tenant_id = $1 AND chat_id = $2`,
      [tenantId, staffPhone],
    );
    const conv = row.rows[0];
    if (!conv) return { handled: false };

    // Drop expired proposals up front.
    let list = this.toAckList(conv.pending_staff_ack).filter((a) => {
      const ageMs = Date.now() - new Date(a.proposedAt).getTime();
      return !Number.isNaN(ageMs) && ageMs <= EXPIRY_HOURS * 3600_000;
    });
    if (list.length === 0) {
      if (conv.pending_staff_ack) await this.writeAckList(conv.id, []);
      return { handled: false };
    }

    const t = (text || '').trim();
    const accept = ACCEPT.test(t);
    const reject = REJECT.test(t);
    if (!this.booking || accept === reject) return { handled: false }; // ambiguous / no booking svc

    // Pick the target: an explicit ref in the text, else the sole pending one.
    const upper = t.toUpperCase();
    const byRef = list.find((a) => a.ref && upper.includes(a.ref));
    const target = byRef ?? (list.length === 1 ? list[0] : null);
    if (!target) {
      const menu = list.map((a) => `• ${a.ref}: ${a.summary}`).join('\n');
      return { handled: true, reply: `Ada ${list.length} booking menunggu persetujuan. Balas TERIMA <kode> atau TOLAK <kode>:\n${menu}` };
    }

    const decision = accept ? 'confirmed' : 'cancelled';
    try {
      await this.booking.update(tenantId, target.bookingId, { status: decision });
      list = list.filter((a) => a.bookingId !== target.bookingId);
      await this.writeAckList(conv.id, list);
      await this.recordApproval(tenantId, target, decision, 'whatsapp', staffPhone);
      const more = list.length ? `\n(${list.length} lagi menunggu — balas TERIMA/TOLAK <kode>.)` : '';
      return accept
        ? {
            handled: true,
            reply: `Booking dikonfirmasi ✅ (${target.summary}). Pelanggan sudah kami beri tahu.${more}`,
            notifyCustomer: {
              phone: target.customerPhone,
              text: (await renderNotification(this.renderer, tenantId, 'booking_confirmed', {
                bookingSummary: target.summary,
              })) ?? '',
            },
          }
        : {
            handled: true,
            reply: `Booking ditolak (${target.summary}). Pelanggan sudah kami beri tahu.${more}`,
            notifyCustomer: {
              phone: target.customerPhone,
              text: (await renderNotification(this.renderer, tenantId, 'booking_rejected', {
                bookingSummary: target.summary,
              })) ?? '',
            },
          };
    } catch (e) {
      this.logger.error(`Failed to resolve staff ack for booking ${target.bookingId}: ${String(e)}`);
      return { handled: true, reply: 'Maaf, terjadi kendala saat memproses persetujuan booking.' };
    }
  }

  /** Bookings awaiting staff acknowledgement (for the dashboard approvals view). */
  async listPendingApprovals(tenantId: string): Promise<(PendingStaffAck & { convId: string })[]> {
    const res = await this.pool.query<{ id: string; pending_staff_ack: unknown }>(
      `SELECT id, pending_staff_ack FROM wa_conversations
       WHERE tenant_id = $1 AND pending_staff_ack IS NOT NULL
       ORDER BY last_message_at DESC NULLS LAST`,
      [tenantId],
    );
    return res.rows.flatMap((r) => this.toAckList(r.pending_staff_ack).map((a) => ({ ...a, convId: r.id })));
  }

  /**
   * Resolve an approval from the DASHBOARD (not WhatsApp), keyed by bookingId.
   * Same effect as tryStaffAck: TERIMA/TOLAK → confirm/cancel, clear the ack, and
   * return a `notifyCustomer` payload so the caller can message the customer.
   * Returns null if no matching pending approval exists.
   */
  async resolveByBookingId(tenantId: string, bookingId: string, accept: boolean, decidedBy: string): Promise<StaffAckOutcome | null> {
    // Search the ack QUEUE across the tenant's conversations for this booking.
    const rows = await this.pool.query<{ id: string; pending_staff_ack: unknown }>(
      `SELECT id, pending_staff_ack FROM wa_conversations
       WHERE tenant_id = $1 AND pending_staff_ack IS NOT NULL`,
      [tenantId],
    );
    let convId: string | null = null;
    let ack: PendingStaffAck | null = null;
    let remaining: PendingStaffAck[] = [];
    for (const r of rows.rows) {
      const list = this.toAckList(r.pending_staff_ack);
      const found = list.find((a) => a.bookingId === bookingId);
      if (found) { convId = r.id; ack = found; remaining = list.filter((a) => a.bookingId !== bookingId); break; }
    }
    if (!convId || !ack || !this.booking) return null;

    const status = accept ? 'confirmed' : 'cancelled';
    // If the booking row is gone (deleted/voided elsewhere), don't leave the approval
    // stuck forever with a dead 404 — clear the stale ack, record it as cancelled, and
    // return a resolved outcome so the dashboard panel self-heals on the next click.
    try {
      await this.booking.update(tenantId, ack.bookingId, { status });
    } catch {
      await this.writeAckList(convId, remaining);
      await this.recordApproval(tenantId, ack, 'cancelled', 'dashboard', decidedBy).catch(() => undefined);
      return { handled: true, reply: `Booking sudah tidak ada — approval dibersihkan (${ack.summary}).` };
    }
    await this.writeAckList(convId, remaining);
    await this.recordApproval(tenantId, ack, status, 'dashboard', decidedBy);
    return accept
      ? {
          handled: true,
          reply: `Booking dikonfirmasi ✅ (${ack.summary}).`,
          notifyCustomer: {
            phone: ack.customerPhone,
            text: (await renderNotification(this.renderer, tenantId, 'booking_confirmed', {
              bookingSummary: ack.summary,
            })) ?? '',
          },
        }
      : {
          handled: true,
          reply: `Booking ditolak (${ack.summary}).`,
          notifyCustomer: {
            phone: ack.customerPhone,
            text: (await renderNotification(this.renderer, tenantId, 'booking_rejected', {
              bookingSummary: ack.summary,
            })) ?? '',
          },
        };
  }

  /**
   * Record a resolved approval: to the domain audit table (drives the history
   * view) AND to the global Audit Log (so it appears alongside other security
   * events). Both are best-effort — a booking is never blocked by audit failure.
   */
  private async recordApproval(
    tenantId: string,
    ack: PendingStaffAck,
    decision: 'confirmed' | 'cancelled',
    channel: 'whatsapp' | 'dashboard' | 'system',
    decidedBy: string,
  ): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO wa_booking_approvals (tenant_id, booking_id, summary, customer_phone, decision, channel, decided_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tenantId, ack.bookingId, ack.summary, ack.customerPhone, decision, channel, decidedBy],
      );
    } catch (e) {
      this.logger.warn(`Failed to record booking approval audit for ${ack.bookingId}: ${String(e)}`);
    }
    try {
      // Global Audit Log. WhatsApp decisions have no app user (decidedBy is a
      // phone) → userId null with the phone in metadata; dashboard passes the user id.
      await this.audit?.log({
        tenantId,
        userId: channel === 'dashboard' ? decidedBy : null,
        operation: 'booking_approval',
        entityType: 'booking',
        entityId: ack.bookingId,
        afterValue: { decision, summary: ack.summary, customerPhone: ack.customerPhone },
        metadata: { channel, decidedBy },
      });
    } catch (e) {
      this.logger.warn(`Failed to write global audit for booking ${ack.bookingId}: ${String(e)}`);
    }
  }

  /**
   * SLA sweep: auto-cancel bookings that have sat awaiting staff acknowledgement
   * past the expiry window, across ALL tenants, so a customer who confirmed is
   * never left silently hanging. Returns who to notify (the caller sends the
   * WhatsApp messages). Cancels the booking, audits it (channel 'system'), and
   * removes the ack from its queue.
   */
  async sweepExpired(): Promise<{ tenantId: string; customerPhone: string; summary: string }[]> {
    if (!this.booking) return [];
    const rows = await this.pool.query<{ id: string; tenant_id: string; pending_staff_ack: unknown }>(
      `SELECT id, tenant_id, pending_staff_ack FROM wa_conversations WHERE pending_staff_ack IS NOT NULL`,
    );
    const notifications: { tenantId: string; customerPhone: string; summary: string }[] = [];
    const now = Date.now();
    for (const r of rows.rows) {
      const list = this.toAckList(r.pending_staff_ack);
      if (list.length === 0) continue;
      const fresh: PendingStaffAck[] = [];
      const expired: PendingStaffAck[] = [];
      for (const a of list) {
        const age = now - new Date(a.proposedAt).getTime();
        (Number.isNaN(age) || age > EXPIRY_HOURS * 3600_000 ? expired : fresh).push(a);
      }
      if (expired.length === 0) continue;
      for (const a of expired) {
        try {
          await this.booking.update(r.tenant_id, a.bookingId, { status: 'cancelled' });
          await this.recordApproval(r.tenant_id, a, 'cancelled', 'system', 'sla');
          notifications.push({ tenantId: r.tenant_id, customerPhone: a.customerPhone, summary: a.summary });
        } catch (e) {
          this.logger.warn(`SLA auto-cancel failed for booking ${a.bookingId}: ${String(e)}`);
        }
      }
      await this.writeAckList(r.id, fresh);
    }
    return notifications;
  }

  /** Recent approval decisions for the tenant (audit trail view). */
  async listApprovalHistory(tenantId: string, limit = 20): Promise<Record<string, unknown>[]> {
    const res = await this.pool.query(
      `SELECT booking_id, summary, customer_phone, decision, channel, decided_by, decided_at
       FROM wa_booking_approvals WHERE tenant_id = $1
       ORDER BY decided_at DESC LIMIT $2`,
      [tenantId, Math.min(limit, 100)],
    );
    return res.rows.map((r) => ({
      bookingId: r.booking_id, summary: r.summary, customerPhone: r.customer_phone,
      decision: r.decision, channel: r.channel, decidedBy: r.decided_by, decidedAt: r.decided_at,
    }));
  }

  private async clear(convId: string): Promise<void> {
    await this.pool.query(`UPDATE wa_conversations SET pending_booking = NULL WHERE id = $1`, [convId]);
  }
}
