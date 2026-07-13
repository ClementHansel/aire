'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  PageHeader, StatCard, Panel, ErrorBanner, Modal, Field, StatusBadge, Tabs, Spinner,
  TableWrap, EmptyRow, TableSkeleton, thCls, tdCls, fmtIDR, fmtDate,
} from '@/components/dashboard/ui';

interface Account { id: string; code: string; name: string; type: string; normalBalance: string; isSystem: boolean; isActive: boolean }
interface TBAccount extends Account { debit: number; credit: number; balance: number }
interface TrialBalance {
  accounts: TBAccount[];
  totalDebit: number; totalCredit: number; balanced: boolean;
  pnl: { revenue: number; expense: number; netProfit: number };
  balanceSheet: { assets: number; liabilities: number; equity: number };
}
interface JournalLine { accountCode: string; accountName: string; debit: number; credit: number; memo: string | null }
interface JournalEntry { id: string; date: string; memo: string | null; sourceType: string; status: string; outletName: string | null; lines: JournalLine[] }

const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = () => iso(new Date());
const monthStart = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); };
type Tab = 'overview' | 'trial' | 'journal' | 'coa';

export default function AccountingPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('overview');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [tb, setTb] = useState<TrialBalance | null>(null);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [glAccount, setGlAccount] = useState<TBAccount | null>(null);
  const [showEntry, setShowEntry] = useState(false);
  const [showAccount, setShowAccount] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [tbRes, jRes, aRes] = await Promise.all([
        api.get<TrialBalance>(`/accounting/trial-balance?from=${from}&to=${to}`),
        api.get<JournalEntry[]>(`/accounting/journal?from=${from}&to=${to}`),
        api.get<Account[]>('/accounting/accounts'),
      ]);
      setTb(tbRes); setJournal(jRes); setAccounts(aRes);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.acc.loadError', 'Failed to load ledger'));
    } finally { setLoading(false); }
  }, [from, to, t]);
  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setBusy('sync'); setError('');
    try {
      const r = await api.post<{ orders: number; expenses: number; payroll: number; settlementAccruals: number; settlementPayouts: number }>('/accounting/sync', { from, to });
      await load();
      setError('');
      const settlement = r.settlementAccruals + r.settlementPayouts;
      alert(`${t('dash.acc.synced', 'Posted')}: ${r.orders} ${t('dash.acc.sales', 'sales')}, ${r.expenses} ${t('dash.acc.expenses', 'expenses')}, ${r.payroll} ${t('dash.acc.payroll', 'payroll')}, ${settlement} ${t('dash.acc.settlement', 'settlement')}`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Sync failed'); }
    finally { setBusy(''); }
  };
  const seed = async () => {
    setBusy('seed');
    try { await api.post('/accounting/seed-defaults'); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Seed failed'); }
    finally { setBusy(''); }
  };

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: t('dash.acc.tabOverview', 'Overview') },
    { id: 'trial', label: t('dash.acc.tabTrial', 'Trial balance') },
    { id: 'journal', label: t('dash.acc.tabJournal', 'Journal') },
    { id: 'coa', label: t('dash.acc.tabCoa', 'Chart of accounts') },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title={t('dash.acc.title', 'Bookkeeping')}
        subtitle={t('dash.acc.subtitle', 'Double-entry general ledger. Sales, COGS, expenses and payroll auto-post as balanced journal entries; review the trial balance, journal and per-account ledger.')}
        actions={
          <>
            <div><label className="mb-1 block text-xs font-medium text-text-secondary">{t('dash.acc.from', 'From')}</label><input type="date" className="input-field" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><label className="mb-1 block text-xs font-medium text-text-secondary">{t('dash.acc.to', 'To')}</label><input type="date" className="input-field" value={to} max={today()} onChange={(e) => setTo(e.target.value)} /></div>
            <button className="btn-secondary self-end" onClick={sync} disabled={busy === 'sync'} title={t('dash.acc.syncHint', 'Post any sales/expenses/payroll in range that are not yet booked')}>{busy === 'sync' ? <Spinner /> : t('dash.acc.sync', 'Sync from operations')}</button>
            <button className="btn-primary self-end" onClick={() => setShowEntry(true)}>+ {t('dash.acc.newEntry', 'Journal entry')}</button>
          </>
        }
      />
      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {tb && !tb.balanced && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          {t('dash.acc.unbalancedWarn', 'Ledger is not balanced for this range — debits ≠ credits. This usually means a manual entry needs review.')}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard loading={loading} label={t('dash.acc.revenue', 'Revenue')} value={fmtIDR(tb?.pnl.revenue)} tone="positive" />
        <StatCard loading={loading} label={t('dash.acc.expenses', 'Expenses')} value={fmtIDR((tb?.pnl.expense ?? 0))} tone="negative" />
        <StatCard loading={loading} label={t('dash.acc.netProfit', 'Net profit')} value={fmtIDR(tb?.pnl.netProfit)} tone={(tb?.pnl.netProfit ?? 0) >= 0 ? 'positive' : 'negative'} />
        <StatCard loading={loading} label={t('dash.acc.balanced', 'Balanced')} value={tb?.balanced ? '✓' : '✕'} tone={tb?.balanced ? 'positive' : 'negative'} hint={tb ? `${fmtIDR(tb.totalDebit)} = ${fmtIDR(tb.totalCredit)}` : undefined} />
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="grid lg:grid-cols-2 gap-6">
          <Panel title={t('dash.acc.incomeStatement', 'Income statement')}>
            {loading || !tb ? <div className="h-24 animate-pulse rounded bg-surface-sunken" /> : (
              <div className="space-y-2 text-sm">
                <Row label={t('dash.acc.revenue', 'Revenue')} value={fmtIDR(tb.pnl.revenue)} strong />
                <Row label={`− ${t('dash.acc.expenses', 'Expenses')}`} value={fmtIDR(tb.pnl.expense)} tone="text-rose-600" />
                <div className="border-t border-border pt-2"><Row label={t('dash.acc.netProfit', 'Net profit')} value={fmtIDR(tb.pnl.netProfit)} strong tone={tb.pnl.netProfit >= 0 ? 'text-green-600' : 'text-rose-600'} /></div>
              </div>
            )}
          </Panel>
          <Panel title={t('dash.acc.balanceSheet', 'Balance sheet')}>
            {loading || !tb ? <div className="h-24 animate-pulse rounded bg-surface-sunken" /> : (
              <div className="space-y-2 text-sm">
                <Row label={t('dash.acc.assets', 'Assets')} value={fmtIDR(tb.balanceSheet.assets)} strong />
                <Row label={t('dash.acc.liabilities', 'Liabilities')} value={fmtIDR(tb.balanceSheet.liabilities)} />
                <Row label={t('dash.acc.equity', 'Equity')} value={fmtIDR(tb.balanceSheet.equity)} />
                <div className="border-t border-border pt-2"><Row label={t('dash.acc.retainedPnl', 'Retained (period P&L)')} value={fmtIDR(tb.pnl.netProfit)} tone="text-text-muted" /></div>
              </div>
            )}
          </Panel>
        </div>
      )}

      {tab === 'trial' && (
        <Panel title={t('dash.acc.trialBalance', 'Trial balance')} description={t('dash.acc.trialDesc', 'Click an account to open its ledger')} bodyClassName="p-0">
          {loading ? <TableSkeleton rows={8} cols={5} /> : (
            <TableWrap>
              <thead><tr className="border-b border-border bg-surface-sunken/50">
                <th className={`${thCls} text-left`}>{t('dash.acc.code', 'Code')}</th>
                <th className={`${thCls} text-left`}>{t('dash.acc.account', 'Account')}</th>
                <th className={`${thCls} text-left`}>{t('dash.acc.type', 'Type')}</th>
                <th className={`${thCls} text-right`}>{t('dash.acc.debit', 'Debit')}</th>
                <th className={`${thCls} text-right`}>{t('dash.acc.credit', 'Credit')}</th>
                <th className={`${thCls} text-right`}>{t('dash.acc.balance', 'Balance')}</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {!tb || tb.accounts.length === 0 ? (
                  <EmptyRow colSpan={6}>{t('dash.acc.noAccounts', 'No accounts. Seed the default chart of accounts to begin.')}</EmptyRow>
                ) : tb.accounts.map((a) => (
                  <tr key={a.id} className="cursor-pointer hover:bg-surface-sunken/40" onClick={() => setGlAccount(a)}>
                    <td className={`${tdCls} font-mono text-text-muted`}>{a.code}</td>
                    <td className={`${tdCls} font-medium`}>{a.name}</td>
                    <td className={`${tdCls} capitalize text-text-secondary`}>{a.type}</td>
                    <td className={`${tdCls} text-right tabular-nums`}>{a.debit ? fmtIDR(a.debit) : '—'}</td>
                    <td className={`${tdCls} text-right tabular-nums`}>{a.credit ? fmtIDR(a.credit) : '—'}</td>
                    <td className={`${tdCls} text-right font-medium tabular-nums`}>{fmtIDR(a.balance)}</td>
                  </tr>
                ))}
              </tbody>
              {tb && (
                <tfoot><tr className="border-t-2 border-border bg-surface-sunken/40">
                  <td className={`${tdCls} font-semibold`} colSpan={3}>{t('dash.acc.total', 'Total')}</td>
                  <td className={`${tdCls} text-right font-semibold tabular-nums`}>{fmtIDR(tb.totalDebit)}</td>
                  <td className={`${tdCls} text-right font-semibold tabular-nums`}>{fmtIDR(tb.totalCredit)}</td>
                  <td className={`${tdCls} text-right`}>{tb.balanced ? <StatusBadge status="balanced" /> : <span className="badge bg-rose-50 text-rose-700">{t('dash.acc.off', 'off')}</span>}</td>
                </tr></tfoot>
              )}
            </TableWrap>
          )}
        </Panel>
      )}

      {tab === 'journal' && (
        <Panel title={t('dash.acc.journal', 'Journal')} bodyClassName="p-0">
          {loading ? <TableSkeleton rows={8} cols={4} /> : (
            <TableWrap>
              <thead><tr className="border-b border-border bg-surface-sunken/50">
                <th className={`${thCls} text-left`}>{t('dash.acc.date', 'Date')}</th>
                <th className={`${thCls} text-left`}>{t('dash.acc.entry', 'Entry')}</th>
                <th className={`${thCls} text-left`}>{t('dash.acc.source', 'Source')}</th>
                <th className={`${thCls} text-right`}>{t('dash.acc.amount', 'Amount')}</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {journal.length === 0 ? (
                  <EmptyRow colSpan={4}>{t('dash.acc.noJournal', 'No journal entries in range. Use “Sync from operations” to backfill.')}</EmptyRow>
                ) : journal.map((j) => {
                  const amt = j.lines.reduce((s, l) => s + l.debit, 0);
                  return (
                    <tr key={j.id} className={`hover:bg-surface-sunken/40 ${j.status === 'void' ? 'opacity-50' : ''}`}>
                      <td className={`${tdCls} whitespace-nowrap text-text-muted align-top`}>{fmtDate(j.date)}</td>
                      <td className={tdCls}>
                        <div className="font-medium text-text-primary">{j.memo || '—'}{j.outletName ? <span className="text-text-muted"> · {j.outletName}</span> : ''}</div>
                        <div className="mt-1 space-y-0.5">
                          {j.lines.map((l, i) => (
                            <div key={i} className="flex justify-between gap-4 text-xs">
                              <span className={l.credit > 0 ? 'pl-4 text-text-muted' : 'text-text-secondary'}>{l.accountName}</span>
                              <span className="tabular-nums text-text-muted">{l.debit > 0 ? `Dr ${fmtIDR(l.debit)}` : `Cr ${fmtIDR(l.credit)}`}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className={`${tdCls} align-top`}><span className="badge bg-surface-sunken capitalize text-text-secondary">{j.sourceType}</span></td>
                      <td className={`${tdCls} text-right font-medium tabular-nums align-top`}>{fmtIDR(amt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      )}

      {tab === 'coa' && (
        <Panel
          title={t('dash.acc.chartOfAccounts', 'Chart of accounts')}
          bodyClassName="p-0"
          actions={
            <>
              {accounts.length === 0 && <button className="btn-secondary py-1.5 text-xs" onClick={seed} disabled={busy === 'seed'}>{busy === 'seed' ? <Spinner /> : t('dash.acc.seedDefaults', 'Seed defaults')}</button>}
              <button className="btn-primary py-1.5 text-xs" onClick={() => setShowAccount(true)}>+ {t('dash.acc.addAccount', 'Add account')}</button>
            </>
          }
        >
          {loading ? <TableSkeleton rows={8} cols={4} /> : (
            <TableWrap>
              <thead><tr className="border-b border-border bg-surface-sunken/50">
                <th className={`${thCls} text-left`}>{t('dash.acc.code', 'Code')}</th>
                <th className={`${thCls} text-left`}>{t('dash.acc.account', 'Account')}</th>
                <th className={`${thCls} text-left`}>{t('dash.acc.type', 'Type')}</th>
                <th className={`${thCls} text-left`}>{t('dash.acc.normalBalance', 'Normal')}</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {accounts.length === 0 ? (
                  <EmptyRow colSpan={4}>{t('dash.acc.noAccounts', 'No accounts. Seed the default chart of accounts to begin.')}</EmptyRow>
                ) : accounts.map((a) => (
                  <tr key={a.id} className="hover:bg-surface-sunken/40">
                    <td className={`${tdCls} font-mono text-text-muted`}>{a.code}</td>
                    <td className={`${tdCls} font-medium`}>{a.name} {a.isSystem && <span className="badge bg-surface-sunken text-text-muted">{t('dash.acc.system', 'system')}</span>}</td>
                    <td className={`${tdCls} capitalize text-text-secondary`}>{a.type}</td>
                    <td className={`${tdCls} capitalize text-text-secondary`}>{a.normalBalance}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      )}

      {glAccount && <GeneralLedgerModal account={glAccount} from={from} to={to} onClose={() => setGlAccount(null)} />}
      {showEntry && <JournalEntryModal accounts={accounts} onClose={() => setShowEntry(false)} onSaved={() => { setShowEntry(false); load(); }} />}
      {showAccount && <AccountModal onClose={() => setShowAccount(false)} onSaved={() => { setShowAccount(false); load(); }} />}
    </div>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className={strong ? 'font-semibold text-text-primary' : 'text-text-secondary'}>{label}</span>
      <span className={`tabular-nums ${strong ? 'font-bold' : ''} ${tone ?? 'text-text-primary'}`}>{value}</span>
    </div>
  );
}

function GeneralLedgerModal({ account, from, to, onClose }: { account: TBAccount; from: string; to: string; onClose: () => void }) {
  const { t } = useI18n();
  const [data, setData] = useState<{ lines: { date: string; memo: string | null; sourceType: string; debit: number; credit: number; balance: number }[]; closingBalance: number } | null>(null);
  useEffect(() => {
    api.get<{ lines: { date: string; memo: string | null; sourceType: string; debit: number; credit: number; balance: number }[]; closingBalance: number }>(`/accounting/general-ledger?accountId=${account.id}&from=${from}&to=${to}`)
      .then(setData).catch(() => setData({ lines: [], closingBalance: 0 }));
  }, [account.id, from, to]);
  return (
    <Modal title={`${account.code} · ${account.name}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border bg-surface-sunken/50">
            <th className={`${thCls} text-left`}>{t('dash.acc.date', 'Date')}</th>
            <th className={`${thCls} text-left`}>{t('dash.acc.memo', 'Memo')}</th>
            <th className={`${thCls} text-right`}>{t('dash.acc.debit', 'Debit')}</th>
            <th className={`${thCls} text-right`}>{t('dash.acc.credit', 'Credit')}</th>
            <th className={`${thCls} text-right`}>{t('dash.acc.balance', 'Balance')}</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {data == null ? (
              <tr><td colSpan={5} className="py-6 text-center text-text-muted"><Spinner /></td></tr>
            ) : data.lines.length === 0 ? (
              <tr><td colSpan={5} className="py-6 text-center text-sm text-text-muted">{t('dash.acc.noLines', 'No activity in range.')}</td></tr>
            ) : data.lines.map((l, i) => (
              <tr key={i}>
                <td className="px-3 py-2 text-text-muted">{fmtDate(l.date)}</td>
                <td className="px-3 py-2">{l.memo || l.sourceType}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.debit ? fmtIDR(l.debit) : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.credit ? fmtIDR(l.credit) : '—'}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{fmtIDR(l.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <p className="mt-3 text-right text-sm text-text-secondary">{t('dash.acc.closingBalance', 'Closing balance')}: <span className="font-bold text-text-primary">{fmtIDR(data.closingBalance)}</span></p>}
    </Modal>
  );
}

interface DraftLine { accountId: string; debit: string; credit: string; memo: string }

function JournalEntryModal({ accounts, onClose, onSaved }: { accounts: Account[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [entryDate, setEntryDate] = useState(today());
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ accountId: '', debit: '', credit: '', memo: '' }, { accountId: '', debit: '', credit: '', memo: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const setLine = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, { accountId: '', debit: '', credit: '', memo: '' }]);
  const removeLine = (i: number) => setLines((ls) => ls.length > 2 ? ls.filter((_, j) => j !== i) : ls);
  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = totalDebit > 0 && Math.round(totalDebit * 100) === Math.round(totalCredit * 100);

  const submit = async () => {
    if (!balanced) { setError(t('dash.acc.mustBalance', 'Debits must equal credits and be positive.')); return; }
    const payload = {
      entryDate, memo: memo || undefined,
      lines: lines.filter((l) => l.accountId && (Number(l.debit) || Number(l.credit)))
        .map((l) => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, memo: l.memo || undefined })),
    };
    if (payload.lines.length < 2) { setError(t('dash.acc.needTwoLines', 'Add at least two lines with an account and amount.')); return; }
    setSaving(true); setError('');
    try { await api.post('/accounting/journal', payload); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to post entry'); }
    finally { setSaving(false); }
  };

  return (
    <Modal
      title={t('dash.acc.newEntry', 'Journal entry')}
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={<><button className="btn-secondary" onClick={onClose}>{t('common.cancel', 'Cancel')}</button><button className="btn-primary" onClick={submit} disabled={saving || !balanced}>{saving ? <Spinner /> : t('dash.acc.postEntry', 'Post entry')}</button></>}
    >
      <div className="space-y-4">
        <ErrorBanner message={error} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('dash.acc.date', 'Date')}><input type="date" className="input-field" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></Field>
          <Field label={t('dash.acc.memo', 'Memo')}><input className="input-field" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={t('dash.acc.memoPh', 'e.g. Owner capital injection')} /></Field>
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 items-center gap-2">
              <select className="input-field col-span-5 py-1.5 text-sm" value={l.accountId} onChange={(e) => setLine(i, { accountId: e.target.value })}>
                <option value="">{t('dash.acc.account', 'Account')}…</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select>
              <input className="input-field col-span-3 py-1.5 text-sm text-right" type="number" min="0" placeholder={t('dash.acc.debit', 'Debit')} value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} />
              <input className="input-field col-span-3 py-1.5 text-sm text-right" type="number" min="0" placeholder={t('dash.acc.credit', 'Credit')} value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} />
              <button className="col-span-1 text-text-muted hover:text-rose-600" onClick={() => removeLine(i)} aria-label="Remove" disabled={lines.length <= 2}>✕</button>
            </div>
          ))}
          <button className="btn-ghost text-xs" onClick={addLine}>+ {t('dash.acc.addLine', 'Add line')}</button>
        </div>
        <div className={`flex justify-between rounded-lg border p-3 text-sm ${balanced ? 'border-green-200 bg-green-50 text-green-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
          <span>{t('dash.acc.totals', 'Totals')}</span>
          <span className="tabular-nums">Dr {fmtIDR(totalDebit)} · Cr {fmtIDR(totalCredit)} {balanced ? '✓' : `(${t('dash.acc.diff', 'diff')} ${fmtIDR(Math.abs(totalDebit - totalCredit))})`}</span>
        </div>
      </div>
    </Modal>
  );
}

function AccountModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ code: '', name: '', type: 'expense' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) { setError(t('dash.acc.codeNameReq', 'Code and name are required.')); return; }
    setSaving(true); setError('');
    try { await api.post('/accounting/accounts', form); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setSaving(false); }
  };
  return (
    <Modal title={t('dash.acc.addAccount', 'Add account')} onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose}>{t('common.cancel', 'Cancel')}</button><button className="btn-primary" onClick={submit} disabled={saving}>{saving ? <Spinner /> : t('dash.acc.create', 'Create')}</button></>}>
      <div className="space-y-4">
        <ErrorBanner message={error} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('dash.acc.code', 'Code')}><input className="input-field" value={form.code} placeholder="6200" onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
          <Field label={t('dash.acc.type', 'Type')}>
            <select className="input-field" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {['asset', 'liability', 'equity', 'revenue', 'expense'].map((tp) => <option key={tp} value={tp}>{tp}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t('dash.acc.account', 'Account name')}><input className="input-field" value={form.name} placeholder={t('dash.acc.namePh', 'e.g. Marketing')} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
