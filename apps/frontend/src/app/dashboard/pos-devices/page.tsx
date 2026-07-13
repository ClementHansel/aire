'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { DocumentDesigner } from '@/components/dashboard/DocumentDesigner';

type PosTab = 'terminals' | 'receipt';

interface PosDevice {
  id: string;
  outletId: string;
  label: string | null;
  token: string;
  isActive: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

export default function PosDevicesPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<PosTab>('terminals');
  const [devices, setDevices] = useState<PosDevice[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [outletId, setOutletId] = useState('');
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const launchUrl = (token: string) => `${origin}/pos/launch?posToken=${token}`;

  const load = useCallback(async () => {
    try {
      setDevices(await api.get<PosDevice[]>('/pos-devices'));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.posDevices.errLoad', 'Failed to load POS devices'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Deep-link support: /dashboard/pos-devices?tab=receipt
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('tab');
    if (q === 'receipt' || q === 'terminals') setTab(q);
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
    if (!outletId) { setError(t('dash.posDevices.errChooseBranch', 'Choose a branch for this POS terminal.')); return; }
    setCreating(true); setError('');
    try {
      await api.post('/pos-devices', { outletId, label: label.trim() || undefined });
      setLabel('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.posDevices.errCreate', 'Failed to create POS device'));
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (d: PosDevice) => {
    try {
      await api.patch(`/pos-devices/${d.id}/active`, { isActive: !d.isActive });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.posDevices.errUpdate', 'Failed to update POS device'));
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
    <div>
      <h1 className="text-2xl font-bold text-text-primary mb-4">{t('dash.posDevices.title', 'POS Terminals')}</h1>

      <div className="flex gap-1 border-b border-border mb-6">
        {([
          { key: 'terminals' as const, label: t('dash.posDevices.tabTerminals', 'Terminals') },
          { key: 'receipt' as const, label: t('dash.posDevices.tabReceipt', 'Receipt Designer') },
        ]).map((tb) => (
          <button
            key={tb.key}
            data-testid={`pos-tab-${tb.key}`}
            onClick={() => setTab(tb.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${
              tab === tb.key ? 'border-primary-500 text-primary-600' : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === 'receipt' ? (
        <DocumentDesigner kind="receipt" showHeading={false} />
      ) : (
      <div className="max-w-4xl">
      <p className="text-text-secondary mb-6">
        {t('dash.posDevices.intro', 'Register each POS terminal as a device bound to a branch. Open its launch URL on the terminal once — the device is then pinned to that branch, and cashiers sign in with their own email + password to ring up orders and manage shifts.')}
      </p>

      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      <form onSubmit={create} className="card mb-6 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="pos-branch" className="block text-xs font-medium text-text-secondary mb-1">{t('dash.posDevices.branch', 'Branch')}</label>
          <select id="pos-branch" className="input-field py-1.5" value={outletId} onChange={(e) => setOutletId(e.target.value)}>
            {branches.length === 0 && <option value="">{t('dash.posDevices.noBranches', 'No branches')}</option>}
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label htmlFor="pos-label" className="block text-xs font-medium text-text-secondary mb-1">{t('dash.posDevices.labelOptional', 'Label (optional)')}</label>
          <input id="pos-label" className="input-field py-1.5" placeholder={t('dash.posDevices.labelPlaceholder', 'e.g. Front counter')} value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary" disabled={creating || !outletId}>{creating ? t('dash.posDevices.creating', 'Creating…') : t('dash.posDevices.newDevice', '+ New terminal')}</button>
      </form>

      {loading ? (
        <div className="card text-sm text-text-muted">{t('dash.posDevices.loading', 'Loading…')}</div>
      ) : devices.length === 0 ? (
        <div className="card text-sm text-text-muted">{t('dash.posDevices.empty', 'No POS terminals yet. Register one above.')}</div>
      ) : (
        <div className="space-y-3">
          {devices.map((d) => (
            <div key={d.id} className="card">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-text-primary">
                    {d.label || t('dash.posDevices.device', 'POS terminal')} <span className="text-text-muted font-normal">· {branchName(d.outletId)}</span>
                  </p>
                  <p className="text-xs text-text-muted">
                    {d.lastSeenAt ? `${t('dash.posDevices.lastSeen', 'Last seen')} ${new Date(d.lastSeenAt).toLocaleString()}` : t('dash.posDevices.neverUsed', 'Never used')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge ${d.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{d.isActive ? t('dash.posDevices.active', 'Active') : t('dash.posDevices.disabled', 'Disabled')}</span>
                  <button className="btn-ghost text-xs" onClick={() => toggleActive(d)}>{d.isActive ? t('dash.posDevices.disable', 'Disable') : t('dash.posDevices.enable', 'Enable')}</button>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <input readOnly className="input-field text-xs flex-1 font-mono" value={launchUrl(d.token)} onFocus={(e) => e.currentTarget.select()} />
                <button className="btn-secondary text-xs" onClick={() => copy(d.token)}>{copied === d.token ? t('dash.posDevices.copied', 'Copied!') : t('dash.posDevices.copyUrl', 'Copy URL')}</button>
              </div>
            </div>
          ))}
        </div>
      )}
      </div>
      )}
    </div>
  );
}
