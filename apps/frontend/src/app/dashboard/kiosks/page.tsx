'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { usePublicBranding } from '@/lib/publicBranding';

interface KioskDevice {
  id: string;
  outletId: string;
  label: string | null;
  token: string;
  isActive: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

export default function KiosksPage() {
  const { t } = useI18n();
  const [devices, setDevices] = useState<KioskDevice[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [outletId, setOutletId] = useState('');
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const tenantId = getUser()?.tenantId ?? '';
  // Prefer the tenant's pretty slug so the launch URL is /kiosk/<slug>/… — the
  // public page resolves either form, so fall back to the uuid until slug loads.
  const { slug } = usePublicBranding(tenantId || undefined);
  const tenantRef = slug || tenantId;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const launchUrl = (token: string) => `${origin}/kiosk/${tenantRef}/order?kioskToken=${token}`;

  const load = useCallback(async () => {
    try {
      setDevices(await api.get<KioskDevice[]>('/kiosk-devices'));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.kiosks.errLoad', 'Failed to load kiosks'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    api
      .get<{ branches: { id: string; name: string }[] }>('/hr/my/branch-context')
      .then((ctx) => {
        const b = ctx?.branches ?? [];
        setBranches(b);
        if (b[0]) setOutletId(b[0].id);
      })
      .catch(() => { /* branch list optional */ });
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!outletId) { setError(t('dash.kiosks.errChooseBranch', 'Choose a branch for this kiosk.')); return; }
    setCreating(true); setError('');
    try {
      await api.post('/kiosk-devices', { outletId, label: label.trim() || undefined });
      setLabel('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.kiosks.errCreate', 'Failed to create kiosk'));
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (d: KioskDevice) => {
    try {
      await api.patch(`/kiosk-devices/${d.id}/active`, { isActive: !d.isActive });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.kiosks.errUpdate', 'Failed to update kiosk'));
    }
  };

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(launchUrl(token));
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* clipboard blocked — user can select manually */ }
  };

  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? id;

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-text-primary mb-1">{t('dash.kiosks.title', 'Self-Service Kiosks')}</h1>
      <p className="text-text-secondary mb-6">
        {t('dash.kiosks.intro', "Provision a device token per kiosk. Open the launch URL on the kiosk to let customers identify themselves, order, and pay now (QRIS) or at the cashier — orders appear on the outlet's queue board.")}
      </p>

      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      <form onSubmit={create} className="card mb-6 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="kiosk-branch" className="block text-xs font-medium text-text-secondary mb-1">{t('dash.kiosks.branch', 'Branch')}</label>
          <select id="kiosk-branch" className="input-field py-1.5" value={outletId} onChange={(e) => setOutletId(e.target.value)}>
            {branches.length === 0 && <option value="">{t('dash.kiosks.noBranches', 'No branches')}</option>}
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label htmlFor="kiosk-label" className="block text-xs font-medium text-text-secondary mb-1">{t('dash.kiosks.labelOptional', 'Label (optional)')}</label>
          <input id="kiosk-label" className="input-field py-1.5" placeholder={t('dash.kiosks.labelPlaceholder', 'e.g. Entrance tablet')} value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary" disabled={creating || !outletId}>{creating ? t('dash.kiosks.creating', 'Creating…') : t('dash.kiosks.newKiosk', '+ New kiosk')}</button>
      </form>

      {loading ? (
        <div className="card text-sm text-text-muted">{t('dash.kiosks.loading', 'Loading…')}</div>
      ) : devices.length === 0 ? (
        <div className="card text-sm text-text-muted">{t('dash.kiosks.empty', 'No kiosks yet. Create one above.')}</div>
      ) : (
        <div className="space-y-3">
          {devices.map((d) => (
            <div key={d.id} className="card">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-text-primary">
                    {d.label || t('dash.kiosks.kiosk', 'Kiosk')} <span className="text-text-muted font-normal">· {branchName(d.outletId)}</span>
                  </p>
                  <p className="text-xs text-text-muted">
                    {d.lastSeenAt ? `${t('dash.kiosks.lastSeen', 'Last seen')} ${new Date(d.lastSeenAt).toLocaleString()}` : t('dash.kiosks.neverUsed', 'Never used')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge ${d.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{d.isActive ? t('dash.kiosks.active', 'Active') : t('dash.kiosks.disabled', 'Disabled')}</span>
                  <button className="btn-ghost text-xs" onClick={() => toggleActive(d)}>{d.isActive ? t('dash.kiosks.disable', 'Disable') : t('dash.kiosks.enable', 'Enable')}</button>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <input readOnly className="input-field text-xs flex-1 font-mono" value={launchUrl(d.token)} onFocus={(e) => e.currentTarget.select()} />
                <button className="btn-secondary text-xs" onClick={() => copy(d.token)}>{copied === d.token ? t('dash.kiosks.copied', 'Copied!') : t('dash.kiosks.copyUrl', 'Copy URL')}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
