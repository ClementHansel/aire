'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  PageHeader, Panel, StatCard, TableWrap, thCls, tdCls, EmptyRow, Spinner,
  ErrorBanner, Modal, fmtIDR, fmtDateTime,
} from '@/components/dashboard/ui';
import { exportRows } from '@/components/dashboard/CsvTools';

interface Refund {
  id: string;
  refundNumber: string;
  orderId: string;
  orderNumber: string | null;
  status: string;
  reason: string;
  method: string;
  total: number;
  taxReversed: number;
  outletName: string | null;
  createdAt: string;
}
interface RefundDetail extends Refund {
  items: { id: string; quantity: number; amount: number; service_name: string | null }[];
}

export default function RefundsPage() {
  const { t } = useI18n();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<Refund[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<RefundDetail | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<Refund[]>(`/refunds?from=${from}&to=${to}`);
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load refunds');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const totalRefunded = rows.reduce((s, r) => s + r.total, 0);
  const totalTax = rows.reduce((s, r) => s + r.taxReversed, 0);

  const openDetail = async (id: string) => {
    try { setDetail(await api.get<RefundDetail>(`/refunds/${id}`)); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('nav.refunds', 'Refunds')}
        subtitle={t('refunds.subtitle', 'Money returned to customers — partial and full refunds against paid orders.')}
        actions={
          <div className="flex items-end gap-2">
            <label className="text-xs text-text-secondary">
              {t('common.from', 'From')}
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input-field mt-1" />
            </label>
            <label className="text-xs text-text-secondary">
              {t('common.to', 'To')}
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input-field mt-1" />
            </label>
            <button
              className="btn-secondary"
              onClick={() => exportRows('refunds.csv', rows as unknown as Record<string, unknown>[], [
                { key: 'refundNumber', label: 'Refund No' },
                { key: 'orderNumber', label: 'Order No' },
                { key: 'total', label: 'Amount' },
                { key: 'taxReversed', label: 'PPN Reversed' },
                { key: 'method', label: 'Method' },
                { key: 'reason', label: 'Reason' },
                { key: 'outletName', label: 'Branch' },
                { key: 'createdAt', label: 'Date' },
              ])}
            >
              {t('common.exportCsv', 'Export CSV')}
            </button>
          </div>
        }
      />

      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={t('refunds.count', 'Refunds')} value={rows.length} loading={loading} />
        <StatCard label={t('refunds.total', 'Total refunded')} value={fmtIDR(totalRefunded)} tone="negative" loading={loading} />
        <StatCard label={t('refunds.tax', 'PPN reversed')} value={fmtIDR(totalTax)} loading={loading} />
      </div>

      <Panel title={t('refunds.history', 'Refund history')}>
        <TableWrap>
          <thead>
            <tr className="border-b border-border text-left">
              <th className={thCls}>{t('refunds.number', 'Refund No')}</th>
              <th className={thCls}>{t('refunds.order', 'Order')}</th>
              <th className={thCls}>{t('refunds.amount', 'Amount')}</th>
              <th className={thCls}>{t('refunds.method', 'Method')}</th>
              <th className={thCls}>{t('refunds.reason', 'Reason')}</th>
              <th className={thCls}>{t('common.branch', 'Branch')}</th>
              <th className={thCls}>{t('common.date', 'Date')}</th>
              <th className={thCls}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <EmptyRow colSpan={8}><Spinner /></EmptyRow>
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={8}>{t('refunds.empty', 'No refunds in this range.')}</EmptyRow>
            ) : rows.map((r) => (
              <tr key={r.id}>
                <td className={tdCls}>{r.refundNumber}</td>
                <td className={tdCls}>{r.orderNumber ?? '—'}</td>
                <td className={`${tdCls} tabular-nums text-rose-600`}>{fmtIDR(r.total)}</td>
                <td className={tdCls}><span className="capitalize">{r.method}</span></td>
                <td className={`${tdCls} max-w-[16rem] truncate`} title={r.reason}>{r.reason}</td>
                <td className={tdCls}>{r.outletName ?? '—'}</td>
                <td className={tdCls}>{fmtDateTime(r.createdAt)}</td>
                <td className={tdCls}>
                  <button className="text-primary-600 hover:underline" onClick={() => openDetail(r.id)}>
                    {t('common.view', 'View')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Panel>

      {detail && (
        <Modal title={`${detail.refundNumber}`} onClose={() => setDetail(null)}>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-text-secondary">{t('refunds.order', 'Order')}</span><span>{detail.orderNumber}</span></div>
            <div className="flex justify-between"><span className="text-text-secondary">{t('refunds.method', 'Method')}</span><span className="capitalize">{detail.method}</span></div>
            <div className="flex justify-between"><span className="text-text-secondary">{t('refunds.reason', 'Reason')}</span><span className="text-right">{detail.reason}</span></div>
            <div className="rounded-lg border border-border">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {detail.items.map((it) => (
                    <tr key={it.id}>
                      <td className="px-3 py-2">{it.service_name ?? '—'} × {it.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtIDR(it.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between font-semibold"><span>{t('refunds.total', 'Total refunded')}</span><span className="text-rose-600">{fmtIDR(detail.total)}</span></div>
            <div className="flex justify-between text-xs text-text-muted"><span>{t('refunds.tax', 'PPN reversed')}</span><span>{fmtIDR(detail.taxReversed)}</span></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
