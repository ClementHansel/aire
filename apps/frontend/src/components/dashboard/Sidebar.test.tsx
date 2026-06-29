/**
 * Unit tests for Sidebar component.
 * Requirements: 3.1-3.7, 44.1, 44.2
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar, navSections } from './Sidebar';

describe('Sidebar', () => {
  it('should render the sidebar element with navigation role', () => {
    render(<Sidebar />);
    const sidebar = screen.getByTestId('sidebar');
    expect(sidebar).toBeInTheDocument();
    expect(sidebar).toHaveAttribute('role', 'navigation');
    expect(sidebar).toHaveAttribute('aria-label', 'Dashboard navigation');
  });

  it('should render all navigation sections', () => {
    render(<Sidebar />);
    const navList = screen.getByTestId('sidebar-nav-list');
    expect(navList).toBeInTheDocument();

    // Verify all expected navigation items are present
    expect(screen.getByTestId('nav-item-outlets')).toBeInTheDocument();
    expect(screen.getByTestId('nav-item-services')).toBeInTheDocument();
    expect(screen.getByTestId('nav-item-memberships')).toBeInTheDocument();
    expect(screen.getByTestId('nav-item-vouchers')).toBeInTheDocument();
    expect(screen.getByTestId('nav-item-campaigns')).toBeInTheDocument();
    expect(screen.getByTestId('nav-item-reports')).toBeInTheDocument();
    expect(screen.getByTestId('nav-item-invoices')).toBeInTheDocument();
    expect(screen.getByTestId('nav-item-audit-logs')).toBeInTheDocument();
  });

  it('should have correct labels for all navigation items', () => {
    render(<Sidebar />);

    expect(screen.getByTestId('nav-item-outlets')).toHaveTextContent('Outlets');
    expect(screen.getByTestId('nav-item-services')).toHaveTextContent('Services');
    expect(screen.getByTestId('nav-item-memberships')).toHaveTextContent('Memberships');
    expect(screen.getByTestId('nav-item-vouchers')).toHaveTextContent('Vouchers');
    expect(screen.getByTestId('nav-item-campaigns')).toHaveTextContent('Campaigns');
    expect(screen.getByTestId('nav-item-reports')).toHaveTextContent('Reports');
    expect(screen.getByTestId('nav-item-invoices')).toHaveTextContent('Invoices');
    expect(screen.getByTestId('nav-item-audit-logs')).toHaveTextContent('Audit Logs');
  });

  it('should have correct href links for all navigation items', () => {
    render(<Sidebar />);

    expect(screen.getByTestId('nav-item-outlets')).toHaveAttribute('href', '/dashboard/outlets');
    expect(screen.getByTestId('nav-item-services')).toHaveAttribute('href', '/dashboard/services');
    expect(screen.getByTestId('nav-item-memberships')).toHaveAttribute('href', '/dashboard/memberships');
    expect(screen.getByTestId('nav-item-vouchers')).toHaveAttribute('href', '/dashboard/vouchers');
    expect(screen.getByTestId('nav-item-campaigns')).toHaveAttribute('href', '/dashboard/campaigns');
    expect(screen.getByTestId('nav-item-reports')).toHaveAttribute('href', '/dashboard/reports');
    expect(screen.getByTestId('nav-item-invoices')).toHaveAttribute('href', '/dashboard/invoices');
    expect(screen.getByTestId('nav-item-audit-logs')).toHaveAttribute('href', '/dashboard/audit-logs');
  });

  it('should highlight active navigation item based on currentPath', () => {
    render(<Sidebar currentPath="/dashboard/services" />);

    const activeItem = screen.getByTestId('nav-item-services');
    expect(activeItem).toHaveClass('active');
    expect(activeItem).toHaveAttribute('aria-current', 'page');

    // Other items should not be active
    const inactiveItem = screen.getByTestId('nav-item-outlets');
    expect(inactiveItem).not.toHaveClass('active');
    expect(inactiveItem).not.toHaveAttribute('aria-current');
  });

  it('should highlight active item for nested paths', () => {
    render(<Sidebar currentPath="/dashboard/memberships/create" />);

    const activeItem = screen.getByTestId('nav-item-memberships');
    expect(activeItem).toHaveClass('active');
    expect(activeItem).toHaveAttribute('aria-current', 'page');
  });

  it('should display tenant name when provided', () => {
    render(<Sidebar tenantName="AIRE Car Wash" />);
    const tenantName = screen.getByTestId('sidebar-tenant-name');
    expect(tenantName).toBeInTheDocument();
    expect(tenantName).toHaveTextContent('AIRE Car Wash');
  });

  it('should not display tenant name when not provided', () => {
    render(<Sidebar />);
    expect(screen.queryByTestId('sidebar-tenant-name')).not.toBeInTheDocument();
  });

  it('should export navSections array with 9 items', () => {
    expect(navSections).toHaveLength(9);
    expect(navSections.map((s) => s.id)).toEqual([
      'outlets',
      'services',
      'memberships',
      'vouchers',
      'campaigns',
      'reports',
      'invoices',
      'audit-logs',
      'settings',
    ]);
  });
});
