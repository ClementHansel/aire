'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import BranchFilter from '@/components/dashboard/BranchFilter';
import ProposalsWidget from './ProposalsWidget';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

interface Summary { totalOrders: number; revenue: number; uniqueMembers: number }
interface OutletLite { id: string; name: string }

export default function DashboardHomePage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [outletList, setOutletList] = useState<OutletLite[]>([]);
  const [branch, setBranch] = useState<string>(''); // '' = all branches (global)
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    const u = getUser();
    if (u) setTenantId(u.tenantId);
    api.get<OutletLite[]>('/outlets').then(setOutletList).catch(() => setOutletList([]));
  }, []);

  useEffect(() => {
    const d = today();
    setSummary(null);
    const qs = `dateFrom=${d}&dateTo=${d}${branch ? `&outletId=${branch}` : ''}`;
    api.get<Summary>(`/reports/summary?${qs}`).then(setSummary).catch(() => setSummary(null));
  }, [branch]);

  const stat = (v: number | null | undefined, render: (n: number) => string = (n) => String(n)) =>
    v == null ? '—' : render(v);

  return (
    <div data-testid="dashboard-home">
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-text-primary" data-testid="dashboard-home-title">
            Dashboard Overview
          </h1>
          <p className="mt-1 text-sm text-text-secondary" data-testid="dashboard-home-description">
            Manage your outlets, services, memberships, and view reports from here.
          </p>
        </div>
        <BranchFilter value={branch} onChange={setBranch} />
      </div>

      {/* Quick Stats */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8" data-testid="dashboard-quick-stats">
        <div className="card" data-testid="stat-outlets">
          <p className="text-sm text-text-secondary">Outlets</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{stat(outletList.length || null)}</p>
        </div>
        <div className="card" data-testid="stat-active-members">
          <p className="text-sm text-text-secondary">Members Served (Today)</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{stat(summary?.uniqueMembers)}</p>
        </div>
        <div className="card" data-testid="stat-today-orders">
          <p className="text-sm text-text-secondary">Today&apos;s Orders</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{stat(summary?.totalOrders)}</p>
        </div>
        <div className="card" data-testid="stat-revenue">
          <p className="text-sm text-text-secondary">Revenue (Today)</p>
          <p className="text-2xl font-bold text-primary-600 mt-1">{stat(summary?.revenue, fmt)}</p>
        </div>
      </section>

      {/* Action Proposals */}
      <div className="mb-8">
        {tenantId && <ProposalsWidget tenantId={tenantId} />}
      </div>

      {/* Quick Access */}
      <section data-testid="dashboard-sections">
        <h2 className="section-title mb-4">Quick Access</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="dashboard-section-links">
          {[
            { href: '/dashboard/services', label: 'Manage Services', icon: '🚿' },
            { href: '/dashboard/memberships', label: 'Membership Plans', icon: '💳' },
            { href: '/dashboard/reports', label: 'View Reports', icon: '📈' },
            { href: '/dashboard/settings', label: 'Settings', icon: '⚙️' },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 p-4 rounded-xl border border-border bg-surface-raised hover:bg-surface-sunken transition-colors"
            >
              <span className="text-xl">{item.icon}</span>
              <span className="text-sm font-medium text-text-primary">{item.label}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
