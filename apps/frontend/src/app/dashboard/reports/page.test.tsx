/**
 * Unit tests for Dashboard Consolidated Reports page.
 * Requirements: 3.6, 23.4, 23.5
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ReportsPage, { type ReportData, type OutletOption } from './ReportsPageContent';

const mockOutlets: OutletOption[] = [
  { id: 'o1', name: 'Outlet Kemang' },
  { id: 'o2', name: 'Outlet Sudirman' },
];

const mockReportData: ReportData = {
  totalOrders: 142,
  revenue: 8500000,
  paidCount: 130,
  cancelledCount: 12,
  uniqueMembers: 45,
  newMembers: 8,
  byPaymentMethod: {
    cash: { revenue: 3500000, count: 60 },
    qris_static: { revenue: 2000000, count: 35 },
    edc: { revenue: 3000000, count: 35 },
  },
  byService: [
    { serviceId: 'svc1', name: 'Premium Wash', quantity: 80, revenue: 6000000 },
    { serviceId: 'svc2', name: 'Basic Wash', quantity: 50, revenue: 1500000 },
    { serviceId: 'svc3', name: 'Interior Clean', quantity: 30, revenue: 1000000 },
  ],
};

describe('ReportsPage', () => {
  it('should render the reports page container and title', () => {
    render(<ReportsPage />);
    expect(screen.getByTestId('reports-page')).toBeInTheDocument();
    expect(screen.getByTestId('reports-title')).toHaveTextContent('Consolidated Reports');
  });

  it('should render the outlet filter dropdown', () => {
    render(<ReportsPage outlets={mockOutlets} />);
    expect(screen.getByTestId('outlet-select')).toBeInTheDocument();
    expect(screen.getByTestId('outlet-select')).toHaveValue('all');
  });

  it('should list available outlets in the filter dropdown', () => {
    render(<ReportsPage outlets={mockOutlets} />);
    const select = screen.getByTestId('outlet-select') as HTMLSelectElement;
    // "All Outlets" + 2 outlets = 3 options
    expect(select.options.length).toBe(3);
  });

  it('should render date range picker with from and to inputs', () => {
    render(<ReportsPage />);
    expect(screen.getByTestId('report-date-from')).toBeInTheDocument();
    expect(screen.getByTestId('report-date-to')).toBeInTheDocument();
  });

  it('should render the Today shortcut button', () => {
    render(<ReportsPage />);
    expect(screen.getByTestId('report-today-btn')).toBeInTheDocument();
  });

  it('should render the Export CSV button', () => {
    render(<ReportsPage />);
    expect(screen.getByTestId('report-export-csv-btn')).toBeInTheDocument();
  });

  it('should call onExport with date range and outlet when Export CSV is clicked', () => {
    const onExport = vi.fn();
    render(<ReportsPage outlets={mockOutlets} onExport={onExport} />);

    fireEvent.click(screen.getByTestId('report-export-csv-btn'));
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onExport).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'all');
  });

  it('should show empty state when no report data is provided', () => {
    render(<ReportsPage />);
    expect(screen.getByTestId('reports-empty')).toBeInTheDocument();
  });

  it('should display KPI cards when report data is provided', () => {
    render(<ReportsPage initialData={mockReportData} />);
    expect(screen.getByTestId('report-kpis')).toBeInTheDocument();
    expect(screen.getByTestId('report-kpi-total-orders')).toBeInTheDocument();
    expect(screen.getByTestId('report-kpi-revenue')).toBeInTheDocument();
    expect(screen.getByTestId('report-kpi-paid')).toBeInTheDocument();
    expect(screen.getByTestId('report-kpi-cancelled')).toBeInTheDocument();
    expect(screen.getByTestId('report-kpi-unique-members')).toBeInTheDocument();
    expect(screen.getByTestId('report-kpi-new-members')).toBeInTheDocument();
  });

  it('should display payment method breakdown table', () => {
    render(<ReportsPage initialData={mockReportData} />);
    expect(screen.getByTestId('report-payment-breakdown')).toBeInTheDocument();
    expect(screen.getByTestId('payment-breakdown-table')).toBeInTheDocument();
    expect(screen.getByTestId('payment-row-cash')).toBeInTheDocument();
    expect(screen.getByTestId('payment-row-edc')).toBeInTheDocument();
  });

  it('should display service breakdown table', () => {
    render(<ReportsPage initialData={mockReportData} />);
    expect(screen.getByTestId('report-service-breakdown')).toBeInTheDocument();
    expect(screen.getByTestId('service-breakdown-table')).toBeInTheDocument();
    expect(screen.getByTestId('service-row-svc1')).toBeInTheDocument();
  });

  it('should allow changing the outlet filter', () => {
    render(<ReportsPage outlets={mockOutlets} />);
    const select = screen.getByTestId('outlet-select') as HTMLSelectElement;

    fireEvent.change(select, { target: { value: 'o1' } });
    expect(select.value).toBe('o1');
  });

  it('should pass selected outlet when exporting CSV', () => {
    const onExport = vi.fn();
    render(<ReportsPage outlets={mockOutlets} onExport={onExport} />);

    // Change outlet filter
    fireEvent.change(screen.getByTestId('outlet-select'), { target: { value: 'o2' } });
    // Click export
    fireEvent.click(screen.getByTestId('report-export-csv-btn'));

    expect(onExport).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'o2');
  });
});
