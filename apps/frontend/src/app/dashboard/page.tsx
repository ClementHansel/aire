'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import ProposalsWidget from './ProposalsWidget';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

interface Summary { totalOrders: number; revenue: number; uniqueMembers: number }

export default function DashboardHomePage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [outlets, setOutlets] = useState<number | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    const u = getUser();
    if (u) setTenantId(u.tenantId);
    const d = today();
    api.get<{ id: string }[]>('/outlets').then((o) => setOutlets(o.length)).catch(() => setOutlets(null));
    api.get<Summary>(`/reports/summary?dateFrom=${d}&dateTo=${d}`).then(setSummary).catch(() => setSummary(null));
  }, []);

  const stat = (v: number | null | undefined, render: (n: number) => string = (n) => String(n)) =>
    v == null ? '—' : render(v);

  return (
    <div data-testid="dashboard-home">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-text-primary" data-testid="dashboard-home-title">
          Dashboard Overview
        </h1>
        <p className="mt-1 text-sm text-text-secondary" data-testid="dashboard-home-description">
          Manage your outlets, services, memberships, and view reports from here.
        </p>
      </div>

      {/* Quick Stats */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8" data-testid="dashboard-quick-stats">
        <div className="card" data-testid="stat-outlets">
          <p className="text-sm text-text-secondary">Outlets</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{stat(outlets)}</p>
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
