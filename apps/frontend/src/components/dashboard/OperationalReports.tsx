'use client';

/**
 * The two reports the owner keeps by hand in a spreadsheet today, rebuilt from
 * live data (Samuel 2026-07-30 — "kalau datanya ada dan memungkinkan kurang
 * lebih boleh diikuti"):
 *
 * 1. Daily operations — one row per day: money split per payment rail, then
 *    volume, member split, items by category, memberships new/renewed, vouchers.
 * 2. Item × agent — what each salesperson sold in the period.
 *
 * Both are wide tables, so each scrolls horizontally inside its own card rather
 * than forcing the page to.
 */

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { DailyOperationsRow, AgentPerformanceReport } from '@aire/shared';

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
const fmtCompact = (n: number) => (n === 0 ? '—' : n.toLocaleString('id-ID'));

/** "qris_dynamic|AIRE" → "QRIS · AIRE"; "cash" → "Cash". */
function paymentLabel(key: string): string {
  const [method, unit] = key.split('|');
  const base = ({
    cash: 'Cash', transfer: 'Transfer', edc: 'Debit/EDC', cc: 'Credit card',
    qris_static: 'QRIS', qris_dynamic: 'QRIS', unpaid: 'Unpaid',
  } as Record<string, string>)[method ?? ''] ?? (method ?? '');
  return unit ? `${base} · ${unit}` : base;
}

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const dayName = (iso: string) => DAY_NAMES[new Date(`${iso}T00:00:00`).getDay()] ?? '';

