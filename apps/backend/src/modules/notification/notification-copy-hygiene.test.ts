import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NOTIFICATION_CATALOG, CATALOG_KEY_ALIASES, getDefinition } from './notification-catalog';
import { fillTemplate, optionalVars } from './notification-renderer.service';

/**
 * COPY HYGIENE RATCHET
 *
 * This platform is multi-tenant, but its customer-facing copy was written for
 * one tenant: a car wash whose assistant is called Irene. Two symptoms reached
 * real customers of a calibration lab —
 *
 *   - "boleh info nomor HP …, nomor member, atau plat kendaraannya" (a lab has
 *     no plates), and
 *   - "Baik kak, Irene siapkan booking berikut ya" (their assistant is Kalia),
 *
 * and in both cases the owner could not find the sentence, because it was a
 * string literal in TypeScript rather than anything they could open.
 *
 * These tests fail the build on a repeat:
 *   1. no persona or brand name hardcoded in any message body,
 *   2. any body naming a vehicle must offer a non-vehicle alternative,
 *   3. no message body written inline in the WhatsApp send path,
 *   4. every legacy alias still resolves to a real catalogue entry.
 */

/**
 * Names that must never be baked into a body. A tenant's assistant is named by
 * their own persona config, and the business by `{businessName}`.
 */
const FORBIDDEN_NAMES = [
  { pattern: /\bIrene\b/i, why: 'the demo car wash\'s assistant — use the {agentName} variable' },
  { pattern: /\bKalia\b/i, why: 'one tenant\'s assistant — use the {agentName} variable' },
  { pattern: /\bAIRE\b/, why: 'one tenant\'s brand — use the {businessName} variable' },
  { pattern: /\bAirin\b/i, why: 'the platform brand — tenants are not Airin' },
];

/**
 * Words that only make sense for a tenant that services vehicles. A body using
 * one needs `defaultBodyByVertical` entries so a non-vehicle tenant reads
 * correctly.
 */
const VEHICLE_WORDS = /\b(mobil|kendaraan|dicuci|cuci|plat)\b/i;

/**
 * The body as a non-vehicle tenant would actually receive it: rendered with
 * every variable empty, so lines carrying only optional placeholders drop out.
 *
 * Judging the raw template instead would flag `Plat: {plate}` in the branch
 * booking alert — a line that never reaches a business without vehicles,
 * because `plate` is optional and its line disappears. The rule has to match
 * the runtime behaviour or it just trains people to suppress it.
 */
function asDelivered(def: { defaultBody: string; variables: { name: string }[] }, body: string): string {
  return fillTemplate(body, {}, optionalVars(def as never));
}

/** The verticals that do not service vehicles. */
const NON_VEHICLE = ['services', 'fnb', 'laundry'] as const;

describe('notification copy hygiene', () => {
  it('no message body hardcodes a persona or brand name', () => {
    const problems: string[] = [];
    for (const def of NOTIFICATION_CATALOG) {
      const bodies = [def.defaultBody, ...Object.values(def.defaultBodyByVertical ?? {})];
      for (const body of bodies) {
        for (const { pattern, why } of FORBIDDEN_NAMES) {
          if (pattern.test(body)) problems.push(`${def.key}: contains ${pattern} — ${why}`);
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('every vehicle-flavoured body offers a non-vehicle alternative', () => {
    const problems: string[] = [];
    for (const def of NOTIFICATION_CATALOG) {
      if (!VEHICLE_WORDS.test(asDelivered(def, def.defaultBody))) continue;
      const byVertical = def.defaultBodyByVertical ?? {};
      for (const vertical of NON_VEHICLE) {
        const alt = byVertical[vertical];
        if (!alt) {
          problems.push(
            `${def.key}: default names a vehicle but has no '${vertical}' wording. `
            + 'Add defaultBodyByVertical, or rewrite the default so it fits any business.',
          );
        } else if (VEHICLE_WORDS.test(asDelivered(def, alt))) {
          problems.push(`${def.key}: the '${vertical}' wording still names a vehicle.`);
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('every legacy template alias resolves to a real catalogue entry', () => {
    // An alias pointing at a key that has been renamed degrades silently to
    // "unknown template, nothing sent" — a notification that just stops.
    const broken = Object.entries(CATALOG_KEY_ALIASES)
      .filter(([, key]) => !getDefinition(key))
      .map(([legacy, key]) => `${legacy} -> ${key} (no such entry)`);
    expect(broken, broken.join('\n')).toEqual([]);
  });

  it('the WhatsApp send path contains no inline message body', () => {
    // The catalogue's own rule: "A message body written inline at a call site is
    // a bug: the owner cannot edit it and nobody can find it." `identityAsk()`
    // in whatsapp.service.ts was exactly that.
    const dir = join(__dirname, '..', 'whatsapp');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.includes('.test.'));

    const problems: string[] = [];
    for (const file of files) {
      const src = readFileSync(join(dir, file), 'utf8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        // Comments explain the history and legitimately quote the old strings.
        const code = line.trim();
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
        // A customer-facing sentence is the tell: Indonesian address forms that
        // only ever appear in copy sent to a customer.
        if (/(boleh info nomor HP|plat kendaraannya|Aku Irene|siapkan booking berikut)/i.test(code)) {
          problems.push(`${file}:${i + 1}: inline customer copy — move it to the notification catalogue`);
        }
      });
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
