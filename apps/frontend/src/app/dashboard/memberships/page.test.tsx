/**
 * Unit tests for Dashboard Membership Plans management page.
 * Requirements: 3.3
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MembershipsPage from './page';

const mockPlans = [
  {
    id: 'mp1',
    name: 'Silver Plan',
    durationMonths: 1,
    quotaCap: 30,
    dailyLimit: 1,
    maxPlates: 3,
    price: 150000,
    freeServices: ['wash-basic'],
    discountedServices: [],
    outletScope: 'all',
    active: true,
  },
  {
    id: 'mp2',
    name: 'Gold Plan',
    durationMonths: 3,
    quotaCap: 90,
    dailyLimit: 2,
    maxPlates: 5,
    price: 400000,
    freeServices: ['wash-basic', 'wash-premium'],
    discountedServices: ['interior-clean'],
    outletScope: 'all',
    active: true,
  },
];

describe('MembershipsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should render loading state initially', () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}));
    render(<MembershipsPage />);
    expect(screen.getByTestId('memberships-loading')).toBeInTheDocument();
  });

  it('should render the memberships page with title after loading', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockPlans,
    } as Response);

    render(<MembershipsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('memberships-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('memberships-title')).toHaveTextContent('Membership Plans');
  });

  it('should display plans in a table after fetching', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockPlans,
    } as Response);

    render(<MembershipsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('plans-table')).toBeInTheDocument();
    });
    expect(screen.getByTestId('plan-row-mp1')).toBeInTheDocument();
    expect(screen.getByTestId('plan-row-mp2')).toBeInTheDocument();
  });

  it('should show empty message when no plans exist', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    render(<MembershipsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('no-plans')).toBeInTheDocument();
    });
  });

  it('should render the Add Plan button', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockPlans,
    } as Response);

    render(<MembershipsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('add-plan-btn')).toBeInTheDocument();
    });
  });

  it('should open the form dialog when Add Plan is clicked', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockPlans,
    } as Response);

    render(<MembershipsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('add-plan-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('add-plan-btn'));
    expect(screen.getByTestId('plan-form-dialog')).toBeInTheDocument();
  });

  it('should show error on fetch failure', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);

    render(<MembershipsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('memberships-error')).toBeInTheDocument();
    });
  });
});
