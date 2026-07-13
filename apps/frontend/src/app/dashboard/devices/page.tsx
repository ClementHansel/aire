'use client';

/**
 * Device Registry — the flat, filterable inventory of every registered LAN
 * device across branches (cameras, controllers, printers, kiosks, terminals,
 * routers). Cards open the shared DeviceDetailModal.
 *   GET /api/devices?outletId=&category=
 *   GET /api/outlets
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { HardDrive } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { OutletOption } from '../settings/DeviceDiscoverySection';
import {
  type RegistryDevice, type DeviceCategory, DEVICE_CATEGORIES,
  categoryMeta, statusToken, normalizeStatus,
} from '@/lib/topology';
import { DeviceDetailModal } from '@/components/dashboard/DeviceDetailModal';

type CategoryFilter = 'all' | DeviceCategory;

export default function DevicesPage() {
  const { t } = useI18n();
  const [outlets, setOutlets] = useState<OutletOption[]>([]);
  const [outletId, setOutletId] = useState('');           // '' = all branches
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [devices, setDevices] = useState<RegistryDevice[] | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<RegistryDevice | null>(null);

  useEffect(() => {
    api.get<OutletOption[]>('/outlets').then(setOutlets).catch(() => setOutlets([]));
  }, []);

  const outletName = useMemo(
    () => Object.fromEntries(outlets.map((o) => [o.id, o.name])),
    [outlets],
  );

  const load = useCallback(async () => {
    setDevices(null);
    setError('');
    const qs = new URLSearchParams();
    if (outletId) qs.set('outletId', outletId);
    if (category !== 'all') qs.set('category', category);
    try {
      const list = await api.get<RegistryDevice[]>(`/devices${qs.toString() ? `?${qs}` : ''}`);
      setDevices(list);
    } catch (e) {
      setDevices([]);
      setError(e instanceof Error ? e.message : 'Failed to load devices');
    }
  }, [outletId, category]);
  useEffect(() => { load(); }, [load]);

  // Group by category for the sectioned layout.
  const grouped = useMemo(() => {
    const map = new Map<DeviceCategory, RegistryDevice[]>();
    for (const d of devices ?? []) {
      const arr = map.get(d.category) ?? [];
      arr.push(d);
      map.set(d.category, arr);
    }
    return DEVICE_CATEGORIES
      .filter((c) => (category === 'all' ? map.has(c) : c === category))
      .map((c) => ({ category: c, items: map.get(c) ?? [] }));
  }, [devices, category]);

  const total = devices?.length ?? 0;

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-text-primary">
            <HardDrive className="h-6 w-6" strokeWidth={1.75} />{t('dash.devices.title', 'Devices')}
          </h1>
          <p className="text-sm text-text-secondary">
            {t('dash.devices.subtitle', 'Every registered branch device — cameras, controllers, printers, kiosks, terminals and routers.')}
          </p>
        </div>
        <select
          className="input-field w-auto"
          value={outletId}
          onChange={(e) => setOutletId(e.target.value)}
          data-testid="devices-outlet-select"
        >
          <option value="">{t('dash.devices.allBranches', 'All branches')}</option>
          {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>

      {/* Category segmented control */}
      <div className="mb-6 flex flex-wrap gap-1.5" data-testid="devices-category-filter">
        <SegBtn active={category === 'all'} onClick={() => setCategory('all')}>
          {t('dash.devices.catAll', 'All')}
          <Count n={total} active={category === 'all'} />
        </SegBtn>
        {DEVICE_CATEGORIES.map((c) => {
          const meta = categoryMeta(c);
          const Icon = meta.icon;
          return (
            <SegBtn key={c} active={category === c} onClick={() => setCategory(c)}>
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t(`dash.devices.cat.${c}`, meta.label)}
            </SegBtn>
          );
        })}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Body */}
      {devices === null ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[92px] animate-pulse rounded-lg bg-surface-sunken" />
          ))}
        </div>
      ) : total === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-8">
          {grouped.map(({ category: c, items }) => {
            if (items.length === 0) return null;
            const meta = categoryMeta(c);
            const Icon = meta.icon;
            return (
              <section key={c}>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-secondary">
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                  {t(`dash.devices.cat.${c}`, meta.label)}
                  <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-normal text-text-muted">{items.length}</span>
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((d) => (
                    <DeviceCard
                      key={d.id}
                      device={d}
                      branch={d.outletName || outletName[d.outletId] || ''}
                      onClick={() => setSelected(d)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {selected && <DeviceDetailModal device={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────── */

function SegBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'border-primary-300 bg-primary-50 text-primary-700'
          : 'border-border text-text-secondary hover:bg-surface-sunken hover:text-text-primary',
      )}
    >
      {children}
    </button>
  );
}

function Count({ n, active }: { n: number; active: boolean }) {
  return (
    <span className={cn('rounded-full px-1.5 text-2xs font-semibold', active ? 'bg-primary-200 text-primary-700' : 'bg-surface-sunken text-text-muted')}>
      {n}
    </span>
  );
}

function DeviceCard({ device, branch, onClick }: { device: RegistryDevice; branch: string; onClick: () => void }) {
  const meta = categoryMeta(device.category);
  const st = statusToken(normalizeStatus(device.status));
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`device-card-${device.id}`}
      className="card group flex items-center gap-3 p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-luxury"
    >
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-text-secondary group-hover:text-primary-600">
        <Icon className="h-5 w-5" strokeWidth={1.75} />
        <span className={cn('absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface-raised', st.dot)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text-primary">{device.name}</p>
        <p className="truncate font-mono text-xs text-text-muted">{device.ipAddress || '—'}</p>
        {branch && <p className="truncate text-xs text-text-muted">{branch}</p>}
      </div>
      <span className={cn('badge shrink-0', st.badge)}>{st.label}</span>
    </button>
  );
}

function EmptyState() {
  const { t } = useI18n();
  return (
    <div className="card flex flex-col items-center justify-center gap-2 py-16 text-center">
      <HardDrive className="h-10 w-10 text-text-muted" strokeWidth={1.5} />
      <p className="text-sm font-medium text-text-primary">{t('dash.devices.emptyTitle', 'No devices registered')}</p>
      <p className="max-w-sm text-sm text-text-muted">
        {t('dash.devices.emptyHint', 'Run Scan devices from a branch (Settings → Devices) to discover and register hardware here.')}
      </p>
    </div>
  );
}
