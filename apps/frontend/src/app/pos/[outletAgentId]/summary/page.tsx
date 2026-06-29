/**
 * POS Summary/Reports view.
 * Displays summary KPIs, payment method breakdown, and top services
 * with configurable date range filtering.
 *
 * Requirements: 23.1, 23.2, 23.3, 23.5
 */
'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { PaymentMethod } from '@aire/shared/enums';

/** Summary data returned from the reports API */
export interface SummaryData {
  totalOrders: number;
  revenue: number;
  paidCount: number;
  cancelledCount: number;
  uniqueMembers: number;
  newMembers: number;
  byPaymentMethod: Record<string, { revenue: number; count: number }>;
  byService: Array<{ serviceId: string; name: string; quantity: number; revenue: number }>;
}

/** Props for the SummaryPage component (used for testing with injected data) */
export interface SummaryPageProps {
  /** Optional pre-loaded summary data (for testing). If not provided, displays loading state. */
  initialData?: SummaryData | null;
  /** Optional callback for CSV export */
  onExport?: (dateFrom: string, dateTo: string) => void;
}

/** Format a number as Indonesian Rupiah-style currency (no symbol) */
function formatCurrency(amount: number): string {
  return amount.toLocaleString('id-ID');
}

/** Get today's date as YYYY-MM-DD string */
function getTodayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Human-friendly labels for payment methods */
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  [PaymentMethod.Cash]: 'Cash',
  [PaymentMethod.QrisStatic]: 'QRIS (Static)',
  [PaymentMethod.QrisDynamic]: 'QRIS (Dynamic)',
  [PaymentMethod.Edc]: 'EDC',
  [PaymentMethod.Transfer]: 'Transfer',
};

export default function SummaryPage({ initialData, onExport }: SummaryPageProps = {}) {
  const today = getTodayString();
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [summaryData] = useState<SummaryData | null>(initialData ?? null);

  const handleTodayClick = useCallback(() => {
    const todayStr = getTodayString();
    setDateFrom(todayStr);
    setDateTo(todayStr);
  }, []);

  const handleExport = useCallback(() => {
    if (onExport) {
      onExport(dateFrom, dateTo);
    }
  }, [onExport, dateFrom, dateTo]);

  /** Top 10 services sorted by revenue descending */
  const topServices = useMemo(() => {
    if (!summaryData?.byService) return [];
    return [...summaryData.byService]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  }, [summaryData]);

  /** Payment method entries as array for rendering */
  const paymentMethods = useMemo(() => {
    if (!summaryData?.byPaymentMethod) return [];
    return Object.entries(summaryData.byPaymentMethod).map(([method, data]) => ({
      method,
      label: PAYMENT_METHOD_LABELS[method] || method,
      ...data,
    }));
  }, [summaryData]);

  return (
    <div className="summary-page" data-testid="summary-page">
      {/* Header */}
      <div className="summary-page__header">
        <h1>Summary & Reports</h1>
      </div>

      {/* Date Range Picker */}
      <div className="summary-page__date-range" data-testid="date-range-picker">
        <label htmlFor="date-from">From</label>
        <input
          id="date-from"
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          data-testid="date-from"
          aria-label="Start date"
        />

        <label htmlFor="date-to">To</label>
        <input
          id="date-to"
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          data-testid="date-to"
          aria-label="End date"
        />

        <button
          type="button"
          onClick={handleTodayClick}
          data-testid="today-btn"
          aria-label="Set date range to today"
        >
          Today
        </button>

        <button
          type="button"
          onClick={handleExport}
          data-testid="export-csv-btn"
          aria-label="Export data as CSV"
        >
          Export CSV
        </button>
      </div>

      {/* KPI Summary Cards */}
      {summaryData ? (
        <>
          <div className="summary-page__kpis" data-testid="kpi-cards">
            <div className="summary-page__kpi-card" data-testid="kpi-total-orders">
              <span className="summary-page__kpi-label">Total Orders</span>
              <span className="summary-page__kpi-value">{summaryData.totalOrders}</span>
            </div>

            <div className="summary-page__kpi-card" data-testid="kpi-revenue">
              <span className="summary-page__kpi-label">Revenue</span>
              <span className="summary-page__kpi-value">
                {formatCurrency(summaryData.revenue)}
              </span>
            </div>

            <div className="summary-page__kpi-card" data-testid="kpi-paid-count">
              <span className="summary-page__kpi-label">Paid</span>
              <span className="summary-page__kpi-value">{summaryData.paidCount}</span>
            </div>

            <div className="summary-page__kpi-card" data-testid="kpi-cancelled-count">
              <span className="summary-page__kpi-label">Cancelled</span>
              <span className="summary-page__kpi-value">{summaryData.cancelledCount}</span>
            </div>

            <div className="summary-page__kpi-card" data-testid="kpi-unique-members">
              <span className="summary-page__kpi-label">Unique Members</span>
              <span className="summary-page__kpi-value">{summaryData.uniqueMembers}</span>
            </div>

            <div className="summary-page__kpi-card" data-testid="kpi-new-members">
              <span className="summary-page__kpi-label">New Members</span>
              <span className="summary-page__kpi-value">{summaryData.newMembers}</span>
            </div>
          </div>

          {/* Payment Method Breakdown */}
          <div className="summary-page__section" data-testid="payment-method-breakdown">
            <h2>Payment Method Breakdown</h2>
            {paymentMethods.length > 0 ? (
              <ul className="summary-page__payment-list">
                {paymentMethods.map((pm) => (
                  <li
                    key={pm.method}
                    className="summary-page__payment-item"
                    data-testid={`payment-method-${pm.method}`}
                  >
                    <span className="summary-page__payment-label">{pm.label}</span>
                    <span className="summary-page__payment-revenue">
                      {formatCurrency(pm.revenue)}
                    </span>
                    <span className="summary-page__payment-count">
                      {pm.count} txn{pm.count !== 1 ? 's' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p data-testid="no-payment-data">No payment data available</p>
            )}
          </div>

          {/* Top Services */}
          <div className="summary-page__section" data-testid="top-services">
            <h2>Top Services</h2>
            {topServices.length > 0 ? (
              <table className="summary-page__services-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Service</th>
                    <th>Quantity</th>
                    <th>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {topServices.map((service, index) => (
                    <tr key={service.serviceId} data-testid={`service-row-${service.serviceId}`}>
                      <td>{index + 1}</td>
                      <td>{service.name}</td>
                      <td>{service.quantity}</td>
                      <td>{formatCurrency(service.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p data-testid="no-services-data">No service data available</p>
            )}
          </div>
        </>
      ) : (
        <div className="summary-page__empty" data-testid="summary-empty">
          <p>Select a date range and load data to view summary.</p>
        </div>
      )}
    </div>
  );
}
