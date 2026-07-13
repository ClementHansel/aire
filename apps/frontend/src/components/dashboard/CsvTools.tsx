'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toCsv, parseCsv, downloadCsv, readFileText } from '@/lib/csv';

export interface CsvColumn { key: string; label: string; required?: boolean; example?: string }

/** Download a CSV with just the header row + one example row, as a fill-in template. */
export function downloadTemplate(filename: string, columns: CsvColumn[]) {
  const example: Record<string, unknown> = {};
  columns.forEach((c) => { example[c.key] = c.example ?? ''; });
  downloadCsv(filename, toCsv([example], columns.map((c) => c.key)));
}

/** Export the given rows to CSV using the column keys (rows must already expose those keys). */
export function exportRows(filename: string, rows: Record<string, unknown>[], columns: CsvColumn[]) {
  downloadCsv(filename, toCsv(rows, columns.map((c) => c.key)));
}

interface ImportResult { created: number; updated: number; skipped: number; errors: string[] }

/**
 * Generic CSV import dialog: pick a file → parse client-side → POST { rows } to `endpoint`.
 * `mapRow` maps a parsed CSV row (keys are the lower-cased header names) to the API shape.
 */
export function CsvImportModal({ title, columns, endpoint, templateName, mapRow, onClose, onDone }: {
  title: string;
  columns: CsvColumn[];
  endpoint: string;
  templateName: string;
  mapRow: (row: Record<string, string>) => Record<string, unknown>;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [parsed, setParsed] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  const onFile = async (f?: File | null) => {
    if (!f) return;
    setFileName(f.name); setErr(''); setResult(null); setParsed(null);
    try { setParsed(parseCsv(await readFileText(f))); }
    catch (e) { setErr(e instanceof Error ? e.message : t('dash.csv.readError', 'Failed to read file')); }
  };

  const doImport = async () => {
    if (!parsed || parsed.length === 0) { setErr(t('dash.csv.noRows', 'No data rows found in the file')); return; }
    setBusy(true); setErr('');
    try {
      const res = await api.post<ImportResult>(endpoint, { rows: parsed.map(mapRow) });
      setResult(res);
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : t('dash.csv.importFailed', 'Import failed')); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="section-title">{title}</h3>
          <button className="text-text-muted hover:text-text-primary" onClick={onClose}>✕</button>
        </div>

        {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-sm text-red-700 mb-3">{err}</div>}

        <p className="text-sm text-text-secondary mb-2">{t('dash.csv.expectedCols', 'Expected columns (header row):')}</p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {columns.map((c) => (
            <span key={c.key} className="badge bg-surface-sunken text-text-secondary font-mono text-xs">{c.key}{c.required ? ' *' : ''}</span>
          ))}
        </div>
        <button className="btn-secondary text-sm mb-4" onClick={() => downloadTemplate(templateName, columns)}>{t('dash.csv.downloadTemplate', 'Download template')}</button>

        <label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.csv.chooseFile', 'CSV file')}</label>
        <input type="file" accept=".csv,text/csv" className="block w-full text-sm mb-3 file:btn-secondary file:mr-3" onChange={(e) => onFile(e.target.files?.[0])} />
        {fileName && parsed && !result && <p className="text-sm text-text-secondary mb-3">{fileName} · {parsed.length} {t('dash.csv.rowsFound', 'row(s) found')}</p>}

        {result && (
          <div className="rounded-lg border border-border bg-surface-sunken/40 p-3 mb-3 text-sm">
            <p className="text-green-600 font-medium mb-1">{t('dash.csv.done', 'Import complete')}</p>
            <p>{t('dash.csv.created', 'Created')}: {result.created} · {t('dash.csv.updated', 'Updated')}: {result.updated}{result.skipped ? ` · ${t('dash.csv.skipped', 'Skipped')}: ${result.skipped}` : ''}</p>
            {result.errors.length > 0 && (
              <ul className="mt-2 max-h-32 overflow-y-auto text-xs text-amber-700 list-disc pl-4">
                {result.errors.slice(0, 50).map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-2">
          <button className="btn-secondary" onClick={onClose}>{result ? t('dash.csv.close', 'Close') : t('dash.csv.cancel', 'Cancel')}</button>
          {!result && <button className="btn-primary" onClick={doImport} disabled={busy || !parsed}>{busy ? t('dash.csv.importing', 'Importing…') : t('dash.csv.import', 'Import')}</button>}
        </div>
      </div>
    </div>
  );
}
