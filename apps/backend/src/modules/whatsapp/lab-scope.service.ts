import { Injectable, Inject, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

/**
 * "Can you calibrate X at Y?" — answered from the accreditation index
 * (migration 102), never from the model's recollection of a prompt.
 *
 * Why this is a tool and not knowledge text: the tenant's partner laboratories
 * carry ~44 KAN scope documents between them, roughly 400k characters. The
 * knowledge-document prompt budget is 40k. Stuffing even a tenth of it in would
 * be worse than useless, because a model cannot distinguish "not accredited"
 * from "truncated out of my context" — both come back as a confident no, with
 * no signal that it is guessing. A query returns the handful of rows that bear
 * on the question and nothing else.
 *
 * The answer turns on RANGE, not instrument name. Two labs both "calibrate
 * Timbangan"; one stops at 1000 kg and the other reaches 4000 kg. Matching on
 * the name alone is confidently wrong on exactly the axis that decides routing.
 */

/** Multiplier to the canonical unit per quantity. Mirrors the seed generator in
 *  database/seeds/ — kept in sync by lab-scope.service.test.ts, which asserts
 *  the conversions that actually decide answers. */
const CANON: Record<string, Record<string, number>> = {
  temperature: { c: 1, '°c': 1, celsius: 1 },
  humidity: { '%rh': 1, rh: 1, '%': 1 },
  voltage: { uv: 1e-6, µv: 1e-6, mv: 1e-3, v: 1, kv: 1e3 },
  current: { ua: 1e-6, µa: 1e-6, ma: 1e-3, a: 1 },
  // NB no `resistance` entry: it is case-sensitive (mOhm vs MOhm) and is
  // resolved by resistanceMultiplier() instead. Adding it here would shadow that.
  capacitance: { pf: 1e-12, nf: 1e-9, uf: 1e-6, µf: 1e-6, f: 1 },
  inductance: { mh: 1e-3, h: 1 },
  power: { w: 1, kw: 1e3 },
  time: { ns: 1e-9, us: 1e-6, µs: 1e-6, ms: 1e-3, s: 1, detik: 1 },
  frequency: { hz: 1, khz: 1e3, mhz: 1e6 },
  rotation: { rpm: 1 },
  mass: { mg: 1e-6, g: 1e-3, gr: 1e-3, kg: 1, ton: 1e3 },
  volume: { ul: 1e-6, µl: 1e-6, ml: 1e-3, l: 1, liter: 1 },
  pressure: { bar: 1, kpa: 0.01, mpa: 10, psi: 0.0689476, 'kgf/cm2': 0.980665 },
  ph: { ph: 1 },
  gas_percent: { '%': 1 },
  gas_ppm: { ppm: 1 },
  tds: { 'mg/l': 1, ppm: 1, 'g/l': 1e3 },
  force: { n: 1, kn: 1e3, kgf: 9.80665, tf: 9806.65, gf: 0.00980665 },
  torque: { nm: 1, 'n.m': 1, 'n m': 1, ncm: 0.01, 'kgf.m': 9.80665 },
  length: { um: 1e-3, 'µm': 1e-3, mm: 1, cm: 10, m: 1e3, km: 1e6 },
  angle: { deg: 1, '°': 1, derajat: 1 },
  flow: { 'l/min': 1, lpm: 1, 'l/s': 60, 'm3/min': 1e3, 'm3/h': 16.6667, 'm3/jam': 16.6667 },
  speed: { 'm/s': 1, 'km/h': 1 / 3.6, 'km/jam': 1 / 3.6 },
  concentration: { 'mg/l': 1, ppm: 1, 'ug/ml': 1, 'µg/ml': 1 },
  conductivity: { 'us/cm': 1, 'µs/cm': 1, 'ms/cm': 1e3 },
  turbidity: { ntu: 1 },
  viscosity: { cp: 1, cst: 1, mpas: 1 },
  brix: { '%brix': 1, brix: 1, 'obrix': 1 },
  wavelength: { nm: 1 },
  light: { lux: 1, lx: 1 },
  sound: { db: 1 },
  charge: { pc: 1, nc: 1e3 },
  energy_joule: { joule: 1, j: 1 },
  heartrate: { bpm: 1 },
  density: { 'g/cm3': 1, 'g/ml': 1 },
  acceleration: { 'm/s2': 1 },
  moisture_percent: { '%': 1 },
  massflow: { 't/h': 1, 'ton/h': 1, 'ton/jam': 1 },
  volumeflow_mlh: { 'ml/h': 1, 'ml/jam': 1 },
  inclination: { 'mm/m': 1 },
};

/**
 * Ohm is ambiguous: "MOhm" is mega but "mOhm" is milli, and a customer types
 * neither consistently. Resolved case-sensitively BEFORE lowercasing, which is
 * why this cannot just live in the table above.
 */
function resistanceMultiplier(raw: string): number | null {
  const t = raw.replace(/ohm|Ω/gi, '').trim();
  if (t === '') return 1;
  if (t === 'µ' || t === 'u') return 1e-6;
  if (t === 'm') return 1e-3;
  if (t === 'k' || t === 'K') return 1e3;
  if (t === 'M') return 1e6;
  if (t === 'G') return 1e9;
  return null;
}

export type ScopeMatch = {
  lab: string;
  lkNumber: string;
  ownLab: boolean;
  measurementGroup: string;
  instrument: string;
  range: string;
  uncertainty: string | null;
  method: string | null;
};

export type ScopeAnswer = {
  inScope: boolean;
  /** Set when the caller gave a value we could not place on a scale. */
  note?: string;
  matches: ScopeMatch[];
  /** Instruments we DO cover whose name resembles the query — so the assistant
   *  can say "not that, but we do cover this" instead of a bare no. */
  nearest?: { instrument: string; range: string; lab: string }[];
};

/** Lowercase, strip punctuation — mirrors instrument_search in the index. */
export function searchKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

/** Convert a customer-supplied value to the canonical unit for a quantity.
 *  Returns null when the unit is not one we know — the caller must then NOT
 *  filter by range, and must say so rather than silently answering yes. */
export function toCanonical(value: number, unit: string, quantity: string): number | null {
  const u = unit.trim();
  if (quantity === 'resistance') {
    const m = resistanceMultiplier(u);
    return m === null ? null : value * m;
  }
  const table = CANON[quantity];
  if (!table) return null;
  const m = table[u.toLowerCase()];
  return m === undefined ? null : value * m;
}

@Injectable()
export class LabScopeService {
  private readonly logger = new Logger(LabScopeService.name);

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * @param instrument what the customer called it, in their words
   * @param value      optional magnitude they need covered
   * @param unit       the unit that value is in
   */
  async check(
    tenantId: string,
    instrument: string,
    value?: number | null,
    unit?: string | null,
  ): Promise<ScopeAnswer> {
    const key = searchKey(instrument);
    if (!key) return { inScope: false, matches: [], note: 'No instrument given.' };

    // Every token must appear, so "termokopel k" does not match "termokopel j".
    // Unverified rows are excluded here, not filtered later: a row nobody has
    // checked against the source PDF must never be able to tell a customer yes.
    const tokens = key.split(' ');
    const conds = tokens.map((_, i) => `c.instrument_search LIKE $${i + 2}`).join(' AND ');
    const params: unknown[] = [tenantId, ...tokens.map((t) => `%${t}%`)];

    const sql = `
      SELECT p.name AS lab, p.lk_number, p.is_own_lab, p.accredited_until,
             c.measurement_group, c.instrument,
             c.range_text, c.unit, c.quantity, c.range_min_si, c.range_max_si,
             c.range_point_si, c.uncertainty, c.method
        FROM lab_capabilities c
        JOIN lab_partners p ON p.id = c.partner_id
       WHERE c.tenant_id = $1 AND c.verified = TRUE AND p.is_active = TRUE
         AND ${conds}
       ORDER BY p.is_own_lab DESC, p.name, c.sort_order
       LIMIT 200`;

    let rows: Record<string, unknown>[];
    try {
      rows = (await this.pool.query(sql, params)).rows as Record<string, unknown>[];
    } catch (err) {
      // A failure here must not become "we cannot do that" — that is a lie the
      // customer would act on. Say nothing definitive and let the agent escalate.
      this.logger.error(`check_scope failed: ${err instanceof Error ? err.message : String(err)}`);
      return { inScope: false, matches: [], note: 'Scope index unavailable; escalate to a human.' };
    }

    const shape = (r: Record<string, unknown>): ScopeMatch => ({
      lab: String(r.lab),
      lkNumber: String(r.lk_number),
      ownLab: Boolean(r.is_own_lab),
      measurementGroup: String(r.measurement_group),
      instrument: String(r.instrument),
      range: String(r.range_text ?? ''),
      uncertainty: r.uncertainty == null ? null : String(r.uncertainty),
      method: r.method == null ? null : String(r.method),
    });

    if (rows.length === 0) return { inScope: false, matches: [] };

    // A KAN accreditation that has run out cannot be quoted, however good the
    // range is. Drop those rows — but if they were the ONLY match, say so by
    // name instead of returning a bare no, because "we stopped being able to"
    // and "we never could" call for different replies and different follow-up.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lapsed = new Set<string>();
    const live = rows.filter((r) => {
      const until = r.accredited_until == null ? null : new Date(String(r.accredited_until));
      if (until && until < today) {
        lapsed.add(`${String(r.lab)} (${String(r.lk_number)})`);
        return false;
      }
      return true;
    });
    if (live.length === 0) {
      return {
        inScope: false,
        matches: [],
        note:
          `Only ${[...lapsed].join(', ')} covers this, and that accreditation has ` +
          `expired. Escalate to a human — do not tell the customer we can or cannot do it.`,
      };
    }
    rows = live;

    // No magnitude given: report what we cover and let the assistant ask.
    if (value == null || !Number.isFinite(value) || !unit) {
      return { inScope: true, matches: rows.slice(0, 12).map(shape) };
    }

    const quantity = String(rows[0]!.quantity);
    const target = toCanonical(value, unit, quantity);
    if (target === null) {
      return {
        inScope: true,
        matches: rows.slice(0, 12).map(shape),
        note: `Unit "${unit}" not recognised for ${quantity}; ranges below are NOT filtered — confirm with the team before promising coverage.`,
      };
    }

    const within = rows.filter((r) => {
      const lo = r.range_min_si == null ? null : Number(r.range_min_si);
      const hi = r.range_max_si == null ? null : Number(r.range_max_si);
      const pt = r.range_point_si == null ? null : Number(r.range_point_si);
      if (lo !== null && hi !== null) return target >= lo && target <= hi;
      if (pt !== null) return Math.abs(pt - target) < Math.abs(pt || 1) * 1e-9;
      return false;
    });

    if (within.length > 0) return { inScope: true, matches: within.map(shape) };

    // Name matches, magnitude does not — the most dangerous case to get wrong,
    // so hand back what IS covered and let the reply be specific about why not.
    return {
      inScope: false,
      matches: [],
      nearest: rows.slice(0, 8).map((r) => ({
        instrument: String(r.instrument),
        range: String(r.range_text ?? ''),
        lab: String(r.lab),
      })),
    };
  }
}
