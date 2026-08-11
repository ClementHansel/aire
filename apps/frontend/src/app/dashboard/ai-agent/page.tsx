'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface AgentConfig {
  escalationNumber: string | null;
  waProvider: 'waha' | 'kirim'; waNumber: string | null; wahaSession: string | null;
  kirimConfigured: boolean; kirimPhoneId: string | null; aiReplyEnabled: boolean; perBranchWaEnabled: boolean; wahaMockEnabled: boolean;
}

interface BranchWaConfig {
  outletId: string; name: string;
  waProvider: 'waha' | 'kirim'; waNumber: string | null; wahaSession: string | null;
  kirimConfigured: boolean; kirimPhoneId: string | null; configured: boolean;
}

export default function AiAgentPage() {
  const { t } = useI18n();
  const [cfg, setCfg] = useState<AgentConfig | null>(null);
  const [kirimApiKey, setKirimApiKey] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try { setCfg(await api.get<AgentConfig>('/agent-config')); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.aiAgent.failedToLoad', 'Failed to load')); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const set = <K extends keyof AgentConfig>(k: K, v: AgentConfig[K]) => setCfg((c) => c ? { ...c, [k]: v } : c);

  const save = async () => {
    if (!cfg) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      const updated = await api.put<AgentConfig>('/agent-config', {
        escalationNumber: cfg.escalationNumber,
        waProvider: cfg.waProvider, waNumber: cfg.waNumber, wahaSession: cfg.wahaSession, kirimPhoneId: cfg.kirimPhoneId,
        aiReplyEnabled: cfg.aiReplyEnabled, perBranchWaEnabled: cfg.perBranchWaEnabled, wahaMockEnabled: cfg.wahaMockEnabled, ...(kirimApiKey ? { kirimApiKey } : {}),
      });
      setCfg(updated); setKirimApiKey(''); setSaved(true);
    } catch (err) { setError(err instanceof Error ? err.message : t('dash.aiAgent.saveFailed', 'Save failed')); }
    finally { setSaving(false); }
  };

  if (!cfg) return <p className="text-text-muted">{t('dash.aiAgent.loading', 'Loading…')}</p>;

  return (
    <div data-testid="ai-agent-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{t('dash.aiAgent.title', 'WhatsApp')}</h1>
          <p className="mt-1 text-sm text-text-secondary">{t('dash.aiAgent.subtitle', 'Your WhatsApp connection and AI auto-reply pause live here. The AI model, prompt and knowledge are managed by Airin on your behalf.')}</p>
        </div>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? t('dash.aiAgent.saving', 'Saving…') : t('dash.aiAgent.saveChanges', 'Save changes')}</button>
      </div>
      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}
      {saved && <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700 mb-4">{t('dash.aiAgent.savedMsg', 'Saved.')}</div>}

      <div className="space-y-5 max-w-3xl">
        {/* AI reply toggle */}
        <div className="card flex items-center justify-between">
          <div>
            <h2 className="section-title">{t('dash.aiAgent.autoReply', 'AI auto-reply')}</h2>
            <p className="section-description">{t('dash.aiAgent.autoReplyDesc', 'When off, the agent stops replying to customers (you can still chat manually).')}</p>
          </div>
          <button onClick={() => set('aiReplyEnabled', !cfg.aiReplyEnabled)} className={`relative w-12 h-7 rounded-full transition-colors ${cfg.aiReplyEnabled ? 'bg-primary-500' : 'bg-gray-300'}`}>
            <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform ${cfg.aiReplyEnabled ? 'translate-x-5' : ''}`} />
          </button>
        </div>

        {/* Connection */}
        <div className="card">
          <h2 className="section-title mb-3">{t('dash.aiAgent.connection', 'WhatsApp connection')}</h2>

          {/* Simulation mode (per-tenant WAHA mock) */}
          <div className="flex items-center justify-between rounded-lg bg-surface-sunken p-3 mb-4">
            <div className="pr-3">
              <p className="text-sm font-medium text-text-primary">{t('dash.aiAgent.mockMode', 'Simulation mode')}</p>
              <p className="text-xs text-text-muted mt-0.5">{t('dash.aiAgent.mockModeDesc', 'Test the WhatsApp flow without a real number: outgoing messages are captured (see the Conversation Log “Mock outbox”) instead of being sent. Turn off to use the real connection.')}</p>
            </div>
            <button onClick={() => set('wahaMockEnabled', !cfg.wahaMockEnabled)} className={`relative shrink-0 w-12 h-7 rounded-full transition-colors ${cfg.wahaMockEnabled ? 'bg-amber-500' : 'bg-gray-300'}`} title={t('dash.aiAgent.mockModeToggle', 'Toggle simulation mode')}>
              <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform ${cfg.wahaMockEnabled ? 'translate-x-5' : ''}`} />
            </button>
          </div>

          <div className="inline-flex rounded-md border border-border bg-surface-raised p-0.5 mb-4">
            {(['waha', 'kirim'] as const).map((p) => (
              <button key={p} onClick={() => set('waProvider', p)} className={`px-4 py-1.5 text-sm font-semibold rounded-md ${cfg.waProvider === p ? 'bg-primary-500 text-white' : 'text-text-secondary'}`}>
                {p === 'waha' ? t('dash.aiAgent.wahaOption', 'WAHA (QR scan)') : 'kirimdev'}
              </button>
            ))}
          </div>
          {cfg.waProvider === 'waha' ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium mb-1.5">{t('dash.aiAgent.waNumber', 'WhatsApp number')}</label><input className="input-field" value={cfg.waNumber ?? ''} onChange={(e) => set('waNumber', e.target.value)} placeholder="628xxxx" /></div>
                <div><label className="block text-sm font-medium mb-1.5">{t('dash.aiAgent.wahaSession', 'WAHA session name')}</label><input className="input-field" value={cfg.wahaSession ?? ''} onChange={(e) => set('wahaSession', e.target.value)} placeholder="default" /></div>
              </div>
              <WahaConnect />
            </div>
          ) : (
            <div className="space-y-3">
              <div><label className="block text-sm font-medium mb-1.5">{t('dash.aiAgent.waNumber', 'WhatsApp number')}</label><input className="input-field" value={cfg.waNumber ?? ''} onChange={(e) => set('waNumber', e.target.value)} placeholder="628xxxx" /></div>
              <div><label className="block text-sm font-medium mb-1.5">{t('dash.aiAgent.kirimPhoneId', 'kirim phone number ID')}</label><input className="input-field" value={cfg.kirimPhoneId ?? ''} onChange={(e) => set('kirimPhoneId', e.target.value)} placeholder="123456789012345" /></div>
              <div><label className="block text-sm font-medium mb-1.5">{t('dash.aiAgent.kirimApiKey', 'kirim API key')} {cfg.kirimConfigured && <span className="text-xs text-green-600">({t('dash.aiAgent.configured', 'configured')})</span>}</label><input className="input-field" type="password" value={kirimApiKey} onChange={(e) => setKirimApiKey(e.target.value)} placeholder={cfg.kirimConfigured ? t('dash.aiAgent.kirimKeep', '•••••••• (leave blank to keep)') : t('dash.aiAgent.kirimEnter', 'Enter kirim API key')} /></div>
            </div>
          )}
        </div>

        {/* Per-branch WhatsApp */}
        <div className="card">
          <div className="flex items-center justify-between mb-1">
            <h2 className="section-title">{t('dash.aiAgent.perBranch', 'Separate WhatsApp per branch')}</h2>
            <button onClick={() => set('perBranchWaEnabled', !cfg.perBranchWaEnabled)} className={`relative w-12 h-7 rounded-full transition-colors ${cfg.perBranchWaEnabled ? 'bg-primary-500' : 'bg-gray-300'}`} title={t('dash.aiAgent.perBranchToggle', 'Enable per-branch WhatsApp')}>
              <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform ${cfg.perBranchWaEnabled ? 'translate-x-5' : ''}`} />
            </button>
          </div>
          <p className="section-description">{t('dash.aiAgent.perBranchDesc', 'Give each branch its own WhatsApp number & QR. Escalation number, AI model, prompt, knowledge and the daily cap stay shared across the whole business. A branch with no number set is simply not connected — it does not fall back to the main line. The built-in agent uses the branch line; n8n flows and broadcasts use the main line.')}</p>
          {cfg.perBranchWaEnabled && (
            <>
              <p className="text-xs text-text-muted mt-2 mb-3">{t('dash.aiAgent.perBranchSaveHint', 'Save this page first to turn the feature on, then configure each branch below.')}</p>
              <PerBranchWhatsApp />
            </>
          )}
        </div>

        {/* Escalation */}
        <div className="card">
          <label className="block text-sm font-medium mb-1.5">{t('dash.aiAgent.escalationNumber', 'Escalation number')}</label>
          <input className="input-field" value={cfg.escalationNumber ?? ''} onChange={(e) => set('escalationNumber', e.target.value)} placeholder={t('dash.aiAgent.escalationPlaceholder', '628xxxx (admin/supervisor)')} />
        </div>

        {/* Staff whitelist — saves per row, independent of the page's Save button. */}
        <StaffWhitelist />
      </div>
    </div>
  );
}

/* ── Staff whitelist ─────────────────────────────────────────────────── */

interface WhitelistEntry {
  id: string;
  phone: string;
  label: string;
  accessLevel: 'full' | 'read_only';
  notes: string | null;
  isActive: boolean;
  lastUsedAt: string | null;
}

const BLANK: { phone: string; label: string; accessLevel: 'full' | 'read_only'; notes: string } = {
  phone: '', label: '', accessLevel: 'full', notes: '',
};

/**
 * Numbers that talk to the FULL business assistant over WhatsApp instead of the
 * customer bot. Each row is a grant of access to the business's own data from a
 * phone, so the UI states that plainly and keeps revoke (deactivate) one click
 * away from delete.
 */
function StaffWhitelist() {
  const { t } = useI18n();
  const [rows, setRows] = useState<WhitelistEntry[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await api.get<WhitelistEntry[]>('/whatsapp/whitelist');
      // A non-array response (an older backend, a proxy error page) must not blank
      // the whole WhatsApp settings page — treat it as "nothing configured".
      setRows(Array.isArray(res) ? res : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.aiAgent.failedToLoad', 'Failed to load'));
      setRows([]);
    }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const reset = () => { setForm(BLANK); setEditing(null); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const body = { phone: form.phone, label: form.label, accessLevel: form.accessLevel, notes: form.notes || null };
      if (editing) await api.patch(`/whatsapp/whitelist/${editing}`, body);
      else await api.post('/whatsapp/whitelist', body);
      reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dash.aiAgent.saveFailed', 'Save failed'));
    } finally { setBusy(false); }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setError('');
    try { await api.patch(`/whatsapp/whitelist/${id}`, body); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.aiAgent.saveFailed', 'Save failed')); }
  };

  const remove = async (id: string) => {
    if (!window.confirm(t('dash.aiAgent.whitelistConfirmDelete', 'Remove this number from the whitelist? It will go back to being treated as a customer.'))) return;
    setError('');
    try { await api.delete(`/whatsapp/whitelist/${id}`); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.aiAgent.saveFailed', 'Delete failed')); }
  };

  return (
    <div className="card" data-testid="wa-whitelist">
      <h2 className="section-title">{t('dash.aiAgent.whitelistTitle', 'Staff WhatsApp numbers')}</h2>
      <p className="section-description">
        {t('dash.aiAgent.whitelistDesc', 'These numbers chat with the FULL business assistant over WhatsApp — the same one as the dashboard, with your live business data — instead of the customer bot. Everyone else stays a customer. Only add numbers you trust.')}
      </p>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-xs text-red-700 mt-3">{error}</div>}

      {rows === null ? (
        <p className="text-sm text-text-muted mt-3">{t('dash.aiAgent.loading', 'Loading…')}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-muted mt-3">{t('dash.aiAgent.whitelistEmpty', 'No staff numbers yet. Add yours below to ask the assistant from WhatsApp.')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium text-text-primary">
                  {r.label}
                  {!r.isActive && (
                    <span className="badge bg-surface-sunken text-text-muted">{t('dash.aiAgent.whitelistInactive', 'revoked')}</span>
                  )}
                  <span className={`badge ${r.accessLevel === 'full' ? 'bg-primary-50 text-primary-700' : 'bg-surface-sunken text-text-secondary'}`}>
                    {r.accessLevel === 'full'
                      ? t('dash.aiAgent.whitelistFull', 'full access')
                      : t('dash.aiAgent.whitelistReadOnly', 'read only')}
                  </span>
                </p>
                <p className="text-xs text-text-muted">
                  +{r.phone}
                  {r.notes ? ` · ${r.notes}` : ''}
                  {r.lastUsedAt ? ` · ${t('dash.aiAgent.whitelistLastUsed', 'last used')} ${new Date(r.lastUsedAt).toLocaleDateString()}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" className="btn-ghost text-xs" onClick={() => patch(r.id, { isActive: !r.isActive })}>
                  {r.isActive ? t('dash.aiAgent.whitelistRevoke', 'Revoke') : t('dash.aiAgent.whitelistRestore', 'Restore')}
                </button>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => {
                    setEditing(r.id);
                    setForm({ phone: r.phone, label: r.label, accessLevel: r.accessLevel, notes: r.notes ?? '' });
                  }}
                >
                  {t('common.edit', 'Edit')}
                </button>
                <button type="button" className="btn-ghost text-xs text-red-600" onClick={() => remove(r.id)}>
                  {t('common.delete', 'Delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium mb-1.5">{t('dash.aiAgent.whitelistPhone', 'WhatsApp number')}</label>
          <input
            className="input-field"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="0812xxxxxxx"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">{t('dash.aiAgent.whitelistLabel', 'Who is this?')}</label>
          <input
            className="input-field"
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            placeholder={t('dash.aiAgent.whitelistLabelPlaceholder', 'e.g. Pak Samuel (owner)')}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">{t('dash.aiAgent.whitelistAccess', 'Access')}</label>
          <select
            className="input-field"
            value={form.accessLevel}
            onChange={(e) => setForm((f) => ({ ...f, accessLevel: e.target.value as 'full' | 'read_only' }))}
          >
            <option value="full">{t('dash.aiAgent.whitelistFullOption', 'Full — can read and act')}</option>
            <option value="read_only">{t('dash.aiAgent.whitelistReadOnlyOption', 'Read only — can look, not change')}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">{t('dash.aiAgent.whitelistNotes', 'Note (optional)')}</label>
          <input className="input-field" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </div>
        <div className="sm:col-span-2 flex gap-2">
          <button type="submit" className="btn-primary text-sm" disabled={busy}>
            {busy
              ? t('dash.aiAgent.saving', 'Saving…')
              : editing
                ? t('dash.aiAgent.whitelistUpdate', 'Update number')
                : t('dash.aiAgent.whitelistAdd', 'Add number')}
          </button>
          {editing && (
            <button type="button" className="btn-ghost text-sm" onClick={reset}>{t('common.cancel', 'Cancel')}</button>
          )}
        </div>
      </form>
    </div>
  );
}

