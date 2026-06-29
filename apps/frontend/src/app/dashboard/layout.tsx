'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { id: 'overview', label: 'Overview', href: '/dashboard', icon: '📊' },
  { id: 'services', label: 'Services', href: '/dashboard/services', icon: '🚿' },
  { id: 'memberships', label: 'Memberships', href: '/dashboard/memberships', icon: '💳' },
  { id: 'reports', label: 'Reports', href: '/dashboard/reports', icon: '📈' },
  { id: 'settings', label: 'Settings', href: '/dashboard/settings', icon: '⚙️' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-surface flex" data-testid="dashboard-layout">
      {/* Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 bg-surface-raised border-r border-border" data-testid="dashboard-sidebar">
        {/* Brand */}
        <div className="p-5 border-b border-border">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-primary-500 rounded-lg flex items-center justify-center">
              <span className="text-sm font-bold text-white">A</span>
            </div>
            <span className="font-semibold text-text-primary" data-testid="header-tenant-name">AIRE Dashboard</span>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-0.5" data-testid="sidebar-nav-list">
          {navItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.id}
                href={item.href}
                data-testid={`nav-item-${item.id}`}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary'
                }`}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom section */}
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
              <span className="text-xs font-medium text-primary-700">TO</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">Tenant Owner</p>
              <p className="text-xs text-text-muted truncate">owner@aire.com</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center justify-between p-4 bg-surface-raised border-b border-border" data-testid="dashboard-header">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-7 h-7 bg-primary-500 rounded-lg flex items-center justify-center">
              <span className="text-xs font-bold text-white">A</span>
            </div>
            <span className="font-semibold text-sm text-text-primary">AIRE</span>
          </Link>
        </header>

        {/* Page content */}
        <main className="flex-1 p-6 lg:p-8 overflow-auto" data-testid="dashboard-content">
          {children}
        </main>

        {/* Mobile bottom nav */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-surface-raised border-t border-border flex justify-around py-2 px-4" data-testid="dashboard-bottom-nav" aria-label="Mobile navigation">
          {navItems.slice(0, 5).map((item) => {
            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.id}
                href={item.href}
                data-testid={`bottom-nav-${item.id}`}
                className={`flex flex-col items-center gap-0.5 text-xs ${
                  isActive ? 'text-primary-600' : 'text-text-muted'
                }`}
              >
                <span className="text-lg">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
