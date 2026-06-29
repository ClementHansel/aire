/**
 * Unit tests for Dashboard layout component.
 * Requirements: 3.1, 44.1, 44.2
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DashboardLayout from './layout';

describe('DashboardLayout', () => {
  it('should render the dashboard layout container', () => {
    render(
      <DashboardLayout>
        <div>Child content</div>
      </DashboardLayout>,
    );
    expect(screen.getByTestId('dashboard-layout')).toBeInTheDocument();
  });

  it('should render sidebar navigation', () => {
    render(
      <DashboardLayout>
        <div>Child content</div>
      </DashboardLayout>,
    );
    expect(screen.getByTestId('dashboard-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  });

  it('should render header with default tenant name', () => {
    render(
      <DashboardLayout>
        <div>Child content</div>
      </DashboardLayout>,
    );
    const header = screen.getByTestId('dashboard-header');
    expect(header).toBeInTheDocument();
    expect(screen.getByTestId('header-tenant-name')).toHaveTextContent('AIRE Dashboard');
  });

  it('should render children in the content area', () => {
    render(
      <DashboardLayout>
        <div data-testid="test-child">Hello Dashboard</div>
      </DashboardLayout>,
    );
    const content = screen.getByTestId('dashboard-content');
    expect(content).toBeInTheDocument();
    expect(screen.getByTestId('test-child')).toBeInTheDocument();
    expect(screen.getByTestId('test-child')).toHaveTextContent('Hello Dashboard');
  });

  it('should render bottom navigation for mobile/tablet', () => {
    render(
      <DashboardLayout>
        <div>Child content</div>
      </DashboardLayout>,
    );
    const bottomNav = screen.getByTestId('dashboard-bottom-nav');
    expect(bottomNav).toBeInTheDocument();
    expect(bottomNav).toHaveAttribute('aria-label', 'Mobile navigation');

    // Check key navigation links are present in bottom nav
    expect(screen.getByTestId('bottom-nav-outlets')).toBeInTheDocument();
    expect(screen.getByTestId('bottom-nav-services')).toBeInTheDocument();
    expect(screen.getByTestId('bottom-nav-memberships')).toBeInTheDocument();
    expect(screen.getByTestId('bottom-nav-reports')).toBeInTheDocument();
    expect(screen.getByTestId('bottom-nav-invoices')).toBeInTheDocument();
    expect(screen.getByTestId('bottom-nav-settings')).toBeInTheDocument();
  });
});
