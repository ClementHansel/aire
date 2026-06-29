'use client';

import { Sidebar } from '@/components/dashboard/Sidebar';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

/**
 * Dashboard layout with sidebar navigation and header.
 * Sidebar visible on desktop (≥1024px), bottom nav on tablet (<1024px).
 * Requirements: 3.1, 44.1, 44.2
 */
export default function DashboardLayout({
  children,
}: DashboardLayoutProps) {
  // In production, these would be fetched from auth context or a store
  const tenantName = 'AIRE Dashboard';
  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/dashboard';

  return (
    <div data-testid="dashboard-layout" className="dashboard-layout">
      {/* Sidebar - visible on desktop */}
      <div className="dashboard-sidebar" data-testid="dashboard-sidebar">
        <Sidebar currentPath={currentPath} tenantName={tenantName} />
      </div>

      {/* Main content area */}
      <div className="dashboard-main">
        {/* Header */}
        <header data-testid="dashboard-header" className="dashboard-header">
          <div data-testid="header-tenant-name" className="header-tenant-name">
            {tenantName}
          </div>
        </header>

        {/* Page content */}
        <main data-testid="dashboard-content" className="dashboard-content">
          {children}
        </main>
      </div>

      {/* Bottom nav - visible on tablet (<1024px) */}
      <nav
        data-testid="dashboard-bottom-nav"
        className="dashboard-bottom-nav"
        aria-label="Mobile navigation"
      >
        <a href="/dashboard/outlets" data-testid="bottom-nav-outlets">Outlets</a>
        <a href="/dashboard/services" data-testid="bottom-nav-services">Services</a>
        <a href="/dashboard/memberships" data-testid="bottom-nav-memberships">Memberships</a>
        <a href="/dashboard/reports" data-testid="bottom-nav-reports">Reports</a>
        <a href="/dashboard/invoices" data-testid="bottom-nav-invoices">Invoices</a>
        <a href="/dashboard/settings" data-testid="bottom-nav-settings">Settings</a>
      </nav>
    </div>
  );
}
