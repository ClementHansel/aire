'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getUser, isAuthenticated, logout, type AuthUser } from '@/lib/auth';

interface HubTile {
  id: string;
  label: string;
  description: string;
  icon: string;
  href: string;
  accent: string;
}

export default function HubPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [outletId, setOutletId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      window.location.href = '/';
      return;
    }
    const u = getUser();
    setUser(u);
    setChecked(true);
    // Resolve an outlet for the POS / Queue Board tiles. Outlet-scoped users
    // already carry their outlet; owners/admins fetch the tenant's first outlet.
    if (u?.outletId) {
      setOutletId(u.outletId);
    } else {
      api.get<{ id: string }[]>('/outlets')
        .then((outlets) => { const first = outlets[0]; if (first) setOutletId(first.id); })
        .catch(() => { /* no outlet access; tiles fall back to tenant */ });
    }
  }, []);

  if (!checked) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <p className="text-sm text-text-muted">Loading…</p>
      </div>
    );
  }

  const isSuperAdmin = user?.role === 'platform_super_admin';
  // The POS URL param is a label only — the backend resolves the outlet/shift
  // from the authenticated session. Fall back to the tenant when no outlet is set.
  const posAgent = outletId ?? user?.tenantId ?? 'pos';

  const tiles: HubTile[] = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      description: 'Services, inventory, finance, HR, payroll and reports',
      icon: '📊',
      href: '/dashboard',
      accent: 'bg-primary-50 text-primary-700',
    },
    {
      id: 'pos',
      label: 'Point of Sale',
      description: 'Take orders, accept payments, manage shifts and petty cash',
      icon: '🧾',
      href: `/pos/${posAgent}/new-order`,
      accent: 'bg-emerald-50 text-emerald-700',
    },
    {
      id: 'kiosk',
      label: 'Self-Service Kiosk',
      description: 'Customer-facing order status and queue lookup',
      icon: '🖥️',
      href: `/kiosk/${user?.tenantId ?? ''}`,
      accent: 'bg-violet-50 text-violet-700',
    },
  ];

  if (outletId) {
    tiles.push({
      id: 'queue-board',
      label: 'Queue Board',
      description: 'Live outlet display of orders in progress and ready',
      icon: '📺',
      href: `/queue-board/${outletId}`,
      accent: 'bg-sky-50 text-sky-700',
    });
  }

  if (isSuperAdmin) {
    tiles.push({
      id: 'admin',
      label: 'Platform Admin',
      description: 'Manage tenants, platform configuration and support',
      icon: '🛡️',
      href: '/admin',
      accent: 'bg-slate-100 text-slate-700',
    });
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col" data-testid="hub-page">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 lg:px-10 py-5 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-primary-500 rounded-xl flex items-center justify-center">
            <span className="text-base font-bold text-white">A</span>
          </div>
          <span className="font-semibold text-text-primary">AIRE Operations</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium text-text-primary">{user?.name ?? 'User'}</p>
            <p className="text-xs text-text-muted capitalize">{user?.role?.replace(/_/g, ' ') ?? ''}</p>
          </div>
          <button onClick={logout} className="btn-ghost text-xs">↩ Sign out</button>
        </div>
      </header>

      {/* Hub */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-4xl">
          <div className="text-center mb-10">
            <p className="eyebrow mb-3">Workspace</p>
            <h1 className="text-3xl lg:text-4xl font-bold text-text-primary">
              Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
            </h1>
            <p className="mt-2 text-text-secondary">Choose where you want to work today.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5" data-testid="hub-tiles">
            {tiles.map((tile) => (
              <Link
                key={tile.id}
                href={tile.href}
                data-testid={`hub-tile-${tile.id}`}
                className="group card flex items-start gap-4 p-6 transition-all hover:shadow-md hover:border-border-strong"
              >
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shrink-0 ${tile.accent}`}>
                  {tile.icon}
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-text-primary group-hover:text-primary-600 transition-colors">
                    {tile.label}
                  </h2>
                  <p className="mt-1 text-sm text-text-secondary">{tile.description}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
