/**
 * Tiny dependency-free CSV helpers for import/export + downloadable templates.
 * Handles quoted fields, embedded commas/quotes/newlines, and a leading header row.
 */

/** Escape one cell: wrap in quotes when it contains a comma, quote, or newline. */
function escapeCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build CSV text from objects, one column per `columns` entry (in order). */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.map(escapeCell).join(',');
  const body = rows.map((r) => columns.map((c) => escapeCell(r[c])).join(',')).join('\r\n');
  return body ? `${header}\r\n${body}` : header;
}

/** Parse CSV text into an array of row objects keyed by the header row (trimmed, lower-cased). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const src = text.replace(/^﻿/, ''); // strip BOM
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
  if (rows.length === 0) return [];

  const headers = rows[0]!.map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = (cells[idx] ?? '').trim(); });
    return obj;
  });
}

/** Trigger a browser download of CSV text. */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

/** Read a File (from an <input type=file>) as text. */
export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
