'use client';

/**
 * Invoices — a billing view over completed orders. Lists paid/confirmed/completed
 * orders and produces a printable A4 invoice (print-to-PDF) per order. Reuses the
 * existing /orders data; no separate invoice store.
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useBranding } from '@/contexts/BrandingContext';
import BranchFilter from '@/components/dashboard/BranchFilter';
import { buildDocHtml, type DocTemplate, type DocData } from '@/components/dashboard/DocumentRenderer';
import { DocumentDesigner } from '@/components/dashboard/DocumentDesigner';

type InvoicesTab = 'invoices' | 'designer';

interface OrderItem { serviceName: string; quantity: number; subtotal: number }
interface Order {
  id: string; orderNumber: string; customerName: string; customerPhone: string;
  licensePlate?: string; status: string; items: OrderItem[]; total: number; createdAt: string;
}
interface OrderListResponse { orders: Order[] }
/** Financial breakdown from GET /orders/:id (the list shape omits these). */
interface OrderDetail { subtotal: number; serviceCharge: number; tax: number; voucherDiscount: number; total: number }

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

export default function InvoicesPage() {
  const { t } = useI18n();
  const { companyName, legalName, logoUrl } = useBranding();
  const [tab, setTab] = useState<InvoicesTab>('invoices');
  const [orders, setOrders] = useState<Order[]>([]);
  const [tpl, setTpl] = useState<DocTemplate | null>(null);
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Load the tenant's invoice layout (if designed). Absent/failed → legacy HTML.
  useEffect(() => { api.get<DocTemplate>('/doc-template/invoice').then(setTpl).catch(() => setTpl(null)); }, []);

  // Deep-link support: /dashboard/invoices?tab=designer
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('tab');
    if (q === 'designer' || q === 'invoices') setTab(q);
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ status: 'paid' });
      if (search.trim()) qs.set('search', search.trim());
      if (branch) qs.set('outletId', branch);
      const data = await api.get<OrderListResponse>(`/orders?${qs.toString()}`);
      setOrders(data.orders);
    } catch (e) { setError(e instanceof Error ? e.message : t('dash.invoices.failLoad', 'Failed to load invoices')); }
    finally { setLoading(false); }
  }, [search, branch]);
  useEffect(() => { load(); }, [load]);

  const openHtml = (html: string) => {
    const w = window.open('', '_blank', 'width=800,height=900');
    if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 250); }
  };

  const print = async (o: Order) => {
    // Designed layout: fill the tenant's invoice template with real order data.
    if (tpl) {
      let detail: OrderDetail | null = null;
      try { detail = await api.get<OrderDetail>(`/orders/${o.id}`); } catch { /* fall back to list totals */ }
      const discount = detail?.voucherDiscount ?? 0;
      const data: DocData = {
        fields: {
          company_name: companyName, legal_name: legalName, npwp: '', company_address: '', company_phone: '',
          invoice_number: o.orderNumber, invoice_date: new Date(o.createdAt).toLocaleString('id-ID'),
          customer_name: o.customerName, customer_phone: o.customerPhone,
          license_plate: o.licensePlate ?? '', payment_method: '', note: '',
        },
        items: o.items.map((it) => ({
          name: it.serviceName, quantity: String(it.quantity),
          unitPrice: fmt(it.quantity ? Math.round(it.subtotal / it.quantity) : it.subtotal), subtotal: fmt(it.subtotal),
        })),
        totals: [
          { label: t('dash.invoices.subtotal', 'Subtotal'), value: fmt(detail?.subtotal ?? o.total) },
          ...(detail && detail.serviceCharge ? [{ label: t('dash.invoices.serviceCharge', 'Service charge'), value: fmt(detail.serviceCharge) }] : []),
          ...(detail && detail.tax ? [{ label: t('dash.invoices.tax', 'Tax'), value: fmt(detail.tax) }] : []),
          ...(discount ? [{ label: t('dash.invoices.discount', 'Discount'), value: `- ${fmt(discount)}` }] : []),
          { label: t('dash.invoices.totalLabel', 'Total:'), value: fmt(detail?.total ?? o.total), strong: true },
        ],
        logo: logoUrl, code: null,
      };
      openHtml(buildDocHtml(tpl, data, `${t('dash.invoices.invoiceTitle', 'Invoice')} ${o.orderNumber}`));
      return;
    }
    // Legacy fallback (no template / fetch failed).
    const tenant = companyName || 'Airin';
    const rows = o.items.map((it) => `<tr><td>${it.quantity}× ${it.serviceName}</td><td style="text-align:right">${fmt(it.subtotal)}</td></tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${t('dash.invoices.invoiceTitle', 'Invoice')} ${o.orderNumber}</title>
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
        <div><h1>${tenant}</h1><p class="muted">${t('dash.invoices.tagline', 'Car Wash &amp; Detailing')}</p></div>
        <div style="text-align:right"><h1>${t('dash.invoices.invoiceHeading', 'INVOICE')}</h1><p class="muted">${o.orderNumber}</p><span class="badge">${o.status.toUpperCase()}</span></div>
      </div>
      <p class="muted">${t('dash.invoices.billTo', 'Bill to:')} <strong>${o.customerName}</strong>${o.customerPhone ? ` · ${o.customerPhone}` : ''}${o.licensePlate ? ` · ${o.licensePlate}` : ''}</p>
      <p class="muted">${t('dash.invoices.dateLabel', 'Date:')} ${new Date(o.createdAt).toLocaleString('id-ID')}</p>
      <table><thead><tr><th style="text-align:left">${t('dash.invoices.item', 'Item')}</th><th style="text-align:right">${t('dash.invoices.amount', 'Amount')}</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="total">${t('dash.invoices.totalLabel', 'Total:')} ${fmt(o.total)}</p>
      <p class="muted" style="margin-top:32px;text-align:center">${t('dash.invoices.thankYou', 'Thank you for your business.')} clean car. clear mind.</p>
      </body></html>`;
    openHtml(html);
  };

  return (
    <div data-testid="invoices-page">
      <h1 className="text-2xl font-bold text-text-primary mb-4">{t('dash.invoices.title', 'Invoices')}</h1>

      <div className="flex gap-1 border-b border-border mb-6">
        {([
          { key: 'invoices' as const, label: t('dash.invoices.tabInvoices', 'Invoices') },
          { key: 'designer' as const, label: t('dash.invoices.tabDesigner', 'Invoice Designer') },
        ]).map((tb) => (
          <button
            key={tb.key}
            data-testid={`invoices-tab-${tb.key}`}
            onClick={() => setTab(tb.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${
              tab === tb.key ? 'border-primary-500 text-primary-600' : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === 'designer' ? (
        <DocumentDesigner kind="invoice" showHeading={false} />
      ) : (
      <>
      <p className="mb-4 text-sm text-text-secondary">{t('dash.invoices.subtitle', 'Printable invoices for completed transactions. Open one and use your browser\'s "Save as PDF".')}</p>

      <div className="flex items-center gap-3 mb-4">
        <input className="input-field max-w-xs" placeholder={t('dash.invoices.searchPlaceholder', 'Search order # / name / phone…')} value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <button className="btn-secondary" onClick={load}>{t('dash.invoices.search', 'Search')}</button>
        <BranchFilter value={branch} onChange={setBranch} />
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {loading ? (
        <div className="card text-sm text-text-muted">{t('dash.invoices.loading', 'Loading…')}</div>
      ) : orders.length === 0 ? (
        <div className="card text-sm text-text-muted">{t('dash.invoices.noPaidOrders', 'No paid orders to invoice yet.')}</div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full">
            <thead><tr className="border-b border-border bg-surface-sunken/50">
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.invoices.invoiceNumber', 'Invoice #')}</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.invoices.customer', 'Customer')}</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.invoices.dateCol', 'Date')}</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.invoices.total', 'Total')}</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase"></th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="px-5 py-3 text-sm font-mono">{o.orderNumber}</td>
                  <td className="px-5 py-3 text-sm font-medium text-text-primary">{o.customerName}<div className="text-xs text-text-muted">{o.customerPhone}</div></td>
                  <td className="px-5 py-3 text-xs text-text-muted">{new Date(o.createdAt).toLocaleString('id-ID')}</td>
                  <td className="px-5 py-3 text-sm text-right font-semibold text-primary-600">{fmt(o.total)}</td>
                  <td className="px-5 py-3 text-right"><button className="btn-secondary text-xs" onClick={() => void print(o)}>🖨 {t('dash.invoices.invoice', 'Invoice')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>
      )}
    </div>
  );
}
