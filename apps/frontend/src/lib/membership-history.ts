/**
 * Human-readable rendering of a membership history entry.
 *
 * The member-detail popup used to print the raw event payload as
 * `key: value · key: value` and clip it to one line, so the owner saw things
 * like "orderNumber: ORD-20260805-003 · amount: 349000 · agent: Cashier Budi ·
 * cashie…" — code variable names, an unformatted number, and the tail cut off
 * (AIRIN-141). Event payloads are written by several services with different
 * shapes, so the formatting lives here, once, and is unit-testable.
 *
 * Anything we don't have a sentence for still renders, but with humanised keys
 * and opaque ids dropped — a new event type degrades to something readable
 * rather than to a variable dump.
 */

export interface MembershipHistoryEvent {
  eventType: string;
  payload: Record<string, unknown> | null;
}

/** Keys that are internal joins — never useful to a human reading history. */
const OPAQUE_KEYS = new Set(['planId', 'orderId', 'membershipId', 'source', 'type']);

const rupiah = (v: unknown): string => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? `Rp ${n.toLocaleString('id-ID')}` : String(v);
};

const str = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
};

/** "orderNumber" → "Order number" */
const humaniseKey = (key: string): string => {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
};

/** Readable label for the badge, e.g. 'plates_released' → 'Plates released'. */
export function membershipEventLabel(eventType: string): string {
  return humaniseKey(eventType);
}

/**
 * One-line description of what happened. Returns '' when the event type says
 * everything on its own (the badge already carries it) and the payload adds
 * nothing.
 */
export function describeMembershipEvent(ev: MembershipHistoryEvent): string {
  const p = ev.payload ?? {};
  const parts: string[] = [];

  switch (ev.eventType) {
    case 'purchased': {
      const order = str(p.orderNumber);
      const amount = p.amount != null ? rupiah(p.amount) : null;
      if (order) parts.push(`Order ${order}`);
      if (amount) parts.push(amount);
      // agent and cashier are frequently the same person; say it once.
      const agent = str(p.agent);
      const cashier = str(p.cashier);
      if (agent && cashier && agent === cashier) parts.push(`sold by ${agent}`);
      else {
        if (agent) parts.push(`sold by ${agent}`);
        if (cashier) parts.push(`rung up by ${cashier}`);
      }
      return parts.join(' · ');
    }

    case 'plate_added':
    case 'plate_removed': {
      const plate = str(p.plate);
      const vehicle = str(p.vehicle);
      if (plate) parts.push(plate);
      if (vehicle) parts.push(vehicle);
      return parts.join(' — ');
    }

    case 'plate_updated': {
      const from = str(p.from);
      const plate = str(p.plate);
      const vehicle = str(p.vehicle);
      const change = from && plate && from !== plate ? `${from} → ${plate}` : plate;
      if (change) parts.push(change);
      if (vehicle) parts.push(vehicle);
      return parts.join(' — ');
    }

    case 'suspended':
    case 'cancelled': {
      const reason = str(p.reason);
      return reason ? `Reason: ${reason}` : '';
    }

    case 'renewed': {
      // `type` distinguishes extending the current term from starting a
      // parallel one — the only part of a renewal payload a human cares about.
      if (p.type === 'new_parallel') return 'Started a new term alongside the current one';
      if (p.type === 'extension') return 'Current term extended';
      return '';
    }

    case 'reminder': {
      const milestone = Number(p.milestone);
      if (!Number.isFinite(milestone)) return 'Expiry reminder sent';
      if (milestone === 0) return 'Expiry reminder sent — expires today';
      return `Expiry reminder sent — ${milestone} day${milestone === 1 ? '' : 's'} left`;
    }

    case 'welcome_sent':
      return 'Welcome message sent on WhatsApp';

    case 'entered_grace':
      return 'Term ended — still renewable during the grace period';

    case 'revoked':
      return 'Grace period passed — benefits withdrawn';

    case 'reactivated':
      return 'Put back into service';

    default: {
      // Unknown event: render whatever the payload holds, minus internal ids.
      for (const [k, v] of Object.entries(p)) {
        if (OPAQUE_KEYS.has(k)) continue;
        const value = str(v);
        if (value === null) continue;
        parts.push(`${humaniseKey(k)}: ${k === 'amount' ? rupiah(v) : value}`);
      }
      return parts.join(' · ');
    }
  }
}
