/**
 * Price-list import — turn a client's price sheet into sellable catalog rows.
 *
 * Written for Kalibrasi's "Price List Draft.xlsx" (144 calibration items across
 * eight measurement scopes), but the sheet contract is deliberately generic:
 * one header row naming the columns, one item per row after it. Columns are
 * matched BY HEADER TEXT, not by position, so a client who reorders or inserts
 * a column does not silently shift every price by one field.
 *
 * What it writes, per row:
 *   services.name         ← the instrument / item name
 *   services.description  ← the qualifier (measuring range, what is covered)
 *   services.price        ← the price
 *   services.category_id  ← a product_category per scope ("Kelistrikan", …)
 *   services.business_unit← the unit given by --unit
 *
 * Two decisions worth knowing:
 *
 *  - ROWS WITH NO PRICE ARE STILL IMPORTED, as inactive. Kalibrasi's sheet
 *    lists 40 items it services but has not priced (Centrifuge, Micrometer,
 *    every "Panjang" row). Dropping them would make the assistant answer "we do
 *    not do micrometers", which is false and costs a sale; importing them at
 *    price 0 would make it quote free calibration, which is worse. Inactive
 *    keeps them out of the customer price tool and out of POS, while the row
 *    exists for the owner to price later. Use --include-unpriced=false to skip.
 *
 *  - IT IS RE-RUNNABLE. Matching is on (tenant, business_unit, name,
 *    description), the natural key of a price-list line — the same instrument at
 *    a different range is a different product at a different price, so the range
 *    is part of the identity. A second run updates prices in place rather than
 *    duplicating the catalog. Nothing is ever deleted: a row that disappears
 *    from the sheet is reported, not removed, because it may carry sales history.
 *
 * Usage:
 *   PRICE_XLSX="/path/Price List Draft.xlsx" TENANT_ID=… pnpm --filter @aire/database import:prices -- --dry-run
 *   PRICE_XLSX="…" TENANT_ID=… UNIT=KAL pnpm --filter @aire/database import:prices
 *
 * Env / flags:
 *   PRICE_XLSX        path to the workbook                        (required)
 *   TENANT_ID         target tenant                               (required)
 *   DATABASE_URL      connection string (or standard PG* vars)
 *   UNIT              business_unit code for the rows             (default: the
 *                     tenant's first business unit by sort_order)
 *   SHEET             sheet name to read                          (default: first)
 *   DRY_RUN=1         parse and report, write nothing             (also --dry-run)
 *   --include-unpriced=false   skip rows with no price instead of importing them inactive
 */

import pg from 'pg';
import { readWorkbook, type Cell, type Row } from './xlsx-reader.js';

const { Client } = pg;

const XLSX_PATH = process.env.PRICE_XLSX || '';
const TENANT_ID = process.env.TENANT_ID || '';
const SHEET_NAME = process.env.SHEET || '';
const UNIT_CODE = process.env.UNIT || '';
const DRY_RUN = process.env.DRY_RUN === '1' || process.argv.includes('--dry-run');
const INCLUDE_UNPRICED = !process.argv.includes('--include-unpriced=false');

/**
 * Header text → the field it feeds. Matched case-insensitively as a SUBSTRING
 * of the header cell, because real sheets carry trailing spaces, line breaks
 * and parentheses ("Nama Alat ", "Jenis Alat Ukur (Lingkup)").
 *
 * Order matters within a field: the first alias that matches wins, so put the
 * more specific alias first. `group` is checked before `name` for exactly this
 * reason — "Jenis Alat Ukur (Lingkup)" contains "alat" and would otherwise be
 * read as the name column.
 */
type Field = 'group' | 'name' | 'range' | 'price';
/** Which spreadsheet column letter feeds each field, once the header is found. */
type ColumnMap = Partial<Record<Field, string>>;

const HEADERS: { field: Field; aliases: string[] }[] = [
  { field: 'group', aliases: ['lingkup', 'scope', 'kategori', 'category', 'group'] },
  { field: 'range', aliases: ['rentang', 'range', 'kapasitas', 'spesifikasi', 'keterangan'] },
  { field: 'price', aliases: ['harga', 'price', 'tarif', 'biaya'] },
  { field: 'name', aliases: ['nama alat', 'nama', 'item', 'layanan', 'service', 'produk', 'alat'] },
];

interface ParsedRow {
  group: string | null;
  name: string;
  range: string | null;
  price: number | null;
  sheetRow: number;
}

function text(v: Cell): string {
  if (v === null || v === undefined) return '';
  // Quoted cells arrive from Excel with the quotes intact ("\"Stopwatch, Timer\"").
  return String(v).trim().replace(/^"(.*)"$/s, '$1').trim();
}

