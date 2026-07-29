/**
 * One badge vocabulary for membership status, shared by every surface that shows
 * it (CRM customer list, CRM customer detail, memberships page).
 *
 * Why this is centralised: the CRM list and CRM detail used to carry two
 * independent maps. The list's map had no `pending` entry, so a customer who had
 * started a membership but not finished paying fell through to the map's default
 * and was labelled "Past member" — while the detail view, using the other map,
 * correctly showed "Pending". Same customer, two contradictory answers
 * (AIRIN-124). Any new status must be added here once, not per-page.
 *
 * Values are the raw `memberships.status` strings from the DB (see the
 * MembershipStatus enum in @aire/shared), plus `inactive`, which the customer
 * list uses for "was a member, no longer".
 */

export interface MemberBadge {
  /** Tailwind classes for the badge. */
  cls: string;
  /** Default English label; pass through i18n at the call site where available. */
  label: string;
  /** i18n key for the label. */
  key: string;
}

export const MEMBER_STATUS_BADGE: Record<string, MemberBadge> = {
  active: { cls: 'bg-green-50 text-green-700', label: 'Member', key: 'member.status.active' },
  // Paid period ended but still renewable — benefits are off, so this is a
  // warning state, not a healthy one.
  grace: { cls: 'bg-orange-50 text-orange-700', label: 'Member · grace', key: 'member.status.grace' },
  // Started but not paid for. MUST NOT read as "past member" — the sale is still
  // live and the cashier can still collect payment.
  pending: { cls: 'bg-blue-50 text-blue-700', label: 'Pending member', key: 'member.status.pending' },
  suspended: { cls: 'bg-amber-50 text-amber-700', label: 'Member · suspended', key: 'member.status.suspended' },
  // Past the renewable window — terminal.
  revoked: { cls: 'bg-rose-50 text-rose-700', label: 'Past member', key: 'member.status.revoked' },
  expired: { cls: 'bg-gray-100 text-gray-500', label: 'Past member', key: 'member.status.expired' },
  cancelled: { cls: 'bg-red-50 text-red-700', label: 'Cancelled', key: 'member.status.cancelled' },
  inactive: { cls: 'bg-gray-100 text-gray-500', label: 'Past member', key: 'member.status.inactive' },
};

/**
 * Badge for a status string. Unknown statuses get neutral styling and the raw
 * value as the label — visible enough to notice and report, rather than being
 * silently mislabelled as something else.
 */
export function memberBadge(status: string): MemberBadge {
  return (
    MEMBER_STATUS_BADGE[status] ?? {
      cls: 'bg-surface-sunken text-text-secondary',
      label: status,
      key: `member.status.${status}`,
    }
  );
}
