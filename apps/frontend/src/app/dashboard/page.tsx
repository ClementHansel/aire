import ProposalsWidget from './ProposalsWidget';

/**
 * Tenant Dashboard home/overview page.
 * Shows multi-outlet overview and quick access to key sections.
 * Requirements: 3.1, 3.6, 6.3, 7.3
 */
export default function DashboardHomePage() {
  return (
    <div data-testid="dashboard-home">
      <h1 data-testid="dashboard-home-title">Dashboard Overview</h1>
      <p data-testid="dashboard-home-description">
        Manage your outlets, services, memberships, and view reports from here.
      </p>

      <section data-testid="dashboard-quick-stats" className="dashboard-quick-stats">
        <div data-testid="stat-outlets" className="stat-card">
          <span className="stat-label">Outlets</span>
          <span className="stat-value">—</span>
        </div>
        <div data-testid="stat-active-members" className="stat-card">
          <span className="stat-label">Active Members</span>
          <span className="stat-value">—</span>
        </div>
        <div data-testid="stat-today-orders" className="stat-card">
          <span className="stat-label">Today&apos;s Orders</span>
          <span className="stat-value">—</span>
        </div>
        <div data-testid="stat-revenue" className="stat-card">
          <span className="stat-label">Revenue (Today)</span>
          <span className="stat-value">—</span>
        </div>
      </section>

      <section data-testid="dashboard-proposals" className="dashboard-proposals">
        <ProposalsWidget tenantId="current" />
      </section>

      <section data-testid="dashboard-sections" className="dashboard-sections">
        <h2>Quick Access</h2>
        <ul data-testid="dashboard-section-links">
          <li><a href="/dashboard/outlets">Manage Outlets</a></li>
          <li><a href="/dashboard/services">Manage Services</a></li>
          <li><a href="/dashboard/memberships">Membership Plans</a></li>
          <li><a href="/dashboard/vouchers">Voucher Templates</a></li>
          <li><a href="/dashboard/campaigns">Campaigns</a></li>
          <li><a href="/dashboard/reports">View Reports</a></li>
          <li><a href="/dashboard/invoices">Invoices &amp; Receipts</a></li>
          <li><a href="/dashboard/audit-logs">Audit Logs</a></li>
        </ul>
      </section>
    </div>
  );
}