/**
 * Raw WAHA/backend status → what an owner should read. Keeps the operator out of
 * guessing games when a line is down: every state either says it's fine or says
 * what to do next.
 */
const WA_STATUS_LABEL: Record<string, string> = {
  WORKING: 'Connected',
  SCAN_QR_CODE: 'Waiting for QR scan',
  STARTING: 'Starting…',
  FAILED: 'Failed — could not connect',
  stopped: 'Not started',
  qr: 'Waiting for QR scan',
  kirim: 'Using kirimdev (no QR needed)',
  configured: 'Configured',
  not_configured: 'Not configured',
  unreachable: 'WhatsApp service unreachable',
  unknown: 'Unknown',
};

function WahaConnect({ outletId }: { outletId?: string }) {
  const { t } = useI18n();
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState<string | undefined>();
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const suffix = outletId ? `?outletId=${encodeURIComponent(outletId)}` : '';

  const refresh = async () => {
    try { const s = await api.get<{ status: string }>(`/whatsapp/status${suffix}`); setStatus(s.status); setReason(undefined); } catch { setStatus('unreachable'); }
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [outletId]);

  const connect = async () => {
    setLoading(true);
    try {
      await api.post('/whatsapp/connect', outletId ? { outletId } : {});
      const res = await api.get<{ qr: string | null; status: string; reason?: string }>(`/whatsapp/qr${suffix}`);
      setQr(res.qr); setStatus(res.status); setReason(res.reason);
    } catch { setStatus('unreachable'); setReason(undefined); }
    finally { setLoading(false); }
  };

  return (
    <div className="rounded-lg bg-surface-sunken p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-text-secondary">{t('dash.aiAgent.connectionStatus', 'Connection status:')} <span className="font-medium text-text-primary">{status ? (WA_STATUS_LABEL[status] ?? status) : '—'}</span></span>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost text-xs" onClick={refresh}>{t('dash.aiAgent.refresh', 'Refresh')}</button>
          <button type="button" className="btn-primary text-xs py-1" onClick={connect} disabled={loading}>{loading ? t('dash.aiAgent.connecting', 'Connecting…') : t('dash.aiAgent.connectGetQr', 'Connect / Get QR')}</button>
        </div>
      </div>
      {reason && (
        <p className={`mt-2 text-xs ${status === 'WORKING' ? 'text-text-muted' : 'text-amber-700 dark:text-amber-400'}`}>{reason}</p>
      )}
      {qr && (
        <div className="mt-3 text-center">
          <p className="text-xs text-text-muted mb-2">{t('dash.aiAgent.scanQr', 'Scan this with WhatsApp on the agent phone')}</p>
          <img src={qr} alt={t('dash.aiAgent.qrAlt', 'WhatsApp QR')} className="mx-auto rounded-lg border border-border" width={240} height={240} />
        </div>
      )}
      <p className="text-xs text-text-muted mt-2">{t('dash.aiAgent.wahaHint', 'Save your number & session above first. The QR comes from your WAHA service; once scanned, the agent is live.')}</p>
    </div>
  );
}

