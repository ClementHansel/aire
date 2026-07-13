'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  PageHeader, Panel, Tabs, TableWrap, EmptyRow, TableSkeleton, thCls, tdCls,
  Modal, Field, StatusBadge, ErrorBanner, fmtIDR, fmtDate,
} from '@/components/dashboard/ui';

/* ── Types ──────────────────────────────────────────────────────────────── */

interface TaxInvoice {
  id: string;
  fakturNumber: string;
  kodeTransaksi: string;
  orderId: string | null;
  orderNumber: string | null;
  buyerNpwp: string | null;
  buyerNik: string | null;
  buyerName: string | null;
  buyerAddress: string | null;
  dpp: number;
  ppn: number;
  status: string;
  issuedAt: string;
  exportedAt: string | null;
}

interface TaxInvoiceDetail extends TaxInvoice {
  sellerNpwp: string;
  sellerName: string;
  sellerAddress: string;
}

interface TaxConfig {
  enabled: boolean;
  sellerNpwp: string;
  sellerName: string;
  sellerAddress: string;
  kodeTransaksi: string;
  fakturPrefix: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const monthAgo = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
};

type TabId = 'invoices' | 'setup';

export default function TaxInvoicesPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabId>('invoices');
  const [error, setError] = useState('');

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title={t('dash.tax.title', 'Tax Invoices (Faktur Pajak)')}
        subtitle={t('dash.tax.subtitle', 'Issue Faktur Pajak from orders and export the Coretax / e-Faktur import file.')}
      />
      <Tabs<TabId>
        tabs={[
          { id: 'invoices', label: t('dash.tax.tab.invoices', 'Invoices') },
          { id: 'setup', label: t('dash.tax.tab.setup', 'Setup') },
        ]}
        active={tab}
        onChange={setTab}
      />
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      {tab === 'invoices' ? <InvoicesTab onError={setError} /> : <SetupTab onError={setError} />}
    </div>
  );
}

/* ── Invoices tab ───────────────────────────────────────────────────────── */

