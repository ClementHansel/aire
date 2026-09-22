/**
 * Minimal XLSX reader — shared by the spreadsheet importers.
 *
 * A workbook is a zip of XML. We need three things out of it — the sheet order,
 * the shared-string table, and the cell values — so rather than take on a
 * spreadsheet dependency (and, with it, a place for real customer names and
 * phone numbers to leak into a lockfile-pinned third party), we unzip with the
 * built-in inflater and scan the XML we need.
 *
 * Extracted verbatim from `import-pos-history.ts`, which was its only caller
 * until the price-list importer needed the same three things.
 */
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

/** Read a zip's central directory and inflate every entry. */
export function unzip(buf: Buffer): Map<string, Buffer> {
  const EOCD_SIG = 0x06054b50;
  const CDIR_SIG = 0x02014b50;
  let eocd = -1;
  // The end-of-central-directory record lives in the last 64KB + 22 bytes.
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip/xlsx file (no end-of-central-directory record)');

  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== CDIR_SIG) throw new Error('Corrupt zip central directory');
    const method = buf.readUInt16LE(off + 10);
    const compressedSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);

    // The local header repeats the name/extra with possibly different lengths.
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressedSize);
    out.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));

    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function unescapeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** The shared-string table: one entry per <si>, joining its text runs. */
export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const si = /<si(?:\s[^>]*)?\/>|<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = si.exec(xml))) {
    if (m[1] === undefined) { out.push(''); continue; }
    let text = '';
    const t = /<t(?:\s[^>]*)?\/>|<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let tm: RegExpExecArray | null;
    while ((tm = t.exec(m[1]))) text += unescapeXml(tm[1] ?? '');
    out.push(text);
  }
  return out;
}

export type Cell = string | number | null;
export type Row = Map<string, Cell>;

/** Cell values per row, keyed by column letter. Formulas yield their cached value. */
export function parseSheet(xml: string, shared: string[]): Map<number, Row> {
  const rows = new Map<number, Row>();
  const rowRe = /<row[^>]*\sr="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
  const cellRe = /<c[^>]*\sr="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let rm: RegExpExecArray | null;

  while ((rm = rowRe.exec(xml))) {
    const rowNum = Number(rm[1]);
    const body = rm[2];
    if (!body) continue;
    const row: Row = new Map();
    let cm: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cm = cellRe.exec(body))) {
      const col = cm[1]!;
      const attrs = cm[2] ?? '';
      const inner = cm[3] ?? '';
      const type = /\st="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
      let value: Cell = null;

      if (type === 'inlineStr') {
        let text = '';
        const t = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
        let tm: RegExpExecArray | null;
        while ((tm = t.exec(inner))) text += unescapeXml(tm[1] ?? '');
        value = text;
      } else {
        const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (v !== undefined && v !== '') {
          if (type === 's') value = shared[Number(v)] ?? null;
          else if (type === 'str') value = unescapeXml(v);
          else if (type === 'b') value = v === '1' ? 1 : 0;
          else value = Number(v);
        }
      }
      if (value !== null && value !== '') row.set(col, value);
    }
    if (row.size > 0) rows.set(rowNum, row);
  }
  return rows;
}

/** Sheets in workbook order, with their names. */
export function readWorkbook(path: string): { name: string; rows: Map<number, Row> }[] {
  const entries = unzip(readFileSync(path));
  const wb = entries.get('xl/workbook.xml');
  if (!wb) throw new Error('xl/workbook.xml missing — not an xlsx workbook');
  const wbXml = wb.toString('utf8');
  const relsXml = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';

  // sheet name → relationship id → target part
  const relTarget = new Map<string, string>();
  const relRe = /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
  let r: RegExpExecArray | null;
  while ((r = relRe.exec(relsXml))) relTarget.set(r[1]!, r[2]!);

  const shared = entries.has('xl/sharedStrings.xml')
    ? parseSharedStrings(entries.get('xl/sharedStrings.xml')!.toString('utf8'))
    : [];

  const out: { name: string; rows: Map<number, Row> }[] = [];
  const sheetRe = /<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/?>/g;
  let s: RegExpExecArray | null;
  while ((s = sheetRe.exec(wbXml))) {
    const name = unescapeXml(s[1]!);
    let target = relTarget.get(s[2]!) ?? '';
    if (!target) continue;
    target = target.replace(/^\/?(xl\/)?/, 'xl/');
    const part = entries.get(target);
    if (!part) continue;
    out.push({ name, rows: parseSheet(part.toString('utf8'), shared) });
  }
  return out;
}