/**
 * Lists each branch and lets the owner give it its own WhatsApp line. Only
 * shown when the tenant toggle (perBranchWaEnabled) is on. Each branch saves its
 * own connection via PUT /agent-config/branches/:outletId, independent of the
 * main "Save changes" button.
 */
function PerBranchWhatsApp() {
  const { t } = useI18n();
  const [branches, setBranches] = useState<BranchWaConfig[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setBranches(await api.get<BranchWaConfig[]>('/agent-config/branches')); }
    catch (e) { setError(e instanceof Error ? e.message : t('dash.aiAgent.failedToLoad', 'Failed to load')); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>;
  if (!branches) return <p className="text-sm text-text-muted">{t('dash.aiAgent.loading', 'Loading…')}</p>;
  if (branches.length === 0) return <p className="text-sm text-text-muted">{t('dash.aiAgent.noBranches', 'No branches yet. Add branches first, then set a WhatsApp line for each.')}</p>;

  return (
    <div className="space-y-3">
      {branches.map((b) => <BranchWaCard key={b.outletId} branch={b} onSaved={load} />)}
    </div>
  );
}

function BranchWaCard({ branch, onSaved }: { branch: BranchWaConfig; onSaved: () => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<BranchWaConfig>(branch);
  const [kirimApiKey, setKirimApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const set = <K extends keyof BranchWaConfig>(k: K, v: BranchWaConfig[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const updated = await api.put<BranchWaConfig>(`/agent-config/branches/${branch.outletId}`, {
        waProvider: draft.waProvider, waNumber: draft.waNumber, wahaSession: draft.wahaSession, kirimPhoneId: draft.kirimPhoneId,
        ...(kirimApiKey ? { kirimApiKey } : {}),
      });
      setDraft(updated); setKirimApiKey(''); setMsg({ ok: true, text: t('dash.aiAgent.savedMsg', 'Saved.') });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : t('dash.aiAgent.saveFailed', 'Save failed') });
    } finally { setSaving(false); }
  };

  const remove = async () => {
    setSaving(true); setMsg(null);
    try {
      await api.delete(`/agent-config/branches/${branch.outletId}`);
      setDraft({ ...branch, waProvider: 'waha', waNumber: null, wahaSession: null, kirimConfigured: false, kirimPhoneId: null, configured: false });
      setKirimApiKey(''); onSaved();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : t('dash.aiAgent.saveFailed', 'Save failed') });
    } finally { setSaving(false); }
  };

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-text-primary">{draft.name}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${branch.configured ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-text-muted'}`}>
            {branch.configured ? t('dash.aiAgent.branchConnected', 'has own line') : t('dash.aiAgent.branchNotConnected', 'not connected')}
          </span>
        </div>
        <div className="flex gap-2">
          {branch.configured && <button type="button" className="btn-ghost text-xs text-red-600" onClick={remove} disabled={saving}>{t('dash.aiAgent.branchRemove', 'Remove')}</button>}
          <button type="button" className="btn-primary text-xs py-1" onClick={save} disabled={saving}>{saving ? t('dash.aiAgent.saving', 'Saving…') : t('dash.aiAgent.saveChanges', 'Save changes')}</button>
        </div>
      </div>

      <div className="inline-flex rounded-md border border-border bg-surface-raised p-0.5 mb-3">
        {(['waha', 'kirim'] as const).map((p) => (
          <button key={p} onClick={() => set('waProvider', p)} className={`px-3 py-1 text-xs font-semibold rounded-md ${draft.waProvider === p ? 'bg-primary-500 text-white' : 'text-text-secondary'}`}>
            {p === 'waha' ? t('dash.aiAgent.wahaOption', 'WAHA (QR scan)') : 'kirimdev'}
          </button>
        ))}
      </div>

      {draft.waProvider === 'waha' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium mb-1.5">{t('dash.aiAgent.waNumber', 'WhatsApp number')}</label><input className="input-field" value={draft.waNumber ?? ''} onChange={(e) => set('waNumber', e.target.value)} placeholder="628xxxx" /></div>
            <div><label className="block text-sm font-medium mb-1.5">{t('dash.aiAgent.wahaSession', 'WAHA session name')}</label><input className="input-field" value={draft.wahaSession ?? ''} onChange={(e) => set('wahaSession', e.target.value)} placeholder={`${branch.name.toLowerCase().replace(/\s+/g, '-')}`} /></div>
          </div>
          {branch.configured && draft.wahaSession && <WahaConnect outletId={branch.outletId} />}
        </div>
      ) : (
        <div className="space-y-3">
          <div><label className="block text-sm font-medium mb-1.5">{t('dash.aiAgent.waNumber', 'WhatsApp number')}</label><input className="input-field" value={draft.waNumber ?? ''} onChange={(e) => set('waNumber', e.target.value)} placeholder="628xxxx" /></div>
          <div><label className="block text-sm font-medium mb-1.5">{t('dash.aiAgent.kirimPhoneId', 'kirim phone number ID')}</label><input className="input-field" value={draft.kirimPhoneId ?? ''} onChange={(e) => set('kirimPhoneId', e.target.value)} placeholder="123456789012345" /></div>
          <div><label className="block text-sm font-medium mb-1.5">{t('dash.aiAgent.kirimApiKey', 'kirim API key')} {draft.kirimConfigured && <span className="text-xs text-green-600">({t('dash.aiAgent.configured', 'configured')})</span>}</label><input className="input-field" type="password" value={kirimApiKey} onChange={(e) => setKirimApiKey(e.target.value)} placeholder={draft.kirimConfigured ? t('dash.aiAgent.kirimKeep', '•••••••• (leave blank to keep)') : t('dash.aiAgent.kirimEnter', 'Enter kirim API key')} /></div>
        </div>
      )}
      {msg && <p className={`text-xs mt-2 ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>}
    </div>
  );
}
