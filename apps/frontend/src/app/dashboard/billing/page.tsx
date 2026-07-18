'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { qrDataUrl } from '@/lib/cardCodes';
import {
  PageHeader, StatCard, Panel, Modal, ErrorBanner,
  TableWrap, EmptyRow, StatusBadge, Spinner,
  thCls, tdCls, fmtIDR, fmtDate,
} from '@/components/dashboard/ui';

/* ── Contract types (see /api/billing/me/*) ─────────────────────────────── */

interface Plan {
  code: string;
  name: string;
  description: string;
  price: number;
  billingCycle: 'monthly' | 'annual';
  features: string[];
  limits: Record<string, number>;
  isActive?: boolean;
  sortOrder?: number;
}

interface EntitlementResource {
  key: string;
  label: string;
  used: number;
  limit: number | null;
  unlimited: boolean;
  remaining: number | null;
  exceeded: boolean;
}

interface Summary {
  tenant: { id: string; name: string; status: string; statusReason?: string | null };
  planCode: string | null;
  plan: Plan | null;
  entitlements: { plan: string | null; resources: EntitlementResource[] };
  currentPeriod: string;
  outstandingCount: number;
  sandbox: boolean;
}

type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'void';

interface Invoice {
  id: string;
  period: string;
  planCode: string | null;
  amount: number;        // tax base / DPP
  taxRate: number;       // fraction, e.g. 0.11
  taxAmount: number;     // PPN amount
  total: number;         // payable = amount + taxAmount
  fakturNumber: string | null; // Faktur Pajak serial, may be null
  currency: string;
  status: InvoiceStatus;
  issuedAt: string | null;
  dueDate: string | null;
  paidAt: string | null;
  notes: string | null;
}

/** Payable amount for an invoice — the tax-inclusive total, with a safe
 *  fallback for older invoice payloads that predate the PPN fields. */
const invoiceTotal = (inv: Invoice) => inv.total ?? inv.amount;

interface PayResponse {
  invoiceId: string;
  amount: number;
  currency: string;
  provider: string;
  reference: string;
  checkoutUrl: string;
  expiresAt: string | null;
  sandbox: boolean;
}

/* Invoices in these states can be paid by the owner. */
const PAYABLE: InvoiceStatus[] = ['sent', 'overdue'];

/* ── Plan & usage meter ─────────────────────────────────────────────────── */

function UsageMeter({ resource }: { resource: EntitlementResource }) {
  const { t } = useI18n();
  const { used, limit, unlimited, exceeded, label } = resource;
  // Fraction of the cap consumed; unlimited resources show a full, muted bar.
  const pct = unlimited || limit == null || limit <= 0
    ? (unlimited ? 100 : 0)
    : Math.min(100, Math.round((used / limit) * 100));
  const barColor = exceeded
    ? 'bg-rose-500'
    : unlimited
      ? 'bg-surface-sunken'
      : pct >= 90
        ? 'bg-amber-500'
        : 'bg-primary-500';

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-text-primary">{label}</span>
        <span className={`text-sm tabular-nums ${exceeded ? 'font-semibold text-rose-600' : 'text-text-secondary'}`}>
          {unlimited
            ? `${used} / ${t('dash.billing.unlimited', 'Unlimited')}`
            : `${used} / ${limit ?? 0}`}
        </span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      {exceeded && (
        <p className="mt-1 text-xs text-rose-600">{t('dash.billing.overLimit', 'Over your plan limit')}</p>
      )}
    </div>
  );
}

/* ── Pay modal (QR + poll-until-paid) ───────────────────────────────────── */

