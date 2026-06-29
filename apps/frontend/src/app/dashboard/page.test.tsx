/**
 * Unit tests for Dashboard home/overview page.
 * Requirements: 3.1, 3.6
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DashboardHomePage from './page';

describe('DashboardHomePage', () => {
  it('should render the dashboard home container', () => {
    render(<DashboardHomePage />);
    expect(screen.getByTestId('dashboard-home')).toBeInTheDocument();
  });

  it('should display the dashboard title', () => {
    render(<DashboardHomePage />);
    expect(screen.getByTestId('dashboard-home-title')).toHaveTextContent('Dashboard Overview');
  });

  it('should display a description', () => {
    render(<DashboardHomePage />);
    expect(screen.getByTestId('dashboard-home-description')).toBeInTheDocument();
  });

  it('should render quick stats section with stat cards', () => {
    render(<DashboardHomePage />);
    expect(screen.getByTestId('dashboard-quick-stats')).toBeInTheDocument();
    expect(screen.getByTestId('stat-outlets')).toBeInTheDocument();
    expect(screen.getByTestId('stat-active-members')).toBeInTheDocument();
    expect(screen.getByTestId('stat-today-orders')).toBeInTheDocument();
    expect(screen.getByTestId('stat-revenue')).toBeInTheDocument();
  });

  it('should render quick access section links to all dashboard areas', () => {
    render(<DashboardHomePage />);
    const sectionLinks = screen.getByTestId('dashboard-section-links');
    expect(sectionLinks).toBeInTheDocument();

    const links = sectionLinks.querySelectorAll('a');
    const hrefs = Array.from(links).map((link) => link.getAttribute('href'));

    expect(hrefs).toContain('/dashboard/outlets');
    expect(hrefs).toContain('/dashboard/services');
    expect(hrefs).toContain('/dashboard/memberships');
    expect(hrefs).toContain('/dashboard/vouchers');
    expect(hrefs).toContain('/dashboard/campaigns');
    expect(hrefs).toContain('/dashboard/reports');
    expect(hrefs).toContain('/dashboard/invoices');
    expect(hrefs).toContain('/dashboard/audit-logs');
  });
});
