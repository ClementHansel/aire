'use client';

import { useState } from 'react';

export default function ReportsPage() {
  const [dateFrom, setDateFrom] = useState('2026-06-29');
  const [dateTo, setDateTo] = useState('2026-06-29');

  return (
    <div data-testid="reports-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary" data-testid="reports-title">Reports</h1>
          <p className="mt-1 text-sm text-text-secondary">Consolidated business metrics and performance data.</p>
        </div>
        <button className="btn-secondary">📥 Export CSV</button>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Outlet</label>
            <select className="input-field">
              <option>All Outlets</option>
            </select>
          </div>
          <button className="btn-primary">Apply</button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="card">
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Total Orders</p>
          <p className="text-2xl font-bold text-text-primary mt-1">—</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Revenue</p>
          <p className="text-2xl font-bold text-primary-600 mt-1">—</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Paid</p>
          <p className="text-2xl font-bold text-success mt-1">—</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Cancelled</p>
          <p className="text-2xl font-bold text-error mt-1">—</p>
        </div>
      </div>

      {/* Tables */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-text-primary">Payment Methods</h2>
          </div>
          <div className="p-5">
            <p className="text-sm text-text-muted italic">No data for selected period.</p>
          </div>
        </div>

        <div className="card p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-text-primary">Top Services</h2>
          </div>
          <div className="p-5">
            <p className="text-sm text-text-muted italic">No data for selected period.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
