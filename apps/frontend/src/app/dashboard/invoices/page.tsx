'use client';

/**
 * Invoices — a billing view over completed orders. Lists paid/confirmed/completed
 * orders and produces a printable A4 invoice (print-to-PDF) per order. Reuses the
 * existing /orders data; no separate invoice store.
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import BranchFilter from '@/components/dashboard/BranchFilter';

interface OrderItem { serviceName: string; quantity: number; subtotal: number }
interface Order {
  id: string; orderNumber: string; customerName: string; customerPhone: string;
  licensePlate?: string; status: string; items: OrderItem[]; total: number; createdAt: string;
}
interface OrderListResponse { orders: Order[] }

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

export default function InvoicesPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ status: 'paid' });
      if (search.trim()) qs.set('search', search.trim());
      if (branch) qs.set('outletId', branch);
      const data = await api.get<OrderListResponse>(`/orders?${qs.toString()}`);
      setOrders(data.orders);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load invoices'); }
    finally { setLoading(false); }
  }, [search, branch]);
  useEffect(() => { load(); }, [load]);

  const print = (o: Order) => {
    const tenant = getUser()?.name ? 'AIRE Operations' : 'AIRE';
    const rows = o.items.map((it) => `<tr><td>${it.quantity}× ${it.serviceName}</td><td style="text-align:right">${fmt(it.subtotal)}</td></tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${o.orderNumber}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;color:#111;max-width:720px;margin:32px auto;padding:0 24px}
        h1{font-size:22px;margin:0}.muted{color:#666;font-size:13px}
        .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1652F0;padding-bottom:16px;margin-bottom:20px}
        table{width:100%;border-collapse:collapse;margin-top:12px}
        td,th{border-bottom:1px solid #E5E7EB;padding:8px;font-size:14px}
        .total{text-align:right;font-size:18px;font-weight:bold;margin-top:16px;color:#1652F0}
        .badge{display:inline-block;padding:2px 8px;border-radius:6px;background:#E8FAF0;color:#067647;font-size:12px}
      </style></head><body>
      <div class="head">
        <div><h1>${tenant}</h1><p class="muted">Car Wash &amp; Detailing</p></div>
        <div style="text-align:right"><h1>INVOICE</h1><p class="muted">${o.orderNumber}</p><span class="badge">${o.status.toUpperCase()}</span></div>
      </div>
      <p class="muted">Bill to: <strong>${o.customerName}</strong>${o.customerPhone ? ` · ${o.customerPhone}` : ''}${o.licensePlate ? ` · ${o.licensePlate}` : ''}</p>
      <p class="muted">Date: ${new Date(o.createdAt).toLocaleString('id-ID')}</p>
      <table><thead><tr><th style="text-align:left">Item</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="total">Total: ${fmt(o.total)}</p>
      <p class="muted" style="margin-top:32px;text-align:center">Thank you for your business. clean car. clear mind.</p>
      </body></html>`;
    const w = window.open('', '_blank', 'width=800,height=900');
    if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 250); }
  };

  return (
    <div data-testid="invoices-page">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-text-primary">Invoices</h1>
        <p className="mt-1 text-sm text-text-secondary">Printable invoices for completed transactions. Open one and use your browser&apos;s &quot;Save as PDF&quot;.</p>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <input className="input-field max-w-xs" placeholder="Search order # / name / phone…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <button className="btn-secondary" onClick={load}>Search</button>
        <BranchFilter value={branch} onChange={setBranch} />
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {loading ? (
        <div className="card text-sm text-text-muted">Loading…</div>
      ) : orders.length === 0 ? (
        <div className="card text-sm text-text-muted">No paid orders to invoice yet.</div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full">
            <thead><tr className="border-b border-border bg-surface-sunken/50">
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Invoice #</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Customer</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Date</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">Total</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase"></th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="px-5 py-3 text-sm font-mono">{o.orderNumber}</td>
                  <td className="px-5 py-3 text-sm font-medium text-text-primary">{o.customerName}<div className="text-xs text-text-muted">{o.customerPhone}</div></td>
                  <td className="px-5 py-3 text-xs text-text-muted">{new Date(o.createdAt).toLocaleString('id-ID')}</td>
                  <td className="px-5 py-3 text-sm text-right font-semibold text-primary-600">{fmt(o.total)}</td>
                  <td className="px-5 py-3 text-right"><button className="btn-secondary text-xs" onClick={() => print(o)}>🖨 Invoice</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
