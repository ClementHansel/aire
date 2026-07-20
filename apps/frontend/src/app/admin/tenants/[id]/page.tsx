'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { isAuthenticated, startImpersonation, getUser, type AuthUser } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { TENANT_MODULES } from '@aire/shared';
import { BranchModal } from '@/components/admin/BranchModal';
import { PageHeader, StatCard, Panel, Modal, Field, ErrorBanner, StatusBadge, TableWrap, EmptyRow, thCls, tdCls, fmtIDR, fmtDate, fmtDateTime } from '@/components/dashboard/ui';

interface TenantRow {
  id: string; name: string; slug: string; plan: string; status: string; tenant_code?: string | null; created_at: string;
  status_reason?: string | null; status_changed_at?: string | null;
}
interface Detail {
  tenant: TenantRow;
  outlets: { id: string; name: string; code: string | null; is_active: boolean; phone: string | null }[];
  users: { id: string; name: string; email: string; role: string }[];
  stats: { orders30d: number; revenue30d: number; activeMembers: number; customers: number };
}

export default function TenantDetailPage() {
  const { t } = useI18n();
  const params = useParams();
  const id = params.id as string;
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [branchModal, setBranchModal] = useState(false);
  const [confirmImpersonate, setConfirmImpersonate] = useState(false);
  const [resetPw, setResetPw] = useState(false);

  // Bumped after any lifecycle action to force the usage + status-history panels
  // (keyed on it) to remount and refetch alongside the reloaded tenant header.
  const [lifecycleKey, setLifecycleKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setD(await api.get<Detail>(`/admin/tenants/${id}/detail`)); }
    catch (err) { setError(err instanceof Error ? err.message : t('admin.tenantDetail.failedToLoad', 'Failed to load')); }
    finally { setLoading(false); }
  }, [id, t]);
  useEffect(() => { if (!isAuthenticated()) { window.location.href = '/'; return; } load(); }, [load]);

  const afterLifecycle = useCallback(() => { setLifecycleKey((k) => k + 1); load(); }, [load]);

  const impersonate = async () => {
    setBusy(true); setError('');
    try {
      const res = await api.post<{ accessToken: string; user: AuthUser }>(`/admin/tenants/${id}/impersonate`, {});
      startImpersonation(res.accessToken, res.user);
      window.location.href = '/hub';
    } catch (err) { setError(err instanceof Error ? err.message : t('admin.tenantDetail.impersonationFailed', 'Impersonation failed')); setBusy(false); setConfirmImpersonate(false); }
  };

  if (loading) return <p className="text-text-muted">{t('admin.tenantDetail.loading', 'Loading…')}</p>;
  if (error && !d) return <ErrorBanner message={error} />;
  if (!d) return <p className="text-text-muted">{t('admin.tenantDetail.notFound', 'Not found.')}</p>;

  return (
    <div className="space-y-6" data-testid="tenant-detail">
      <div>
        <Link href="/admin/tenants" className="text-sm text-primary-600 hover:underline">← {t('admin.tenantDetail.allTenants', 'All tenants')}</Link>
        <div className="mt-2">
          <PageHeader
            title={d.tenant.name}
            subtitle={
              <>
                <span className="capitalize">{d.tenant.plan} · {d.tenant.status} · {t('admin.tenantDetail.since', 'since')} {fmtDate(d.tenant.created_at)}</span>
                {d.tenant.tenant_code && <> · {t('admin.tenantDetail.code', 'Code')}: <code className="font-mono tracking-widest">{d.tenant.tenant_code}</code></>}
              </>
            }
            actions={getUser()?.role === 'platform_super_admin' && (
              <>
                <button className="btn-secondary" onClick={() => setResetPw(true)}>🔑 {t('admin.tenantDetail.resetOwner', 'Reset owner password')}</button>
                <button className="btn-primary" onClick={() => setConfirmImpersonate(true)} disabled={busy}>👤 {t('admin.tenantDetail.impersonate', 'Impersonate')}</button>
              </>
            )}
          />
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={t('admin.tenantDetail.orders30d', 'Orders 30d')} value={String(d.stats.orders30d)} />
        <StatCard label={t('admin.tenantDetail.revenue30d', 'Revenue 30d')} value={fmtIDR(d.stats.revenue30d)} tone="primary" />
        <StatCard label={t('admin.tenantDetail.activeMembers', 'Active members')} value={String(d.stats.activeMembers)} />
        <StatCard label={t('admin.tenantDetail.customers', 'Customers')} value={String(d.stats.customers)} />
      </section>

      <div className="grid lg:grid-cols-2 gap-4">
        <LifecyclePanel tenant={d.tenant} onChanged={afterLifecycle} />
        <PlanUsagePanel key={`usage-${lifecycleKey}`} tenantId={d.tenant.id} />
      </div>

      <StatusHistoryPanel key={`history-${lifecycleKey}`} tenantId={d.tenant.id} />

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel
          title={`${t('admin.tenantDetail.branches', 'Branches')} (${d.outlets.length})`}
          actions={<button className="btn-primary text-xs" onClick={() => setBranchModal(true)}>+ {t('admin.tenantDetail.addBranch', 'Add branch')}</button>}
        >
          {d.outlets.length === 0 ? <p className="text-sm text-text-muted">{t('admin.tenantDetail.noBranches', 'No branches.')}</p> : (
            <ul className="divide-y divide-border -my-2">
              {d.outlets.map((o) => (
                <li key={o.id} className="py-2 flex items-center justify-between text-sm">
                  <span>{o.name} <span className="text-xs text-text-muted">{o.code ?? ''}</span></span>
                  <span className={cn('badge', o.is_active ? 'bg-green-50 text-green-700' : 'bg-surface-sunken text-text-secondary')}>{o.is_active ? t('admin.tenantDetail.branchActive', 'Active') : t('admin.tenantDetail.branchInactive', 'Inactive')}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={`${t('admin.tenantDetail.users', 'Users')} (${d.users.length})`}>
          {d.users.length === 0 ? <p className="text-sm text-text-muted">{t('admin.tenantDetail.noUsers', 'No users.')}</p> : (
            <ul className="divide-y divide-border -my-2">
              {d.users.map((u) => (
                <li key={u.id} className="py-2 flex items-center justify-between text-sm gap-3">
                  <span className="min-w-0"><span className="block truncate">{u.name}</span><span className="block text-xs text-text-muted truncate">{u.email}</span></span>
                  <span className="badge bg-surface-sunken text-text-secondary capitalize whitespace-nowrap">{u.role.replace(/_/g, ' ')}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Downstream calls use the resolved tenant UUID from the loaded detail —
          the URL param may be a slug, and /api/outlets does not resolve slugs. */}
      <ModulesPanel tenantId={d.tenant.id} />

      <AiConfigPanel tenantId={d.tenant.id} />

      <SupportNotesPanel tenantId={id} />

      {resetPw && <ResetOwnerPasswordModal tenantId={id} onClose={() => setResetPw(false)} />}

      {branchModal && (
        <BranchModal tenantId={d.tenant.id} onClose={() => setBranchModal(false)} onSaved={() => { setBranchModal(false); load(); }} />
      )}

      {confirmImpersonate && (
        <Modal
          title={t('admin.tenantDetail.impersonate', 'Impersonate')}
          onClose={() => setConfirmImpersonate(false)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setConfirmImpersonate(false)} disabled={busy}>{t('admin.tenantDetail.cancel', 'Cancel')}</button>
              <button className="btn-primary" onClick={impersonate} disabled={busy}>{busy ? t('admin.tenantDetail.starting', 'Starting…') : t('admin.tenantDetail.confirmImpersonate', 'Impersonate')}</button>
            </>
          }
        >
          <p className="text-sm text-text-secondary">{t('admin.tenantDetail.impersonateConfirm', 'Impersonate this tenant? You will act as their owner until you stop. This is audited.')}</p>
        </Modal>
      )}
    </div>
  );
}

/**
 * Per-tenant module enable/disable. Toggles map to tenants.settings.featureFlags
 * on the backend and drive which navigation the tenant sees. Modules default to
 * enabled, so a fresh tenant has everything on until an admin turns things off.
 */
function ModulesPanel({ tenantId }: { tenantId: string }) {
  const { t } = useI18n();
  const [modules, setModules] = useState<Record<string, boolean> | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    api
      .get<Record<string, boolean>>(`/admin/tenants/${tenantId}/modules`)
      .then(setModules)
      .catch((e) => setErr(e instanceof Error ? e.message : t('admin.tenantDetail.failedLoadModules', 'Failed to load modules')));
  }, [tenantId, t]);

  const toggle = (key: string) => {
    setModules((m) => (m ? { ...m, [key]: !(m[key] !== false) } : m));
    setMsg('');
  };

  const save = async () => {
    if (!modules) return;
    setSaving(true); setErr(''); setMsg('');
    try {
      const updated = await api.put<Record<string, boolean>>(`/admin/tenants/${tenantId}/modules`, { modules });
      setModules(updated);
      setMsg(t('admin.tenantDetail.modulesSaved', 'Modules saved.'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('admin.tenantDetail.failedSave', 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      title={t('admin.tenantDetail.modules', 'Modules')}
      description={t('admin.tenantDetail.modulesDesc', 'Enable or disable features for this tenant. Disabled modules are hidden from their dashboard.')}
      actions={<button className="btn-primary text-xs" onClick={save} disabled={saving || !modules}>{saving ? t('admin.tenantDetail.saving', 'Saving…') : t('admin.tenantDetail.saveModules', 'Save modules')}</button>}
    >
      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-xs text-red-700 mb-3">{err}</div>}
      {msg && <div className="rounded-lg bg-green-50 border border-green-200 p-2 text-xs text-green-700 mb-3">{msg}</div>}

      {!modules ? (
        <p className="text-sm text-text-muted">{t('admin.tenantDetail.loadingModules', 'Loading modules…')}</p>
      ) : (
        <ul className="divide-y divide-border -my-2.5" data-testid="tenant-modules">
          {TENANT_MODULES.map((mod) => {
            const enabled = modules[mod.key] !== false;
            return (
              <li key={mod.key} className="py-2.5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary">{mod.label}</p>
                  <p className="text-xs text-text-muted">{mod.description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  data-testid={`module-toggle-${mod.key}`}
                  onClick={() => toggle(mod.key)}
                  className={cn('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors', enabled ? 'bg-primary-500' : 'bg-gray-300')}
                >
                  <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white transition-transform', enabled ? 'translate-x-6' : 'translate-x-1')} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

interface AiConfig {
  basePrompt: string | null; productKnowledge: string | null; skills: string | null;
  maxMessagesPerDay: number; llmProvider: 'openrouter' | 'hermes_ai'; llmModel: string | null;
  aiEnabled: boolean; llmKeyConfigured: boolean;
}

/**
 * Super-admin-only AI brain configuration for a tenant: LLM provider, model,
 * key, on/off switch, base prompt, product knowledge, skills, and the daily
 * message cap. Tenants no longer see or control any of this — they only get
 * the WhatsApp connection and an AI auto-reply pause (see their AI Agent page).
 */
function AiConfigPanel({ tenantId }: { tenantId: string }) {
  const { t } = useI18n();
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [llmApiKey, setLlmApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try { setCfg(await api.get<AiConfig>(`/admin/tenants/${tenantId}/ai-config`)); }
    catch (e) { setErr(e instanceof Error ? e.message : t('admin.tenantDetail.aiConfigFailed', 'Failed to load AI config')); }
  }, [tenantId, t]);
  useEffect(() => { load(); }, [load]);

  const set = <K extends keyof AiConfig>(k: K, v: AiConfig[K]) => setCfg((c) => (c ? { ...c, [k]: v } : c));

  const save = async () => {
    if (!cfg) return;
    setSaving(true); setErr(''); setMsg('');
    try {
      const updated = await api.put<AiConfig>(`/admin/tenants/${tenantId}/ai-config`, {
        basePrompt: cfg.basePrompt, productKnowledge: cfg.productKnowledge, skills: cfg.skills,
        maxMessagesPerDay: cfg.maxMessagesPerDay, llmProvider: cfg.llmProvider, llmModel: cfg.llmModel,
        aiEnabled: cfg.aiEnabled, ...(llmApiKey ? { llmApiKey } : {}),
      });
      setCfg(updated); setLlmApiKey('');
      setMsg(t('admin.tenantDetail.aiConfigSaved', 'AI config saved.'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('admin.tenantDetail.failedSave', 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      title={t('admin.tenantDetail.aiConfig', 'AI configuration')}
      description={t('admin.tenantDetail.aiConfigDesc', 'The AI brain for this tenant — model, key, prompt, knowledge and skills. Hidden from the tenant; they only control the WhatsApp connection and an on/off pause.')}
      actions={<button className="btn-primary text-xs" onClick={save} disabled={saving || !cfg}>{saving ? t('admin.tenantDetail.saving', 'Saving…') : t('admin.tenantDetail.saveAiConfig', 'Save AI config')}</button>}
    >
      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-xs text-red-700 mb-3">{err}</div>}
      {msg && <div className="rounded-lg bg-green-50 border border-green-200 p-2 text-xs text-green-700 mb-3">{msg}</div>}

      {!cfg ? (
        <p className="text-sm text-text-muted">{t('admin.tenantDetail.loadingAiConfig', 'Loading AI config…')}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-text-primary">{t('admin.tenantDetail.aiEnabled', 'AI enabled')}</span>
            <button
              type="button"
              role="switch"
              aria-checked={cfg.aiEnabled}
              onClick={() => set('aiEnabled', !cfg.aiEnabled)}
              className={cn('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors', cfg.aiEnabled ? 'bg-primary-500' : 'bg-gray-300')}
            >
              <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white transition-transform', cfg.aiEnabled ? 'translate-x-6' : 'translate-x-1')} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('admin.tenantDetail.provider', 'Provider')}>
              <select className="input-field" value={cfg.llmProvider} onChange={(e) => set('llmProvider', e.target.value as AiConfig['llmProvider'])}>
                <option value="openrouter">OpenRouter</option>
                <option value="hermes_ai">{t('admin.tenantDetail.hermes', 'Hermes AI (self-hosted)')}</option>
              </select>
            </Field>
            <Field label={`${t('admin.tenantDetail.apiKey', 'API key')}${cfg.llmKeyConfigured ? ` (${t('admin.tenantDetail.configured', 'configured')})` : ''}`}>
              <input className="input-field" type="password" value={llmApiKey} onChange={(e) => setLlmApiKey(e.target.value)} placeholder={cfg.llmKeyConfigured ? t('admin.tenantDetail.keyKeep', '•••••••• (leave blank to keep)') : t('admin.tenantDetail.keyEnter', 'sk-or-…')} />
            </Field>
          </div>

          <Field label={t('admin.tenantDetail.model', 'Model')} hint={t('admin.tenantDetail.modelHint', 'e.g. openai/gpt-4o-mini, hermes3:latest. Blank = provider default.')}>
            <input className="input-field" value={cfg.llmModel ?? ''} onChange={(e) => set('llmModel', e.target.value || null)} placeholder="openai/gpt-4o-mini" />
          </Field>

          <Field label={t('admin.tenantDetail.maxMessages', 'Max messages per user / day')}>
            <input type="number" className="input-field" value={cfg.maxMessagesPerDay} onChange={(e) => set('maxMessagesPerDay', Number(e.target.value))} />
          </Field>

          <Field label={t('admin.tenantDetail.basePrompt', 'Base prompt')}>
            <textarea className="input-field min-h-28" value={cfg.basePrompt ?? ''} onChange={(e) => set('basePrompt', e.target.value)} placeholder={t('admin.tenantDetail.basePromptPlaceholder', 'You are the friendly assistant for AIRE Car Wash…')} />
          </Field>

          <Field label={t('admin.tenantDetail.productKnowledge', 'Product knowledge')}>
            <textarea className="input-field min-h-28" value={cfg.productKnowledge ?? ''} onChange={(e) => set('productKnowledge', e.target.value)} placeholder={t('admin.tenantDetail.productKnowledgePlaceholder', 'Hours: 08:00–20:00. Memberships: 1/3/12 months…')} />
          </Field>

          <Field label={t('admin.tenantDetail.skills', 'Agent skills')}>
            <textarea className="input-field min-h-20" value={cfg.skills ?? ''} onChange={(e) => set('skills', e.target.value)} placeholder={t('admin.tenantDetail.skillsPlaceholder', 'Answer membership status\nShare pricing\nCheck voucher validity')} />
          </Field>
        </div>
      )}
    </Panel>
  );
}

interface SupportNote { id: string; body: string; pinned: boolean; authorName: string | null; createdAt: string }

/** Internal support log for a tenant (never shown to the tenant). */
function SupportNotesPanel({ tenantId }: { tenantId: string }) {
  const { t } = useI18n();
  const [notes, setNotes] = useState<SupportNote[]>([]);
  const [draft, setDraft] = useState('');
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try { setNotes(await api.get<SupportNote[]>(`/admin/tenants/${tenantId}/notes`)); }
    catch (e) { setErr(e instanceof Error ? e.message : t('admin.tenantDetail.notesFailed', 'Failed to load notes')); }
  }, [tenantId, t]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!draft.trim()) return;
    setSaving(true); setErr('');
    try { await api.post(`/admin/tenants/${tenantId}/notes`, { body: draft, pinned }); setDraft(''); setPinned(false); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : t('admin.tenantDetail.noteFailed', 'Failed to add note')); }
    finally { setSaving(false); }
  };
  const remove = async (id: string) => {
    try { await api.delete(`/admin/notes/${id}`); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : t('admin.tenantDetail.noteFailed', 'Failed')); }
  };

  return (
    <Panel title={t('admin.tenantDetail.supportNotes', 'Support notes')} description={t('admin.tenantDetail.supportNotesDesc', 'Internal notes — never shown to the tenant.')}>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-xs text-red-700 mb-3">{err}</div>}
      <div className="flex flex-col gap-2 mb-4">
        <textarea className="input-field min-h-[64px]" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('admin.tenantDetail.notePlaceholder', 'Add a note about this tenant…')} />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> {t('admin.tenantDetail.pin', 'Pin')}</label>
          <button className="btn-primary text-xs" onClick={add} disabled={saving || !draft.trim()}>{saving ? t('admin.tenantDetail.adding', 'Adding…') : t('admin.tenantDetail.addNote', 'Add note')}</button>
        </div>
      </div>
      {notes.length === 0 ? <p className="text-sm text-text-muted">{t('admin.tenantDetail.noNotes', 'No notes yet.')}</p> : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-text-primary whitespace-pre-wrap">{n.pinned && <span className="mr-1" aria-label="pinned">📌</span>}{n.body}</p>
                <button className="btn-ghost text-xs text-rose-600 shrink-0" onClick={() => remove(n.id)}>{t('admin.tenantDetail.deleteNote', 'Delete')}</button>
              </div>
              <p className="text-xs text-text-muted mt-1">{n.authorName ?? '—'} · {fmtDateTime(n.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ── Plan & usage ────────────────────────────────────────────────────── */

interface Resource { key: string; label: string; used: number; limit: number | null; unlimited: boolean; remaining: number | null; exceeded: boolean }
interface Entitlements { tenantId: string; plan: string; resources: Resource[] }

/** A resource is over budget when the backend flags it or usage hit the cap. */
function isOver(r: Resource): boolean {
  return r.exceeded || (!r.unlimited && r.limit != null && r.limit > 0 && r.used >= r.limit);
}

/**
 * Per-tenant entitlement usage (seats, branches, etc.) against the plan limits.
 * Each row shows used / limit with a meter; capped resources turn red once
 * usage reaches or passes the limit.
 */
function PlanUsagePanel({ tenantId }: { tenantId: string }) {
  const { t } = useI18n();
  const [data, setData] = useState<Entitlements | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    setLoading(true); setErr('');
    api.get<Entitlements>(`/admin/tenants/${tenantId}/entitlements`)
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : t('admin.tenantDetail.usageFailed', 'Failed to load usage')))
      .finally(() => setLoading(false));
  }, [tenantId, t]);

  return (
    <Panel
      title={t('admin.tenantDetail.planUsage', 'Plan & usage')}
      description={data ? `${t('admin.tenantDetail.plan', 'Plan')}: ${data.plan}` : undefined}
    >
      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-xs text-red-700 mb-3">{err}</div>}
      {loading ? (
        <p className="text-sm text-text-muted">{t('admin.tenantDetail.loadingUsage', 'Loading usage…')}</p>
      ) : !data || data.resources.length === 0 ? (
        <p className="text-sm text-text-muted">{t('admin.tenantDetail.noUsage', 'No metered resources for this plan.')}</p>
      ) : (
        <ul className="space-y-3.5" data-testid="tenant-usage">
          {data.resources.map((r) => {
            const over = isOver(r);
            const pct = r.unlimited || r.limit == null || r.limit <= 0
              ? (r.used > 0 ? 100 : 0)
              : Math.min(100, Math.round((r.used / r.limit) * 100));
            return (
              <li key={r.key} data-testid={`usage-${r.key}`}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-text-primary">{r.label}</span>
                  <span className={cn('tabular-nums', over ? 'text-rose-600 font-semibold' : 'text-text-secondary')}>
                    {r.unlimited || r.limit == null
                      ? `${r.used} · ${t('admin.tenantDetail.unlimited', 'Unlimited')}`
                      : `${r.used} / ${r.limit}`}
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
                  <div
                    className={cn('h-full rounded-full transition-[width]', over ? 'bg-rose-500' : 'bg-primary-500')}
                    style={{ width: `${r.unlimited ? 8 : pct}%` }}
                  />
                </div>
                {over && (
                  <p className="mt-1 text-xs text-rose-600">{t('admin.tenantDetail.overLimit', 'Over plan limit')}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* ── Lifecycle (status + suspend / reactivate / cancel) ──────────────── */

type LifecycleAction = 'suspend' | 'reactivate' | 'cancel';

/**
 * Current tenant status + the state-machine actions available from it.
 * Suspend applies to active/past_due; Reactivate to suspended/past_due/cancelled;
 * Cancel to anything not already cancelled. Each opens a Modal to capture an
 * optional reason before calling the matching endpoint.
 */
function LifecyclePanel({ tenant, onChanged }: { tenant: TenantRow; onChanged: () => void }) {
  const { t } = useI18n();
  const [action, setAction] = useState<LifecycleAction | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const isSuper = getUser()?.role === 'platform_super_admin';
  const status = tenant.status;

  const open = (a: LifecycleAction) => { setAction(a); setReason(''); setErr(''); };

  const submit = async () => {
    if (!action) return;
    setBusy(true); setErr('');
    try {
      await api.patch(`/admin/tenants/${tenant.id}/${action}`, { reason: reason.trim() || undefined });
      setAction(null);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('admin.tenantDetail.lifecycleFailed', 'Action failed'));
    } finally {
      setBusy(false);
    }
  };

  const canSuspend = status === 'active' || status === 'past_due';
  const canReactivate = status === 'suspended' || status === 'past_due' || status === 'cancelled';
  const canCancel = status !== 'cancelled';

  const LABELS: Record<LifecycleAction, string> = {
    suspend: t('admin.tenantDetail.suspend', 'Suspend'),
    reactivate: t('admin.tenantDetail.reactivate', 'Reactivate'),
    cancel: t('admin.tenantDetail.cancel2', 'Cancel subscription'),
  };

  return (
    <Panel title={t('admin.tenantDetail.lifecycle', 'Lifecycle')}>
      <div className="flex items-center gap-2">
        <StatusBadge status={status} />
      </div>
      {tenant.status_reason && (
        <p className="mt-3 text-sm text-text-secondary"><span className="text-text-muted">{t('admin.tenantDetail.statusReason', 'Reason')}:</span> {tenant.status_reason}</p>
      )}
      {tenant.status_changed_at && (
        <p className="mt-1 text-xs text-text-muted">{t('admin.tenantDetail.statusChanged', 'Changed')} {fmtDateTime(tenant.status_changed_at)}</p>
      )}

      {isSuper ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {canSuspend && <button className="btn-secondary text-xs text-amber-700" onClick={() => open('suspend')}>{LABELS.suspend}</button>}
          {canReactivate && <button className="btn-secondary text-xs text-green-700" onClick={() => open('reactivate')}>{LABELS.reactivate}</button>}
          {canCancel && <button className="btn-secondary text-xs text-rose-700" onClick={() => open('cancel')}>{LABELS.cancel}</button>}
        </div>
      ) : (
        <p className="mt-4 text-xs text-text-muted">{t('admin.tenantDetail.lifecycleSuperOnly', 'Lifecycle changes require a Platform Super Admin.')}</p>
      )}

      {action && (
        <Modal
          title={LABELS[action]}
          onClose={() => setAction(null)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setAction(null)} disabled={busy}>{t('admin.tenantDetail.cancel', 'Cancel')}</button>
              <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? t('admin.tenantDetail.working', 'Working…') : LABELS[action]}</button>
            </>
          }
        >
          <div className="space-y-4">
            <ErrorBanner message={err} />
            <p className="text-sm text-text-secondary">
              {action === 'suspend' && t('admin.tenantDetail.suspendConfirm', 'Suspend this tenant? Their staff will be blocked from the app until reactivated. This is audited.')}
              {action === 'reactivate' && t('admin.tenantDetail.reactivateConfirm', 'Reactivate this tenant? They regain access to the app. This is audited.')}
              {action === 'cancel' && t('admin.tenantDetail.cancelConfirm', 'Cancel this tenant’s subscription? They lose access to the app. This is audited.')}
            </p>
            <Field label={t('admin.tenantDetail.reasonOptional', 'Reason (optional)')}>
              <textarea className="input-field min-h-[64px]" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('admin.tenantDetail.reasonPlaceholder', 'Add context for the audit log…')} autoFocus />
            </Field>
          </div>
        </Modal>
      )}
    </Panel>
  );
}

/* ── Status history ──────────────────────────────────────────────────── */

interface StatusEvent {
  id: string; fromStatus: string | null; toStatus: string; reason: string | null;
  source: 'admin' | 'billing' | 'system'; actorUserId: string | null; actorName: string | null; createdAt: string;
}

const SOURCE_BADGE: Record<StatusEvent['source'], string> = {
  admin: 'bg-sky-50 text-sky-700', billing: 'bg-violet-50 text-violet-700', system: 'bg-surface-sunken text-text-secondary',
};

/** Append-only audit of tenant status transitions (newest first, per the API). */
function StatusHistoryPanel({ tenantId }: { tenantId: string }) {
  const { t } = useI18n();
  const [events, setEvents] = useState<StatusEvent[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setErr('');
    api.get<StatusEvent[]>(`/admin/tenants/${tenantId}/status-events`)
      .then(setEvents)
      .catch((e) => { setEvents([]); setErr(e instanceof Error ? e.message : t('admin.tenantDetail.historyFailed', 'Failed to load status history')); });
  }, [tenantId, t]);

  return (
    <Panel title={t('admin.tenantDetail.statusHistory', 'Status history')} bodyClassName="p-0">
      {err && <div className="px-5 pt-4"><ErrorBanner message={err} /></div>}
      {events === null ? (
        <p className="px-5 py-6 text-sm text-text-muted">{t('admin.tenantDetail.loadingHistory', 'Loading history…')}</p>
      ) : (
        <TableWrap>
          <thead>
            <tr className="border-b border-border">
              <th className={cn(thCls, 'text-left')}>{t('admin.tenantDetail.when', 'When')}</th>
              <th className={cn(thCls, 'text-left')}>{t('admin.tenantDetail.change', 'Change')}</th>
              <th className={cn(thCls, 'text-left')}>{t('admin.tenantDetail.source', 'Source')}</th>
              <th className={cn(thCls, 'text-left')}>{t('admin.tenantDetail.actor', 'Actor')}</th>
              <th className={cn(thCls, 'text-left')}>{t('admin.tenantDetail.reason', 'Reason')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {events.length === 0 ? (
              <EmptyRow colSpan={5}>{t('admin.tenantDetail.noHistory', 'No status changes recorded.')}</EmptyRow>
            ) : events.map((ev) => (
              <tr key={ev.id} className="hover:bg-surface-sunken/50">
                <td className={cn(tdCls, 'whitespace-nowrap text-xs text-text-muted')}>{fmtDateTime(ev.createdAt)}</td>
                <td className={cn(tdCls, 'whitespace-nowrap')}>
                  <span className="text-text-muted capitalize">{ev.fromStatus ? ev.fromStatus.replace(/_/g, ' ') : '—'}</span>
                  <span className="mx-1.5 text-text-muted">→</span>
                  <StatusBadge status={ev.toStatus} />
                </td>
                <td className={tdCls}><span className={cn('badge capitalize', SOURCE_BADGE[ev.source] ?? 'bg-surface-sunken text-text-secondary')}>{ev.source}</span></td>
                <td className={cn(tdCls, 'whitespace-nowrap')}>{ev.actorName ?? '—'}</td>
                <td className={cn(tdCls, 'text-text-secondary')}>{ev.reason || '—'}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Panel>
  );
}

/** Privileged reset of a tenant owner's password. */
function ResetOwnerPasswordModal({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      const r = await api.post<{ ok: true; email: string }>(`/admin/tenants/${tenantId}/reset-owner-password`, { password });
      setDone(r.email);
    } catch (err) { setError(err instanceof Error ? err.message : t('admin.tenantDetail.resetFailed', 'Reset failed')); }
    finally { setSaving(false); }
  };
  return (
    <Modal
      title={t('admin.tenantDetail.resetOwner', 'Reset owner password')}
      onClose={onClose}
      footer={done ? <button className="btn-primary" onClick={onClose}>{t('admin.tenantDetail.close', 'Close')}</button> : <>
        <button className="btn-secondary" onClick={onClose}>{t('admin.tenantDetail.cancel', 'Cancel')}</button>
        <button type="submit" form="reset-owner-form" className="btn-primary" disabled={saving}>{saving ? t('admin.tenantDetail.resetting', 'Resetting…') : t('admin.tenantDetail.reset', 'Reset password')}</button>
      </>}
    >
      {done ? (
        <p className="text-sm text-green-700">{t('admin.tenantDetail.resetDone', 'Password reset for {email}. Share the new password securely.').replace('{email}', done)}</p>
      ) : (
        <form id="reset-owner-form" onSubmit={submit} className="space-y-4">
          <ErrorBanner message={error} />
          <p className="text-sm text-text-secondary">{t('admin.tenantDetail.resetOwnerDesc', 'Sets a new password for this tenant’s owner account. This is audited.')}</p>
          <Field label={t('admin.tenantDetail.newPassword', 'New password')} hint={t('admin.tenantDetail.passwordHint', 'At least 8 characters.')}><input className="input-field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoFocus /></Field>
        </form>
      )}
    </Modal>
  );
}
