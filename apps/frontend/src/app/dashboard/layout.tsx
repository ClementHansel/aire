'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getUser, isAuthenticated, logout, type AuthUser } from '@/lib/auth';

interface NavItem { id: string; label: string; href: string; icon: string }
interface NavSection { title: string | null; items: NavItem[] }

// Grouped navigation. Sections keep related tools together and prevent the
// "wall of links" problem. Icons are unique per item to avoid visual collisions.
const navSections: NavSection[] = [
  {
    title: null,
    items: [
      { id: 'hub', label: 'Hub', href: '/hub', icon: '🏠' },
      { id: 'overview', label: 'Overview', href: '/dashboard', icon: '📊' },
    ],
  },
  {
    title: 'Analytics',
    items: [
      { id: 'transactions', label: 'Transactions', href: '/dashboard/transactions', icon: '🧾' },
      { id: 'reports', label: 'Reports', href: '/dashboard/reports', icon: '📑' },
      { id: 'sales', label: 'Sales & Leads', href: '/dashboard/sales', icon: '📈' },
    ],
  },
  {
    title: 'Customers',
    items: [
      { id: 'crm', label: 'Customers & CRM', href: '/dashboard/crm', icon: '🧑‍🤝‍🧑' },
      { id: 'memberships', label: 'Memberships', href: '/dashboard/memberships', icon: '🎫' },
      { id: 'vouchers', label: 'Vouchers', href: '/dashboard/vouchers', icon: '🎟️' },
      { id: 'promotions', label: 'Promotions', href: '/dashboard/promotions', icon: '🎉' },
    ],
  },
  {
    title: 'Catalog & Outlets',
    items: [
      { id: 'branches', label: 'Branches', href: '/dashboard/branches', icon: '🏢' },
      { id: 'services', label: 'Services', href: '/dashboard/services', icon: '🚿' },
      { id: 'catalog', label: 'Catalog', href: '/dashboard/catalog', icon: '🏷️' },
      { id: 'payment-methods', label: 'Payment Methods', href: '/dashboard/payment-methods', icon: '💳' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { id: 'inventory', label: 'Inventory', href: '/dashboard/inventory', icon: '📦' },
      { id: 'procurement', label: 'Procurement', href: '/dashboard/procurement', icon: '🛒' },
    ],
  },
  {
    title: 'Finance & People',
    items: [
      { id: 'finance', label: 'Finance', href: '/dashboard/finance', icon: '💰' },
      { id: 'settlement', label: 'Settlement', href: '/dashboard/settlement', icon: '🔁' },
      { id: 'hr', label: 'HR', href: '/dashboard/hr', icon: '👥' },
      { id: 'payroll', label: 'Payroll', href: '/dashboard/payroll', icon: '💵' },
    ],
  },
  {
    title: 'AI',
    items: [
      { id: 'assistant', label: 'AI Assistant', href: '/dashboard/assistant', icon: '🤖' },
      { id: 'ai-agent', label: 'Agentic AI (WhatsApp)', href: '/dashboard/ai-agent', icon: '🧠' },
      { id: 'conversations', label: 'Conversations', href: '/dashboard/conversations', icon: '💬' },
      { id: 'monitoring', label: 'AI Monitoring', href: '/dashboard/monitoring', icon: '📡' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { id: 'users', label: 'Users & Roles', href: '/dashboard/users', icon: '🔑' },
      { id: 'settings', label: 'Settings', href: '/dashboard/settings', icon: '⚙️' },
    ],
  },
];

// Flat list for the mobile bottom bar (kept short and explicit).
const mobileItems: NavItem[] = [
  { id: 'hub', label: 'Hub', href: '/hub', icon: '🏠' },
  { id: 'overview', label: 'Overview', href: '/dashboard', icon: '📊' },
  { id: 'transactions', label: 'Transactions', href: '/dashboard/transactions', icon: '🧾' },
  { id: 'crm', label: 'CRM', href: '/dashboard/crm', icon: '🧑‍🤝‍🧑' },
  { id: 'assistant', label: 'Assistant', href: '/dashboard/assistant', icon: '🤖' },
];

function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      window.location.href = '/';
      return;
    }
    setUser(getUser());
    setChecked(true);
  }, []);

  if (!checked) {
    return (
      <div className="h-screen bg-surface flex items-center justify-center">
        <p className="text-sm text-text-muted">Loading…</p>
      </div>
    );
  }

  const isActive = (href: string) =>
    pathname === href || (href !== '/dashboard' && href !== '/hub' && pathname.startsWith(href));

  return (
    // h-screen + overflow-hidden makes the app shell own the viewport; only the
    // <main> region scrolls, so pages never produce a second (body) scrollbar.
    <div className="h-screen overflow-hidden bg-surface flex" data-testid="dashboard-layout">
      {/* Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 bg-surface-raised border-r border-border" data-testid="dashboard-sidebar">
        {/* Brand */}
        <div className="p-5 border-b border-border shrink-0">
          <Link href="/hub" className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-primary-500 rounded-lg flex items-center justify-center">
              <span className="text-sm font-bold text-white">A</span>
            </div>
            <span className="font-semibold text-text-primary" data-testid="header-tenant-name">AIRE Dashboard</span>
          </Link>
        </div>

        {/* Navigation (its own scroll region) */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-4 min-h-0" data-testid="sidebar-nav-list">
          {navSections.map((section, idx) => (
            <div key={section.title ?? `section-${idx}`} className="space-y-0.5">
              {section.title && (
                <p className="px-3 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  {section.title}
                </p>
              )}
              {section.items.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  data-testid={`nav-item-${item.id}`}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive(item.href)
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary'
                  }`}
                >
                  <span className="text-base">{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        {/* Bottom section */}
        <div className="p-4 border-t border-border shrink-0">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
              <span className="text-xs font-medium text-primary-700">{user ? initials(user.name) : '··'}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">{user?.name ?? 'User'}</p>
              <p className="text-xs text-text-muted truncate capitalize">{user?.role?.replace(/_/g, ' ') ?? ''}</p>
            </div>
          </div>
          <button onClick={logout} className="btn-ghost w-full text-xs justify-start">
            ↩ Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 h-screen">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center justify-between p-4 bg-surface-raised border-b border-border shrink-0" data-testid="dashboard-header">
          <Link href="/hub" className="flex items-center gap-2">
            <div className="w-7 h-7 bg-primary-500 rounded-lg flex items-center justify-center">
              <span className="text-xs font-bold text-white">A</span>
            </div>
            <span className="font-semibold text-sm text-text-primary">AIRE</span>
          </Link>
          <button onClick={logout} className="text-xs text-text-secondary">Sign out</button>
        </header>

        {/* Page content — the single vertical scroll container */}
        <main className="flex-1 overflow-y-auto min-h-0 p-6 lg:p-8 pb-20 lg:pb-8" data-testid="dashboard-content">
          {children}
        </main>

        {/* Mobile bottom nav */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-surface-raised border-t border-border flex justify-around py-2 px-4" data-testid="dashboard-bottom-nav" aria-label="Mobile navigation">
          {mobileItems.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              data-testid={`bottom-nav-${item.id}`}
              className={`flex flex-col items-center gap-0.5 text-xs ${
                isActive(item.href) ? 'text-primary-600' : 'text-text-muted'
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
