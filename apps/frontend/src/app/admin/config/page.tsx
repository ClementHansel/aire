'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { isAuthenticated, getUser, logout } from '@/lib/auth';

interface PricingTier {
  plan: string;
  price: number;
}

interface PlatformConfig {
  defaultPlans: string[];
  pricingTiers: PricingTier[];
  featureFlags: Record<string, boolean>;
}

function normalize(raw: Record<string, unknown>): PlatformConfig {
  const plans = Array.isArray(raw.defaultPlans) ? (raw.defaultPlans as string[]) : ['standard', 'premium', 'enterprise'];
  const tiersRaw = Array.isArray(raw.pricingTiers) ? (raw.pricingTiers as Record<string, unknown>[]) : [];
  const tiers: PricingTier[] = tiersRaw.map((t) => ({
    plan: String(t.plan ?? ''),
    price: Number(t.price ?? 0),
  }));
  const flags = (raw.featureFlags && typeof raw.featureFlags === 'object'
    ? (raw.featureFlags as Record<string, boolean>)
    : {});
  return { defaultPlans: plans, pricingTiers: tiers, featureFlags: flags };
}

export default function AdminConfigPage() {
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
      const msg = err instanceof Error ? err.message : 'Failed to load configuration';
      if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) setForbidden(true);
      else setError(msg);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/'; return; }
    load();
  }, [load]);

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
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally { setSaving(false); }
  };

  const setTier = (i: number, patch: Partial<PricingTier>) => {
    setConfig((c) => c && { ...c, pricingTiers: c.pricingTiers.map((t, idx) => idx === i ? { ...t, ...patch } : t) });
  };
  const addTier = () => setConfig((c) => c && { ...c, pricingTiers: [...c.pricingTiers, { plan: '', price: 0 }] });
  const removeTier = (i: number) => setConfig((c) => c && { ...c, pricingTiers: c.pricingTiers.filter((_, idx) => idx !== i) });

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

  if (loading) return <p className="text-text-muted">Loading…</p>;

  if (forbidden) {
    return (
      <div className="max-w-md">
        <h1 className="text-xl font-bold text-text-primary mb-2">Access Denied</h1>
        <p className="text-sm text-text-secondary">This area requires a Platform Super Admin account. You are signed in as <span className="font-medium">{getUser()?.role?.replace(/_/g, ' ')}</span>.</p>
        <button onClick={logout} className="btn-secondary mt-4">Sign in as different user</button>
      </div>
    );
  }

  return (
    <div data-testid="admin-config">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Platform Config</h1>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}
      {saved && <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700 mb-4">Configuration saved.</div>}

      <div className="space-y-5 max-w-2xl">
        <div className="card">
          <h2 className="section-title mb-1">Default plans</h2>
          <p className="section-description mb-3">Comma-separated list of plans offered to new tenants.</p>
          <input className="input-field" value={plansText} onChange={(e) => setPlansText(e.target.value)} placeholder="standard, premium, enterprise" />
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="section-title">Pricing tiers</h2>
              <p className="section-description">Monthly price per plan (used for billing estimates).</p>
            </div>
            <button className="btn-secondary text-xs" onClick={addTier}>+ Add tier</button>
          </div>
          {config?.pricingTiers.length === 0 ? (
            <p className="text-sm text-text-muted">No pricing tiers configured.</p>
          ) : (
            <div className="space-y-2">
              {config?.pricingTiers.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className="input-field flex-1" value={t.plan} onChange={(e) => setTier(i, { plan: e.target.value })} placeholder="Plan name" />
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-text-muted">Rp</span>
                    <input className="input-field w-32" type="number" value={t.price} onChange={(e) => setTier(i, { price: Number(e.target.value) })} placeholder="0" />
                  </div>
                  <button className="btn-ghost text-xs text-red-600" onClick={() => removeTier(i)}>Remove</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="section-title">Feature flags</h2>
              <p className="section-description">Toggle platform-wide features.</p>
            </div>
          </div>
          <div className="space-y-2 mb-3">
            {Object.keys(config?.featureFlags ?? {}).length === 0 ? (
              <p className="text-sm text-text-muted">No feature flags defined.</p>
            ) : Object.entries(config?.featureFlags ?? {}).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between border border-border rounded-lg px-3 py-2">
                <span className="text-sm font-medium text-text-primary font-mono">{k}</span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => toggleFlag(k)}
                    className={`badge ${v ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}
                  >
                    {v ? 'Enabled' : 'Disabled'}
                  </button>
                  <button className="btn-ghost text-xs text-red-600" onClick={() => removeFlag(k)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input className="input-field flex-1" value={newFlag} onChange={(e) => setNewFlag(e.target.value)} placeholder="new_feature_key" />
            <button className="btn-secondary text-xs" onClick={addFlag}>+ Add flag</button>
          </div>
        </div>
      </div>
    </div>
  );
}
