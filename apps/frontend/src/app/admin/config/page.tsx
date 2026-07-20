'use client';

import { useState, useEffect, useCallback } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { api } from '@/lib/api';
import { isAuthenticated, getUser, logout } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { PageHeader, Panel, Field, ErrorBanner } from '@/components/dashboard/ui';

interface PlatformAi { provider: 'openrouter' | 'hermes_ai'; model: string | null; keyConfigured: boolean }

/* ── Platform AI / LLM connection (ONE key for ALL tenants) ─────────────────── */
function PlatformAiPanel() {
  const { t } = useI18n();
  const [cfg, setCfg] = useState<PlatformAi | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try { setCfg(await api.get<PlatformAi>('/admin/platform/ai')); }
    catch (err) { setError(err instanceof Error ? err.message : t('admin.config.ai.failedToLoad', 'Failed to load AI settings')); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const toggleShowKey = async () => {
    if (showKey) { setShowKey(false); return; }
    if (!apiKey && cfg?.keyConfigured) {
      setRevealing(true);
      try { const r = await api.get<{ apiKey: string | null }>('/admin/platform/ai/key'); setApiKey(r.apiKey ?? ''); }
      catch (err) { setError(err instanceof Error ? err.message : t('admin.config.ai.revealFailed', 'Failed to reveal key')); }
      finally { setRevealing(false); }
    }
    setShowKey(true);
  };

  const save = async () => {
    if (!cfg) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      const updated = await api.put<PlatformAi>('/admin/platform/ai', {
        provider: cfg.provider, model: cfg.model, ...(apiKey ? { apiKey } : {}),
      });
      setCfg(updated); setApiKey(''); setShowKey(false); setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.config.ai.saveFailed', 'Save failed'));
    } finally { setSaving(false); }
  };

  return (
    <Panel
      title={t('admin.config.ai.title', 'AI / LLM connection')}
      description={t('admin.config.ai.desc', 'Airin’s own LLM account, used by every tenant’s WhatsApp agent. Set the key once here — you never need to configure it per tenant.')}
      actions={<button className="btn-primary text-sm" onClick={save} disabled={saving || !cfg}>{saving ? t('admin.config.ai.saving', 'Saving…') : t('admin.config.ai.save', 'Save AI settings')}</button>}
    >
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      {saved && <div className="mb-3 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">{t('admin.config.ai.savedMsg', 'AI settings saved.')}</div>}
      {!cfg ? (
        <p className="text-sm text-text-muted">{t('admin.config.ai.loading', 'Loading…')}</p>
      ) : (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label={t('admin.config.ai.provider', 'Provider')}>
              <select className="input-field" value={cfg.provider} onChange={(e) => setCfg({ ...cfg, provider: e.target.value as PlatformAi['provider'] })}>
                <option value="openrouter">OpenRouter</option>
                <option value="hermes_ai">{t('admin.config.ai.hermes', 'Hermes AI (self-hosted)')}</option>
              </select>
            </Field>
            <Field label={`${t('admin.config.ai.apiKey', 'API key')}${cfg.keyConfigured ? ` (${t('admin.config.ai.configured', 'configured')})` : ''}`}>
              <div className="relative">
                <input
                  className="input-field pr-10"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={cfg.keyConfigured ? t('admin.config.ai.keyKeep', '•••••••• (leave blank to keep)') : t('admin.config.ai.keyEnter', 'sk-or-…')}
                />
                <button
                  type="button"
                  onClick={toggleShowKey}
                  disabled={revealing || (!apiKey && !cfg.keyConfigured)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-text-muted hover:text-text-primary disabled:opacity-40"
                  aria-label={showKey ? t('admin.config.ai.hideKey', 'Hide key') : t('admin.config.ai.showKey', 'Show key')}
                  title={showKey ? t('admin.config.ai.hideKey', 'Hide key') : t('admin.config.ai.showKey', 'Show key')}
                >
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
          </div>
          <Field label={t('admin.config.ai.model', 'Model')} hint={t('admin.config.ai.modelHint', 'e.g. qwen/qwen3.5-flash-02-23. Blank = provider default.')}>
            <input className="input-field" value={cfg.model ?? ''} onChange={(e) => setCfg({ ...cfg, model: e.target.value || null })} placeholder="qwen/qwen3.5-flash-02-23" />
          </Field>
        </div>
      )}
    </Panel>
  );
}

interface PlatformTaxConfig { enabled: boolean; npwp: string; name: string; address: string; rate: number }

/* ── Platform tax (PPN / Faktur Pajak) ──────────────────────────────────── */
// Self-contained so it owns its own load/save cycle, independent of the
// feature-flag/plans form above (which has its own single Save button).
function PlatformTaxPanel() {
  const { t } = useI18n();
  const [cfg, setCfg] = useState<PlatformTaxConfig | null>(null);
  // Rate is edited as a percentage (11) but stored as a fraction (0.11).
  const [ratePct, setRatePct] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await api.get<PlatformTaxConfig>('/admin/platform-tax');
      setCfg({
        enabled: Boolean(data.enabled), npwp: data.npwp ?? '', name: data.name ?? '',
        address: data.address ?? '', rate: Number(data.rate) || 0,
      });
      setRatePct(String(+((Number(data.rate) || 0) * 100).toFixed(4)));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.config.tax.failedToLoad', 'Failed to load tax settings'));
    } finally { setLoading(false); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!cfg) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      const rate = Math.max(0, Number(ratePct) || 0) / 100;
      const updated = await api.put<PlatformTaxConfig>('/admin/platform-tax', {
        enabled: cfg.enabled, npwp: cfg.npwp, name: cfg.name, address: cfg.address, rate,
      });
      setCfg({
        enabled: Boolean(updated.enabled), npwp: updated.npwp ?? '', name: updated.name ?? '',
        address: updated.address ?? '', rate: Number(updated.rate) || 0,
      });
      setRatePct(String(+((Number(updated.rate) || 0) * 100).toFixed(4)));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.config.tax.saveFailed', 'Save failed'));
    } finally { setSaving(false); }
  };

  return (
    <Panel
      title={t('admin.config.tax.title', 'Platform tax (PPN)')}
      description={t('admin.config.tax.desc', 'Seller identity and PPN rate applied to the invoices the platform issues to tenants (Faktur Pajak).')}
      actions={<button className="btn-primary text-sm" onClick={save} disabled={saving || loading}>{saving ? t('admin.config.tax.saving', 'Saving…') : t('admin.config.tax.save', 'Save tax settings')}</button>}
    >
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      {saved && <div className="mb-3 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">{t('admin.config.tax.savedMsg', 'Tax settings saved.')}</div>}
      <div className="space-y-4">
        <div className="flex items-center justify-between border border-border rounded-lg px-3 py-2.5">
          <div>
            <p className="text-sm font-medium text-text-primary">{t('admin.config.tax.enabled', 'Charge PPN on invoices')}</p>
            <p className="text-xs text-text-muted">{t('admin.config.tax.enabledHint', 'When on, invoices include PPN and can carry a Faktur Pajak serial.')}</p>
          </div>
          <button
            type="button"
            onClick={() => setCfg((c) => c && { ...c, enabled: !c.enabled })}
            disabled={loading || !cfg}
            className={cn('badge', cfg?.enabled ? 'bg-green-50 text-green-700' : 'bg-surface-sunken text-text-secondary')}
          >
            {cfg?.enabled ? t('admin.config.enabled', 'Enabled') : t('admin.config.disabled', 'Disabled')}
          </button>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label={t('admin.config.tax.name', 'Seller name')}>
            <input className="input-field" value={cfg?.name ?? ''} disabled={loading || !cfg} onChange={(e) => setCfg((c) => c && { ...c, name: e.target.value })} placeholder="PT Airin Teknologi" />
          </Field>
          <Field label={t('admin.config.tax.npwp', 'NPWP')}>
            <input className="input-field font-mono" value={cfg?.npwp ?? ''} disabled={loading || !cfg} onChange={(e) => setCfg((c) => c && { ...c, npwp: e.target.value })} placeholder="00.000.000.0-000.000" />
          </Field>
        </div>
        <Field label={t('admin.config.tax.address', 'Seller address')}>
          <textarea className="input-field" rows={2} value={cfg?.address ?? ''} disabled={loading || !cfg} onChange={(e) => setCfg((c) => c && { ...c, address: e.target.value })} />
        </Field>
        <Field label={t('admin.config.tax.rate', 'PPN rate (%)')} hint={t('admin.config.tax.rateHint', 'Percentage, e.g. 11 for 11%.')}>
          <input className="input-field max-w-[140px] tabular-nums" type="number" min={0} step="0.1" value={ratePct} disabled={loading || !cfg} onChange={(e) => setRatePct(e.target.value)} />
        </Field>
      </div>
    </Panel>
  );
}

