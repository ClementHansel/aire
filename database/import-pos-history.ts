/**
 * POS history import — the client's real transaction log, straight from the
 * outlet's operating spreadsheet.
 *
 * Unlike `seed-history.ts` (which INVENTS plausible data), this reads an actual
 * workbook — one sheet per month, one row per transaction — and reconstructs the
 * domain records that produced it:
 *
 *   • customers        deduplicated by normalized phone
 *   • memberships      one per member card code (+ plates, usages, renewals)
 *   • voucher books    one per pack sale (+ tickets, redemptions marked)
 *   • orders           one per sheet row (+ items, tags)
 *   • catalog top-up   services / plans / voucher template the sheet sells but
 *                      the tenant does not have yet (never modifies existing rows)
 *   • staff            the agents named in the sheet, as salespeople
 *
 * The sheet's own recap block is the correctness oracle: SUM of the PRICE column
 * equals the month's stated REVENUE, so the import asserts that imported
 * `SUM(orders.total)` matches per month, and refuses to commit if it drifts.
 *
 * Usage:
 *   POS_XLSX="/path/POS Sample 2026 01-02.xlsx" pnpm --filter @aire/database import:pos -- --dry-run
 *   POS_XLSX="…" TENANT_ID=… pnpm --filter @aire/database import:pos
 *
 * Env:
 *   POS_XLSX      path to the workbook                       (required)
 *   DATABASE_URL  connection string (or standard PG* vars)
 *   TENANT_ID     target tenant                              (default demo tenant)
 *   OUTLET_CODE   outlet the sheet belongs to                (default KWS)
 *   DRY_RUN=1     parse, resolve and report — write nothing  (also --dry-run)
 *
 * Re-runnable: every row it writes is tagged (`orders.order_number` starts with
 * the import prefix, catalog rows are matched by name), and each run first
 * removes its own previous output. It never deletes a row it did not create.
 */

import pg from 'pg';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { readWorkbook, type Cell, type Row } from './xlsx-reader.js';

const { Client } = pg;

const DEMO_TENANT = '11111111-1111-1111-1111-111111111111';
const TENANT_ID = process.env.TENANT_ID || DEMO_TENANT;
const OUTLET_CODE = process.env.OUTLET_CODE || 'KWS';
const XLSX_PATH = process.env.POS_XLSX || '';
const DRY_RUN = process.env.DRY_RUN === '1' || process.argv.includes('--dry-run');

/** Order numbers this import owns. Cleanup keys on it, so it must stay stable. */
const ORDER_PREFIX = 'POS';
/** Jakarta is UTC+7 year-round; the sheet's clock is wall-clock Jakarta time. */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Sheet semantics
// ─────────────────────────────────────────────────────────────────────────────

/** Row 1–3 are the banner/header rows; transactions start at row 4. */
const FIRST_DATA_ROW = 4;

const COL = {
  day: 'A', date: 'B', time: 'C', service: 'D', status: 'E',
  brand: 'F', vehicle: 'G', plate: 'H', name: 'I', phone: 'J',
  notes: 'K', expiry: 'L', payment: 'M', price: 'N', remarks: 'O',
  agent: 'P',
} as const;

const MEMBER_CODE = /^([A-Z]{3})-(\d{1,2})-(\d{1,6})$/i;
const VOUCHER_CODE = /^([A-Z]{3})-VRW-(\d{1,6})$/i;

function text(v: Cell): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** Blank-ish sheet values: the operator's "nothing here" is a dash. */
function nullable(v: Cell): string | null {
  const s = text(v);
  return s === '' || s === '-' || s === '0' ? null : s;
}

/** Excel serial day → UTC ms. Serial 25569 is 1970-01-01. */
function serialToUtcMs(serial: number): number {
  return Math.round((serial - 25569) * 86400000);
}

/**
 * Is this DATE cell an actual operating date?
 *
 * The recap block under the transactions reuses the same columns for its
 * totals, so its rows also carry a number in the DATE column — a transaction
 * count like `33`, which is a perfectly valid 1900 date serial. Requiring a
 * plausible modern date is what separates a sale from the summary of sales
 * (and it matters: the recap's own REVENUE cell sits in the PRICE column, so
 * reading one recap row silently doubles the month's revenue).
 */
const MIN_DATE_SERIAL = 43831; // 2020-01-01
const MAX_DATE_SERIAL = 49310; // 2035-01-01
function isDateSerial(v: Cell): v is number {
  return typeof v === 'number' && v >= MIN_DATE_SERIAL && v <= MAX_DATE_SERIAL;
}

/**
 * The sheet's date + time as a real instant.
 *
 * Both are Jakarta wall-clock. Postgres stores UTC and every report converts
 * back with `AT TIME ZONE 'Asia/Jakarta'`, so the instant we store has to be
 * the local reading minus 7h — otherwise an evening order lands on the wrong
 * operating day.
 */
function rowTimestamp(dateCell: Cell, timeCell: Cell): Date | null {
  if (!isDateSerial(dateCell)) return null;
  let dayMs = serialToUtcMs(Math.floor(dateCell));

  let secondsIntoDay = 12 * 3600; // sheet leaves ~120 times blank; midday is neutral
  if (typeof timeCell === 'number') {
    secondsIntoDay = Math.round((timeCell % 1) * 86400);
  } else {
    // Typos are common: "13;52" for 13:52, "17.05", stray spaces.
    const m = /^(\d{1,2})\s*[:;.,]\s*(\d{1,2})/.exec(text(timeCell));
    if (m) {
      const h = Number(m[1]);
      const min = Number(m[2]);
      if (h < 24 && min < 60) secondsIntoDay = h * 3600 + min * 60;
    }
  }
  return new Date(dayMs + secondsIntoDay * 1000 - WIB_OFFSET_MS);
}

/** Membership expiry, rejecting the sheet's typo years (1982, 2016, 2926…). */
function expiryDate(cell: Cell, near: Date): string | null {
  if (typeof cell !== 'number') return null;
  const d = new Date(serialToUtcMs(Math.floor(cell)));
  const year = d.getUTCFullYear();
  const refYear = near.getUTCFullYear();
  if (year < refYear - 1 || year > refYear + 2) return null;
  return d.toISOString().slice(0, 10);
}

/** Indonesian mobile numbers, normalized to 62… — matches the app's own rule. */
function normalizePhone(raw: string | null): { display: string; normalized: string } | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  let n = digits;
  if (n.startsWith('0')) n = `62${n.slice(1)}`;
  else if (!n.startsWith('62')) n = `62${n}`;
  if (n.length > 20) return null;
  return { display: raw.replace(/[^\d+]/g, '').slice(0, 20), normalized: n };
}

