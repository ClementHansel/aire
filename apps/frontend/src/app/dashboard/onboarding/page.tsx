'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getUser, isAuthenticated } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { ErrorBanner } from '@/components/dashboard/ui';
import { StepIndicator } from '@/components/onboarding/StepIndicator';
import {
  LegalEntityFields, BranchFields, ServiceFields,
  EMPTY_LEGAL, EMPTY_BRANCH, EMPTY_SERVICE,
  type LegalEntityInput, type BranchInput, type ServiceInput,
} from '@/components/onboarding/fields';
import { useOnboarding } from '@/lib/useOnboarding';

interface LegalEntity { id: string; name: string }
interface Branch { id: string; name: string }
interface FinanceStatus { checklist: { provisioned: boolean; chartOfAccounts: boolean; openingBalances: boolean }; settings: { provisionedAt: string | null } }

/**
 * Tenant onboarding wizard — the blocking first-run experience. The owner must
 * finish the mandatory steps (company legal entity → branch → a service) before
 * the app unlocks; staff and finance are guided but skippable. Non-owner tenant
 * users see a "waiting for the owner" screen.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const { t } = useI18n();
  const { status, reload } = useOnboarding();
  const [role, setRole] = useState<string>('');
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  // Pre-fill from any data an admin already created for this tenant.
  const [legalEntities, setLegalEntities] = useState<LegalEntity[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [legal, setLegal] = useState<LegalEntityInput>(EMPTY_LEGAL);
  const [branch, setBranch] = useState<BranchInput>(EMPTY_BRANCH);
  const [service, setService] = useState<ServiceInput>(EMPTY_SERVICE);
  const [staff, setStaff] = useState({ name: '', email: '', password: '', role: 'cashier', salary: '' });
  const [finance, setFinance] = useState<FinanceStatus | null>(null);

  const LABELS = [
    t('onboarding.step.company', 'Company'),
    t('onboarding.step.branch', 'Branch'),
    t('onboarding.step.services', 'Services'),
    t('onboarding.step.staff', 'Staff'),
    t('onboarding.step.finance', 'Finance'),
    t('onboarding.step.done', 'Done'),
  ];

  const loadData = useCallback(async () => {
    const [les, brs] = await Promise.all([
      api.get<LegalEntity[]>('/legal-entities').catch(() => []),
      api.get<Branch[]>('/outlets').catch(() => []),
    ]);
    setLegalEntities(les); setBranches(brs);
    if (brs[0]) setBranch((b) => ({ ...b, legalEntityId: b.legalEntityId || (les[0]?.id ?? '') }));
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/'; return; }
    const u = getUser();
    setRole(u?.role ?? '');
    void loadData();
  }, [loadData]);

  // Once we know the status, jump to the first unfinished mandatory step.
  useEffect(() => {
    if (!status || ready) return;
    if (status.completedAt) { router.replace('/dashboard'); return; }
    const s = status.steps;
    setStep(!s.legal.done ? 1 : !s.branch.done ? 2 : !s.service.done ? 3 : 4);
    setReady(true);
  }, [status, ready, router]);

  const persistStep = (n: number) => { void api.put('/onboarding/me/state', { currentStep: n }).catch(() => {}); };
  const goto = (n: number) => { setError(''); setStep(n); persistStep(n); };

  const saveLegal = async () => {
    setBusy(true); setError('');
    try {
      await api.post('/legal-entities', { name: legal.name, npwp: legal.npwp || undefined, address: legal.address || undefined, phone: legal.phone || undefined });
      await Promise.all([reload(), loadData()]);
      goto(2);
    } catch (e) { setError(e instanceof Error ? e.message : t('onboarding.saveFailed', 'Save failed')); }
    finally { setBusy(false); }
  };

  const saveBranch = async () => {
    setBusy(true); setError('');
    try {
      await api.post('/outlets', {
        name: branch.name,
        code: branch.code || undefined,
        legalEntityId: branch.legalEntityId || legalEntities[0]?.id || null,
        address: branch.address || undefined,
        phone: branch.phone || undefined,
        settings: {
          ...(branch.serviceChargePct ? { service_charge_pct: Number(branch.serviceChargePct) } : {}),
          ...(branch.taxPct ? { tax_pct: Number(branch.taxPct) } : {}),
        },
      });
      await Promise.all([reload(), loadData()]);
      goto(3);
    } catch (e) { setError(e instanceof Error ? e.message : t('onboarding.saveFailed', 'Save failed')); }
    finally { setBusy(false); }
  };

  const saveService = async () => {
    setBusy(true); setError('');
    try {
      await api.post('/services', { name: service.name, category: service.category, businessUnit: service.businessUnit, price: Number(service.price) });
      await reload();
      goto(4);
    } catch (e) { setError(e instanceof Error ? e.message : t('onboarding.saveFailed', 'Save failed')); }
    finally { setBusy(false); }
  };

  const saveStaff = async () => {
    setBusy(true); setError('');
    try {
      const outletId = branches[0]?.id;
      const user = await api.post<{ id: string }>('/users', {
        name: staff.name, email: staff.email, password: staff.password, role: staff.role,
        outletIds: outletId ? [outletId] : undefined,
      });
      // Link a matching HR/payroll record so the staff member flows into HR.
      await api.post('/hr/employees', {
        name: staff.name, email: staff.email || undefined, role: staff.role,
        salary: staff.salary ? Number(staff.salary) : 0, outletId, userId: user.id,
      }).catch(() => {}); // non-fatal — the login still works without the HR row
      await reload();
      setStaff({ name: '', email: '', password: '', role: 'cashier', salary: '' });
      goto(5);
    } catch (e) { setError(e instanceof Error ? e.message : t('onboarding.saveFailed', 'Save failed')); }
    finally { setBusy(false); }
  };

  const loadFinance = useCallback(async () => {
    const fs = await api.get<FinanceStatus>('/finance-setup/status').catch(() => null);
    setFinance(fs);
  }, []);
  useEffect(() => { if (step === 5) void loadFinance(); }, [step, loadFinance]);

  const provisionFinance = async () => {
    setBusy(true); setError('');
    try {
      await api.post('/finance-setup/provision', {});
      await loadFinance();
    } catch (e) { setError(e instanceof Error ? e.message : t('onboarding.saveFailed', 'Setup failed')); }
    finally { setBusy(false); }
  };

  const finish = async () => {
    setBusy(true); setError('');
    try {
      await api.post('/onboarding/me/complete', {});
      router.replace('/dashboard');
    } catch (e) { setError(e instanceof Error ? e.message : t('onboarding.finishFailed', 'Could not finish — complete the required steps first.')); }
    finally { setBusy(false); }
  };

  // Non-owner tenant users can't run setup — show a holding screen.
  if (role && role !== 'tenant_owner' && role !== 'platform_super_admin') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="card max-w-md text-center space-y-2">
          <div className="text-3xl">🛠️</div>
          <h1 className="text-lg font-semibold text-text-primary">{t('onboarding.waiting.title', 'Setup in progress')}</h1>
          <p className="text-sm text-text-secondary">{t('onboarding.waiting.body', 'Your business is being set up. Please check back once the owner has finished onboarding.')}</p>
        </div>
      </div>
    );
  }

  if (!ready || !status) {
    return <div className="min-h-[60vh] flex items-center justify-center"><p className="text-sm text-text-muted">{t('onboarding.loading', 'Loading…')}</p></div>;
  }

  const s = status.steps;

  return (
    <div className="mx-auto max-w-2xl py-8 px-4" data-testid="onboarding-wizard">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-text-primary">{t('onboarding.title', 'Set up your business')}</h1>
        <p className="mt-1 text-sm text-text-secondary">{t('onboarding.subtitle', 'A few quick steps and you are ready to start taking orders.')}</p>
      </div>

      <div className="card">
        <StepIndicator labels={LABELS} step={step} />
        {error && <div className="mb-4"><ErrorBanner message={error} onDismiss={() => setError('')} /></div>}

        {/* Step 1 — Company / legal entity */}
        {step === 1 && (
          <div className="space-y-4" data-testid="onboarding-step-1">
            <p className="text-sm text-text-secondary">{t('onboarding.legal.intro', 'Your registered company (PT). This appears on invoices and receipts.')}</p>
            <LegalEntityFields value={legal} onChange={setLegal} />
            <div className="flex justify-end pt-2">
              <button className="btn-primary" disabled={busy || !legal.name.trim()} onClick={saveLegal}>{busy ? t('onboarding.saving', 'Saving…') : t('onboarding.saveContinue', 'Save & continue')}</button>
            </div>
          </div>
        )}

        {/* Step 2 — Branch */}
        {step === 2 && (
          <div className="space-y-4" data-testid="onboarding-step-2">
            <p className="text-sm text-text-secondary">{t('onboarding.branch.intro', 'Your first branch (outlet). You can add more later.')}</p>
            <BranchFields value={branch} onChange={setBranch} legalEntities={legalEntities} />
            <div className="flex justify-between pt-2">
              <button className="btn-ghost" onClick={() => goto(1)}>{t('onboarding.back', 'Back')}</button>
              <button className="btn-primary" disabled={busy || !branch.name.trim()} onClick={saveBranch}>{busy ? t('onboarding.saving', 'Saving…') : t('onboarding.saveContinue', 'Save & continue')}</button>
            </div>
          </div>
        )}

        {/* Step 3 — Service */}
        {step === 3 && (
          <div className="space-y-4" data-testid="onboarding-step-3">
            <p className="text-sm text-text-secondary">{t('onboarding.service.intro', 'Add one service so the POS is ready. You can build the full menu later.')}</p>
            <ServiceFields value={service} onChange={setService} />
            <div className="flex justify-between pt-2">
              <button className="btn-ghost" onClick={() => goto(2)}>{t('onboarding.back', 'Back')}</button>
              <button className="btn-primary" disabled={busy || !service.name.trim() || !service.price} onClick={saveService}>{busy ? t('onboarding.saving', 'Saving…') : t('onboarding.saveContinue', 'Save & continue')}</button>
            </div>
          </div>
        )}

        {/* Step 4 — Staff (guided, skippable) */}
        {step === 4 && (
          <div className="space-y-4" data-testid="onboarding-step-4">
            <p className="text-sm text-text-secondary">{t('onboarding.staff.intro', 'Add a staff login so your team can run the POS. This also creates their HR/payroll record. Optional — you can skip and add staff later.')}</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="mb-1.5 block text-sm font-medium text-text-primary">{t('onboarding.staff.name', 'Name')}</span><input className="input-field" value={staff.name} onChange={(e) => setStaff({ ...staff, name: e.target.value })} /></label>
              <label className="block"><span className="mb-1.5 block text-sm font-medium text-text-primary">{t('onboarding.staff.role', 'Role')}</span>
                <select className="input-field" value={staff.role} onChange={(e) => setStaff({ ...staff, role: e.target.value })}>
                  <option value="cashier">{t('onboarding.staff.roleCashier', 'Cashier')}</option>
                  <option value="outlet_admin">{t('onboarding.staff.roleOutletAdmin', 'Outlet admin')}</option>
                </select>
              </label>
              <label className="block"><span className="mb-1.5 block text-sm font-medium text-text-primary">{t('onboarding.staff.email', 'Email')}</span><input className="input-field" type="email" value={staff.email} onChange={(e) => setStaff({ ...staff, email: e.target.value })} /></label>
              <label className="block"><span className="mb-1.5 block text-sm font-medium text-text-primary">{t('onboarding.staff.password', 'Password')}</span><input className="input-field" type="password" value={staff.password} onChange={(e) => setStaff({ ...staff, password: e.target.value })} /></label>
              <label className="block"><span className="mb-1.5 block text-sm font-medium text-text-primary">{t('onboarding.staff.salary', 'Monthly salary (IDR)')}</span><input className="input-field" type="number" min={0} value={staff.salary} onChange={(e) => setStaff({ ...staff, salary: e.target.value })} placeholder="0" /></label>
            </div>
            <div className="flex justify-between pt-2">
              <button className="btn-ghost" onClick={() => goto(3)}>{t('onboarding.back', 'Back')}</button>
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={() => goto(5)}>{t('onboarding.skip', 'Skip for now')}</button>
                <button className="btn-primary" disabled={busy || !staff.name.trim() || !staff.email.trim() || staff.password.length < 8} onClick={saveStaff}>{busy ? t('onboarding.saving', 'Saving…') : t('onboarding.staff.add', 'Add & continue')}</button>
              </div>
            </div>
          </div>
        )}

        {/* Step 5 — Finance (guided, skippable; uses the finance-setup module) */}
        {step === 5 && (
          <div className="space-y-4" data-testid="onboarding-step-5">
            <p className="text-sm text-text-secondary">{t('onboarding.finance.intro', 'Set up your books in one click: chart of accounts, opening balances, and automatic posting. Optional — you can do this later from Finance settings.')}</p>
            <div className="rounded-lg border border-border p-4 text-sm space-y-1">
              <div className="flex items-center gap-2">{finance?.checklist.chartOfAccounts ? '✅' : '⬜'} {t('onboarding.finance.coa', 'Chart of accounts')}</div>
              <div className="flex items-center gap-2">{finance?.checklist.openingBalances ? '✅' : '⬜'} {t('onboarding.finance.opening', 'Opening balances')}</div>
              <div className="flex items-center gap-2">{finance?.checklist.provisioned ? '✅' : '⬜'} {t('onboarding.finance.provisioned', 'Books provisioned')}</div>
            </div>
            <div className="flex justify-between pt-2">
              <button className="btn-ghost" onClick={() => goto(4)}>{t('onboarding.back', 'Back')}</button>
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={() => goto(6)}>{t('onboarding.skip', 'Skip for now')}</button>
                {finance?.checklist.provisioned ? (
                  <button className="btn-primary" onClick={() => goto(6)}>{t('onboarding.continue', 'Continue')}</button>
                ) : (
                  <button className="btn-primary" disabled={busy} onClick={provisionFinance}>{busy ? t('onboarding.finance.provisioning', 'Setting up…') : t('onboarding.finance.provision', 'Set up finance (1-click)')}</button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Step 6 — Finish */}
        {step === 6 && (
          <div className="space-y-4" data-testid="onboarding-step-6">
            <p className="text-sm text-text-secondary">{t('onboarding.done.intro', 'You are all set. Review below and enter your dashboard.')}</p>
            <div className="rounded-lg border border-border p-4 text-sm space-y-1">
              <div className="flex items-center gap-2">{s.legal.done ? '✅' : '❌'} {t('onboarding.done.legal', 'Company legal entity')}</div>
              <div className="flex items-center gap-2">{s.branch.done ? '✅' : '❌'} {t('onboarding.done.branch', 'At least one branch')}</div>
              <div className="flex items-center gap-2">{s.service.done ? '✅' : '❌'} {t('onboarding.done.service', 'At least one service')}</div>
              <div className="flex items-center gap-2 text-text-muted">{s.staff.done ? '✅' : '➖'} {t('onboarding.done.staff', 'Staff (optional)')}</div>
            </div>
            {!status.mandatoryComplete && (
              <p className="text-sm text-amber-600">{t('onboarding.done.incomplete', 'Finish the required steps (company, branch, service) to continue.')}</p>
            )}
            <div className="flex justify-between pt-2">
              <button className="btn-ghost" onClick={() => goto(5)}>{t('onboarding.back', 'Back')}</button>
              <button className="btn-primary" data-testid="onboarding-finish" disabled={busy || !status.mandatoryComplete} onClick={finish}>{busy ? t('onboarding.finishing', 'Finishing…') : t('onboarding.enterDashboard', 'Enter dashboard →')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
