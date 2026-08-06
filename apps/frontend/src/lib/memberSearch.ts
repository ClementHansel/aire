/**
 * Classifies what a cashier typed into the POS "Find member" box.
 *
 * The three accepted formats are inherently ambiguous: an Indonesian mobile is
 * very often EXACTLY 12 digits (08xx xxxx xxxx), and a membership number is 12
 * base-36 characters — which can also be all digits. So "081200000091" is a valid
 * shape for both, and reading it as a member number produced "Customer not found"
 * for a customer standing at the counter.
 *
 * Two rules follow from that:
 *   1. All-digits starting 0 or 62 is read as a PHONE first — that pattern is a
 *      phone far more often than it is a member number.
 *   2. Every guess carries an `alternateKey`, so the caller retries the other
 *      interpretation before telling the cashier nobody matched. Guessing between
 *      ambiguous formats must never be a dead end.
 */
export type MemberSearchKey = 'phone' | 'number' | 'plate';

export interface MemberSearchClassification {
  /** The lookup parameter to try first. */
  key: MemberSearchKey;
  /** The one to retry on a miss, or null when there is no sensible alternative. */
  alternateKey: MemberSearchKey | null;
}

export function classifyMemberSearch(raw: string): MemberSearchClassification {
  const v = raw.trim();
  const looksLikePhone = /^(?:0|62)\d{7,14}$/.test(v);
  const isNumber = !looksLikePhone && /^[0-9A-Za-z]{12}$/.test(v);
  const isPhone = looksLikePhone || (!isNumber && /\d/.test(v) && !/[a-z]/i.test(v));

  const key: MemberSearchKey = isNumber ? 'number' : isPhone ? 'phone' : 'plate';
  // A plate is distinctive enough (letters + digits in a plate shape) that
  // retrying it as a phone or member number would only add noise.
  const alternateKey: MemberSearchKey | null =
    key === 'phone' ? 'number' : key === 'number' ? 'phone' : null;

  return { key, alternateKey };
}
