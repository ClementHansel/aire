'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { currentTenantId } from '@/lib/settings';
import { Panel, Spinner, ErrorBanner } from '@/components/dashboard/ui';

/* ── Types (mirror the backend catalogue) ───────────────────────────── */

interface TemplateVariable {
  name: string;
  description: string;
  sample: string;
  optional?: boolean;
}

interface TemplateView {
  key: string;
  title: string;
  category: string;
  audience: string;
  trigger: string;
  variables: TemplateVariable[];
  defaultBody: string;
  canDisable: boolean;
  lockedReason?: string;
  inactive?: boolean;
  body: string;
  enabled: boolean;
  customized: boolean;
  updatedAt: string | null;
  preview: string;
}

interface ListResponse {
  templates: TemplateView[];
  categoryLabels: Record<string, string>;
  audienceLabels: Record<string, string>;
}

/* ── Preview rendering (mirrors the backend's fillTemplate) ─────────── */

/**
 * The live preview must agree with what the customer receives, so this repeats
 * the server's substitution rules exactly: fill `{vars}`, drop a line whose
 * placeholders are all empty when at least one is optional, and tidy the seam a
 * removed variable leaves behind.
 *
 * The server remains the authority — the editor re-fetches its preview on save —
 * but doing it locally keeps typing instant.
 */
function fillTemplate(body: string, vars: Record<string, string>, optional: Set<string>): string {
  const value = (n: string) => vars[n] ?? '';
  const lines = body.split('\n').flatMap((line) => {
    const names = [...line.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]!);
    const allEmpty = names.length > 0 && names.every((n) => value(n).trim() === '');
    if (allEmpty && names.some((n) => optional.has(n))) return [];
    const hadEmpty = names.some((n) => value(n).trim() === '');
    let filled = line.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_, n: string) => value(n));
    if (hadEmpty) filled = filled.replace(/ {2,}/g, ' ').replace(/ +([!?,.:;])/g, '$1').trimEnd();
    return filled.split('\n');
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '').trim();
}

/** Turn WhatsApp `*bold*` / `_italic_` into markup, for the preview bubble only. */
function waMarkup(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>');
}

/* ── Section ─────────────────────────────────────────────────────────── */

export default function NotificationsSection() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loadError, setLoadError] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      setData(await api.get<ListResponse>(`/notification-templates/${currentTenantId()}`));
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'Gagal memuat daftar notifikasi.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => {
    if (!data) return [];
    const order: string[] = [];
    const byCat = new Map<string, TemplateView[]>();
    for (const t of data.templates) {
      if (!byCat.has(t.category)) { byCat.set(t.category, []); order.push(t.category); }
      byCat.get(t.category)!.push(t);
    }
    return order.map((c) => ({ category: c, label: data.categoryLabels[c] ?? c, items: byCat.get(c)! }));
  }, [data]);

  if (loadError) return <ErrorBanner message={loadError} onDismiss={() => setLoadError('')} />;
  if (!data) return <div className="flex justify-center py-12"><Spinner /></div>;

  const customized = data.templates.filter((t) => t.customized).length;
  const disabled = data.templates.filter((t) => !t.enabled).length;

  return (
    <div className="space-y-4">
      <Panel
        title="Notifikasi otomatis"
        description={
          `${data.templates.length} pesan otomatis · ${customized} sudah diubah · ${disabled} dimatikan. ` +
          'Klik salah satu untuk melihat kapan pesan itu dikirim dan mengubah isinya.'
        }
      >
        <p className="text-xs text-text-muted">
          Kata dalam kurung kurawal seperti <code className="rounded bg-surface-sunken px-1">{'{customerName}'}</code> akan
          diganti otomatis saat pesan dikirim. Baris yang hanya berisi variabel opsional akan hilang sendiri
          bila datanya kosong — jadi Anda tidak perlu menulis kondisi apa pun.
        </p>
      </Panel>

      {grouped.map((g) => (
        <Panel key={g.category} title={g.label} bodyClassName="divide-y divide-border">
          {g.items.map((t) => (
            <TemplateRow
              key={t.key}
              template={t}
              audienceLabel={data.audienceLabels[t.audience] ?? t.audience}
              open={openKey === t.key}
              onToggle={() => setOpenKey(openKey === t.key ? null : t.key)}
              onSaved={load}
            />
          ))}
        </Panel>
      ))}
    </div>
  );
}

/* ── One notification ────────────────────────────────────────────────── */

