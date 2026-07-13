'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  PageHeader, Panel, StatCard, Tabs, TableWrap, thCls, tdCls, EmptyRow, Spinner,
  ErrorBanner, Field, fmtIDR,
} from '@/components/dashboard/ui';
import { exportRows } from '@/components/dashboard/CsvTools';

type Mode = 'pct_of_sale' | 'per_service_pct' | 'per_service_fixed' | 'fixed_per_job';
type Scope = 'global' | 'service' | 'category' | 'product' | 'staff';
interface Rule { scope: Scope; refId?: string | null; mode: Mode; value: number }
interface MonthlyTarget { employeeId: string; target: number; bonus: number }
interface Config { enabled: boolean; rules: Rule[]; tipEnabled: boolean; monthlyTargets: MonthlyTarget[] }
interface ReportRow { employeeId: string; employeeName: string; period: string; orders: number; total: number; appliedCount: number }
interface NamedRef { id: string; name: string }

const MODE_LABELS: Record<Mode, string> = {
  pct_of_sale: '% of sale',
  per_service_pct: '% of service line',
  per_service_fixed: 'Fixed per unit',
  fixed_per_job: 'Fixed per job (once/order)',
};

export default function CommissionPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<'setup' | 'report'>('report');
  const [cfg, setCfg] = useState<Config | null>(null);
  const [report, setReport] = useState<ReportRow[]>([]);
  const [services, setServices] = useState<NamedRef[]>([]);
  const [categories, setCategories] = useState<NamedRef[]>([]);
  const [employees, setEmployees] = useState<NamedRef[]>([]);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // Bulk per-staff rule editor state.
  const [selStaff, setSelStaff] = useState<string[]>([]);
  const [bulkMode, setBulkMode] = useState<Mode>('pct_of_sale');
  const [bulkValue, setBulkValue] = useState<number>(5);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [c, rep, svc, cats, emps] = await Promise.all([
        api.get<Config>('/commission/config'),
        api.get<ReportRow[]>(`/commission/report?period=${period}`),
        api.get<NamedRef[]>('/services').catch(() => []),
        api.get<NamedRef[]>('/categories').catch(() => []),
        api.get<NamedRef[]>('/hr/employees').catch(() => []),
      ]);
      setCfg(c);
      setReport(rep);
      setServices(svc);
      setCategories(cats);
      setEmployees(emps);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load commission data');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const save = async (next: Config) => {
    setSaving(true);
    setError('');
    try {
      const saved = await api.put<Config>('/commission/config', next);
      setCfg(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const patch = (p: Partial<Config>) => cfg && save({ ...cfg, ...p });

  const refOptions = (scope: Scope): NamedRef[] =>
    scope === 'category' ? categories : scope === 'staff' ? employees : scope === 'global' ? [] : services;

  const employeeName = (id: string) => employees.find((e) => e.id === id)?.name ?? id;

  const toggleStaff = (id: string) =>
    setSelStaff((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const allStaffSelected = employees.length > 0 && selStaff.length === employees.length;
  const toggleAllStaff = () => setSelStaff(allStaffSelected ? [] : employees.map((e) => e.id));

  // Apply the chosen mode+value as a per-staff rule to every marked employee at
  // once — replacing any existing staff rule for that employee, then persist.
  const applyStaffBulk = () => {
    if (!cfg || selStaff.length === 0) return;
    const rules = cfg.rules.filter((r) => !(r.scope === 'staff' && selStaff.includes(r.refId ?? '')));
    for (const id of selStaff) rules.push({ scope: 'staff', refId: id, mode: bulkMode, value: bulkValue });
    save({ ...cfg, rules });
    setSelStaff([]);
  };
  const staffRules = cfg?.rules.filter((r) => r.scope === 'staff') ?? [];

  const totalAccrued = report.reduce((s, r) => s + r.total, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('nav.commission', 'Commission & Tips')}
        subtitle={t('commission.subtitle', 'Reward staff per job. Accrued commission flows automatically into payroll as a bonus.')}
        actions={<Tabs<'setup' | 'report'> tabs={[{ id: 'report', label: t('commission.report', 'Report') }, { id: 'setup', label: t('commission.setup', 'Setup') }]} active={tab} onChange={setTab} />}
      />

      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

      {tab === 'report' && (
        <>
          <div className="flex items-end gap-2">
            <label className="text-xs text-text-secondary">
              {t('commission.period', 'Period')}
              <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="input-field mt-1" />
            </label>
            <button
              className="btn-secondary"
              onClick={() => exportRows('commission.csv', report as unknown as Record<string, unknown>[], [
                { key: 'employeeName', label: 'Employee' },
                { key: 'period', label: 'Period' },
                { key: 'orders', label: 'Orders' },
                { key: 'total', label: 'Commission' },
              ])}
            >
              {t('common.exportCsv', 'Export CSV')}
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label={t('commission.staff', 'Staff with commission')} value={report.length} loading={loading} />
            <StatCard label={t('commission.accrued', 'Accrued this period')} value={fmtIDR(totalAccrued)} tone="primary" loading={loading} />
            <StatCard label={t('commission.status', 'Enabled')} value={cfg?.enabled ? t('common.yes', 'Yes') : t('common.no', 'No')} loading={loading} />
          </div>
          <Panel title={t('commission.byEmployee', 'Commission by employee')}>
            <TableWrap>
              <thead>
                <tr className="border-b border-border text-left">
                  <th className={thCls}>{t('commission.employee', 'Employee')}</th>
                  <th className={thCls}>{t('commission.period', 'Period')}</th>
                  <th className={thCls}>{t('commission.orders', 'Orders')}</th>
                  <th className={thCls}>{t('commission.amount', 'Commission')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? <EmptyRow colSpan={4}><Spinner /></EmptyRow>
                  : report.length === 0 ? <EmptyRow colSpan={4}>{t('commission.empty', 'No commission accrued for this period.')}</EmptyRow>
                    : report.map((r) => (
                      <tr key={r.employeeId + r.period}>
                        <td className={tdCls}>{r.employeeName}</td>
                        <td className={tdCls}>{r.period}</td>
                        <td className={tdCls}>{r.orders}</td>
                        <td className={`${tdCls} tabular-nums`}>{fmtIDR(r.total)}</td>
                      </tr>
                    ))}
              </tbody>
            </TableWrap>
          </Panel>
        </>
      )}

      {tab === 'setup' && cfg && (
        <div className="space-y-6">
          <Panel title={t('commission.enable', 'Commission program')}>
            <label className="flex items-center gap-3">
              <input type="checkbox" checked={cfg.enabled} disabled={saving} onChange={(e) => patch({ enabled: e.target.checked })} />
              <span className="text-sm">{t('commission.enableHint', 'Enable per-job commission accrual (off by default). Accruals roll into payroll as a bonus.')}</span>
            </label>
            <label className="mt-3 flex items-center gap-3">
              <input type="checkbox" checked={cfg.tipEnabled} disabled={saving} onChange={(e) => patch({ tipEnabled: e.target.checked })} />
              <span className="text-sm">{t('commission.tips', 'Enable tips capture')}</span>
            </label>
          </Panel>

          <Panel
            title={t('commission.rules', 'Commission rules')}
            description={t('commission.rulesHint', 'Precedence: per-staff → product/service-specific → category → global.')}
            actions={
              <button className="btn-secondary" disabled={saving}
                onClick={() => patch({ rules: [...cfg.rules, { scope: 'global', mode: 'pct_of_sale', value: 5 }] })}>
                {t('commission.addRule', '+ Add rule')}
              </button>
            }
          >
            {cfg.rules.length === 0 ? (
              <p className="text-sm text-text-muted">{t('commission.noRules', 'No rules yet. Add one to start accruing commission.')}</p>
            ) : (
              <div className="space-y-3">
                {cfg.rules.map((rule, i) => {
                  const update = (p: Partial<Rule>) => {
                    const rules = cfg.rules.slice();
                    rules[i] = { ...rule, ...p };
                    setCfg({ ...cfg, rules });
                  };
                  return (
                    <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                      <select className="input-field" value={rule.scope} onChange={(e) => update({ scope: e.target.value as Scope, refId: null })}>
                        <option value="global">{t('commission.scopeGlobal', 'Global')}</option>
                        <option value="staff">{t('commission.scopeStaff', 'Per staff')}</option>
                        <option value="category">{t('commission.scopeCategory', 'Category')}</option>
                        <option value="service">{t('commission.scopeService', 'Service')}</option>
                        <option value="product">{t('commission.scopeProduct', 'Product')}</option>
                      </select>
                      {rule.scope === 'global' ? <div /> : (
                        <select className="input-field" value={rule.refId ?? ''} onChange={(e) => update({ refId: e.target.value })}>
                          <option value="">{t('commission.selectRef', 'Select…')}</option>
                          {refOptions(rule.scope).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                      )}
                      <select className="input-field" value={rule.mode} onChange={(e) => update({ mode: e.target.value as Mode })}>
                        {Object.entries(MODE_LABELS).map(([m, l]) => <option key={m} value={m}>{l}</option>)}
                      </select>
                      <div className="flex items-center gap-2">
                        <input type="number" className="input-field w-24" value={rule.value} min={0}
                          onChange={(e) => update({ value: Number(e.target.value) })} />
                        <span className="text-xs text-text-muted">{rule.mode.includes('pct') ? '%' : 'Rp'}</span>
                        <button className="text-rose-600" onClick={() => setCfg({ ...cfg, rules: cfg.rules.filter((_, j) => j !== i) })}>✕</button>
                      </div>
                    </div>
                  );
                })}
                <button className="btn-primary" disabled={saving} onClick={() => save(cfg)}>
                  {saving ? <Spinner /> : t('common.save', 'Save rules')}
                </button>
              </div>
            )}
          </Panel>

          <Panel
            title={t('commission.perStaff', 'Per-staff rules')}
            description={t('commission.perStaffHint', 'Set a commission rate for specific staff. Mark the staff below, choose a rate, and apply it to all of them at once. A per-staff rate overrides the general rules above.')}
          >
            <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
              {/* Staff picker */}
              <div className="rounded-lg border border-border">
                <label className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-medium">
                  <input type="checkbox" checked={allStaffSelected} onChange={toggleAllStaff} />
                  {t('commission.selectAll', 'Select all staff')}
                  <span className="ml-auto text-xs text-text-muted">{selStaff.length}/{employees.length}</span>
                </label>
                <div className="max-h-60 overflow-y-auto divide-y divide-border">
                  {employees.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-text-muted">{t('commission.noStaff', 'No staff found.')}</p>
                  ) : employees.map((e) => {
                    const existing = staffRules.find((r) => r.refId === e.id);
                    return (
                      <label key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-surface-sunken/40">
                        <input type="checkbox" checked={selStaff.includes(e.id)} onChange={() => toggleStaff(e.id)} />
                        <span className="flex-1">{e.name}</span>
                        {existing && (
                          <span className="badge bg-sky-50 text-sky-700 text-xs">
                            {existing.value}{existing.mode.includes('pct') ? '%' : ' Rp'}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Rate to apply */}
              <div className="space-y-3">
                <Field label={t('commission.mode', 'Commission mode')}>
                  <select className="input-field" value={bulkMode} onChange={(e) => setBulkMode(e.target.value as Mode)}>
                    {Object.entries(MODE_LABELS).map(([m, l]) => <option key={m} value={m}>{l}</option>)}
                  </select>
                </Field>
                <Field label={bulkMode.includes('pct') ? t('commission.percent', 'Percent (%)') : t('commission.amountRp', 'Amount (Rp)')}>
                  <input type="number" min={0} className="input-field" value={bulkValue} onChange={(e) => setBulkValue(Number(e.target.value))} />
                </Field>
                <button className="btn-primary w-full" disabled={saving || selStaff.length === 0} onClick={applyStaffBulk}>
                  {saving ? <Spinner /> : t('commission.applyToMarked', 'Apply to marked staff')}
                </button>
                {staffRules.length > 0 && (
                  <button
                    className="btn-secondary w-full"
                    disabled={saving}
                    onClick={() => cfg && save({ ...cfg, rules: cfg.rules.filter((r) => r.scope !== 'staff') })}
                  >
                    {t('commission.clearStaffRules', 'Clear all staff rules')}
                  </button>
                )}
              </div>
            </div>

            {staffRules.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-text-secondary mb-2">{t('commission.currentStaffRules', 'Current per-staff rules')}</p>
                <div className="flex flex-wrap gap-2">
                  {staffRules.map((r, i) => (
                    <span key={(r.refId ?? '') + i} className="badge bg-surface-sunken text-text-secondary inline-flex items-center gap-1.5">
                      {employeeName(r.refId ?? '')}: {r.value}{r.mode.includes('pct') ? '%' : ' Rp'}
                      <button
                        className="text-rose-600"
                        disabled={saving}
                        onClick={() => cfg && save({ ...cfg, rules: cfg.rules.filter((x) => !(x.scope === 'staff' && x.refId === r.refId)) })}
                      >✕</button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Panel>

          <Panel
            title={t('commission.monthlyTargets', 'Monthly target bonuses')}
            description={t('commission.monthlyHint', 'Flat bonus when an employee’s monthly sales reach a target.')}
            actions={
              <button className="btn-secondary" disabled={saving}
                onClick={() => setCfg({ ...cfg, monthlyTargets: [...cfg.monthlyTargets, { employeeId: '', target: 0, bonus: 0 }] })}>
                {t('commission.addTarget', '+ Add target')}
              </button>
            }
          >
            {cfg.monthlyTargets.length === 0 ? (
              <p className="text-sm text-text-muted">{t('commission.noTargets', 'No monthly targets.')}</p>
            ) : (
              <div className="space-y-3">
                {cfg.monthlyTargets.map((mt, i) => {
                  const update = (p: Partial<MonthlyTarget>) => {
                    const targets = cfg.monthlyTargets.slice();
                    targets[i] = { ...mt, ...p };
                    setCfg({ ...cfg, monthlyTargets: targets });
                  };
                  return (
                    <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                      <select className="input-field" value={mt.employeeId} onChange={(e) => update({ employeeId: e.target.value })}>
                        <option value="">{t('commission.selectEmployee', 'Employee…')}</option>
                        {employees.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                      <Field label={t('commission.target', 'Sales target (Rp)')}><input type="number" className="input-field" value={mt.target} onChange={(e) => update({ target: Number(e.target.value) })} /></Field>
                      <Field label={t('commission.bonus', 'Bonus (Rp)')}><input type="number" className="input-field" value={mt.bonus} onChange={(e) => update({ bonus: Number(e.target.value) })} /></Field>
                      <button className="self-center text-rose-600" onClick={() => setCfg({ ...cfg, monthlyTargets: cfg.monthlyTargets.filter((_, j) => j !== i) })}>✕</button>
                    </div>
                  );
                })}
                <button className="btn-primary" disabled={saving} onClick={() => save(cfg)}>
                  {saving ? <Spinner /> : t('common.save', 'Save targets')}
                </button>
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
