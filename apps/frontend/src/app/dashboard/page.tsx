'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getUser } from '@/lib/auth';
import ProposalsWidget from './ProposalsWidget';

export default function DashboardHomePage() {
  const [tenantId, setTenantId] = useState<string | null>(null);

  useEffect(() => {
    const u = getUser();
    if (u) setTenantId(u.tenantId);
  }, []);

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
          <p className="text-2xl font-bold text-text-primary mt-1">—</p>
        </div>
        <div className="card" data-testid="stat-active-members">
          <p className="text-sm text-text-secondary">Active Members</p>
          <p className="text-2xl font-bold text-text-primary mt-1">—</p>
        </div>
        <div className="card" data-testid="stat-today-orders">
          <p className="text-sm text-text-secondary">Today&apos;s Orders</p>
          <p className="text-2xl font-bold text-text-primary mt-1">—</p>
        </div>
        <div className="card" data-testid="stat-revenue">
          <p className="text-sm text-text-secondary">Revenue (Today)</p>
          <p className="text-2xl font-bold text-text-primary mt-1">—</p>
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
