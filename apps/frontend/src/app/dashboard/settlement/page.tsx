'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import BranchFilter from '@/components/dashboard/BranchFilter';
import { useI18n } from '@/lib/i18n';
import {
  PageHeader, StatCard, Panel, ErrorBanner, Modal, Field,
  TableWrap, EmptyRow, TableSkeleton, thCls, tdCls,
  fmtIDR, fmtDateTime, fmtDate, Spinner,
} from '@/components/dashboard/ui';

interface SummaryRow { owingOutletId: string; owingName: string; servingOutletId: string; servingName: string; entries: number; amount: number }
interface PayoutRow { id: string; amount: number; entryCount: number; note: string | null; owingName: string; servingName: string; createdAt: string }
interface EntryRow { id: string; amount: number; status: string; owingName: string; servingName: string; createdAt: string }

export default function SettlementPage() {
  const { t } = useI18n();
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [branch, setBranch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [active, setActive] = useState<SummaryRow | null>(null);
  const [payoutDetail, setPayoutDetail] = useState<PayoutRow | null>(null);
  const [netTarget, setNetTarget] = useState<NetPair | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const bq = branch ? `?outletId=${branch}` : '';
      const [s, p] = await Promise.all([
        api.get<SummaryRow[]>(`/settlement/summary${bq}`),
        api.get<PayoutRow[]>(`/settlement/payouts${bq}`),
      ]);
      setSummary(s); setPayouts(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dash.settlement.loadError', 'Failed to load settlement data'));
    } finally {
      setLoading(false);
    }
  }, [branch, t]);
  useEffect(() => { load(); }, [load]);

  const totalPending = summary.reduce((s, r) => s + r.amount, 0);
  const totalSettled = payouts.reduce((s, r) => s + r.amount, 0);

  // Bilateral pairs: both A→B and B→A have pending amounts → candidates for net-off.
  // Build one NetPair per unordered pair (keyed by sorted ids) to avoid duplicates.
  const netPairs = (() => {
    const byPair = new Map<string, SummaryRow>();
    summary.forEach((r) => byPair.set(`${r.owingOutletId}|${r.servingOutletId}`, r));
    const seen = new Set<string>();
    const out: NetPair[] = [];
    for (const r of summary) {
      const reverse = byPair.get(`${r.servingOutletId}|${r.owingOutletId}`);
      if (!reverse) continue;
      const key = [r.owingOutletId, r.servingOutletId].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      // Orient A/B deterministically by id so aOwesB/bOwesA are stable.
      const aId = r.owingOutletId < r.servingOutletId ? r.owingOutletId : r.servingOutletId;
      const bId = r.owingOutletId < r.servingOutletId ? r.servingOutletId : r.owingOutletId;
      const aRow = byPair.get(`${aId}|${bId}`)!;
      const bRow = byPair.get(`${bId}|${aId}`)!;
      out.push({
        aId, aName: aRow.owingName, bId, bName: aRow.servingName,
        aOwesB: aRow.amount, bOwesA: bRow.amount, net: aRow.amount - bRow.amount,
      });
    }
    return out;
  })();

  return (
    <div data-testid="settlement-page" className="space-y-6">
      <PageHeader
        title={t('dash.settlement.title', 'Inter-Branch Settlement')}
        subtitle={t('dash.settlement.subtitle', 'When a member washes at a branch other than where they bought their membership, the home branch owes the serving branch. Review what is owed and settle each pair.')}
        actions={<BranchFilter value={branch} onChange={setBranch} label={t('dash.settlement.involvingBranch', 'Involving branch')} />}
      />

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard loading={loading} label={t('dash.settlement.totalPending', 'Pending settlement')} value={fmtIDR(totalPending)} tone={totalPending > 0 ? 'warning' : 'default'} />
        <StatCard loading={loading} label={t('dash.settlement.openPairs', 'Open branch pairs')} value={summary.length} />
        <StatCard loading={loading} label={t('dash.settlement.settledTotal', 'Settled to date')} value={fmtIDR(totalSettled)} tone="positive" />
      </div>

      {/* Net-off opportunities — pairs that owe each other both ways */}
      {netPairs.length > 0 && (
        <Panel
          title={t('dash.settlement.netOffTitle', 'Net-off opportunities')}
          description={t('dash.settlement.netOffDesc', 'These branches owe each other in both directions — offset them into a single net payment.')}
          bodyClassName="p-0"
        >
          <TableWrap>
            <thead>
              <tr className="border-b border-border bg-surface-sunken/50">
                <th className={`${thCls} text-left`}>{t('dash.settlement.branches', 'Branches')}</th>
                <th className={`${thCls} text-right`}>{t('dash.settlement.eachWay', 'Owed each way')}</th>
                <th className={`${thCls} text-right`}>{t('dash.settlement.net', 'Net')}</th>
                <th className={`${thCls} text-right`}>{t('dash.settlement.action', 'Action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {netPairs.map((p) => (
                <tr key={p.aId + p.bId} className="hover:bg-surface-sunken/40">
                  <td className={`${tdCls} font-medium`}>{p.aName} ↔ {p.bName}</td>
                  <td className={`${tdCls} text-right tabular-nums text-text-secondary`}>{fmtIDR(p.aOwesB)} / {fmtIDR(p.bOwesA)}</td>
                  <td className={`${tdCls} text-right font-medium tabular-nums`}>
                    {p.net === 0 ? t('dash.settlement.fullyNetted', 'Fully netted') : `${p.net > 0 ? p.aName : p.bName} +${fmtIDR(Math.abs(p.net))}`}
                  </td>
                  <td className={`${tdCls} text-right`}>
                    <button className="btn-secondary py-1.5 text-xs" onClick={() => setNetTarget(p)}>{t('dash.settlement.netOff', 'Net off')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Panel>
      )}

      {/* Pending (owed) */}
      <Panel title={t('dash.settlement.pendingOwed', 'Pending (owed)')} bodyClassName="p-0">
        {loading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : (
          <TableWrap>
            <thead>
              <tr className="border-b border-border bg-surface-sunken/50">
                <th className={`${thCls} text-left`}>{t('dash.settlement.owingBranch', 'Owing branch')}</th>
                <th className={`${thCls} text-left`}>{t('dash.settlement.owes', 'Owes')}</th>
                <th className={`${thCls} text-right`}>{t('dash.settlement.entries', 'Entries')}</th>
                <th className={`${thCls} text-right`}>{t('dash.settlement.amount', 'Amount')}</th>
                <th className={`${thCls} text-right`}>{t('dash.settlement.action', 'Action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {summary.length === 0 ? (
                <EmptyRow colSpan={5}>{t('dash.settlement.nothingPending', 'Nothing pending — all branches are settled.')}</EmptyRow>
              ) : summary.map((r) => (
                <tr key={r.owingOutletId + r.servingOutletId} className="hover:bg-surface-sunken/40">
                  <td className={`${tdCls} font-medium`}>{r.owingName}</td>
                  <td className={tdCls}>{r.servingName}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{r.entries}</td>
                  <td className={`${tdCls} text-right font-medium tabular-nums`}>{fmtIDR(r.amount)}</td>
                  <td className={`${tdCls} text-right`}>
                    <button className="btn-secondary py-1.5 text-xs" onClick={() => setActive(r)}>{t('dash.settlement.reviewSettle', 'Review & settle')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      {/* Payout history */}
      <Panel title={t('dash.settlement.payoutHistory', 'Payout history')} bodyClassName="p-0">
        {loading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : (
          <TableWrap>
            <thead>
              <tr className="border-b border-border bg-surface-sunken/50">
                <th className={`${thCls} text-left`}>{t('dash.settlement.date', 'Date')}</th>
                <th className={`${thCls} text-left`}>{t('dash.settlement.fromTo', 'From → To')}</th>
                <th className={`${thCls} text-left`}>{t('dash.settlement.note', 'Note')}</th>
                <th className={`${thCls} text-right`}>{t('dash.settlement.entries', 'Entries')}</th>
                <th className={`${thCls} text-right`}>{t('dash.settlement.amount', 'Amount')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {payouts.length === 0 ? (
                <EmptyRow colSpan={5}>{t('dash.settlement.noPayouts', 'No payouts yet.')}</EmptyRow>
              ) : payouts.map((p) => (
                <tr key={p.id} className="cursor-pointer hover:bg-surface-sunken/40" onClick={() => setPayoutDetail(p)}>
                  <td className={`${tdCls} whitespace-nowrap text-text-muted`}>{fmtDateTime(p.createdAt)}</td>
                  <td className={tdCls}>{p.owingName} → {p.servingName}</td>
                  <td className={`${tdCls} text-text-secondary`}>{p.note || '—'}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{p.entryCount}</td>
                  <td className={`${tdCls} text-right font-medium tabular-nums`}>{fmtIDR(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      {active && <SettleModal row={active} onClose={() => setActive(null)} onSettled={() => { setActive(null); load(); }} />}
      {netTarget && <NetSettleModal pair={netTarget} onClose={() => setNetTarget(null)} onSettled={() => { setNetTarget(null); load(); }} />}

      {payoutDetail && (
        <Modal title={t('dash.settlement.payoutDetail', 'Payout detail')} onClose={() => setPayoutDetail(null)}>
          <dl className="divide-y divide-border text-sm">
            <div className="flex justify-between py-2"><dt className="text-text-secondary">{t('dash.settlement.date', 'Date')}</dt><dd className="font-medium text-text-primary">{fmtDateTime(payoutDetail.createdAt)}</dd></div>
            <div className="flex justify-between py-2"><dt className="text-text-secondary">{t('dash.settlement.fromTo', 'From → To')}</dt><dd className="font-medium text-text-primary">{payoutDetail.owingName} → {payoutDetail.servingName}</dd></div>
            <div className="flex justify-between py-2"><dt className="text-text-secondary">{t('dash.settlement.entries', 'Entries settled')}</dt><dd className="text-text-primary tabular-nums">{payoutDetail.entryCount}</dd></div>
            <div className="flex justify-between gap-6 py-2"><dt className="text-text-secondary">{t('dash.settlement.note', 'Note')}</dt><dd className="text-right text-text-primary">{payoutDetail.note || '—'}</dd></div>
            <div className="flex justify-between py-2"><dt className="text-text-secondary">{t('dash.settlement.amount', 'Amount')}</dt><dd className="text-lg font-bold tabular-nums text-text-primary">{fmtIDR(payoutDetail.amount)}</dd></div>
          </dl>
        </Modal>
      )}
    </div>
  );
}

function SettleModal({ row, onClose, onSettled }: { row: SummaryRow; onClose: () => void; onSettled: () => void }) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<EntryRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<EntryRow[]>(`/settlement/entries?owing=${row.owingOutletId}&serving=${row.servingOutletId}&status=pending`)
      .then((rows) => { setEntries(rows); setSelected(new Set(rows.map((r) => r.id))); }) // default: all selected
      .catch(() => setEntries([]));
  }, [row]);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSelected = !!entries && entries.length > 0 && selected.size === entries.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set((entries ?? []).map((e) => e.id)));
  const selectedTotal = (entries ?? []).filter((e) => selected.has(e.id)).reduce((s, e) => s + e.amount, 0);
  const partial = !!entries && selected.size > 0 && selected.size < entries.length;

  const settle = async () => {
    if (selected.size === 0) { setError(t('dash.settlement.selectAtLeastOne', 'Select at least one entry.')); return; }
    setBusy(true); setError('');
    try {
      await api.post('/settlement/payout', {
        owingOutletId: row.owingOutletId,
        servingOutletId: row.servingOutletId,
        note: note || undefined,
        // Only send entryIds for a partial settlement; omit to settle all.
        entryIds: partial ? [...selected] : undefined,
      });
      onSettled();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.settlement.payoutError', 'Payout failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('dash.settlement.settlePair', 'Settle branch pair')}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>{t('common.cancel', 'Cancel')}</button>
          <button className="btn-primary" onClick={settle} disabled={busy || selected.size === 0}>
            {busy ? <Spinner /> : `${t('dash.settlement.settlePayout', 'Settle')} ${fmtIDR(selectedTotal)}`}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorBanner message={error} />
        <div className="rounded-lg border border-border bg-surface-sunken/40 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">{t('dash.settlement.owingBranch', 'Owing branch')}</span>
            <span className="font-medium text-text-primary">{row.owingName}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-text-secondary">{t('dash.settlement.servingBranch', 'Serving branch')}</span>
            <span className="font-medium text-text-primary">{row.servingName}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-text-secondary">{t('dash.settlement.selectedAmount', 'Selected')}</span>
            <span className="font-semibold text-text-primary">{fmtIDR(selectedTotal)} · {selected.size}/{row.entries} {t('dash.settlement.entriesLower', 'entries')}</span>
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-sm font-medium text-text-primary">{t('dash.settlement.includedEntries', 'Entries to settle')}</p>
            {entries && entries.length > 0 && (
              <button className="text-xs text-primary-600 hover:underline" onClick={toggleAll}>
                {allSelected ? t('dash.settlement.clearAll', 'Clear all') : t('dash.settlement.selectAll', 'Select all')}
              </button>
            )}
          </div>
          <div className="max-h-52 overflow-y-auto rounded-lg border border-border">
            {entries == null ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-text-muted"><Spinner /> {t('common.loading', 'Loading…')}</div>
            ) : entries.length === 0 ? (
              <p className="py-6 text-center text-sm text-text-muted">{t('dash.settlement.noEntries', 'No pending entries.')}</p>
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {entries.map((e) => (
                    <tr key={e.id} className="cursor-pointer hover:bg-surface-sunken/40" onClick={() => toggle(e.id)}>
                      <td className="px-3 py-2"><input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} onClick={(ev) => ev.stopPropagation()} /></td>
                      <td className="px-3 py-2 text-text-muted">{fmtDate(e.createdAt)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{fmtIDR(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {partial && <p className="mt-1.5 text-xs text-amber-600">{t('dash.settlement.partialNote', 'Partial settlement — unselected entries stay pending.')}</p>}
        </div>

        <Field label={t('dash.settlement.note', 'Note')} hint={t('dash.settlement.noteHint', 'Optional — e.g. transfer reference or payment date')}>
          <input className="input-field" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('dash.settlement.notePh', 'Transfer ref…')} />
        </Field>
      </div>
    </Modal>
  );
}

/** A branch pair that owes in BOTH directions — a candidate for net-off. */
interface NetPair { aId: string; aName: string; bId: string; bName: string; aOwesB: number; bOwesA: number; net: number; }

function NetSettleModal({ pair, onClose, onSettled }: { pair: NetPair; onClose: () => void; onSettled: () => void }) {
  const { t } = useI18n();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const owingName = pair.net >= 0 ? pair.aName : pair.bName;
  const servingName = pair.net >= 0 ? pair.bName : pair.aName;
  const netAmount = Math.abs(pair.net);

  const settle = async () => {
    setBusy(true); setError('');
    try {
      await api.post('/settlement/net-settle', { outletAId: pair.aId, outletBId: pair.bId, note: note || undefined });
      onSettled();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.settlement.payoutError', 'Payout failed'));
    } finally { setBusy(false); }
  };

  return (
    <Modal
      title={t('dash.settlement.netOff', 'Net-off branches')}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>{t('common.cancel', 'Cancel')}</button>
          <button className="btn-primary" onClick={settle} disabled={busy}>{busy ? <Spinner /> : t('dash.settlement.confirmNetOff', 'Net-off & settle')}</button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorBanner message={error} />
        <p className="text-sm text-text-secondary">{t('dash.settlement.netOffExplain', 'Both directions are cancelled against each other and discharged in one batch, leaving a single net payment.')}</p>
        <div className="rounded-lg border border-border bg-surface-sunken/40 p-4 text-sm">
          <div className="flex items-center justify-between"><span className="text-text-secondary">{pair.aName} → {pair.bName}</span><span className="tabular-nums text-text-primary">{fmtIDR(pair.aOwesB)}</span></div>
          <div className="mt-1 flex items-center justify-between"><span className="text-text-secondary">{pair.bName} → {pair.aName}</span><span className="tabular-nums text-text-primary">{fmtIDR(pair.bOwesA)}</span></div>
          <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
            <span className="font-medium text-text-primary">{netAmount === 0 ? t('dash.settlement.fullyNetted', 'Fully netted') : `${owingName} → ${servingName}`}</span>
            <span className="text-base font-bold tabular-nums text-text-primary">{fmtIDR(netAmount)}</span>
          </div>
        </div>
        <Field label={t('dash.settlement.note', 'Note')} hint={t('dash.settlement.noteHint', 'Optional — e.g. transfer reference or payment date')}>
          <input className="input-field" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('dash.settlement.notePh', 'Transfer ref…')} />
        </Field>
      </div>
    </Modal>
  );
}
