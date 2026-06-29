'use client';

import { useState, useMemo, useCallback } from 'react';

/** Outlet option for the filter */
export interface OutletOption {
  id: string;
  name: string;
}

/** Report summary data */
export interface ReportData {
  totalOrders: number;
  revenue: number;
  paidCount: number;
  cancelledCount: number;
  uniqueMembers: number;
  newMembers: number;
  byPaymentMethod: Record<string, { revenue: number; count: number }>;
  byService: Array<{ serviceId: string; name: string; quantity: number; revenue: number }>;
}

/** Props for the ReportsPage (supports test injection) */
export interface ReportsPageProps {
  /** Available outlets for the filter dropdown */
  outlets?: OutletOption[];
  /** Pre-loaded report data (for testing) */
  initialData?: ReportData | null;
  /** CSV export callback */
  onExport?: (dateFrom: string, dateTo: string, outletId: string) => void;
}

/** Format a number as Indonesian Rupiah-style currency */
function formatCurrency(amount: number): string {
  return amount.toLocaleString('id-ID');
}

/** Get today's date as YYYY-MM-DD */
function getTodayString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Consolidated Reports page content component.
 * Provides multi-outlet filtering, date range picker, KPIs,
 * payment method breakdown, service breakdown, and CSV export.
 */
export default function ReportsPageContent({
  outlets = [],
  initialData = null,
  onExport,
}: ReportsPageProps) {
  const today = getTodayString();
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [selectedOutlet, setSelectedOutlet] = useState('all');
  const [reportData] = useState<ReportData | null>(initialData);

  const handleTodayClick = useCallback(() => {
    const todayStr = getTodayString();
    setDateFrom(todayStr);
    setDateTo(todayStr);
  }, []);

  const handleExport = useCallback(() => {
    if (onExport) {
      onExport(dateFrom, dateTo, selectedOutlet);
    }
  }, [onExport, dateFrom, dateTo, selectedOutlet]);

  const topServices = useMemo(() => {
    if (!reportData?.byService) return [];
    return [...reportData.byService].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  }, [reportData]);

  const paymentMethods = useMemo(() => {
    if (!reportData?.byPaymentMethod) return [];
    return Object.entries(reportData.byPaymentMethod).map(([method, data]) => ({
      method,
      ...data,
    }));
  }, [reportData]);

  return (
    <div data-testid="reports-page">
      <header className="page-header">
        <h1 data-testid="reports-title">Consolidated Reports</h1>
      </header>

      <div data-testid="reports-filters" className="reports-filters">
        <div data-testid="outlet-filter">
          <label htmlFor="outlet-select">Outlet</label>
          <select
            id="outlet-select"
            data-testid="outlet-select"
            value={selectedOutlet}
            onChange={(e) => setSelectedOutlet(e.target.value)}
          >
            <option value="all">All Outlets</option>
            {outlets.map((outlet) => (
              <option key={outlet.id} value={outlet.id}>
                {outlet.name}
              </option>
            ))}
          </select>
        </div>

        <div data-testid="date-range-picker" className="date-range-picker">
          <label htmlFor="report-date-from">From</label>
          <input
            id="report-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            data-testid="report-date-from"
            aria-label="Start date"
          />
          <label htmlFor="report-date-to">To</label>
          <input
            id="report-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            data-testid="report-date-to"
            aria-label="End date"
          />
          <button type="button" onClick={handleTodayClick} data-testid="report-today-btn">
            Today
          </button>
        </div>

        <button
          type="button"
          onClick={handleExport}
          data-testid="report-export-csv-btn"
          aria-label="Export report data as CSV"
        >
          Export CSV
        </button>
      </div>

      {reportData ? (
        <>
          <section data-testid="report-kpis" className="report-kpis">
            <div data-testid="report-kpi-total-orders" className="kpi-card">
              <span className="kpi-label">Total Orders</span>
              <span className="kpi-value">{reportData.totalOrders}</span>
            </div>
            <div data-testid="report-kpi-revenue" className="kpi-card">
              <span className="kpi-label">Revenue</span>
              <span className="kpi-value">{formatCurrency(reportData.revenue)}</span>
            </div>
            <div data-testid="report-kpi-paid" className="kpi-card">
              <span className="kpi-label">Paid</span>
              <span className="kpi-value">{reportData.paidCount}</span>
            </div>
            <div data-testid="report-kpi-cancelled" className="kpi-card">
              <span className="kpi-label">Cancelled</span>
              <span className="kpi-value">{reportData.cancelledCount}</span>
            </div>
            <div data-testid="report-kpi-unique-members" className="kpi-card">
              <span className="kpi-label">Unique Members</span>
              <span className="kpi-value">{reportData.uniqueMembers}</span>
            </div>
            <div data-testid="report-kpi-new-members" className="kpi-card">
              <span className="kpi-label">New Members</span>
              <span className="kpi-value">{reportData.newMembers}</span>
            </div>
          </section>

          <section data-testid="report-payment-breakdown">
            <h2>Payment Method Breakdown</h2>
            {paymentMethods.length > 0 ? (
              <table data-testid="payment-breakdown-table" className="data-table">
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>Revenue</th>
                    <th>Transactions</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentMethods.map((pm) => (
                    <tr key={pm.method} data-testid={`payment-row-${pm.method}`}>
                      <td>{pm.method}</td>
                      <td>{formatCurrency(pm.revenue)}</td>
                      <td>{pm.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p data-testid="no-payment-data">No payment data available</p>
            )}
          </section>

          <section data-testid="report-service-breakdown">
            <h2>Top Services</h2>
            {topServices.length > 0 ? (
              <table data-testid="service-breakdown-table" className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Service</th>
                    <th>Quantity</th>
                    <th>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {topServices.map((svc, idx) => (
                    <tr key={svc.serviceId} data-testid={`service-row-${svc.serviceId}`}>
                      <td>{idx + 1}</td>
                      <td>{svc.name}</td>
                      <td>{svc.quantity}</td>
                      <td>{formatCurrency(svc.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p data-testid="no-service-data">No service data available</p>
            )}
          </section>
        </>
      ) : (
        <div data-testid="reports-empty">
          <p>Select a date range and outlet to view consolidated reports.</p>
        </div>
      )}
    </div>
  );
}