function InvoicesTab({ onError }: { onError: (m: string) => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<TaxInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());
  const [showGenerate, setShowGenerate] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<TaxInvoice[]>(`/tax-invoice?from=${from}&to=${to}`);
      setRows(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : t('dash.tax.loadError', 'Failed to load tax invoices'));
    } finally {
      setLoading(false);
    }
  }, [from, to, t, onError]);
  useEffect(() => { load(); }, [load]);

  // Export downloads the file with a bearer token, then triggers a Blob download.
  const doExport = useCallback(async () => {
    setExporting(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('aire_access_token') : null;
      const base = process.env.NEXT_PUBLIC_API_URL || '/api';
      const url = `${base}/tax-invoice/export?from=${from}&to=${to}&format=coretax`;
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(t('dash.tax.exportError', 'Export failed'));
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `coretax-${from}-to-${to}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      await load(); // statuses flip to "exported"
    } catch (err) {
      onError(err instanceof Error ? err.message : t('dash.tax.exportError', 'Export failed'));
    } finally {
      setExporting(false);
    }
  }, [from, to, t, onError, load]);

  const printInvoice = useCallback(async (id: string) => {
    try {
      const inv = await api.get<TaxInvoiceDetail>(`/tax-invoice/${id}`);
      openPrintWindow(inv);
    } catch (err) {
      onError(err instanceof Error ? err.message : t('dash.tax.printError', 'Failed to load invoice'));
    }
  }, [t, onError]);

  return (
    <>
      <Panel
        title={t('dash.tax.list.title', 'Issued Faktur Pajak')}
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="mr-1 text-text-secondary">{t('common.from', 'From')}</span>
              <input type="date" className="input-field inline-block w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="mr-1 text-text-secondary">{t('common.to', 'To')}</span>
              <input type="date" className="input-field inline-block w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <button type="button" className="btn-secondary" onClick={doExport} disabled={exporting}>
              {exporting ? t('dash.tax.exporting', 'Exporting…') : t('dash.tax.export', 'Export to Coretax')}
            </button>
            <button type="button" className="btn-primary" onClick={() => setShowGenerate(true)}>
              {t('dash.tax.generate', 'Generate from order')}
            </button>
          </div>
        }
      >
        {loading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : (
          <TableWrap>
            <thead>
              <tr className="border-b border-border text-left">
                <th className={thCls}>{t('dash.tax.col.faktur', 'Faktur No.')}</th>
                <th className={thCls}>{t('dash.tax.col.buyer', 'Buyer')}</th>
                <th className={`${thCls} text-right`}>{t('dash.tax.col.dpp', 'DPP')}</th>
                <th className={`${thCls} text-right`}>{t('dash.tax.col.ppn', 'PPN')}</th>
                <th className={thCls}>{t('dash.tax.col.status', 'Status')}</th>
                <th className={thCls}>{t('dash.tax.col.date', 'Date')}</th>
                <th className={`${thCls} text-right`}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyRow colSpan={7}>{t('dash.tax.empty', 'No tax invoices in this range.')}</EmptyRow>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/60">
                    <td className={`${tdCls} font-mono text-xs`}>{r.fakturNumber}</td>
                    <td className={tdCls}>
                      <div>{r.buyerName || '—'}</div>
                      <div className="text-xs text-text-muted">{r.buyerNpwp || t('dash.tax.noNpwp', 'No NPWP')}</div>
                    </td>
                    <td className={`${tdCls} text-right tabular-nums`}>{fmtIDR(r.dpp)}</td>
                    <td className={`${tdCls} text-right tabular-nums`}>{fmtIDR(r.ppn)}</td>
                    <td className={tdCls}><StatusBadge status={r.status} /></td>
                    <td className={tdCls}>{fmtDate(r.issuedAt)}</td>
                    <td className={`${tdCls} text-right`}>
                      <button type="button" className="btn-ghost text-sm" onClick={() => printInvoice(r.id)}>
                        {t('dash.tax.print', 'Print')}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      {showGenerate && (
        <GenerateModal
          onClose={() => setShowGenerate(false)}
          onDone={() => { setShowGenerate(false); load(); }}
          onError={onError}
        />
      )}
    </>
  );
}

/* ── Generate modal ─────────────────────────────────────────────────────── */

function GenerateModal({ onClose, onDone, onError }: { onClose: () => void; onDone: () => void; onError: (m: string) => void }) {
  const { t } = useI18n();
  const [orderId, setOrderId] = useState('');
  const [buyerNpwp, setBuyerNpwp] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!orderId.trim()) { onError(t('dash.tax.needOrder', 'Enter an order ID.')); return; }
    setSaving(true);
    try {
      await api.post('/tax-invoice/generate', {
        orderId: orderId.trim(),
        buyerNpwp: buyerNpwp.trim() || undefined,
        buyerName: buyerName.trim() || undefined,
        buyerAddress: buyerAddress.trim() || undefined,
      });
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : t('dash.tax.genError', 'Failed to generate tax invoice'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={t('dash.tax.generate', 'Generate from order')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>{t('common.cancel', 'Cancel')}</button>
          <button type="button" className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? t('common.saving', 'Saving…') : t('dash.tax.generate', 'Generate')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('dash.tax.orderId', 'Order ID')} hint={t('dash.tax.orderIdHint', 'The order must be paid/confirmed/completed.')}>
          <input className="input-field" value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="order UUID" />
        </Field>
        <Field label={t('dash.tax.buyerNpwp', 'Buyer NPWP')} hint={t('dash.tax.buyerFallback', 'Leave blank to use the customer’s stored tax identity.')}>
          <input className="input-field" value={buyerNpwp} onChange={(e) => setBuyerNpwp(e.target.value)} />
        </Field>
        <Field label={t('dash.tax.buyerName', 'Buyer name')}>
          <input className="input-field" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
        </Field>
        <Field label={t('dash.tax.buyerAddress', 'Buyer address')}>
          <input className="input-field" value={buyerAddress} onChange={(e) => setBuyerAddress(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/* ── Setup tab ──────────────────────────────────────────────────────────── */

function SetupTab({ onError }: { onError: (m: string) => void }) {
  const { t } = useI18n();
  const [cfg, setCfg] = useState<TaxConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setCfg(await api.get<TaxConfig>('/tax-invoice/config'));
      } catch (err) {
        onError(err instanceof Error ? err.message : t('dash.tax.loadError', 'Failed to load config'));
      } finally {
        setLoading(false);
      }
    })();
  }, [t, onError]);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    setSaved(false);
    try {
      const next = await api.put<TaxConfig>('/tax-invoice/config', cfg);
      setCfg(next);
      setSaved(true);
    } catch (err) {
      onError(err instanceof Error ? err.message : t('dash.tax.saveError', 'Failed to save config'));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !cfg) return <Panel title={t('dash.tax.tab.setup', 'Setup')}><TableSkeleton rows={4} cols={2} /></Panel>;

  const upd = (patch: Partial<TaxConfig>) => { setCfg({ ...cfg, ...patch }); setSaved(false); };

  return (
    <Panel
      title={t('dash.tax.setup.title', 'Seller identity (Faktur Pajak)')}
      description={t('dash.tax.setup.desc', 'Used as the seller on issued invoices and in the Coretax export.')}
    >
      <div className="max-w-lg space-y-4">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => upd({ enabled: e.target.checked })} />
          <span className="text-sm font-medium text-text-primary">{t('dash.tax.setup.enabled', 'Enable tax-invoice issuance')}</span>
        </label>
        <Field label={t('dash.tax.setup.sellerNpwp', 'Seller NPWP')}>
          <input className="input-field" value={cfg.sellerNpwp} onChange={(e) => upd({ sellerNpwp: e.target.value })} />
        </Field>
        <Field label={t('dash.tax.setup.sellerName', 'Seller name')}>
          <input className="input-field" value={cfg.sellerName} onChange={(e) => upd({ sellerName: e.target.value })} />
        </Field>
        <Field label={t('dash.tax.setup.sellerAddress', 'Seller address')}>
          <textarea className="input-field" rows={2} value={cfg.sellerAddress} onChange={(e) => upd({ sellerAddress: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('dash.tax.setup.kode', 'Transaction code')} hint={t('dash.tax.setup.kodeHint', 'Coretax kode transaksi (default 04).')}>
            <input className="input-field" value={cfg.kodeTransaksi} onChange={(e) => upd({ kodeTransaksi: e.target.value })} />
          </Field>
          <Field label={t('dash.tax.setup.prefix', 'Faktur prefix')} hint={t('dash.tax.setup.prefixHint', 'Default 010.')}>
            <input className="input-field" value={cfg.fakturPrefix} onChange={(e) => upd({ fakturPrefix: e.target.value })} />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" className="btn-primary" onClick={save} disabled={saving}>
            {saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
          </button>
          {saved && <span className="text-sm text-green-600">{t('common.saved', 'Saved')}</span>}
        </div>
      </div>
    </Panel>
  );
}

/* ── Printable Faktur Pajak ─────────────────────────────────────────────── */

function openPrintWindow(inv: TaxInvoiceDetail) {
  const w = window.open('', '_blank', 'width=800,height=900');
  if (!w) return;
  const idr = (n: number) => `Rp ${Math.round(Number(n || 0)).toLocaleString('id-ID')}`;
  const esc = (s: string | null | undefined) => (s ?? '—').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  const total = inv.dpp + inv.ppn;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Faktur Pajak ${esc(inv.fakturNumber)}</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:32px;max-width:720px;margin:0 auto;}
      h1{font-size:18px;text-align:center;margin:0 0 4px;}
      .sub{text-align:center;font-size:12px;color:#555;margin-bottom:24px;}
      .box{border:1px solid #ccc;border-radius:6px;padding:12px 16px;margin-bottom:16px;}
      .label{font-size:11px;text-transform:uppercase;color:#666;letter-spacing:.04em;}
      .val{font-size:14px;margin-bottom:8px;}
      table{width:100%;border-collapse:collapse;margin-top:12px;}
      td{padding:6px 8px;font-size:14px;}
      .totals td{border-top:1px solid #ddd;}
      .r{text-align:right;}.b{font-weight:700;}
      @media print{button{display:none;}}
    </style></head><body>
    <h1>FAKTUR PAJAK</h1>
    <div class="sub">${esc(inv.fakturNumber)} &middot; Kode Transaksi ${esc(inv.kodeTransaksi)} &middot; ${(inv.issuedAt || '').slice(0, 10)}</div>
    <div class="box">
      <div class="label">Penjual (Seller)</div>
      <div class="val b">${esc(inv.sellerName)}</div>
      <div class="val">NPWP: ${esc(inv.sellerNpwp)}<br>${esc(inv.sellerAddress)}</div>
    </div>
    <div class="box">
      <div class="label">Pembeli (Buyer)</div>
      <div class="val b">${esc(inv.buyerName)}</div>
      <div class="val">NPWP: ${esc(inv.buyerNpwp)}<br>${esc(inv.buyerAddress)}</div>
    </div>
    <table>
      <tr><td>Dasar Pengenaan Pajak (DPP)</td><td class="r">${idr(inv.dpp)}</td></tr>
      <tr><td>PPN (11%)</td><td class="r">${idr(inv.ppn)}</td></tr>
      <tr class="totals"><td class="b">Total</td><td class="r b">${idr(total)}</td></tr>
    </table>
    <p style="margin-top:24px"><button onclick="window.print()">Print</button></p>
    </body></html>`);
  w.document.close();
}
