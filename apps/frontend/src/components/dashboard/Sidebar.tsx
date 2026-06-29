'use client';

import { ReactNode } from 'react';

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: ReactNode;
}

const navSections: NavItem[] = [
  { id: 'outlets', label: 'Outlets', href: '/dashboard/outlets', icon: <span aria-hidden="true">🏪</span> },
  { id: 'services', label: 'Services', href: '/dashboard/services', icon: <span aria-hidden="true">🚿</span> },
  { id: 'memberships', label: 'Memberships', href: '/dashboard/memberships', icon: <span aria-hidden="true">💳</span> },
  { id: 'vouchers', label: 'Vouchers', href: '/dashboard/vouchers', icon: <span aria-hidden="true">🎟️</span> },
  { id: 'campaigns', label: 'Campaigns', href: '/dashboard/campaigns', icon: <span aria-hidden="true">📢</span> },
  { id: 'reports', label: 'Reports', href: '/dashboard/reports', icon: <span aria-hidden="true">📊</span> },
  { id: 'invoices', label: 'Invoices', href: '/dashboard/invoices', icon: <span aria-hidden="true">🧾</span> },
  { id: 'audit-logs', label: 'Audit Logs', href: '/dashboard/audit-logs', icon: <span aria-hidden="true">📋</span> },
  { id: 'settings', label: 'Settings', href: '/dashboard/settings', icon: <span aria-hidden="true">⚙️</span> },
];

interface SidebarProps {
  currentPath?: string;
  tenantName?: string;
}

export function Sidebar({ currentPath = '/dashboard', tenantName }: SidebarProps) {
  return (
    <aside data-testid="sidebar" className="sidebar" role="navigation" aria-label="Dashboard navigation">
      {tenantName && (
        <div data-testid="sidebar-tenant-name" className="sidebar-tenant">
          {tenantName}
        </div>
      )}
      <nav>
        <ul data-testid="sidebar-nav-list" className="sidebar-nav-list">
          {navSections.map((item) => {
            const isActive = currentPath === item.href || currentPath.startsWith(item.href + '/');
            return (
              <li key={item.id}>
                <a
                  data-testid={`nav-item-${item.id}`}
                  href={item.href}
                  className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span className="sidebar-nav-icon">{item.icon}</span>
                  <span className="sidebar-nav-label">{item.label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

export { navSections };