function TemplateRow({
  template, audienceLabel, open, onToggle, onSaved,
}: {
  template: TemplateView;
  audienceLabel: string;
  open: boolean;
  onToggle: () => void;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(template.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [testPhone, setTestPhone] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);

  // A reload after saving replaces the template object; re-sync the draft unless
  // the owner is mid-edit (dirty), which must never be clobbered.
  const dirty = draft !== template.body;
  useEffect(() => { if (!dirty) setDraft(template.body); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [template.body]);

  const optional = useMemo(
    () => new Set(template.variables.filter((v) => v.optional).map((v) => v.name)),
    [template.variables],
  );
  const samples = useMemo(
    () => Object.fromEntries(template.variables.map((v) => [v.name, v.sample])),
    [template.variables],
  );

  const unknown = useMemo(() => {
    const allowed = new Set(template.variables.map((v) => v.name));
    const found = [...draft.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]!);
    return [...new Set(found.filter((f) => !allowed.has(f)))];
  }, [draft, template.variables]);

  const preview = useMemo(() => fillTemplate(draft, samples, optional), [draft, samples, optional]);

  const locked = !!template.lockedReason;

  const call = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await fn();
      await onSaved();
      setNotice(ok);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal menyimpan.');
    } finally {
      setBusy(false);
    }
  };

  const save = () => call(
    () => api.put(`/notification-templates/${currentTenantId()}/${template.key}`, { body: draft }),
    'Tersimpan.',
  );

  const reset = () => call(async () => {
    await api.delete(`/notification-templates/${currentTenantId()}/${template.key}`);
    setDraft(template.defaultBody);
  }, 'Dikembalikan ke teks bawaan.');

  const toggleEnabled = () => call(
    () => api.put(`/notification-templates/${currentTenantId()}/${template.key}`, { enabled: !template.enabled }),
    template.enabled ? 'Notifikasi dimatikan.' : 'Notifikasi diaktifkan.',
  );

  const sendTest = () => call(async () => {
    const res = await api.post<{ sent: boolean; reason?: string }>(
      `/notification-templates/${currentTenantId()}/${template.key}/test`,
      { phone: testPhone, body: draft },
    );
    if (!res.sent) throw new ApiError(400, res.reason ?? 'Gagal mengirim uji coba.');
  }, 'Uji coba terkirim.');

  /** Insert a variable at the cursor rather than making the owner type braces. */
  const insertVar = (name: string) => {
    const el = textarea.current;
    const token = `{${name}}`;
    if (!el) { setDraft(draft + token); return; }
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? start;
    const next = draft.slice(0, start) + token + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button onClick={onToggle} className="flex-1 min-w-0 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{template.title}</span>
            <Tag>{audienceLabel}</Tag>
            {template.customized && <Tag tone="info">diubah</Tag>}
            {!template.enabled && <Tag tone="warn">dimatikan</Tag>}
            {locked && <Tag tone="warn">terkunci</Tag>}
          </div>
          <p className="mt-1 text-xs text-text-muted line-clamp-2">{template.trigger}</p>
        </button>
        <div className="flex items-center gap-2">
          {template.canDisable && (
            <button
              onClick={toggleEnabled}
              disabled={busy}
              className="btn-secondary text-xs"
              title={template.enabled ? 'Matikan notifikasi ini' : 'Aktifkan notifikasi ini'}
            >
              {template.enabled ? 'Matikan' : 'Aktifkan'}
            </button>
          )}
          <button onClick={onToggle} className="btn-secondary text-xs">{open ? 'Tutup' : 'Ubah'}</button>
        </div>
      </div>

      {open && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {/* Editor */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary">Isi pesan</label>
            <textarea
              ref={textarea}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={locked || busy}
              rows={Math.max(6, draft.split('\n').length + 1)}
              className="input w-full font-mono text-xs leading-relaxed disabled:opacity-60"
            />

            {locked ? (
              <p className="text-xs text-warning-600">{template.lockedReason}</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {template.variables.length === 0 && (
                    <span className="text-xs text-text-muted">Pesan ini tidak memakai variabel.</span>
                  )}
                  {template.variables.map((v) => (
                    <button
                      key={v.name}
                      onClick={() => insertVar(v.name)}
                      title={`${v.description}${v.optional ? ' — baris ini hilang bila kosong' : ''}`}
                      className="rounded-full border border-border px-2 py-0.5 font-mono text-2xs text-text-secondary hover:border-primary-500 hover:text-primary-600"
                    >
                      {`{${v.name}}`}{v.optional && <span className="ml-1 text-text-muted">opsional</span>}
                    </button>
                  ))}
                </div>

                {unknown.length > 0 && (
                  <p className="text-xs text-danger-600">
                    Variabel tidak dikenal: {unknown.map((u) => `{${u}}`).join(', ')} — akan ditolak saat disimpan.
                  </p>
                )}
              </>
            )}

            {error && <p className="text-xs text-danger-600">{error}</p>}
            {notice && <p className="text-xs text-success-600">{notice}</p>}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                onClick={save}
                disabled={locked || busy || !dirty || unknown.length > 0 || !draft.trim()}
                className="btn-primary text-xs"
              >
                {busy ? 'Menyimpan…' : 'Simpan'}
              </button>
              {dirty && !locked && (
                <button onClick={() => setDraft(template.body)} disabled={busy} className="btn-secondary text-xs">
                  Batal
                </button>
              )}
              {template.customized && (
                <button onClick={reset} disabled={busy} className="btn-secondary text-xs">
                  Kembalikan teks bawaan
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <input
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="628xxxxxxxxxx"
                className="input w-48 text-xs"
              />
              <button onClick={sendTest} disabled={busy || !testPhone.trim()} className="btn-secondary text-xs">
                Kirim uji coba
              </button>
              <span className="text-2xs text-text-muted">Dikirim dengan contoh data.</span>
            </div>
          </div>

          {/* Preview */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary">Pratinjau di WhatsApp</label>
            <div className="rounded-lg bg-surface-sunken p-3">
              <div className="max-w-sm rounded-lg rounded-tl-none bg-success-50 px-3 py-2 shadow-sm dark:bg-success-900/30">
                <p
                  className="whitespace-pre-wrap break-words text-xs leading-relaxed text-text-primary"
                  dangerouslySetInnerHTML={{ __html: waMarkup(preview) }}
                />
              </div>
            </div>
            <p className="text-2xs text-text-muted">
              Contoh data dipakai untuk pratinjau. Baris yang memakai variabel opsional kosong tidak akan dikirim.
            </p>
            {template.updatedAt && (
              <p className="text-2xs text-text-muted">Terakhir diubah: {template.updatedAt.slice(0, 16).replace('T', ' ')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Tag({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'info' | 'warn' }) {
  const cls =
    tone === 'info' ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
    : tone === 'warn' ? 'bg-warning-50 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300'
    : 'bg-surface-sunken text-text-secondary';
  return <span className={`rounded-full px-2 py-0.5 text-2xs ${cls}`}>{children}</span>;
}
