'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { isAuthenticated, getUser, logout } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { PageHeader, Panel, ErrorBanner } from '@/components/dashboard/ui';

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
        <Panel title={t('admin.config.defaultPlans', 'Default plans')} description={t('admin.config.defaultPlansDesc', 'Comma-separated list of plans offered to new tenants.')}>
          <input className="input-field" value={plansText} onChange={(e) => setPlansText(e.target.value)} placeholder="standard, premium, enterprise" disabled={loading} />
        </Panel>

        <Panel title={t('admin.config.subscriptionPlans', 'Subscription plans')} description={t('admin.config.subscriptionPlansDesc', 'The plans the platform charges tenants (price, billing cycle, features, limits) now live on their own page — separate from the membership plans each tenant sells to its customers.')}>
          <a href="/admin/plans" className="btn-secondary text-sm inline-block">{t('admin.config.managePlans', 'Manage subscription plans')} →</a>
        </Panel>

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