function nullable(v: Cell): string | null {
  const s = text(v);
  return s === '' || s === '-' ? null : s;
}

/** Locate the header row and map each field to its column letter. */
function findHeader(rows: Map<number, Row>): { headerRow: number; cols: ColumnMap } {
  const numbers = [...rows.keys()].sort((a, b) => a - b);
  // Scan the first 20 rows: sheets routinely open with a banner and a blank line.
  for (const n of numbers.slice(0, 20)) {
    const row = rows.get(n)!;
    const cols: ColumnMap = {};
    const taken = new Set<string>();
    for (const { field, aliases } of HEADERS) {
      // Aliases OUTSIDE, columns inside. The other nesting lets column order
      // beat alias specificity: on Kalibrasi's sheet the generic alias "alat"
      // matched "Jenis Alat Ukur (Lingkup)" in column D before the specific
      // "nama alat" was ever tried against "Nama Alat" in column E. Column D is
      // blank on most rows, so the import silently read 41 of 144 items.
      let found: string | undefined;
      for (const alias of aliases) {
        for (const [col, cell] of row.entries()) {
          if (taken.has(col)) continue;
          const h = text(cell).toLowerCase();
          if (h && h.includes(alias)) { found = col; break; }
        }
        if (found) break;
      }
      if (found) { cols[field] = found; taken.add(found); }
    }
    // A name and a price are the minimum that makes a price list a price list.
    if (cols.name && cols.price) return { headerRow: n, cols };
  }
  throw new Error(
    'Could not find a header row with a name column and a price column in the first 20 rows. '
    + `Expected a header containing one of ${HEADERS.find((h) => h.field === 'name')!.aliases.join('/')} and one of harga/price.`,
  );
}