interface PricingTier { plan: string; price: number }
interface PlatformConfig { defaultPlans: string[]; pricingTiers: PricingTier[]; featureFlags: Record<string, boolean> }

function normalize(raw: Record<string, unknown>): PlatformConfig {
  const plans = Array.isArray(raw.defaultPlans) ? (raw.defaultPlans as string[]) : ['standard', 'premium', 'enterprise'];
  const tiersRaw = Array.isArray(raw.pricingTiers) ? (raw.pricingTiers as Record<string, unknown>[]) : [];
  const tiers: PricingTier[] = tiersRaw.map((t) => ({ plan: String(t.plan ?? ''), price: Number(t.price ?? 0) }));
  const flags = (raw.featureFlags && typeof raw.featureFlags === 'object' ? (raw.featureFlags as Record<string, boolean>) : {});
  return { defaultPlans: plans, pricingTiers: tiers, featureFlags: flags };
}

export default function AdminConfigPage() {
  const { t } = useI18n();
  const [config, setConfig] = useState<PlatformConfig | null>(null);
  const [plansText, setPlansText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newFlag, setNewFlag] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await api.get<Record<string, unknown>>('/admin/config');
      const cfg = normalize(data);
      setConfig(cfg);
      setPlansText(cfg.defaultPlans.join(', '));
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('admin.config.failedToLoad', 'Failed to load configuration');
      if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) setForbidden(true);
      else setError(msg);
    } finally { setLoading(false); }
  }, [t]);

  useEffect(() => { if (!isAuthenticated()) { window.location.href = '/'; return; } load(); }, [load]);

  const save = async () => {
    if (!config) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      const payload: PlatformConfig = {
        defaultPlans: plansText.split(',').map((p) => p.trim()).filter(Boolean),
        pricingTiers: config.pricingTiers,
        featureFlags: config.featureFlags,
      };
      const updated = await api.put<Record<string, unknown>>('/admin/config', payload);
      const cfg = normalize(updated);
      setConfig(cfg);
      setPlansText(cfg.defaultPlans.join(', '));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.config.saveFailed', 'Save failed'));
    } finally { setSaving(false); }
  };

  const toggleFlag = (k: string) => setConfig((c) => c && { ...c, featureFlags: { ...c.featureFlags, [k]: !c.featureFlags[k] } });
  const addFlag = () => {
    const key = newFlag.trim();
    if (!key) return;
    setConfig((c) => c && { ...c, featureFlags: { ...c.featureFlags, [key]: false } });
    setNewFlag('');
  };
  const removeFlag = (k: string) => setConfig((c) => {
    if (!c) return c;
    const next = { ...c.featureFlags };
    delete next[k];
    return { ...c, featureFlags: next };
  });

  if (forbidden) {
    return (
      <div className="max-w-md">
        <h1 className="text-xl font-bold text-text-primary mb-2">{t('admin.config.accessDenied', 'Access Denied')}</h1>
        <p className="text-sm text-text-secondary">{t('admin.config.accessDeniedDesc', 'This area requires a Platform Super Admin account. You are signed in as ')}<span className="font-medium">{getUser()?.role?.replace(/_/g, ' ')}</span>.</p>
        <button onClick={logout} className="btn-secondary mt-4">{t('admin.config.signInDifferent', 'Sign in as different user')}</button>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="admin-config">
      <PageHeader
        title={t('admin.config.title', 'Platform Config')}
        subtitle={t('admin.config.subtitle', 'Platform-wide defaults and feature flags applied across all tenants.')}
        actions={<button className="btn-primary" onClick={save} disabled={saving || loading}>{saving ? t('admin.config.saving', 'Saving…') : t('admin.config.saveChanges', 'Save changes')}</button>}
      />

      <ErrorBanner message={error} onDismiss={() => setError('')} />
      {saved && <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">{t('admin.config.savedMsg', 'Configuration saved.')}</div>}

      <div className="space-y-5 max-w-2xl">
        <PlatformAiPanel />

        <Panel title={t('admin.config.defaultPlans', 'Default plans')} description={t('admin.config.defaultPlansDesc', 'Comma-separated list of plans offered to new tenants.')}>
          <input className="input-field" value={plansText} onChange={(e) => setPlansText(e.target.value)} placeholder="standard, premium, enterprise" disabled={loading} />
        </Panel>

        <Panel title={t('admin.config.subscriptionPlans', 'Subscription plans')} description={t('admin.config.subscriptionPlansDesc', 'The plans the platform charges tenants (price, billing cycle, features, limits) now live on their own page — separate from the membership plans each tenant sells to its customers.')}>
          <a href="/admin/plans" className="btn-secondary text-sm inline-block">{t('admin.config.managePlans', 'Manage subscription plans')} →</a>
        </Panel>

        <PlatformTaxPanel />

        <Panel title={t('admin.config.featureFlags', 'Feature flags')} description={t('admin.config.featureFlagsDesc', 'Toggle platform-wide features.')}>
          <div className="space-y-2 mb-3">
            {Object.keys(config?.featureFlags ?? {}).length === 0 ? (
              <p className="text-sm text-text-muted">{t('admin.config.noFeatureFlags', 'No feature flags defined.')}</p>
            ) : Object.entries(config?.featureFlags ?? {}).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between border border-border rounded-lg px-3 py-2">
                <span className="text-sm font-medium text-text-primary font-mono">{k}</span>
                <div className="flex items-center gap-3">
                  <button onClick={() => toggleFlag(k)} className={cn('badge', v ? 'bg-green-50 text-green-700' : 'bg-surface-sunken text-text-secondary')}>
                    {v ? t('admin.config.enabled', 'Enabled') : t('admin.config.disabled', 'Disabled')}
                  </button>
                  <button className="btn-ghost text-xs text-rose-600" onClick={() => removeFlag(k)}>{t('admin.config.remove', 'Remove')}</button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input className="input-field flex-1" value={newFlag} onChange={(e) => setNewFlag(e.target.value)} placeholder="new_feature_key" />
            <button className="btn-secondary text-xs whitespace-nowrap" onClick={addFlag}>+ {t('admin.config.addFlag', 'Add flag')}</button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