function normalizePlate(raw: string | null): { plate: string; normalized: string } | null {
  if (!raw) return null;
  const plate = raw.toUpperCase().replace(/\s+/g, ' ').trim().slice(0, 20);
  const normalized = plate.replace(/[^A-Z0-9]/g, '').slice(0, 20);
  if (normalized.length < 3) return null;
  return { plate, normalized };
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalog mapping
//
// Left side: exactly what the sheet's SERVICE TYPE column says (the operator's
// shorthand). Right side: the catalog service it means. `unit` splits the wash
// business (AIRE) from the detailing arm (LEAD). `price` is the modal price
// actually charged in this workbook, used only when the service has to be
// created — existing catalog rows are never repriced.
// ─────────────────────────────────────────────────────────────────────────────

interface ServiceSpec {
  catalog: string;
  category: 'car_wash' | 'product' | 'add_on';
  unit: 'AIRE' | 'LEAD';
  price: number;
  /** A wash the membership/voucher can cover. */
  washLike?: boolean;
}

const SERVICE_MAP: Record<string, ServiceSpec> = {
  // ── wash (AIRE) ──
  'CW': { catalog: 'Standard Wash', category: 'car_wash', unit: 'AIRE', price: 60000, washLike: true },
  'CW + W': { catalog: 'Cuci + Spray Wax', category: 'car_wash', unit: 'AIRE', price: 110000, washLike: true },
  'CW + PC': { catalog: 'Cuci + Polymer', category: 'car_wash', unit: 'AIRE', price: 150000, washLike: true },

  // ── detailing / treatment (LEAD) ──
  'GROOM': { catalog: 'Grooming', category: 'car_wash', unit: 'LEAD', price: 1320000 },
  'FOGGING': { catalog: 'Fogging', category: 'car_wash', unit: 'LEAD', price: 250000 },
  'cl. ENGINE': { catalog: 'Cleaning Engine', category: 'car_wash', unit: 'LEAD', price: 390000 },
  'cl. AIR CON': { catalog: 'Cleaning Air Con', category: 'car_wash', unit: 'LEAD', price: 500000 },
  'cl. SEATS': { catalog: 'Cleaning Seats', category: 'car_wash', unit: 'LEAD', price: 1300000 },
  'cl. INTERIOR': { catalog: 'Cleaning Interior', category: 'car_wash', unit: 'LEAD', price: 800000 },
  'cl. WINDOW': { catalog: 'Cleaning Window', category: 'car_wash', unit: 'LEAD', price: 600000 },
  'cl. WINDSHIELD': { catalog: 'Cleaning Windshield', category: 'car_wash', unit: 'LEAD', price: 600000 },
  'coating DP': { catalog: 'Coating (DP)', category: 'car_wash', unit: 'LEAD', price: 1850000 },
  'coating LUNAS': { catalog: 'Coating (Pelunasan)', category: 'car_wash', unit: 'LEAD', price: 1950000 },
  'coating CLAIM': { catalog: 'Coating (Claim Garansi)', category: 'car_wash', unit: 'LEAD', price: 0 },
  'coating WINDSHIELD': { catalog: 'Coating Windshield', category: 'car_wash', unit: 'LEAD', price: 1000000 },
  'coating WINDOW': { catalog: 'Coating Window', category: 'car_wash', unit: 'LEAD', price: 1000000 },

  // ── retail (AIRE) — perfumes and chemicals already in the catalog ──
  'Midnight Drive (MD)': { catalog: 'Midnight Drive', category: 'product', unit: 'AIRE', price: 45000 },
  'Ocean Dream (OD)': { catalog: 'Ocean Drive', category: 'product', unit: 'AIRE', price: 45000 },
  'Honey Peach (HP)': { catalog: 'Honey Peach', category: 'product', unit: 'AIRE', price: 45000 },
  'Microfiber': { catalog: 'microfiber', category: 'product', unit: 'AIRE', price: 25000 },
  'SONAX AC Cleaner': { catalog: 'SNX AC Cleaner', category: 'product', unit: 'AIRE', price: 199000 },
  'SONAX HS Wax': { catalog: 'SNX HS Wax', category: 'product', unit: 'AIRE', price: 210000 },
  'Brill HEPA Filter': { catalog: 'Brill HEPA Filter', category: 'product', unit: 'AIRE', price: 350000 },
  'GX Engine Dressing': { catalog: 'GX Engine Dressing', category: 'product', unit: 'AIRE', price: 68000 },
  'GX Interior Cleaner': { catalog: 'GX Interior Cleaner', category: 'product', unit: 'AIRE', price: 62000 },
  'GX Quick Detailer': { catalog: 'GX Quick Detailer', category: 'product', unit: 'AIRE', price: 74500 },
  'GX Ultimate Wax': { catalog: 'GX Ultimate Wax', category: 'product', unit: 'AIRE', price: 79000 },
  'GX Wash & Wax': { catalog: 'GX Wash & Wax', category: 'product', unit: 'AIRE', price: 74500 },
  'GX Shampoo': { catalog: 'GX Shampoo', category: 'product', unit: 'AIRE', price: 60000 },
  'GX All Purpose': { catalog: 'GX All Purpose', category: 'product', unit: 'AIRE', price: 60000 },
};

/** The add-on charged when a member or voucher wash carries an extra fee. */
const MEMBER_ADDON = { catalog: 'Spray Wax (Member)', price: 30000 };

/** `Non Wash` is not a service — it marks a row whose money is a sale, not a wash. */
const NON_WASH = 'Non Wash';

interface PlanSpec { months: number; name: string; sellable: boolean; }
const PLAN_SPECS: Record<number, PlanSpec> = {
  1: { months: 1, name: 'AIRE Unlimited 1 Bulan', sellable: true },
  3: { months: 3, name: 'AIRE Unlimited 3 Bulan', sellable: true },
  // Two cards in the sheet run on a 12-month plan, but it was never sold inside
  // the window, so the workbook records no price for it. Rather than invent one,
  // the plan is created inactive: the history stays faithful and nobody can ring
  // up a zero-rupiah membership by accident. The owner sets the real price to
  // enable it.
  12: { months: 12, name: 'AIRE Unlimited 12 Bulan', sellable: false },
};

/**
 * What a membership of each duration currently costs, taken from the workbook.
 *
 * The sheet prices the same plan differently across the two months (a 1-month
 * card is 349k in January and 299k in February), so a created plan is priced at
 * the most recent figure actually charged rather than a hardcoded guess. This
 * only sets catalog price for FUTURE sales — every imported order keeps the
 * amount its own row records.
 */
function planPricesFromSheet(txns: Txn[]): Map<number, number> {
  const byMonths = new Map<number, { at: Date; votes: Map<number, number> }>();
  for (const t of txns) {
    if (t.kind.sale?.type !== 'membership' || t.price <= 0) continue;
    const m = t.kind.sale.months;
    const entry = byMonths.get(m) ?? { at: t.at, votes: new Map<number, number>() };
    // Only the latest calendar month's prices get a vote.
    const sameMonth = entry.at.toISOString().slice(0, 7) === t.at.toISOString().slice(0, 7);
    if (t.at > entry.at && !sameMonth) { entry.at = t.at; entry.votes = new Map(); }
    else if (t.at > entry.at) entry.at = t.at;
    if (entry.at.toISOString().slice(0, 7) === t.at.toISOString().slice(0, 7)) {
      entry.votes.set(t.price, (entry.votes.get(t.price) ?? 0) + 1);
    }
    byMonths.set(m, entry);
  }
  const out = new Map<number, number>();
  for (const [m, entry] of byMonths) {
    const best = [...entry.votes.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    if (best) out.set(m, best[0]);
  }
  return out;
}

const VOUCHER_TEMPLATE_NAME = 'Paket Voucher Cuci 10x';
/** A pack is ten washes; the recap's "Vou Terjual" is exactly 10 × packs sold. */
const VOUCHER_PACK_SIZE = 10;

/**
 * Sheet payment label → the tenant's payment method name, plus the entity whose
 * machine took the money. `Qris AIRE` and `Qris LEAD` are two different QRIS
 * accounts, which is why the channel is tracked separately from business unit.
 */
const PAYMENT_MAP: Record<string, { method: string; channel: 'AIRE' | 'LEAD' }> = {
  'cash': { method: 'Cash', channel: 'AIRE' },
  'qris aire': { method: 'QRIS', channel: 'AIRE' },
  'qris lead': { method: 'QRIS LED', channel: 'LEAD' },
  'debit aire': { method: 'Debit', channel: 'AIRE' },
  'debit lead': { method: 'Debit LED', channel: 'LEAD' },
  'cc aire': { method: 'C.Card', channel: 'AIRE' },
  'cc lead': { method: 'C.Card LED', channel: 'LEAD' },
  'transfer': { method: 'Transfer', channel: 'AIRE' },
};

function mapPayment(raw: string | null): { method: string; channel: 'AIRE' | 'LEAD' } | null {
  if (!raw) return null;
  // Trailing '*' / '**' are the sheet's footnotes about QRIS/EDC fees.
  const key = raw.toLowerCase().replace(/\*+$/, '').replace(/\s+/g, ' ').trim();
  return PAYMENT_MAP[key] ?? null;
}

/** How the wash on this row was paid for. Drives coverage and tags. */
type Coverage = 'charged' | 'membership' | 'voucher' | 'complimentary';

/**
 * `order_tags.tag` is a closed vocabulary — the app's own transaction taxonomy,
 * which the POS filters and the daily-ops report group by. Rows outside it
 * (a coating job, a warranty rewash) tag as 'regular'; what they actually were
 * survives in business_unit, the service line and the order note.
 */
type Tag = 'regular' | 'member' | 'voucher' | 'new_member' | 'renewal' | 'buy_voucher_pack';

interface Kind {
  coverage: Coverage;
  /** Membership sold on this row, if any. */
  sale?: { type: 'membership'; months: number } | { type: 'voucher_pack' };
  renewal?: boolean;
  tag: Tag;
}

/**
 * The STATUS column is the operator's transaction type. It decides who paid for
 * the wash and whether the row also sold something.
 */
function classify(status: string | null, service: string, remarks: string | null): Kind {
  const s = (status ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
  const svc = service.toUpperCase();
  const rmk = (remarks ?? '').toUpperCase();

  const newMbr = /^NEW MBR \((\d+)MTH\)$/.exec(s);
  if (newMbr) {
    return { coverage: 'membership', sale: { type: 'membership', months: Number(newMbr[1]) }, tag: 'new_member' };
  }
  const renewal = /^RENEWAL \((\d+)MTH\)$/.exec(s);
  if (renewal) {
    return {
      coverage: 'membership',
      sale: { type: 'membership', months: Number(renewal[1]) },
      renewal: true,
      tag: 'renewal',
    };
  }
  if (s === 'BELI PAKET VOU' || s === 'PAKET VOUCHER') {
    return { coverage: 'charged', sale: { type: 'voucher_pack' }, tag: 'buy_voucher_pack' };
  }
  if (s === 'PAKAI VOU') return { coverage: 'voucher', tag: 'voucher' };
  if (s.startsWith('MEMBER')) return { coverage: 'membership', tag: 'member' };
  if (s === 'NON-MEMBER') return { coverage: 'charged', tag: 'regular' };

  // Warranty rewashes, internal tests and coating claims leave the till empty.
  if (s === 'GARANSI HUJAN') return { coverage: 'complimentary', tag: 'regular' };
  if (s === 'TESTING' || rmk === 'FREE') return { coverage: 'complimentary', tag: 'regular' };
  if (svc.includes('CLAIM')) return { coverage: 'complimentary', tag: 'regular' };

  if (s === 'PRODUCT' || s === 'ITEM') return { coverage: 'charged', tag: 'regular' };
  if (s === 'COATING') return { coverage: 'charged', tag: 'regular' };
  if (s === 'TREATMENT') return { coverage: 'charged', tag: 'regular' };
  if (s === 'PROMO') return { coverage: 'charged', tag: 'regular' };

  return { coverage: 'charged', tag: 'regular' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsed row
// ─────────────────────────────────────────────────────────────────────────────

interface Txn {
  sheet: string;
  sheetRow: number;
  at: Date;
  service: string;
  status: string | null;
  brand: string | null;
  model: string | null;
  plate: { plate: string; normalized: string } | null;
  name: string | null;
  phone: { display: string; normalized: string } | null;
  notes: string | null;
  memberCode: string | null;
  voucherCode: string | null;
  expiry: string | null;
  payment: { method: string; channel: 'AIRE' | 'LEAD' } | null;
  price: number;
  remarks: string | null;
  agent: string | null;
  kind: Kind;
}

/**
 * The month's revenue as the sheet itself states it, from the recap block.
 *
 * This is the one number in the workbook that was not produced by our own
 * parsing, which is exactly what makes it worth checking against: if we drop
 * rows, double-count them, or misread the PRICE column, this disagrees.
 * Returns null if the sheet has no recap to check.
 */
function recapRevenue(rows: Map<number, Row>): number | null {
  for (const row of rows.values()) {
    let hasLabel = false;
    for (const v of row.values()) {
      if (typeof v === 'string' && v.trim().toUpperCase() === 'REVENUE') { hasLabel = true; break; }
    }
    if (!hasLabel) continue;
    let best: number | null = null;
    for (const v of row.values()) {
      if (typeof v === 'number' && (best === null || v > best)) best = v;
    }
    if (best !== null) return best;
  }
  return null;
}

function parseTxns(sheets: { name: string; rows: Map<number, Row> }[], warn: (m: string) => void): Txn[] {
  const out: Txn[] = [];
  for (const sheet of sheets) {
    const rowNums = [...sheet.rows.keys()].filter((n) => n >= FIRST_DATA_ROW).sort((a, b) => a - b);
    // The recap block below the transactions reuses the same columns for its
    // totals, so a numeric DATE cell is what separates a transaction from it.
    for (const n of rowNums) {
      const row = sheet.rows.get(n)!;
      const dateCell = row.get(COL.date) ?? null;
      if (!isDateSerial(dateCell)) continue;
      const at = rowTimestamp(dateCell, row.get(COL.time) ?? null);
      if (!at || Number.isNaN(at.getTime())) { warn(`${sheet.name}!${n}: unreadable date/time — skipped`); continue; }

      const service = text(row.get(COL.service) ?? null) || 'CW';
      const status = nullable(row.get(COL.status) ?? null);
      const notes = nullable(row.get(COL.notes) ?? null);
      const remarks = nullable(row.get(COL.remarks) ?? null);
      const priceCell = row.get(COL.price) ?? null;
      const price = typeof priceCell === 'number' && Number.isFinite(priceCell) ? priceCell : 0;

      const noteUpper = (notes ?? '').toUpperCase();
      const memberCode = MEMBER_CODE.test(noteUpper) ? noteUpper : null;
      const voucherCode = VOUCHER_CODE.test(noteUpper) ? noteUpper : null;

      const agentRaw = nullable(row.get(COL.agent) ?? null);
      // The AGENT and TEKNISI columns double as recap cells further down; only
      // alphabetic values are real staff names.
      const agent = agentRaw && /^[A-Za-z][A-Za-z .'-]*$/.test(agentRaw) ? agentRaw.toUpperCase() : null;

      out.push({
        sheet: sheet.name,
        sheetRow: n,
        at,
        service,
        status,
        brand: nullable(row.get(COL.brand) ?? null)?.slice(0, 100) ?? null,
        model: nullable(row.get(COL.vehicle) ?? null)?.slice(0, 100) ?? null,
        plate: normalizePlate(nullable(row.get(COL.plate) ?? null)),
        name: nullable(row.get(COL.name) ?? null)?.slice(0, 255) ?? null,
        phone: normalizePhone(nullable(row.get(COL.phone) ?? null)),
        notes,
        memberCode,
        voucherCode,
        expiry: expiryDate(row.get(COL.expiry) ?? null, at),
        payment: mapPayment(nullable(row.get(COL.payment) ?? null)),
        price,
        remarks,
        agent,
        kind: classify(status, service, remarks),
      });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Import
// ─────────────────────────────────────────────────────────────────────────────

async function bulkInsert(client: pg.Client, table: string, columns: string[], rows: unknown[][]): Promise<void> {
  if (rows.length === 0) return;
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const tuples = slice.map((r) => `(${r.map((v) => { params.push(v); return `$${params.length}`; }).join(',')})`);
    await client.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${tuples.join(',')}`, params);
  }
}

function money(n: number): string {
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`;
}

async function run(): Promise<void> {
  if (!XLSX_PATH) throw new Error('POS_XLSX is required — path to the POS workbook');

  const warnings: string[] = [];
  const warn = (m: string) => { if (warnings.length < 5000) warnings.push(m); };

  console.log(`\nReading ${XLSX_PATH}…`);
  const sheets = readWorkbook(XLSX_PATH);
  console.log(`  Sheets: ${sheets.map((s) => `${s.name} (${s.rows.size} rows)`).join(', ')}`);

  const txns = parseTxns(sheets, warn);
  if (txns.length === 0) throw new Error('No transaction rows found — is this the right workbook?');

  // Per-sheet expected revenue, checked against the sheet's own recap figure
  // before anything is written.
  const expected = new Map<string, { rows: number; revenue: number }>();
  for (const t of txns) {
    const e = expected.get(t.sheet) ?? { rows: 0, revenue: 0 };
    e.rows++; e.revenue += t.price;
    expected.set(t.sheet, e);
  }
  console.log(`\n  Parsed ${txns.length} transactions:`);
  for (const sheet of sheets) {
    const e = expected.get(sheet.name);
    if (!e) continue;
    const recap = recapRevenue(sheet.rows);
    const agrees = recap === null || Math.abs(recap - e.revenue) < 1;
    console.log(
      `    ${sheet.name}: ${e.rows} rows, ${money(e.revenue)}` +
      (recap === null ? '  (sheet states no recap total)' : `  vs recap ${money(recap)} ${agrees ? '✓' : '✗'}`),
    );
    if (!agrees) {
      throw new Error(
        `${sheet.name}: parsed ${money(e.revenue)} but the sheet's recap says ${money(recap!)} ` +
        `(off by ${money(e.revenue - recap!)}) — refusing to import a misread workbook`,
      );
    }
  }

  const client =
    process.env.DATABASE_URL
      ? new Client({ connectionString: process.env.DATABASE_URL })
      : process.env.PGHOST || process.env.PGUSER
        ? new Client()
        : new Client({ connectionString: 'postgresql://aire:aire_secret@localhost:5432/aire' });
  await client.connect();

  try {
    // ── target outlet ────────────────────────────────────────────────────────
    const outlet = (await client.query<{ id: string; name: string; code: string | null }>(
      `SELECT id, name, code FROM outlets WHERE tenant_id = $1 AND (code = $2 OR agent_id = $2) LIMIT 1`,
      [TENANT_ID, OUTLET_CODE],
    )).rows[0];
    if (!outlet) throw new Error(`No outlet with code/agent_id '${OUTLET_CODE}' in tenant ${TENANT_ID}`);
    console.log(`\n  Outlet: ${outlet.name} (${outlet.code}) — ${outlet.id}`);

    const orderPrefix = `${ORDER_PREFIX}-${outlet.code ?? OUTLET_CODE}-`;

    // ── catalog top-up: services ─────────────────────────────────────────────
    const existing = (await client.query<{ id: string; name: string; price: string }>(
      `SELECT id, name, price FROM services
        WHERE tenant_id = $1 AND (outlet_id IS NULL OR outlet_id = $2)
          AND (outlet_ids IS NULL OR $2 = ANY(outlet_ids))`,
      [TENANT_ID, outlet.id],
    )).rows;
    const serviceByName = new Map(existing.map((s) => [s.name.toLowerCase(), s]));

    const neededCatalog = new Map<string, ServiceSpec>();
    for (const spec of Object.values(SERVICE_MAP)) neededCatalog.set(spec.catalog.toLowerCase(), spec);
    neededCatalog.set(MEMBER_ADDON.catalog.toLowerCase(), {
      catalog: MEMBER_ADDON.catalog, category: 'add_on', unit: 'AIRE', price: MEMBER_ADDON.price,
    });

    const createdServices: string[] = [];
    for (const [key, spec] of neededCatalog) {
      if (serviceByName.has(key)) continue;
      const id = randomUUID();
      if (!DRY_RUN) {
        await client.query(
          `INSERT INTO services (id, tenant_id, name, category, price, is_active, is_main_service, business_unit, outlet_ids)
           VALUES ($1,$2,$3,$4,$5,true,$6,$7,ARRAY[$8::uuid])`,
          [id, TENANT_ID, spec.catalog, spec.category, spec.price,
           spec.category === 'car_wash' && spec.unit === 'AIRE', spec.unit, outlet.id],
        );
      }
      serviceByName.set(key, { id, name: spec.catalog, price: String(spec.price) });
      createdServices.push(`${spec.catalog} (${spec.unit}, ${money(spec.price)})`);
    }
    console.log(`  Services: ${existing.length} existing, ${createdServices.length} created`);
    for (const s of createdServices) console.log(`    + ${s}`);

    const resolveService = (label: string): { id: string; price: number } | null => {
      const spec = SERVICE_MAP[label];
      const name = (spec?.catalog ?? label).toLowerCase();
      const hit = serviceByName.get(name);
      if (!hit) return null;
      return { id: hit.id, price: Number(hit.price) };
    };

    // ── catalog top-up: membership plans ─────────────────────────────────────
    // Only plans this outlet can actually sell are candidates. Matching on
    // duration alone is not enough: a tenant can hold a 1-month plan scoped to
    // a different region, and attaching this outlet's members to it would file
    // every card under the wrong branch's plan.
    const planRows = (await client.query<{ id: string; name: string; duration_months: number }>(
      `SELECT id, name, duration_months FROM membership_plans
        WHERE tenant_id = $1 AND (outlet_ids IS NULL OR $2 = ANY(outlet_ids))
        ORDER BY is_active DESC, created_at`,
      [TENANT_ID, outlet.id],
    )).rows;
    const planByMonths = new Map<number, string>();
    for (const p of planRows) {
      // Prefer the plan this import would itself have created, by name.
      const preferred = PLAN_SPECS[p.duration_months]?.name;
      if (!planByMonths.has(p.duration_months) || p.name === preferred) {
        planByMonths.set(p.duration_months, p.id);
      }
    }

    const monthsUsed = new Set<number>();
    for (const t of txns) {
      const m = t.memberCode ? Number(MEMBER_CODE.exec(t.memberCode)![2]) : null;
      if (m && PLAN_SPECS[m]) monthsUsed.add(m);
      if (t.kind.sale?.type === 'membership' && PLAN_SPECS[t.kind.sale.months]) monthsUsed.add(t.kind.sale.months);
    }
    const sheetPlanPrices = planPricesFromSheet(txns);
    for (const months of [...monthsUsed].sort((a, b) => a - b)) {
      if (planByMonths.has(months)) continue;
      const spec = PLAN_SPECS[months]!;
      const price = spec.sellable ? (sheetPlanPrices.get(months) ?? 0) : 0;
      const sellable = spec.sellable && price > 0;
      const id = randomUUID();
      if (!DRY_RUN) {
        await client.query(
          `INSERT INTO membership_plans
             (id, tenant_id, name, duration_months, max_uses, daily_limit, max_plates, price, is_active, outlet_ids)
           VALUES ($1,$2,$3,$4,$5,1,3,$6,$7,ARRAY[$8::uuid])`,
          [id, TENANT_ID, spec.name, months, months * 31, price, sellable, outlet.id],
        );
      }
      planByMonths.set(months, id);
      console.log(`    + plan ${spec.name} — ${sellable ? money(price) : 'created inactive (no price in the workbook)'}`);
    }

    // ── catalog top-up: voucher template ─────────────────────────────────────
    const washService = resolveService('CW');
    let voucherTemplateId = (await client.query<{ id: string }>(
      `SELECT id FROM voucher_templates WHERE tenant_id = $1 AND name = $2 LIMIT 1`,
      [TENANT_ID, VOUCHER_TEMPLATE_NAME],
    )).rows[0]?.id;
    if (!voucherTemplateId) {
      voucherTemplateId = randomUUID();
      // Sale price is per-row in the history; the template only needs to exist
      // so the pack sale has something to point at.
      if (!DRY_RUN) {
        await client.query(
          `INSERT INTO voucher_templates
             (id, tenant_id, name, type, value, max_uses, sale_price, validity_days, is_active, outlet_ids, service_ids)
           VALUES ($1,$2,$3,'service_pack',$4,$5,$6,90,true,ARRAY[$7::uuid],ARRAY[$8::uuid])`,
          [voucherTemplateId, TENANT_ID, VOUCHER_TEMPLATE_NAME, washService?.price ?? 60000,
           VOUCHER_PACK_SIZE, 399000, outlet.id, washService?.id],
        );
      }
      console.log(`    + voucher template ${VOUCHER_TEMPLATE_NAME} (${VOUCHER_PACK_SIZE}x)`);
    }

    // ── staff: the cashier of record, plus every agent named in the sheet ────
    const password = await bcrypt.hash('password123', 10);
    const cashierEmail = `kasir.${(outlet.code ?? OUTLET_CODE).toLowerCase()}@aire.local`;
    let operatorId: string;
    let operatorName = `Kasir ${outlet.name}`;
    if (DRY_RUN) {
      operatorId = randomUUID();
    } else {
      operatorId = (await client.query<{ id: string }>(
        `INSERT INTO users (tenant_id, outlet_id, email, password_hash, name, role, is_active)
         VALUES ($1,$2,$3,$4,$5,'cashier',true)
         ON CONFLICT (email) DO UPDATE SET outlet_id = EXCLUDED.outlet_id, is_active = true
         RETURNING id`,
        [TENANT_ID, outlet.id, cashierEmail, password, operatorName],
      )).rows[0]!.id;
    }

    const agentNames = [...new Set(txns.map((t) => t.agent).filter((a): a is string => !!a))].sort();
    const agentIds = new Map<string, string>();
    for (const name of agentNames) {
      const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}.${(outlet.code ?? OUTLET_CODE).toLowerCase()}@aire.local`;
      if (DRY_RUN) { agentIds.set(name, randomUUID()); continue; }
      const id = (await client.query<{ id: string }>(
        `INSERT INTO users (tenant_id, outlet_id, email, password_hash, name, role, is_active)
         VALUES ($1,$2,$3,$4,$5,'cashier',true)
         ON CONFLICT (email) DO UPDATE SET outlet_id = EXCLUDED.outlet_id, name = EXCLUDED.name, is_active = true
         RETURNING id`,
        [TENANT_ID, outlet.id, email, password, name],
      )).rows[0]!.id;
      agentIds.set(name, id);
    }
    console.log(`  Staff: cashier ${cashierEmail} + ${agentNames.length} agents (${agentNames.join(', ')})`);

    // ── customers ────────────────────────────────────────────────────────────
    // Identity is the normalized phone. A member card with no phone anywhere in
    // the workbook still gets a customer (the card is a real relationship); its
    // code stands in for the number, which is unsearchable but honest.
    interface CustomerDraft {
      id: string; name: string; phoneDisplay: string; phoneNormalized: string;
      firstSeen: Date; codes: Set<string>;
    }
    const customers = new Map<string, CustomerDraft>();
    const nameVotes = new Map<string, Map<string, number>>();
    const codeToKey = new Map<string, string>();

    const keyFor = (t: Txn): string | null => {
      if (t.phone) return t.phone.normalized;
      if (t.memberCode) return `code:${t.memberCode}`;
      return null;
    };

    for (const t of txns) {
      const key = keyFor(t);
      if (!key) continue;
      let c = customers.get(key);
      if (!c) {
        c = {
          id: randomUUID(),
          name: t.name ?? t.memberCode ?? 'Pelanggan',
          phoneDisplay: t.phone?.display ?? '-',
          phoneNormalized: t.phone?.normalized ?? key.replace(/^code:/, '').slice(0, 20),
          firstSeen: t.at,
          codes: new Set(),
        };
        customers.set(key, c);
      }
      if (t.at < c.firstSeen) c.firstSeen = t.at;
      if (t.memberCode) { c.codes.add(t.memberCode); codeToKey.set(t.memberCode, key); }
      if (t.name) {
        const votes = nameVotes.get(key) ?? new Map<string, number>();
        votes.set(t.name, (votes.get(t.name) ?? 0) + 1);
        nameVotes.set(key, votes);
      }
    }
    // The operator spells a regular's name a few ways; the most frequent wins.
    for (const [key, votes] of nameVotes) {
      const best = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      if (best) customers.get(key)!.name = best[0];
    }

    // ── memberships ──────────────────────────────────────────────────────────
    interface MembershipDraft {
      id: string; code: string; months: number; customerKey: string;
      start: string; end: string; uses: number;
      plates: Map<string, { plate: string; brand: string | null; model: string | null; at: Date }>;
      firstSeen: Date; lastSeen: Date;
    }
    const memberships = new Map<string, MembershipDraft>();
    for (const t of txns) {
      if (!t.memberCode) continue;
      const key = codeToKey.get(t.memberCode);
      if (!key) continue;
      const months = Number(MEMBER_CODE.exec(t.memberCode)![2]);
      if (!PLAN_SPECS[months]) { warn(`${t.sheet}!${t.sheetRow}: member code ${t.memberCode} has no known plan — treated as a plain sale`); continue; }
      let m = memberships.get(t.memberCode);
      if (!m) {
        m = {
          id: randomUUID(), code: t.memberCode, months, customerKey: key,
          start: '', end: '', uses: 0, plates: new Map(), firstSeen: t.at, lastSeen: t.at,
        };
        memberships.set(t.memberCode, m);
      }
      if (t.at < m.firstSeen) m.firstSeen = t.at;
      if (t.at > m.lastSeen) m.lastSeen = t.at;
      // The latest expiry the sheet ever shows is where the card actually runs to.
      if (t.expiry && (!m.end || t.expiry > m.end)) m.end = t.expiry;
      if (t.plate) {
        const prev = m.plates.get(t.plate.normalized);
        if (!prev || t.at < prev.at) {
          m.plates.set(t.plate.normalized, { plate: t.plate.plate, brand: t.brand, model: t.model, at: t.at });
        }
      }
      if (t.kind.coverage === 'membership' && !t.kind.sale) m.uses++;
    }
    const today = new Date().toISOString().slice(0, 10);
    for (const m of memberships.values()) {
      if (!m.end) {
        const end = new Date(m.firstSeen);
        end.setUTCMonth(end.getUTCMonth() + m.months);
        m.end = end.toISOString().slice(0, 10);
      }
      // A card cannot expire before the last wash it paid for. The sheet
      // sometimes carries a stale expiry (the operator copies the previous
      // line), which would otherwise produce a membership whose own usages
      // fall outside its validity.
      const lastSeenDay = m.lastSeen.toISOString().slice(0, 10);
      if (m.end < lastSeenDay) m.end = lastSeenDay;

      const start = new Date(`${m.end}T00:00:00Z`);
      start.setUTCMonth(start.getUTCMonth() - m.months);
      const firstSeenDay = m.firstSeen.toISOString().slice(0, 10);
      m.start = start.toISOString().slice(0, 10);
      if (m.start > firstSeenDay) m.start = firstSeenDay;
    }

    // ── voucher books ────────────────────────────────────────────────────────
    // A pack sale is ten tickets. The sheet records the code the customer was
    // handed; the other nine are derived (a '/' suffix that real codes never
    // contain, so they cannot collide with a code redeemed elsewhere).
    // Codes redeemed in-window that were sold BEFORE it get a per-month
    // carry-in book, so every redemption still points at a real ticket.
    interface BookDraft {
      id: string; buyerName: string | null; buyerPhone: string | null;
      quantity: number; unitPrice: number; expiry: string | null;
      orderId: string | null; at: Date; source: 'sale' | 'adhoc';
      tickets: { id: string; code: string; expiry: string | null }[];
    }
    const books: BookDraft[] = [];
    const ticketByCode = new Map<string, { id: string; bookId: string }>();

    const purchaseRows = txns.filter((t) => t.kind.sale?.type === 'voucher_pack');
    for (const t of purchaseRows) {
      const book: BookDraft = {
        id: randomUUID(),
        buyerName: t.name, buyerPhone: t.phone?.display ?? null,
        quantity: VOUCHER_PACK_SIZE,
        unitPrice: t.price > 0 ? t.price / VOUCHER_PACK_SIZE : 0,
        expiry: t.expiry, orderId: null, at: t.at, source: 'sale', tickets: [],
      };
      const base = t.voucherCode ?? `${outlet.code ?? OUTLET_CODE}-VRW-R${t.sheetRow}`;
      for (let i = 0; i < VOUCHER_PACK_SIZE; i++) {
        const code = i === 0 ? base : `${base}/${i + 1}`;
        if (ticketByCode.has(code)) continue;
        const ticket = { id: randomUUID(), code: code.slice(0, 40), expiry: t.expiry };
        book.tickets.push(ticket);
        ticketByCode.set(ticket.code, { id: ticket.id, bookId: book.id });
      }
      books.push(book);
    }

    const carryIn = new Map<string, BookDraft>();
    for (const t of txns) {
      if (t.kind.coverage !== 'voucher' || !t.voucherCode) continue;
      if (ticketByCode.has(t.voucherCode)) continue;
      const monthKey = t.at.toISOString().slice(0, 7);
      let book = carryIn.get(monthKey);
      if (!book) {
        book = {
          id: randomUUID(),
          buyerName: `Voucher terjual sebelum ${monthKey}`, buyerPhone: null,
          quantity: 0, unitPrice: 0, expiry: null, orderId: null,
          at: t.at, source: 'adhoc', tickets: [],
        };
        carryIn.set(monthKey, book);
        books.push(book);
      }
      const ticket = { id: randomUUID(), code: t.voucherCode.slice(0, 40), expiry: t.expiry };
      book.tickets.push(ticket);
      book.quantity++;
      ticketByCode.set(ticket.code, { id: ticket.id, bookId: book.id });
    }

    // ── orders ───────────────────────────────────────────────────────────────
    const orderRows: unknown[][] = [];
    const itemRows: unknown[][] = [];
    const tagRows: unknown[][] = [];
    const usageRows: unknown[][] = [];
    const renewalRows: unknown[][] = [];
    const redemptions: { ticketId: string; orderId: string; at: Date }[] = [];
    const bookOrder = new Map<string, string>();

    let seq = 0;
    let revenue = 0;
    const perSheet = new Map<string, number>();
    let unmappedServices = new Map<string, number>();

    for (const t of txns) {
      const orderId = randomUUID();
      seq++;
      const orderNumber = `${orderPrefix}${String(seq).padStart(6, '0')}`;
      const custKey = keyFor(t);
      const customer = custKey ? customers.get(custKey) : undefined;
      const membership = t.memberCode ? memberships.get(t.memberCode) : undefined;

      const items: unknown[][] = [];
      let sortOrder = 0;
      let charged = 0;

      const isNonWash = t.service.trim().toLowerCase() === NON_WASH.toLowerCase();
      const spec = SERVICE_MAP[t.service];
      const svc = isNonWash ? null : resolveService(t.service);
      if (!isNonWash && !svc) {
        unmappedServices.set(t.service, (unmappedServices.get(t.service) ?? 0) + 1);
        warn(`${t.sheet}!${t.sheetRow}: no catalog service for '${t.service}' — line omitted`);
      }

      // 1. The wash / service line, and who covered it.
      if (svc) {
        const coverable = t.kind.coverage !== 'charged' && (spec?.washLike ?? false);
        if (coverable) {
          // Covered: the line carries the catalog price and an equal discount, so
          // the order's net is what the till actually took.
          items.push([
            randomUUID(), orderId, svc.id, 1, svc.price, svc.price, 0,
            t.kind.coverage === 'membership', t.kind.coverage === 'membership' ? membership?.id ?? null : null,
            sortOrder++, 'service', null, null, null,
          ]);
        } else if (t.kind.coverage === 'complimentary') {
          items.push([
            randomUUID(), orderId, svc.id, 1, svc.price, svc.price, 0,
            false, null, sortOrder++, 'service', null, null, null,
          ]);
        } else if (!t.kind.sale) {
          // Charged outright: the row's price is the truth, not the catalog's.
          const line = t.price > 0 ? t.price : svc.price;
          items.push([
            randomUUID(), orderId, svc.id, 1, line, 0, line,
            false, null, sortOrder++, 'service', null, null, null,
          ]);
          charged += line;
        } else {
          // A membership/pack sale that also washed the car: the wash rides free.
          items.push([
            randomUUID(), orderId, svc.id, 1, svc.price, svc.price, 0,
            t.kind.coverage === 'membership', t.kind.coverage === 'membership' ? membership?.id ?? null : null,
            sortOrder++, 'service', null, null, null,
          ]);
        }
      }

      // 2. Whatever the row sold on top.
      if (t.kind.sale?.type === 'membership') {
        const planId = planByMonths.get(t.kind.sale.months);
        if (planId) {
          items.push([
            randomUUID(), orderId, null, 1, t.price, 0, t.price,
            false, null, sortOrder++, 'membership_plan',
            PLAN_SPECS[t.kind.sale.months]?.name ?? `Membership ${t.kind.sale.months} bulan`,
            planId, null,
          ]);
          charged += t.price;
        }
      } else if (t.kind.sale?.type === 'voucher_pack') {
        items.push([
          randomUUID(), orderId, null, 1, t.price, 0, t.price,
          false, null, sortOrder++, 'voucher_pack', VOUCHER_TEMPLATE_NAME, null, voucherTemplateId,
        ]);
        charged += t.price;
      } else if (t.price > 0 && charged === 0) {
        // A member or voucher wash with money on it: an add-on was charged.
        const addon = resolveService(MEMBER_ADDON.catalog);
        if (addon) {
          items.push([
            randomUUID(), orderId, addon.id, 1, t.price, 0, t.price,
            false, null, sortOrder++, 'service', null, null, null,
          ]);
          charged += t.price;
        }
      }

      // The sheet's PRICE column is the cash of record. If our lines disagree,
      // the sheet wins — a reconciliation line keeps the order total honest.
      if (Math.abs(charged - t.price) > 0.5) {
        const delta = t.price - charged;
        if (svc && delta !== 0) {
          items.push([
            randomUUID(), orderId, svc.id, 1, delta, 0, delta,
            false, null, sortOrder++, 'service', null, null, null,
          ]);
          charged += delta;
        }
      }

      const total = t.price;
      revenue += total;
      perSheet.set(t.sheet, (perSheet.get(t.sheet) ?? 0) + total);

      const businessUnit = spec?.unit ?? 'AIRE';
      const paidAt = t.at;
      const note = [
        `[import ${t.sheet}!${t.sheetRow}]`,
        t.status ? `status: ${t.status}` : null,
        t.notes && !t.memberCode && !t.voucherCode ? `catatan: ${t.notes}` : null,
        t.remarks ? `remarks: ${t.remarks}` : null,
      ].filter(Boolean).join(' ');

      orderRows.push([
        orderId, TENANT_ID, outlet.id, operatorId, customer?.id ?? null, orderNumber, 'completed',
        (customer?.name ?? t.name ?? '-').slice(0, 255),
        (customer?.phoneDisplay ?? '-').slice(0, 20),
        t.plate?.plate ?? null, t.brand, t.model,
        charged, 0, 0, 0, 0, total,
        t.payment?.method.slice(0, 20) ?? null,
        businessUnit,
        t.payment?.channel ?? businessUnit,
        t.agent ?? null,
        t.kind.coverage === 'membership' ? membership?.id ?? null : null,
        note, t.at, paidAt, paidAt, t.at,
        t.plate?.normalized ?? null,
      ]);
      itemRows.push(...items);
      tagRows.push([randomUUID(), orderId, t.kind.tag]);

      if (t.kind.coverage === 'membership' && membership && !t.kind.sale && t.plate) {
        usageRows.push([randomUUID(), membership.id, t.plate.normalized, orderId, t.at]);
      }
      if (t.kind.renewal && membership) {
        const planId = planByMonths.get(t.kind.sale?.type === 'membership' ? t.kind.sale.months : membership.months);
        if (planId) renewalRows.push([randomUUID(), TENANT_ID, orderId, membership.id, planId, true, t.at, t.at, membership.start]);
      }
      if (t.kind.coverage === 'voucher' && t.voucherCode) {
        const ticket = ticketByCode.get(t.voucherCode);
        if (ticket) redemptions.push({ ticketId: ticket.id, orderId, at: t.at });
      }
      if (t.kind.sale?.type === 'voucher_pack') {
        const book = books.find((b) => b.source === 'sale' && b.at === t.at && !b.orderId);
        if (book) { book.orderId = orderId; bookOrder.set(book.id, orderId); }
      }
    }

    // ── report ───────────────────────────────────────────────────────────────
    console.log(`\n  Reconstructed:`);
    console.log(`    customers   ${customers.size}`);
    console.log(`    memberships ${memberships.size} (${[...memberships.values()].reduce((n, m) => n + m.plates.size, 0)} plates, ${usageRows.length} usages, ${renewalRows.length} renewals)`);
    console.log(`    voucher     ${books.length} books, ${[...ticketByCode.keys()].length} tickets, ${redemptions.length} redemptions`);
    console.log(`    orders      ${orderRows.length} (${itemRows.length} items)`);
    console.log(`    revenue     ${money(revenue)}`);
    for (const [name, e] of expected) {
      const got = perSheet.get(name) ?? 0;
      const ok = Math.abs(got - e.revenue) < 1;
      console.log(`      ${name}: ${money(got)} vs sheet ${money(e.revenue)} ${ok ? '✓' : '✗ MISMATCH'}`);
      if (!ok) throw new Error(`Revenue mismatch on ${name} — refusing to import`);
    }
    if (unmappedServices.size > 0) {
      console.log(`\n  ! Unmapped service labels (rows kept, service line omitted):`);
      for (const [label, n] of [...unmappedServices].sort((a, b) => b[1] - a[1])) console.log(`      ${label} ×${n}`);
    }
    if (warnings.length > 0) {
      console.log(`\n  ! ${warnings.length} data warnings; first 10:`);
      for (const w of warnings.slice(0, 10)) console.log(`      ${w}`);
    }

    if (DRY_RUN) {
      console.log(`\n  DRY RUN — nothing written.\n`);
      return;
    }

    // ── write ────────────────────────────────────────────────────────────────
    console.log(`\n  Writing…`);
    await client.query('BEGIN');
    try {
      // Remove this import's own previous output. Orders first: they hold the
      // RESTRICT references to memberships and customers.
      const prior = await client.query<{ id: string }>(
        `SELECT id FROM orders WHERE tenant_id = $1 AND order_number LIKE $2`,
        [TENANT_ID, `${orderPrefix}%`],
      );
      if (prior.rows.length > 0) {
        console.log(`    clearing ${prior.rows.length} orders from a previous run`);
        await client.query(
          `DELETE FROM voucher_books WHERE tenant_id = $1
             AND (order_id IN (SELECT id FROM orders WHERE tenant_id=$1 AND order_number LIKE $2)
                  OR buyer_name LIKE 'Voucher terjual sebelum %')`,
          [TENANT_ID, `${orderPrefix}%`],
        );
        await client.query(`DELETE FROM orders WHERE tenant_id = $1 AND order_number LIKE $2`, [TENANT_ID, `${orderPrefix}%`]);
        await client.query(
          `DELETE FROM memberships WHERE tenant_id = $1 AND home_outlet_id = $2`,
          [TENANT_ID, outlet.id],
        );
        await client.query(
          `DELETE FROM customers WHERE tenant_id = $1 AND registered_outlet_id = $2`,
          [TENANT_ID, outlet.id],
        );
      }

      // `membership_number` is unique across the whole table, and a card code in
      // this workbook is not reliably unique to one phone — the operator typo'd
      // a digit on 79 of them, so two customers can both look like the holder.
      // Ownership therefore comes from codeToKey, which resolves each code to
      // exactly one customer; a customer that merely appears alongside someone
      // else's card gets no number rather than a colliding one.
      const ownedCodes = new Map<string, string[]>();
      for (const [code, key] of codeToKey) {
        const list = ownedCodes.get(key) ?? [];
        list.push(code);
        ownedCodes.set(key, list);
      }

      await bulkInsert(client, 'customers',
        ['id', 'tenant_id', 'name', 'phone', 'phone_normalized', 'registered_outlet_id', 'membership_number', 'created_at', 'updated_at'],
        [...customers.entries()].map(([key, c]) => {
          // The newest card is the one worth surfacing on the customer record.
          const code = (ownedCodes.get(key) ?? []).sort().pop() ?? null;
          return [c.id, TENANT_ID, c.name, c.phoneDisplay, c.phoneNormalized, outlet.id,
                  code && code.length <= 12 ? code : null, c.firstSeen, c.firstSeen];
        }));

      await bulkInsert(client, 'memberships',
        ['id', 'tenant_id', 'customer_id', 'plan_id', 'status', 'start_date', 'end_date', 'uses_count', 'max_uses', 'daily_limit', 'home_outlet_id', 'created_at', 'updated_at'],
        [...memberships.values()].map((m) => [
          m.id, TENANT_ID, customers.get(m.customerKey)!.id, planByMonths.get(m.months)!,
          m.end >= today ? 'active' : 'expired', m.start, m.end,
          m.uses, Math.max(m.months * 31, m.uses), 1, outlet.id, m.firstSeen, m.firstSeen,
        ]));

      await bulkInsert(client, 'membership_plates',
        ['id', 'membership_id', 'plate', 'plate_normalized', 'brand', 'model', 'created_at'],
        [...memberships.values()].flatMap((m) =>
          [...m.plates.entries()].map(([norm, p]) => [randomUUID(), m.id, p.plate, norm, p.brand, p.model, p.at])));

      await bulkInsert(client, 'orders',
        ['id', 'tenant_id', 'outlet_id', 'operator_id', 'customer_id', 'order_number', 'status',
         'customer_name', 'customer_phone', 'license_plate', 'vehicle_brand', 'vehicle_model',
         'subtotal', 'service_charge', 'tax', 'voucher_discount', 'promo_discount', 'total',
         'payment_method', 'business_unit', 'payment_channel', 'salesperson_name', 'membership_id',
         'note', 'created_at', 'paid_at', 'completed_at', 'updated_at', 'plate_normalized'],
        orderRows);

      await bulkInsert(client, 'order_items',
        ['id', 'order_id', 'service_id', 'quantity', 'unit_price', 'discount', 'subtotal',
         'is_member_pricing', 'membership_id', 'sort_order', 'item_type', 'item_name',
         'membership_plan_id', 'voucher_template_id'],
        itemRows);

      await bulkInsert(client, 'order_tags', ['id', 'order_id', 'tag'], tagRows);
      await bulkInsert(client, 'membership_usages',
        ['id', 'membership_id', 'plate_normalized', 'order_id', 'used_at'], usageRows);
      await bulkInsert(client, 'membership_renewals',
        ['id', 'tenant_id', 'order_id', 'membership_id', 'plan_id', 'applied', 'created_at', 'applied_at', 'next_start_date'],
        renewalRows);

      await bulkInsert(client, 'voucher_books',
        ['id', 'tenant_id', 'outlet_id', 'buyer_name', 'buyer_phone', 'quantity', 'benefit_type',
         'benefit_service_id', 'benefit_value', 'unit_price', 'expiry_date', 'order_id', 'template_id', 'source', 'created_at'],
        books.map((b) => [b.id, TENANT_ID, outlet.id, b.buyerName, b.buyerPhone, b.quantity, 'service',
                          washService?.id ?? null, washService?.price ?? 0, b.unitPrice, b.expiry,
                          b.orderId, voucherTemplateId, b.source, b.at]));

      await bulkInsert(client, 'voucher_tickets',
        ['id', 'tenant_id', 'book_id', 'outlet_id', 'code', 'status', 'expiry_date', 'created_at'],
        books.flatMap((b) => b.tickets.map((t) => [t.id, TENANT_ID, b.id, outlet.id, t.code, 'active', t.expiry, b.at])));

      // Mark redemptions. A code the sheet reused is redeemed once, at its
      // first use — a ticket cannot be spent twice.
      const seenTicket = new Set<string>();
      const redeemRows = redemptions
        .sort((a, b) => a.at.getTime() - b.at.getTime())
        .filter((r) => !seenTicket.has(r.ticketId) && seenTicket.add(r.ticketId));
      for (let i = 0; i < redeemRows.length; i += 400) {
        const slice = redeemRows.slice(i, i + 400);
        const params: unknown[] = [];
        const tuples = slice.map((r) => {
          params.push(r.ticketId, r.orderId, r.at);
          return `($${params.length - 2}::uuid,$${params.length - 1}::uuid,$${params.length}::timestamptz)`;
        });
        await client.query(
          `UPDATE voucher_tickets vt SET status='redeemed', redeemed_at=v.at,
                  redeemed_order_id=v.order_id, redeemed_outlet_id=$${params.length + 1}
             FROM (VALUES ${tuples.join(',')}) AS v(id, order_id, at)
            WHERE vt.id = v.id`,
          [...params, outlet.id],
        );
      }

      await client.query('COMMIT');
      console.log(`    ✓ committed`);
      console.log(`      ${redeemRows.length} vouchers marked redeemed (${redemptions.length - redeemRows.length} repeat scans ignored)`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }

    // ── verify against the database, not our own arithmetic ──────────────────
    const check = await client.query<{ month: string; orders: string; revenue: string }>(
      `SELECT to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') AS month,
              COUNT(*)::text AS orders, COALESCE(SUM(total),0)::text AS revenue
         FROM orders
        WHERE tenant_id = $1 AND order_number LIKE $2
          AND status IN ('paid','confirmed','completed')
        GROUP BY 1 ORDER BY 1`,
      [TENANT_ID, `${orderPrefix}%`],
    );
    console.log(`\n  In the database now:`);
    for (const r of check.rows) console.log(`    ${r.month}: ${r.orders} orders, ${money(Number(r.revenue))}`);
    console.log(`\n✓ Import complete.\n`);
  } finally {
    await client.end();
  }
}

run().catch((e) => {
  console.error('\n✗ Import failed:', e instanceof Error ? e.message : e);
  if (e instanceof Error && e.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n'));
  process.exitCode = 1;
});