/** Download an array of rows as CSV (the sheet this report replaces). */
function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function DailyOperationsReport({ qs, dateFrom, dateTo }: { qs: string; dateFrom: string; dateTo: string }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<DailyOperationsRow[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setRows(null); setError('');
    try {
      setRows(await api.get<DailyOperationsRow[]>(`/reports/daily-operations?${qs}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.reports.failLoad', 'Failed to load report'));
    }
  }, [qs, t]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>;
  if (rows === null) return <p className="text-sm text-text-muted">{t('dash.reports.loading', 'Loading…')}</p>;
  if (rows.length === 0) return <p className="text-sm text-text-muted">{t('dash.reports.noData', 'No data in this range.')}</p>;

  // Columns are whatever rails actually saw money, so a tenant that never takes
  // credit cards doesn't get an empty column.
  const payKeys = [...new Set(rows.flatMap((r) => Object.keys(r.payments)))].sort();
  const categories = [...new Set(rows.flatMap((r) => Object.keys(r.itemsByCategory)))].sort();
  const newKeys = [...new Set(rows.flatMap((r) => Object.keys(r.newMemberships)))].sort((a, b) => +a - +b);
  const rnwKeys = [...new Set(rows.flatMap((r) => Object.keys(r.renewals)))].sort((a, b) => +a - +b);

  const sum = (pick: (r: DailyOperationsRow) => number) => rows.reduce((a, r) => a + pick(r), 0);
  const catLabel = (c: string) => ({ car_wash: t('dash.reports.catWash', 'Wash'), add_on: t('dash.reports.catAddOn', 'Add-on'), product: t('dash.reports.catProduct', 'Product') } as Record<string, string>)[c] ?? c;

  const exportCsv = () => {
    const header = [
      'DAY', 'DATE', ...payKeys.map(paymentLabel), 'TOTAL', 'ORDERS', 'MBR', 'NON',
      ...categories.map(catLabel), ...newKeys.map((k) => `NEW-${k}`), ...rnwKeys.map((k) => `RNWL-${k}`), 'VOU',
    ];
    const body = rows.map((r) => [
      dayName(r.date), r.date, ...payKeys.map((k) => r.payments[k] ?? 0), r.revenue,
      r.orders, r.memberOrders, r.nonMemberOrders,
      ...categories.map((c) => r.itemsByCategory[c] ?? 0),
      ...newKeys.map((k) => r.newMemberships[k] ?? 0),
      ...rnwKeys.map((k) => r.renewals[k] ?? 0),
      r.voucherPacks,
    ]);
    downloadCsv(`daily-operations-${dateFrom}-to-${dateTo}.csv`, header, body);
  };

  const th = 'px-3 py-2 text-xs font-medium text-text-secondary uppercase whitespace-nowrap';
  const td = 'px-3 py-2 text-sm whitespace-nowrap';

  return (
    <div className="card p-0 overflow-hidden" data-testid="daily-operations-report">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">{t('dash.reports.dailyOpsTitle', 'Daily revenue report')}</h2>
          <p className="text-xs text-text-muted mt-0.5">{t('dash.reports.dailyOpsHint', 'Revenue per payment method, then the day’s volume, memberships and vouchers.')}</p>
        </div>
        <button className="btn-secondary text-xs shrink-0" onClick={exportCsv}>{t('dash.reports.exportCsv', 'Export CSV')}</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-surface-sunken/50">
              <th className={`${th} text-left`}>{t('dash.reports.day', 'Day')}</th>
              <th className={`${th} text-left`}>{t('dash.reports.date', 'Date')}</th>
              {payKeys.map((k) => <th key={k} className={`${th} text-right`}>{paymentLabel(k)}</th>)}
              <th className={`${th} text-right`}>{t('dash.reports.total', 'Total')}</th>
              <th className={`${th} text-right border-l border-border`}>{t('dash.reports.ordersCol', 'Orders')}</th>
              <th className={`${th} text-right`}>{t('dash.reports.member', 'Member')}</th>
              <th className={`${th} text-right`}>{t('dash.reports.nonMember', 'Non')}</th>
              {categories.map((c) => <th key={c} className={`${th} text-right`}>{catLabel(c)}</th>)}
              {newKeys.map((k) => <th key={`n${k}`} className={`${th} text-right border-l border-border`}>{`NEW-${k}`}</th>)}
              {rnwKeys.map((k) => <th key={`r${k}`} className={`${th} text-right`}>{`RNWL-${k}`}</th>)}
              <th className={`${th} text-right`}>VOU</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.date}>
                <td className={`${td} text-text-muted`}>{dayName(r.date)}</td>
                <td className={td}>{r.date}</td>
                {payKeys.map((k) => <td key={k} className={`${td} text-right font-mono text-text-secondary`}>{r.payments[k] ? fmt(r.payments[k]!) : '—'}</td>)}
                <td className={`${td} text-right font-mono font-medium`}>{fmt(r.revenue)}</td>
                <td className={`${td} text-right border-l border-border`}>{r.orders}</td>
                <td className={`${td} text-right`}>{fmtCompact(r.memberOrders)}</td>
                <td className={`${td} text-right`}>{fmtCompact(r.nonMemberOrders)}</td>
                {categories.map((c) => <td key={c} className={`${td} text-right`}>{fmtCompact(r.itemsByCategory[c] ?? 0)}</td>)}
                {newKeys.map((k) => <td key={`n${k}`} className={`${td} text-right border-l border-border`}>{fmtCompact(r.newMemberships[k] ?? 0)}</td>)}
                {rnwKeys.map((k) => <td key={`r${k}`} className={`${td} text-right`}>{fmtCompact(r.renewals[k] ?? 0)}</td>)}
                <td className={`${td} text-right`}>{fmtCompact(r.voucherPacks)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-surface-sunken/30 font-semibold">
              <td className={td} colSpan={2}>{t('dash.reports.total', 'Total')}</td>
              {payKeys.map((k) => <td key={k} className={`${td} text-right font-mono`}>{fmt(sum((r) => r.payments[k] ?? 0))}</td>)}
              <td className={`${td} text-right font-mono`}>{fmt(sum((r) => r.revenue))}</td>
              <td className={`${td} text-right border-l border-border`}>{sum((r) => r.orders)}</td>
              <td className={`${td} text-right`}>{sum((r) => r.memberOrders)}</td>
              <td className={`${td} text-right`}>{sum((r) => r.nonMemberOrders)}</td>
              {categories.map((c) => <td key={c} className={`${td} text-right`}>{sum((r) => r.itemsByCategory[c] ?? 0)}</td>)}
              {newKeys.map((k) => <td key={`n${k}`} className={`${td} text-right border-l border-border`}>{sum((r) => r.newMemberships[k] ?? 0)}</td>)}
              {rnwKeys.map((k) => <td key={`r${k}`} className={`${td} text-right`}>{sum((r) => r.renewals[k] ?? 0)}</td>)}
              <td className={`${td} text-right`}>{sum((r) => r.voucherPacks)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="px-5 py-3 text-xs text-text-muted border-t border-border">
        {t('dash.reports.feeNote', 'Revenue is the amount charged — payment-gateway and EDC fees are not deducted.')}
      </p>
    </div>
  );
}

export function AgentPerformanceReportTable({ qs, dateFrom, dateTo }: { qs: string; dateFrom: string; dateTo: string }) {
  const { t } = useI18n();
  const [data, setData] = useState<AgentPerformanceReport | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setData(null); setError('');
    try {
      setData(await api.get<AgentPerformanceReport>(`/reports/agent-performance?${qs}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.reports.failLoad', 'Failed to load report'));
    }
  }, [qs, t]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>;
  if (data === null) return <p className="text-sm text-text-muted">{t('dash.reports.loading', 'Loading…')}</p>;
  if (data.rows.length === 0) return <p className="text-sm text-text-muted">{t('dash.reports.noData', 'No data in this range.')}</p>;

  const agentLabel = (a: string) => (a === '—' ? t('dash.reports.unassigned', 'Unassigned') : a);
  const exportCsv = () => downloadCsv(
    `agent-performance-${dateFrom}-to-${dateTo}.csv`,
    ['ITEM', ...data.agents.map(agentLabel), 'TOTAL'],
    data.rows.map((r) => [r.item, ...data.agents.map((a) => r.byAgent[a] ?? 0), r.total]),
  );

  const th = 'px-3 py-2 text-xs font-medium text-text-secondary uppercase whitespace-nowrap';
  const td = 'px-3 py-2 text-sm whitespace-nowrap';
  const groupTotal = (a: string) => data.rows.reduce((s, r) => s + (r.byAgent[a] ?? 0), 0);

  return (
    <div className="card p-0 overflow-hidden" data-testid="agent-performance-report">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">{t('dash.reports.agentTitle', 'Sales per agent')}</h2>
          <p className="text-xs text-text-muted mt-0.5">{t('dash.reports.agentHint', 'Counted against the salesperson credited on each order, not the cashier.')}</p>
        </div>
        <button className="btn-secondary text-xs shrink-0" onClick={exportCsv}>{t('dash.reports.exportCsv', 'Export CSV')}</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-surface-sunken/50">
              <th className={`${th} text-left`}>{t('dash.reports.item', 'Item')}</th>
              {data.agents.map((a) => <th key={a} className={`${th} text-right`}>{agentLabel(a)}</th>)}
              <th className={`${th} text-right border-l border-border`}>{t('dash.reports.total', 'Total')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.rows.map((r) => (
              <tr key={r.item} data-testid={`agent-row-${r.group}`}>
                <td className={td}>{r.item}</td>
                {data.agents.map((a) => <td key={a} className={`${td} text-right`}>{fmtCompact(r.byAgent[a] ?? 0)}</td>)}
                <td className={`${td} text-right font-medium border-l border-border`}>{r.total}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-surface-sunken/30 font-semibold">
              <td className={td}>{t('dash.reports.total', 'Total')}</td>
              {data.agents.map((a) => <td key={a} className={`${td} text-right`}>{groupTotal(a)}</td>)}
              <td className={`${td} text-right border-l border-border`}>{data.rows.reduce((s, r) => s + r.total, 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
