import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Platform Admin — AIRE Operations Platform',
  description: 'Platform-level administration dashboard for managing tenants and configuration',
};

/**
 * Admin layout wrapping the platform admin dashboard.
 * Restricted to Platform_Super_Admin role.
 *
 * Requirements: 4.1–4.5
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-testid="admin-layout" style={{ display: 'flex', minHeight: '100vh' }}>
      <aside
        data-testid="admin-sidebar"
        style={{
          width: '240px',
          backgroundColor: '#1a1a2e',
          color: '#ffffff',
          padding: '1.5rem 1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
        }}
      >
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', fontWeight: 600 }}>
          AIRE Admin
        </h2>
        <nav data-testid="admin-nav">
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <li>
              <a
                href="/hub"
                data-testid="nav-hub"
                style={{ color: '#9ca3af', textDecoration: 'none', padding: '0.5rem 0.75rem', display: 'block', borderRadius: '6px', borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: '0.5rem' }}
              >
                🏠 Hub
              </a>
            </li>
            <li>
              <a
                href="/admin"
                data-testid="nav-tenants"
                style={{ color: '#e0e0e0', textDecoration: 'none', padding: '0.5rem 0.75rem', display: 'block', borderRadius: '6px' }}
              >
                Tenants
              </a>
            </li>
            <li>
              <a
                href="/admin/config"
                data-testid="nav-config"
                style={{ color: '#e0e0e0', textDecoration: 'none', padding: '0.5rem 0.75rem', display: 'block', borderRadius: '6px' }}
              >
                Platform Config
              </a>
            </li>
            <li>
              <a
                href="/admin/billing"
                data-testid="nav-billing"
                style={{ color: '#e0e0e0', textDecoration: 'none', padding: '0.5rem 0.75rem', display: 'block', borderRadius: '6px' }}
              >
                Billing
              </a>
            </li>
            <li>
              <a
                href="/admin/support"
                data-testid="nav-support"
                style={{ color: '#e0e0e0', textDecoration: 'none', padding: '0.5rem 0.75rem', display: 'block', borderRadius: '6px' }}
              >
                Support
              </a>
            </li>
          </ul>
        </nav>
      </aside>
      <main
        data-testid="admin-content"
        style={{ flex: 1, padding: '2rem', backgroundColor: '#f8f9fa' }}
      >
        {children}
      </main>
    </div>
  );
}