function PayModal({
  invoice,
  onClose,
  onPaid,
}: {
  invoice: Invoice;
  onClose: () => void;
  onPaid: () => void;
}) {
  const { t } = useI18n();
  const [pay, setPay] = useState<PayResponse | null>(null);
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  const [paid, setPaid] = useState(false);
  const [loading, setLoading] = useState(true);
  // Guards the polling loop so it stops on unmount / after payment.
  const activeRef = useRef(true);

  // Kick off the checkout: POST returns a QRIS string we render locally as a QR.
  useEffect(() => {
    activeRef.current = true;
    (async () => {
      try {
        const res = await api.post<PayResponse>(`/billing/me/invoices/${invoice.id}/pay`);
        if (!activeRef.current) return;
        setPay(res);
        setLoading(false);
        // Rendered from the checkout string with the bundled (local) qrcode lib —
        // no external/CDN request, per the app's no-remote-assets rule.
        const img = await qrDataUrl(res.checkoutUrl, 240);
        if (activeRef.current) setQr(img);
      } catch (err) {
        if (!activeRef.current) return;
        setError(err instanceof Error ? err.message : t('dash.billing.payFailed', 'Could not start payment'));
        setLoading(false);
      }
    })();
    return () => { activeRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice.id]);

  // Poll invoices every ~4s until this one flips to 'paid' (sandbox auto-confirms).
  useEffect(() => {
    if (!pay || paid) return;
    const tick = async () => {
      try {
        const list = await api.get<Invoice[]>('/billing/me/invoices');
        if (!activeRef.current) return;
        const fresh = list.find((i) => i.id === invoice.id);
        if (fresh && fresh.status === 'paid') {
          setPaid(true);
          onPaid();
        }
      } catch { /* transient errors are ignored; the next tick retries */ }
    };
    const id = setInterval(tick, 4000);
    return () => clearInterval(id);
  }, [pay, paid, invoice.id, onPaid]);

  return (
    <Modal title={t('dash.billing.payInvoice', 'Pay invoice')} onClose={onClose}>
      {error ? (
        <ErrorBanner message={error} />
      ) : paid ? (
        <div className="py-6 text-center" data-testid="billing-pay-success">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-2xl text-green-700">✓</div>
          <p className="mt-3 text-base font-semibold text-text-primary">{t('dash.billing.paymentReceived', 'Payment received')}</p>
          <p className="mt-1 text-sm text-text-secondary">{t('dash.billing.invoicePaid', 'This invoice has been marked as paid.')}</p>
          <button className="btn-primary mt-5" onClick={onClose}>{t('dash.billing.done', 'Done')}</button>
        </div>
      ) : (
        <div className="text-center">
          <p className="text-sm font-medium text-text-primary">{t('dash.billing.scanToPay', 'Scan to pay')}</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-text-primary">{fmtIDR(pay?.amount ?? invoiceTotal(invoice))}</p>
          {invoice.taxAmount > 0 && (
            <p className="text-xs text-text-muted">
              {t('dash.billing.inclPpn', 'incl. PPN')} {fmtIDR(invoice.taxAmount)}
            </p>
          )}
          <p className="text-xs text-text-muted">{t('dash.billing.period', 'Period')} {invoice.period}</p>

          <div className="mt-4 flex justify-center">
            {loading ? (
              <div className="flex h-[240px] w-[240px] items-center justify-center rounded-lg border border-border bg-surface-sunken">
                <Spinner />
              </div>
            ) : qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt={t('dash.billing.qrAlt', 'QRIS payment code')} width={240} height={240} className="rounded-lg border border-border" />
            ) : (
              // Fallback if QR rendering is unavailable: show the raw QRIS string.
              <div className="max-w-full break-all rounded-lg border border-border bg-surface-sunken p-3 font-mono text-xs text-text-secondary">
                {pay?.checkoutUrl}
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-text-secondary">
            <Spinner className="h-3.5 w-3.5" />
            <span>{t('dash.billing.waitingForPayment', 'Waiting for payment…')}</span>
          </div>
          {pay?.sandbox && (
            <p className="mt-2 text-xs text-text-muted">{t('dash.billing.sandboxAutoConfirm', 'Sandbox mode — this payment auto-confirms in a few seconds.')}</p>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export default function BillingPage() {
  const { t } = useI18n();
  const [role, setRole] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState('');

  useEffect(() => { setRole(getUser()?.role ?? null); }, []);

  const isOwner = role === 'tenant_owner';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, inv, pl] = await Promise.all([
        api.get<Summary>('/billing/me/summary'),
        api.get<Invoice[]>('/billing/me/invoices'),
        api.get<Plan[]>('/billing/me/plans'),
      ]);
      setSummary(s);
      setInvoices(inv);
      setPlans(pl);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dash.billing.loadError', 'Failed to load billing information'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { if (isOwner) load(); }, [isOwner, load]);

  const changePlan = useCallback(async (code: string) => {
    setSwitching(code);
    setSwitchError('');
    try {
      const s = await api.post<Summary>('/billing/me/change-plan', { plan: code });
      setSummary(s);
      // Usage/limits and invoices can shift with the plan — reload them too.
      await load();
    } catch (err) {
      // A blocked downgrade returns HTTP 400 with a human message — surface it verbatim.
      const msg = err instanceof ApiError
        ? err.message
        : err instanceof Error ? err.message : t('dash.billing.changeFailed', 'Could not change plan');
      setSwitchError(msg);
    } finally {
      setSwitching(null);
    }
  }, [load, t]);

  // Role gate is cosmetic — the server enforces tenant_owner on every endpoint.
  if (role !== null && !isOwner) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader title={t('dash.billing.title', 'Billing')} />
        <Panel>
          <p className="text-sm text-text-secondary">
            {t('dash.billing.ownerOnly', 'Billing is available to the account owner only.')}
          </p>
        </Panel>
      </div>
    );
  }

  const currentCode = summary?.planCode ?? summary?.plan?.code ?? null;
  const resources = summary?.entitlements.resources ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6" data-testid="billing-page">
      <PageHeader
        title={t('dash.billing.title', 'Billing')}
        subtitle={t('dash.billing.subtitle', 'Your subscription plan, usage against plan limits, invoices, and plan changes.')}
      />

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {summary?.sandbox && (
        <p className="text-sm text-text-muted" data-testid="billing-sandbox-note">
          {t('dash.billing.sandboxNote', 'Sandbox mode — payments are simulated until the gateway goes live.')}
        </p>
      )}

      {/* A) KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          loading={loading}
          label={t('dash.billing.currentPlan', 'Current plan')}
          value={summary?.plan?.name ?? (currentCode ? currentCode : t('dash.billing.noPlan', 'No plan'))}
          tone="primary"
        />
        <div className="card">
          <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">{t('dash.billing.status', 'Status')}</p>
          {loading ? (
            <div className="mt-2 h-7 w-24 animate-pulse rounded bg-surface-sunken" />
          ) : (
            <div className="mt-2"><StatusBadge status={summary?.tenant.status ?? 'unknown'} /></div>
          )}
          {!loading && summary?.tenant.statusReason && (
            <p className="mt-1 text-xs text-text-muted">{summary.tenant.statusReason}</p>
          )}
        </div>
        <StatCard
          loading={loading}
          label={t('dash.billing.outstanding', 'Outstanding invoices')}
          value={summary?.outstandingCount ?? 0}
          tone={(summary?.outstandingCount ?? 0) > 0 ? 'warning' : 'default'}
        />
        <StatCard
          loading={loading}
          label={t('dash.billing.currentPeriod', 'Current period')}
          value={summary?.currentPeriod ?? '—'}
        />
      </div>

      {/* B) Plan & usage */}
      <Panel
        title={t('dash.billing.planUsage', 'Plan & usage')}
        description={summary?.plan?.description}
      >
        {loading ? (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => <div key={i} className="h-8 w-full animate-pulse rounded bg-surface-sunken" />)}
          </div>
        ) : resources.length === 0 ? (
          <p className="text-sm text-text-muted">{t('dash.billing.noUsage', 'No usage metrics available for this plan.')}</p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            {resources.map((r) => <UsageMeter key={r.key} resource={r} />)}
          </div>
        )}
      </Panel>

      {/* C) Invoices */}
      <Panel title={t('dash.billing.invoices', 'Invoices')} className="p-0">
        <TableWrap>
          <thead className="border-b border-border bg-surface-sunken/40">
            <tr>
              <th className={`${thCls} text-left`}>{t('dash.billing.period', 'Period')}</th>
              <th className={`${thCls} text-right`}>{t('dash.billing.totalInclTax', 'Total (incl. PPN)')}</th>
              <th className={`${thCls} text-left`}>{t('dash.billing.status', 'Status')}</th>
              <th className={`${thCls} text-left`}>{t('dash.billing.dueDate', 'Due date')}</th>
              <th className={`${thCls} text-left`}>{t('dash.billing.paidDate', 'Paid date')}</th>
              <th className={`${thCls} text-right`}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <EmptyRow colSpan={6}>{t('dash.billing.loading', 'Loading…')}</EmptyRow>
            ) : invoices.length === 0 ? (
              <EmptyRow colSpan={6}>{t('dash.billing.noInvoices', 'No invoices yet.')}</EmptyRow>
            ) : invoices.map((inv) => (
              <tr key={inv.id} data-testid={`invoice-row-${inv.id}`}>
                <td className={tdCls}>
                  {inv.period}
                  {inv.fakturNumber && (
                    <span className="mt-0.5 block text-xs text-text-muted" data-testid={`invoice-faktur-${inv.id}`}>
                      {t('dash.billing.faktur', 'Faktur')}: {inv.fakturNumber}
                    </span>
                  )}
                </td>
                <td className={`${tdCls} text-right tabular-nums`}>
                  <span className="font-medium">{fmtIDR(invoiceTotal(inv))}</span>
                  {inv.taxAmount > 0 && (
                    <span className="mt-0.5 block text-xs font-normal text-text-muted">
                      {t('dash.billing.dpp', 'DPP')} {fmtIDR(inv.amount)}
                      {' + '}
                      {t('dash.billing.ppn', 'PPN')} {fmtIDR(inv.taxAmount)}
                    </span>
                  )}
                </td>
                <td className={tdCls}><StatusBadge status={inv.status} /></td>
                <td className={tdCls}>{fmtDate(inv.dueDate)}</td>
                <td className={tdCls}>{fmtDate(inv.paidAt)}</td>
                <td className={`${tdCls} text-right`}>
                  {PAYABLE.includes(inv.status) && (
                    <button
                      className="btn-primary text-xs"
                      data-testid={`pay-invoice-${inv.id}`}
                      onClick={() => setPayInvoice(inv)}
                    >
                      {t('dash.billing.payNow', 'Pay now')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Panel>

      {/* D) Change plan */}
      <Panel title={t('dash.billing.changePlan', 'Change plan')} description={t('dash.billing.changePlanHint', 'Switch your subscription. Downgrades may be blocked if your usage exceeds the target plan.')}>
        <ErrorBanner message={switchError} onDismiss={() => setSwitchError('')} />
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className="h-56 animate-pulse rounded-lg bg-surface-sunken" />)}
          </div>
        ) : plans.length === 0 ? (
          <p className="text-sm text-text-muted">{t('dash.billing.noPlans', 'No plans available.')}</p>
        ) : (
          <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${switchError ? 'mt-4' : ''}`}>
            {plans.map((plan) => {
              const isCurrent = plan.code === currentCode;
              const cycleSuffix = plan.billingCycle === 'annual' ? t('dash.billing.perYear', '/yr') : t('dash.billing.perMonth', '/mo');
              return (
                <div
                  key={plan.code}
                  data-testid={`plan-card-${plan.code}`}
                  className={`flex flex-col rounded-xl border p-5 ${isCurrent ? 'border-primary-500 bg-primary-50/40' : 'border-border bg-surface-raised'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-semibold text-text-primary">{plan.name}</h3>
                    {isCurrent && (
                      <span className="badge bg-primary-50 text-primary-700 text-xs">{t('dash.billing.current', 'Current')}</span>
                    )}
                  </div>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-text-primary">
                    {fmtIDR(plan.price)}<span className="text-sm font-normal text-text-muted">{cycleSuffix}</span>
                  </p>
                  {plan.description && <p className="mt-1 text-xs text-text-muted">{plan.description}</p>}

                  {plan.features.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {plan.features.map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                          <span className="mt-0.5 text-green-600" aria-hidden>✓</span>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {Object.keys(plan.limits).length > 0 && (
                    <div className="mt-3 space-y-1 border-t border-border pt-3">
                      {Object.entries(plan.limits).map(([key, val]) => (
                        <div key={key} className="flex justify-between text-xs">
                          <span className="capitalize text-text-muted">{key.replace(/_/g, ' ')}</span>
                          <span className="font-medium tabular-nums text-text-secondary">
                            {val < 0 ? t('dash.billing.unlimited', 'Unlimited') : val}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-auto pt-4">
                    <button
                      className="btn-secondary w-full text-sm disabled:opacity-50"
                      data-testid={`switch-plan-${plan.code}`}
                      disabled={isCurrent || switching != null}
                      onClick={() => changePlan(plan.code)}
                    >
                      {isCurrent
                        ? t('dash.billing.yourPlan', 'Your plan')
                        : switching === plan.code
                          ? t('dash.billing.switching', 'Switching…')
                          : t('dash.billing.switchTo', 'Switch to this plan')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {payInvoice && (
        <PayModal
          invoice={payInvoice}
          onClose={() => setPayInvoice(null)}
          onPaid={() => { load(); }}
        />
      )}
    </div>
  );
}
