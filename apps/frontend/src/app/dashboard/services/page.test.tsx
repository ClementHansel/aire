/**
 * Unit tests for Dashboard Services management page.
 * Requirements: 3.2
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ServicesPage from './page';

const mockServices = [
  { id: 's1', name: 'Premium Wash', category: 'car_wash', price: 75000, active: true, outletScope: 'all' },
  { id: 's2', name: 'Interior Clean', category: 'addon', price: 30000, active: false, outletScope: 'all' },
];

describe('ServicesPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should render loading state initially', () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}));
    render(<ServicesPage />);
    expect(screen.getByTestId('services-loading')).toBeInTheDocument();
  });

  it('should render the services page with title after loading', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockServices,
    } as Response);

    render(<ServicesPage />);

    await waitFor(() => {
      expect(screen.getByTestId('services-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('services-title')).toHaveTextContent('Manage Services');
  });

  it('should display services in a table after fetching', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockServices,
    } as Response);

    render(<ServicesPage />);

    await waitFor(() => {
      expect(screen.getByTestId('services-table')).toBeInTheDocument();
    });
    expect(screen.getByTestId('service-row-s1')).toBeInTheDocument();
    expect(screen.getByTestId('service-row-s2')).toBeInTheDocument();
  });

  it('should show empty message when no services exist', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    render(<ServicesPage />);

    await waitFor(() => {
      expect(screen.getByTestId('no-services')).toBeInTheDocument();
    });
  });

  it('should render the Add Service button', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockServices,
    } as Response);

    render(<ServicesPage />);

    await waitFor(() => {
      expect(screen.getByTestId('add-service-btn')).toBeInTheDocument();
    });
  });

  it('should open the form dialog when Add Service is clicked', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockServices,
    } as Response);

    render(<ServicesPage />);

    await waitFor(() => {
      expect(screen.getByTestId('add-service-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('add-service-btn'));
    expect(screen.getByTestId('service-form-dialog')).toBeInTheDocument();
  });

  it('should show error message on fetch failure', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);

    render(<ServicesPage />);

    await waitFor(() => {
      expect(screen.getByTestId('services-error')).toBeInTheDocument();
    });
  });

  it('should display active/inactive status for each service', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockServices,
    } as Response);

    render(<ServicesPage />);

    await waitFor(() => {
      expect(screen.getByTestId('service-status-s1')).toHaveTextContent('Active');
      expect(screen.getByTestId('service-status-s2')).toHaveTextContent('Inactive');
    });
  });
});