function parsePrice(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  const s = text(v);
  if (!s) return null;
  // "Rp 1.250.000" / "1,250,000" / "1250000". Strip currency and thousands
  // separators; a sheet that means 1.5 would write it as 1500000 anyway.
  const digits = s.replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseRows(rows: Map<number, Row>): ParsedRow[] {
  const { headerRow, cols } = findHeader(rows);
  const out: ParsedRow[] = [];
  // The scope column is written once per block and left blank on the rows
  // beneath it in plenty of sheets, so carry the last non-empty value forward.
  let lastGroup: string | null = null;

  for (const n of [...rows.keys()].sort((a, b) => a - b)) {
    if (n <= headerRow) continue;
    const row = rows.get(n)!;
    const name = text(row.get(cols.name!) ?? null);
    if (!name) continue;

    const group: string | null = (cols.group ? nullable(row.get(cols.group) ?? null) : null) ?? lastGroup;
    if (group) lastGroup = group;

    out.push({
      group,
      name,
      range: cols.range ? nullable(row.get(cols.range) ?? null) : null,
      price: cols.price ? parsePrice(row.get(cols.price) ?? null) : null,
      sheetRow: n,
    });
  }
  return out;
}

async function resolveBusinessUnit(client: pg.Client): Promise<string> {
  if (UNIT_CODE) {
    const r = await client.query('SELECT code FROM business_units WHERE tenant_id = $1 AND code = $2', [TENANT_ID, UNIT_CODE]);
    if (r.rowCount === 0) {
      const all = await client.query('SELECT code FROM business_units WHERE tenant_id = $1 ORDER BY sort_order, code', [TENANT_ID]);
      throw new Error(
        `Business unit "${UNIT_CODE}" does not exist for this tenant. `
        + `Available: ${all.rows.map((x) => x.code).join(', ') || '(none — seed business units first)'}`,
      );
    }
    return UNIT_CODE;
  }
  const r = await client.query('SELECT code FROM business_units WHERE tenant_id = $1 ORDER BY sort_order, code LIMIT 1', [TENANT_ID]);
  if (r.rowCount === 0) throw new Error('Tenant has no business units; seed them before importing a price list.');
  return r.rows[0].code as string;
}

/** Upsert a product_category per scope, returning name → id. */
async function ensureCategories(client: pg.Client, names: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let sort = 0;
  for (const name of names) {
    const r = await client.query(
      `INSERT INTO product_categories (tenant_id, name, sort_order)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, name) DO UPDATE SET is_active = true
       RETURNING id`,
      [TENANT_ID, name, sort++],
    );
    map.set(name, r.rows[0].id as string);
  }
  return map;
}

async function run(): Promise<void> {
  if (!XLSX_PATH) throw new Error('PRICE_XLSX is required (path to the price-list workbook)');
  if (!TENANT_ID) throw new Error('TENANT_ID is required');

  const sheets = readWorkbook(XLSX_PATH);
  const sheet = SHEET_NAME ? sheets.find((s) => s.name === SHEET_NAME) : sheets[0];
  if (!sheet) {
    throw new Error(`Sheet "${SHEET_NAME}" not found. Available: ${sheets.map((s) => s.name).join(', ')}`);
  }

  const parsed = parseRows(sheet.rows);
  const priced = parsed.filter((r) => r.price !== null);
  const unpriced = parsed.filter((r) => r.price === null);
  const groups = [...new Set(parsed.map((r) => r.group).filter((g): g is string => !!g))];

  console.log(`Sheet "${sheet.name}": ${parsed.length} items (${priced.length} priced, ${unpriced.length} without a price)`);
  console.log(`Scopes: ${groups.join(', ') || '(none)'}`);
  if (unpriced.length && INCLUDE_UNPRICED) {
    console.log(`  ${unpriced.length} unpriced rows will be imported INACTIVE (price 0) so the owner can price them later.`);
    console.log(`  They stay out of POS and out of what the assistant quotes. Pass --include-unpriced=false to skip them entirely.`);
  }

  const toImport = INCLUDE_UNPRICED ? parsed : priced;
  if (toImport.length === 0) throw new Error('Nothing to import.');

  // Duplicate natural keys would make the upsert non-deterministic (last write
  // wins, silently), so surface them rather than picking one.
  const seen = new Map<string, number>();
  for (const r of toImport) {
    const key = `${r.name}|${r.range ?? ''}`.toLowerCase();
    const prev = seen.get(key);
    if (prev !== undefined) {
      console.warn(`  ! duplicate: row ${r.sheetRow} repeats row ${prev} ("${r.name}"${r.range ? ` / ${r.range}` : ''}) — the later price wins`);
    }
    seen.set(key, r.sheetRow);
  }

  if (DRY_RUN) {
    console.log('\nDRY RUN — nothing written. First 10 rows as they would be imported:');
    for (const r of toImport.slice(0, 10)) {
      console.log(`  [${r.group ?? '-'}] ${r.name}${r.range ? ` (${r.range})` : ''} = ${r.price === null ? 'NO PRICE → inactive' : `Rp ${r.price.toLocaleString('id-ID')}`}`);
    }
    return;
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const unit = await resolveBusinessUnit(client);
    const categories = await ensureCategories(client, groups);

    let inserted = 0;
    let updated = 0;
    let sortOrder = 0;

    for (const r of toImport) {
      const categoryId = r.group ? categories.get(r.group) ?? null : null;
      const active = r.price !== null;
      // The natural key of a price-list line: an instrument at a different
      // range is a different product at a different price, so the range is part
      // of the identity, not a detail hanging off it.
      const existing = await client.query(
        `SELECT id FROM services
          WHERE tenant_id = $1 AND business_unit = $2 AND name = $3
            AND COALESCE(description, '') = COALESCE($4, '')
          LIMIT 1`,
        [TENANT_ID, unit, r.name, r.range],
      );

      if (existing.rowCount && existing.rows[0]) {
        await client.query(
          `UPDATE services
              SET price = $1, category_id = $2, sort_order = $3, is_active = $4,
                  deleted_at = NULL, updated_at = NOW()
            WHERE id = $5`,
          [r.price ?? 0, categoryId, sortOrder++, active, existing.rows[0].id],
        );
        updated++;
      } else {
        await client.query(
          `INSERT INTO services
             (tenant_id, name, description, category, business_unit, price, is_active, is_main_service, sort_order, category_id)
           VALUES ($1, $2, $3, 'car_wash', $4, $5, $6, true, $7, $8)`,
          [TENANT_ID, r.name, r.range, unit, r.price ?? 0, active, sortOrder++, categoryId],
        );
        inserted++;
      }
    }

    // Report, never delete: a catalog row dropped from the sheet may still
    // carry sales history, and this script has no business deciding that.
    const stale = await client.query(
      `SELECT name, description FROM services
        WHERE tenant_id = $1 AND business_unit = $2 AND deleted_at IS NULL
          AND NOT (name = ANY($3::text[]))`,
      [TENANT_ID, unit, toImport.map((r) => r.name)],
    );

    await client.query('COMMIT');
    console.log(`\nImported into business unit ${unit}: ${inserted} new, ${updated} updated.`);
    console.log(`Scopes created/reused as product categories: ${groups.length}`);
    if (stale.rowCount) {
      console.log(`\n${stale.rowCount} existing service(s) in ${unit} are NOT in this sheet (left untouched):`);
      for (const row of stale.rows.slice(0, 20)) console.log(`  - ${row.name}${row.description ? ` (${row.description})` : ''}`);
      if (stale.rowCount > 20) console.log(`  … and ${stale.rowCount - 20} more`);
      console.log('Remove any you no longer sell from the Services page — Delete there keeps the sales history.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
