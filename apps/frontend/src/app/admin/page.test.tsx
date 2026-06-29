/**
 * Tests for Platform Admin Dashboard page.
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminDashboardPage from './page';
import type { Tenant, PlatformConfig } from './page';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockTenants: Tenant[] = [
  {
    id: 'tenant-1',
    name: 'AIRE Car Wash',
    slug: 'aire-car-wash',
    plan: 'premium',
    status: 'active',
    createdAt: '2024-01-15T00:00:00Z',
  },
  {
    id: 'tenant-2',
    name: 'Clean Pro',
    slug: 'clean-pro',
    plan: 'standard',
    status: 'suspended',
    createdAt: '2024-03-20T00:00:00Z',
  },
  {
    id: 'tenant-3',
    name: 'Sparkle Wash',
    slug: 'sparkle-wash',
    plan: 'enterprise',
    status: 'cancelled',
    createdAt: '2023-11-01T00:00:00Z',
  },
];

const mockConfig: PlatformConfig = {
  defaultPlans: ['standard', 'premium', 'enterprise'],
  pricingTiers: [],
  featureFlags: { alpr_enabled: true, kiosk_mode: false },
};

function setupFetchMock(tenants: Tenant[] = mockTenants, config: PlatformConfig = mockConfig) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/api/admin/tenants')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(tenants),
      });
    }
    if (url.includes('/api/admin/config')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(config),
      });
    }
    return Promise.resolve({ ok: false, status: 404 });
  });
}

describe('AdminDashboardPage', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it('should render the admin dashboard heading', async () => {
    setupFetchMock();
    render(<AdminDashboardPage />);
    await waitFor(() => {
      expect(screen.getByText('Platform Admin Dashboard')).toBeDefined();
    });
  });

  it('should show loading state initially', () => {
    // Never resolve fetch
    mockFetch.mockImplementation(() => new Promise(() => {}));
    render(<AdminDashboardPage />);
    expect(screen.getByTestId('admin-loading')).toBeDefined();
  });

  it('should display tenant list with status, plan, and creation date (Req 4.1)', async () => {
    setupFetchMock();
    render(<AdminDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('tenant-table')).toBeDefined();
    });

    // Verify tenant rows rendered
    expect(screen.getByTestId('tenant-row-tenant-1')).toBeDefined();
    expect(screen.getByTestId('tenant-row-tenant-2')).toBeDefined();
    expect(screen.getByTestId('tenant-row-tenant-3')).toBeDefined();

    // Verify status badges
    expect(screen.getByTestId('tenant-status-tenant-1').textContent).toBe('active');
    expect(screen.getByTestId('tenant-status-tenant-2').textContent).toBe('suspended');
    expect(screen.getByTestId('tenant-status-tenant-3').textContent).toBe('cancelled');
  });

  it('should show empty state when no tenants exist', async () => {
    setupFetchMock([]);
    render(<AdminDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('no-tenants')).toBeDefined();
    });
  });

  it('should show Create Tenant button (Req 4.2)', async () => {
    setupFetchMock();
    render(<AdminDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('create-tenant-btn')).toBeDefined();
    });
  });

  it('should open create form when Create Tenant is clicked', async () => {
    setupFetchMock();
    render(<AdminDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('create-tenant-btn')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('create-tenant-btn'));
    expect(screen.getByTestId('tenant-form-dialog')).toBeDefined();
    expect(screen.getByText('Create Tenant', { selector: 'h3' })).toBeDefined();
  });

  it('should open edit form when Edit is clicked (Req 4.2)', async () => {
    setupFetchMock();
    render(<AdminDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('edit-tenant-tenant-1')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('edit-tenant-tenant-1'));
    expect(screen.getByTestId('tenant-form-dialog')).toBeDefined();
    expect(screen.getByText('Edit Tenant')).toBeDefined();
  });

  it('should show Suspend button for active tenants (Req 4.2)', async () => {
    setupFetchMock();
    render(<AdminDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('suspend-tenant-tenant-1')).toBeDefined();
    });

    // Suspended tenant should NOT have a suspend button
    expect(screen.queryByTestId('suspend-tenant-tenant-2')).toBeNull();
  });

  it('should show Reactivate button for suspended tenants (Req 4.2)', async () => {
    setupFetchMock();
    render(<AdminDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('reactivate-tenant-tenant-2')).toBeDefined();
    });

    // Active tenant should NOT have a reactivate button
    expect(screen.queryByTestId('reactivate-tenant-tenant-1')).toBeNull();
  });

  it('should call suspend API when Suspend is clicked', async () => {
    setupFetchMock();
    render(<AdminDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('suspend-tenant-tenant-1')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('suspend-tenant-tenant-1'));

    await waitFor(() => {
      const suspendCall = mockFetch.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('/suspend') && call[1]?.method === 'PATCH',
      );
      expect(suspendCall).toBeDefined();
    });
  });

  it('should call reactivate API when Reactivate is clicked', async () => {
    setupFetchMock();
    render(<AdminDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('reactivate-tenant-tenant-2')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('reactivate-tenant-tenant-2'));

    await waitFor(() => {
      const reactivateCall = mockFetch.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('/reactivate') && call[1]?.method === 'PATCH',
      );
      expect(reactivateCall).toBeDefined();
    });
  });

  it('should display platform configuration panel (Req 4.3)', async () => {
    setupFetchMock();
    render(<AdminDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('config-panel')).toBeDefined();
    });

    expect(screen.getByTestId('config-plans')).toBeDefined();
    expect(screen.getByTestId('config-feature-flags')).toBeDefined();
  });

  it('should display feature flag toggles', async () => {
    setupFetchMock();
    render(<AdminDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('toggle-flag-alpr_enabled')).toBeDefined();
      expect(screen.getByTestId('toggle-flag-kiosk_mode')).toBeDefined();
    });
  });

  it('should display error message on fetch failure', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/admin/tenants')) {
        return Promise.resolve({ ok: false, status: 500 });
      }
      if (url.includes('/api/admin/config')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockConfig) });
      }
      return Promise.resolve({ ok: false });
    });

    render(<AdminDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('admin-error')).toBeDefined();
    });
  });

  it('should close form dialog on Cancel', async () => {
    setupFetchMock();
    render(<AdminDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('create-tenant-btn')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('create-tenant-btn'));
    expect(screen.getByTestId('tenant-form-dialog')).toBeDefined();

    fireEvent.click(screen.getByTestId('tenant-form-cancel'));
    expect(screen.queryByTestId('tenant-form-dialog')).toBeNull();
  });

  it('should show tenant count in section heading', async () => {
    setupFetchMock();
    render(<AdminDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Tenants (3)')).toBeDefined();
    });
  });
});

describe('AdminLayout', () => {
  it('should export a layout component', async () => {
    const { default: AdminLayout } = await import('./layout');
    expect(AdminLayout).toBeDefined();
    expect(typeof AdminLayout).toBe('function');
  });

  it('should render sidebar navigation', async () => {
    const { default: AdminLayout } = await import('./layout');
    render(
      <AdminLayout>
        <div>Test Content</div>
      </AdminLayout>,
    );
    expect(screen.getByTestId('admin-layout')).toBeDefined();
    expect(screen.getByTestId('admin-sidebar')).toBeDefined();
    expect(screen.getByTestId('admin-nav')).toBeDefined();
  });

  it('should render navigation links for Tenants, Config, Billing, Support', async () => {
    const { default: AdminLayout } = await import('./layout');
    render(
      <AdminLayout>
        <div>Content</div>
      </AdminLayout>,
    );

    expect(screen.getByTestId('nav-tenants')).toBeDefined();
    expect(screen.getByTestId('nav-config')).toBeDefined();
    expect(screen.getByTestId('nav-billing')).toBeDefined();
    expect(screen.getByTestId('nav-support')).toBeDefined();
  });

  it('should render children in the content area', async () => {
    const { default: AdminLayout } = await import('./layout');
    render(
      <AdminLayout>
        <div data-testid="child-content">Hello Admin</div>
      </AdminLayout>,
    );
    expect(screen.getByTestId('admin-content')).toBeDefined();
    expect(screen.getByTestId('child-content')).toBeDefined();
  });
});
