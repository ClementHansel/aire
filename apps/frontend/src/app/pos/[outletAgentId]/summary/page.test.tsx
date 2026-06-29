/**
 * Unit tests for POS Summary/Reports view.
 * Requirements: 23.1, 23.2, 23.3, 23.5
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SummaryPage, { SummaryData } from './page';
import { PaymentMethod } from '@aire/shared/enums';

const MOCK_SUMMARY: SummaryData = {
  totalOrders: 42,
  revenue: 5_250_000,
  paidCount: 38,
  cancelledCount: 4,
  uniqueMembers: 15,
  newMembers: 3,
  byPaymentMethod: {
    [PaymentMethod.Cash]: { revenue: 2_000_000, count: 20 },
    [PaymentMethod.QrisStatic]: { revenue: 1_500_000, count: 10 },
    [PaymentMethod.Edc]: { revenue: 1_250_000, count: 6 },
    [PaymentMethod.Transfer]: { revenue: 500_000, count: 2 },
  },
  byService: [
    { serviceId: 'svc-1', name: 'Premium Wash', quantity: 15, revenue: 2_250_000 },
    { serviceId: 'svc-2', name: 'Basic Wash', quantity: 20, revenue: 1_600_000 },
    { serviceId: 'svc-3', name: 'Interior Clean', quantity: 8, revenue: 800_000 },
    { serviceId: 'svc-4', name: 'Wax Coating', quantity: 5, revenue: 600_000 },
  ],
};

describe('SummaryPage', () => {
  describe('Date Range Picker', () => {
    it('should render date-from and date-to inputs defaulting to today', () => {
      render(<SummaryPage initialData={MOCK_SUMMARY} />);

      const dateFrom = screen.getByTestId('date-from') as HTMLInputElement;
      const dateTo = screen.getByTestId('date-to') as HTMLInputElement;

      // Both should default to today
      const today = new Date();
      const expectedDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      expect(dateFrom.value).toBe(expectedDate);
      expect(dateTo.value).toBe(expectedDate);
    });

    it('should update date-from when changed', () => {
      render(<SummaryPage initialData={MOCK_SUMMARY} />);

      const dateFrom = screen.getByTestId('date-from') as HTMLInputElement;
      fireEvent.change(dateFrom, { target: { value: '2024-01-15' } });

      expect(dateFrom.value).toBe('2024-01-15');
    });

    it('should update date-to when changed', () => {
      render(<SummaryPage initialData={MOCK_SUMMARY} />);

      const dateTo = screen.getByTestId('date-to') as HTMLInputElement;
      fireEvent.change(dateTo, { target: { value: '2024-01-20' } });

      expect(dateTo.value).toBe('2024-01-20');
    });

    it('should reset both dates to today when "Today" button is clicked', () => {
      render(<SummaryPage initialData={MOCK_SUMMARY} />);

      const dateFrom = screen.getByTestId('date-from') as HTMLInputElement;
      const dateTo = screen.getByTestId('date-to') as HTMLInputElement;

      // Change dates to something else first
      fireEvent.change(dateFrom, { target: { value: '2024-01-01' } });
      fireEvent.change(dateTo, { target: { value: '2024-01-31' } });

      // Click Today
      fireEvent.click(screen.getByTestId('today-btn'));

      const today = new Date();
      const expectedDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      expect(dateFrom.value).toBe(expectedDate);
      expect(dateTo.value).toBe(expectedDate);
    });
  });

  describe('KPI Cards', () => {
    it('should display Total Orders', () => {
      render(<SummaryPage initialData={MOCK_SUMMARY} />);

      const card = screen.getByTestId('kpi-total-orders');
      expect(card.textContent).toContain('Total Orders');
      expect(card.textContent).toContain('42');
    });

    it('should display Revenue formatted as currency', () => {
      render(<SummaryPage initialData={MOCK_SUMMARY} />);

      const card = screen.getByTestId('kpi-revenue');
      expect(card.textContent).toContain('Revenue');
      expect(card.textContent).toContain('5.250.000');
    });

    it('should display Paid Count', () => {
      render(<SummaryPage initialData={MOCK_SUMMARY} />);

      const card = screen.getByTestId('kpi-paid-count');
      expect(card.textContent).toContain('Paid');
      expect(card.textContent).toContain('38');
    });

    it('should display Cancelled Count', () => {
      render(<SummaryPage initialData={MOCK_SUMMARY} />);

      const card = screen.getByTestId('kpi-cancelled-count');
      expect(card.textContent).toContain('Cancelled');
      expect(card.textContent).toContain('4');
    });

    it('should display Unique Members', () => {
      render(<SummaryPage initialData={MOCK_SUMMARY} />);

      const card = screen.getByTestId('kpi-unique-members');
      expect(card.textContent).toContain('Unique Members');
      expect(card.textContent).toContain('15');
    });

    it('should display New Members', () => {
      render(<SummaryPage initialData={MOCK_SUMMARY} />);

      const card = screen.getByTestId('kpi-new-members');
      expect(card.textContent).toContain('New Members');
      expect(card.textContent).toContain('3');
    });
  });

  describe('Payment Method Breakdown', () => {
    it('should display all payment methods with revenue and count', () => {
      render(<SummaryPage initialData={MOCK_SUMMARY} />);

      const cashRow = screen.getByTestId('payment-method-cash');
      expect(cashRow.textContent).toContain('Cash');
      expect(cashRow.textContent).toContain('2.000.000');
      expect(cashRow.textContent).toContain('20 txns');

      const qrisRow = screen.getByTestId('payment-method-qris_static');
      expect(qrisRow.textContent).toContain('QRIS (Static)');
      expect(qrisRow.textContent).toContain('1.500.000');
      expect(qrisRow.textContent).toContain('10 txns');

      const edcRow = screen.getByTestId('payment-method-edc');
      expect(edcRow.textContent).toContain('EDC');
      expect(edcRow.textContent).toContain('1.250.000');
      expect(edcRow.textContent).toContain('6 txns');

      const transferRow = screen.getByTestId('payment-method-transfer');
      expect(transferRow.textContent).toContain('Transfer');
      expect(transferRow.textContent).toContain('500.000');
      expect(transferRow.textContent).toContain('2 txns');
    });

    it('should show "No payment data available" when breakdown is empty', () => {
      const dataWithNoPayments: SummaryData = {
        ...MOCK_SUMMARY,
        byPaymentMethod: {},
      };
      render(<SummaryPage initialData={dataWithNoPayments} />);

      expect(screen.getByTestId('no-payment-data')).toBeDefined();
    });

    it('should display singular "txn" for count of 1', () => {
      const dataWithSingle: SummaryData = {
        ...MOCK_SUMMARY,
        byPaymentMethod: {
          [PaymentMethod.Cash]: { revenue: 100_000, count: 1 },
        },
      };
      render(<SummaryPage initialData={dataWithSingle} />);

      const cashRow = screen.getByTestId('payment-method-cash');
      expect(cashRow.textContent).toContain('1 txn');
      expect(cashRow.textContent).not.toContain('1 txns');
    });
  });

  describe('Top Services', () => {
    it('should display services sorted by revenue descending', () => {
      render(<SummaryPage initialData={MOCK_SUMMARY} />);

      const rows = screen.getAllByTestId(/^service-row-/);
      expect(rows).toHaveLength(4);

      // First should be Premium Wash (highest revenue)
      expect(rows[0].textContent).toContain('Premium Wash');
      expect(rows[0].textContent).toContain('15');
      expect(rows[0].textContent).toContain('2.250.000');

      // Second should be Basic Wash
      expect(rows[1].textContent).toContain('Basic Wash');
    });

    it('should limit to top 10 services', () => {
      const manyServices = Array.from({ length: 15 }, (_, i) => ({
        serviceId: `svc-${i + 1}`,
        name: `Service ${i + 1}`,
        quantity: 15 - i,
        revenue: (15 - i) * 100_000,
      }));

      const dataWithManyServices: SummaryData = {
        ...MOCK_SUMMARY,
        byService: manyServices,
      };
      render(<SummaryPage initialData={dataWithManyServices} />);

      const rows = screen.getAllByTestId(/^service-row-/);
      expect(rows).toHaveLength(10);
    });

    it('should show "No service data available" when services list is empty', () => {
      const dataWithNoServices: SummaryData = {
        ...MOCK_SUMMARY,
        byService: [],
      };
      render(<SummaryPage initialData={dataWithNoServices} />);

      expect(screen.getByTestId('no-services-data')).toBeDefined();
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no data is provided', () => {
      render(<SummaryPage initialData={null} />);

      expect(screen.getByTestId('summary-empty')).toBeDefined();
      expect(screen.queryByTestId('kpi-cards')).toBeNull();
    });

    it('should show empty state by default (no props)', () => {
      render(<SummaryPage />);

      expect(screen.getByTestId('summary-empty')).toBeDefined();
    });
  });

  describe('CSV Export', () => {
    it('should call onExport with current date range when export button is clicked', () => {
      const onExport = vi.fn();
      render(<SummaryPage initialData={MOCK_SUMMARY} onExport={onExport} />);

      // Change dates first
      fireEvent.change(screen.getByTestId('date-from'), { target: { value: '2024-03-01' } });
      fireEvent.change(screen.getByTestId('date-to'), { target: { value: '2024-03-31' } });

      fireEvent.click(screen.getByTestId('export-csv-btn'));

      expect(onExport).toHaveBeenCalledWith('2024-03-01', '2024-03-31');
    });

    it('should not throw when export is clicked without onExport callback', () => {
      render(<SummaryPage initialData={MOCK_SUMMARY} />);

      expect(() => {
        fireEvent.click(screen.getByTestId('export-csv-btn'));
      }).not.toThrow();
    });
  });
});
