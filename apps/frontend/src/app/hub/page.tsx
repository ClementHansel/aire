'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/dashboard/ui';
import { api } from '@/lib/api';
import { getUser, isAuthenticated, logout, type AuthUser } from '@/lib/auth';
import { startStaffPov, startPortalPov } from '@/lib/pov';
import { useI18n } from '@/lib/i18n';
import { usePublicBranding } from '@/lib/publicBranding';

interface HubTile {
  id: string;
  label: string;
  description: string;
  icon: string;
  href?: string;
  onClick?: () => void;
  accent: string;
}

interface TenantRow { id: string; name: string; slug: string; status: string }
interface SelectedTenant { id: string; slug: string; name: string }

interface PovEmployee { id: string; name: string; role: string | null; outletName: string | null }
interface PovCustomer { id: string; name: string; phone: string; isMember: boolean }
interface PovTargets { employees: PovEmployee[]; customers: PovCustomer[] }

const SEL_KEY = 'aire_hub_tenant';

export default function HubPage() {
  const { t } = useI18n();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [outletId, setOutletId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  // Super-admin tenant context.
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [selected, setSelected] = useState<SelectedTenant | null>(null);

  // POV picker modal.
  const [picker, setPicker] = useState<'employee' | 'customer' | null>(null);
  const [targets, setTargets] = useState<PovTargets | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Pretty slug for the kiosk link; falls back to the uuid until it loads.
  const { slug } = usePublicBranding(user?.tenantId || undefined);

  const isSuper = user?.role === 'platform_super_admin';

  useEffect(() => {
    if (!isAuthenticated()) {
      window.location.href = '/';
      return;
    }
    const u = getUser();
    // Onboarding gate: a tenant whose setup isn't finished is sent straight to
    // the wizard from the post-login hub. Super-admins are never gated.
    if (u && u.role !== 'platform_super_admin') {
      api.get<{ completedAt: string | null }>('/onboarding/me')
        .then((st) => { if (!st.completedAt) window.location.href = '/dashboard/onboarding'; })
        .catch(() => { /* never trap the user on a backend hiccup */ });
    }
    setUser(u);
    setChecked(true);
    // Resolve an outlet for the POS / Queue Board tiles. Outlet-scoped users
    // already carry their outlet; owners/admins fetch the tenant's first outlet.
    if (u?.outletId) {
      setOutletId(u.outletId);
    } else if (u?.role !== 'platform_super_admin') {
      api.get<{ id: string }[]>('/outlets')
        .then((outlets) => { const first = outlets[0]; if (first) setOutletId(first.id); })
        .catch(() => { /* no outlet access; tiles fall back to tenant */ });
    }
  }, []);

  // Super-admins pick which tenant to preview. Load the tenant list, restore the
  // last selection, and auto-select when there is exactly one tenant.
  useEffect(() => {
    if (!isSuper) return;
    api.get<TenantRow[]>('/admin/tenants')
      .then((list) => {
        setTenants(list);
        const raw = localStorage.getItem(SEL_KEY);
        const saved = raw ? (JSON.parse(raw) as SelectedTenant) : null;
        if (saved && list.some((x) => x.id === saved.id)) {
          setSelected(saved);
        } else if (list.length === 1) {
          const only = list[0]!;
          const sel = { id: only.id, slug: only.slug, name: only.name };
          setSelected(sel);
          localStorage.setItem(SEL_KEY, JSON.stringify(sel));
        }
      })
      .catch(() => { /* tenant list unavailable; POV tiles stay disabled */ });
  }, [isSuper]);

  const onSelectTenant = (id: string) => {
    const row = tenants.find((x) => x.id === id);
    if (!row) { setSelected(null); localStorage.removeItem(SEL_KEY); return; }
    const sel = { id: row.id, slug: row.slug, name: row.name };
    setSelected(sel);
    localStorage.setItem(SEL_KEY, JSON.stringify(sel));
  };

  // ── POV launchers (super-admin) ────────────────────────────────────────────
  const viewAsOwner = useCallback(async () => {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const res = await api.post<{ accessToken: string; user: AuthUser }>(
        `/admin/tenants/${selected.id}/impersonate`, { as: 'owner' });
      startStaffPov(res.accessToken, res.user, {
        label: t('pov.role.owner', 'Owner'), tenantName: selected.name, returnTo: '/hub',
      });
      window.location.href = '/dashboard';
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); setBusy(false); }
  }, [selected, t]);

  const openPicker = useCallback(async (kind: 'employee' | 'customer') => {
    if (!selected) return;
    setPicker(kind); setError(''); setTargets(null); setPickerLoading(true);
    try {
      const res = await api.get<PovTargets>(`/admin/tenants/${selected.id}/pov-targets`);
      setTargets(res);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setPickerLoading(false); }
  }, [selected]);

  const viewAsEmployee = useCallback(async (employeeId?: string) => {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const res = await api.post<{ accessToken: string; user: AuthUser; employee: { id: string; name: string } }>(
        `/admin/tenants/${selected.id}/impersonate`, { as: 'employee', targetId: employeeId });
      startStaffPov(res.accessToken, res.user, {
        label: `${t('pov.role.employee', 'Employee')} · ${res.employee.name}`,
        tenantName: selected.name, returnTo: '/hub',
      });
      window.location.href = '/employee';
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); setBusy(false); }
  }, [selected, t]);

  const viewAsCustomer = useCallback(async (customerId?: string) => {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const res = await api.post<{ token: string; customer: { id: string; name: string } }>(
        `/admin/tenants/${selected.id}/portal-token`, { targetId: customerId });
      startPortalPov(selected.id, res.token, {
        label: `${t('pov.role.customer', 'Customer')} · ${res.customer.name}`,
        tenantName: selected.name, returnTo: '/hub',
      });
      window.location.href = `/portal/${selected.id}`;
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); setBusy(false); }
  }, [selected, t]);

  if (!checked) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <p className="text-sm text-text-muted">{t('auth.hub.loading', 'Loading…')}</p>
      </div>
    );
  }

  // The POS URL param is a label only — the backend resolves the outlet/shift
  // from the authenticated session. Fall back to the tenant when no outlet is set.
  const posAgent = outletId ?? user?.tenantId ?? 'pos';

  // Super-admins get tenant-scoped POV tiles; everyone else gets their workspace.
  const tiles: HubTile[] = isSuper
    ? [
        {
          id: 'owner',
          label: t('auth.hub.povOwner', 'Owner Dashboard'),
          description: t('auth.hub.povOwnerDesc', 'The tenant business dashboard — services, finance, HR, reports'),
          icon: '📊',
          onClick: selected ? viewAsOwner : undefined,
          accent: 'bg-primary-50 text-primary-700',
        },
        {
          id: 'employee',
          label: t('auth.hub.povEmployee', 'Employee View'),
          description: t('auth.hub.povEmployeeDesc', 'Self-service: schedule, attendance, payslips, leave'),
          icon: '🧑‍🔧',
          onClick: selected ? () => openPicker('employee') : undefined,
          accent: 'bg-emerald-50 text-emerald-700',
        },
        {
          id: 'customer',
          label: t('auth.hub.povCustomer', 'Customer / Member Portal'),
          description: t('auth.hub.povCustomerDesc', 'The customer-facing portal — membership, vouchers, bookings'),
          icon: '🪪',
          onClick: selected ? () => openPicker('customer') : undefined,
          accent: 'bg-violet-50 text-violet-700',
        },
        {
          id: 'admin',
          label: t('auth.hub.admin', 'Platform Admin'),
          description: t('auth.hub.adminDesc', 'Manage tenants, platform configuration and support'),
          icon: '🛡️',
          href: '/admin',
          accent: 'bg-slate-100 text-slate-700',
        },
        {
          id: 'docs',
          label: t('auth.hub.docs', 'Documentation'),
          description: t('auth.hub.docsFullDesc', 'All user manuals and the full technical reference'),
          icon: '📚',
          href: '/docs',
          accent: 'bg-amber-50 text-amber-700',
        },
      ]
    : [
        {
          id: 'dashboard',
          label: t('auth.hub.dashboard', 'Dashboard'),
          description: t('auth.hub.dashboardDesc', 'Services, inventory, finance, HR, payroll and reports'),
          icon: '📊',
          href: '/dashboard',
          accent: 'bg-primary-50 text-primary-700',
        },
        {
          id: 'pos',
          label: t('auth.hub.pos', 'Point of Sale'),
          description: t('auth.hub.posDesc', 'Take orders, accept payments, manage shifts and petty cash'),
          icon: '🧾',
          href: `/pos/${posAgent}/new-order`,
          accent: 'bg-emerald-50 text-emerald-700',
        },
        {
          id: 'kiosk',
          label: t('auth.hub.kiosk', 'Self-Service Kiosk'),
          description: t('auth.hub.kioskDesc', 'Customer-facing order status and queue lookup'),
          icon: '🖥️',
          href: `/kiosk/${slug || user?.tenantId || ''}`,
          accent: 'bg-violet-50 text-violet-700',
        },
        {
          id: 'docs',
          label: t('auth.hub.docs', 'Documentation'),
          description: t('auth.hub.docsDesc', 'Step-by-step user manuals — read online or download as PDF'),
          icon: '📚',
          href: '/docs',
          accent: 'bg-amber-50 text-amber-700',
        },
      ];

  return (
    <div className="min-h-screen bg-surface flex flex-col" data-testid="hub-page">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 lg:px-10 py-5 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-primary-500 rounded-xl flex items-center justify-center">
            <span className="text-base font-bold text-white">A</span>
          </div>
          <span className="font-semibold text-text-primary">airin</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium text-text-primary">{user?.name ?? t('auth.hub.user', 'User')}</p>
            <p className="text-xs text-text-muted capitalize">{user?.role?.replace(/_/g, ' ') ?? ''}</p>
          </div>
          <button onClick={logout} className="btn-ghost text-xs">↩ {t('auth.hub.signOut', 'Sign out')}</button>
        </div>
      </header>

      {/* Hub */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-4xl">
          <div className="text-center mb-10">
            <p className="eyebrow mb-3">{t('auth.hub.workspace', 'Workspace')}</p>
            <h1 className="text-3xl lg:text-4xl font-bold text-text-primary">
              {t('auth.hub.welcomeBack', 'Welcome back')}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
            </h1>
            <p className="mt-2 text-text-secondary">{t('auth.hub.chooseWork', 'Choose where you want to work today.')}</p>
          </div>

          {/* Super-admin tenant picker: which tenant do the POV tiles target? */}
          {isSuper && (
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-center gap-3">
              <label htmlFor="hub-tenant" className="text-sm font-medium text-text-secondary">
                {t('auth.hub.viewingTenant', 'Viewing tenant')}
              </label>
              <select
                id="hub-tenant"
                data-testid="hub-tenant-select"
                value={selected?.id ?? ''}
                onChange={(e) => onSelectTenant(e.target.value)}
                className="input-field sm:w-72"
              >
                <option value="">{t('auth.hub.selectTenant', 'Select a tenant…')}</option>
                {tenants.map((tn) => (
                  <option key={tn.id} value={tn.id}>{tn.name}{tn.status !== 'active' ? ` (${tn.status})` : ''}</option>
                ))}
              </select>
            </div>
          )}

          {isSuper && !selected && (
            <p className="text-center text-sm text-text-muted mb-6">
              {t('auth.hub.pickToPreview', 'Pick a tenant above to preview its dashboards.')}
            </p>
          )}

          {error && !picker && <p className="text-center text-sm text-red-600 mb-4">{error}</p>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5" data-testid="hub-tiles">
            {tiles.map((tile) => {
              const disabled = isSuper && !tile.href && !tile.onClick;
              const cls = `group card flex items-start gap-4 p-6 transition-all text-left ${
                disabled ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md hover:border-border-strong'
              }`;
              const inner = (
                <>
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shrink-0 ${tile.accent}`}>
                    {tile.icon}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-text-primary group-hover:text-primary-600 transition-colors">
                      {tile.label}
                    </h2>
                    <p className="mt-1 text-sm text-text-secondary">{tile.description}</p>
                  </div>
                </>
              );
              return tile.href ? (
                <Link key={tile.id} href={tile.href} data-testid={`hub-tile-${tile.id}`} className={cls}>
                  {inner}
                </Link>
              ) : (
                <button
                  key={tile.id}
                  type="button"
                  data-testid={`hub-tile-${tile.id}`}
                  onClick={tile.onClick}
                  disabled={disabled || busy}
                  className={cls}
                >
                  {inner}
                </button>
              );
            })}
          </div>
        </div>
      </main>

      {/* POV target picker */}
      {picker && (
        <Modal
          title={picker === 'employee'
            ? t('auth.hub.pickEmployee', 'View as which employee?')
            : t('auth.hub.pickCustomer', 'View as which customer?')}
          onClose={() => { if (!busy) { setPicker(null); setError(''); } }}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setPicker(null)} disabled={busy}>
                {t('auth.hub.cancel', 'Cancel')}
              </button>
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() => (picker === 'employee' ? viewAsEmployee() : viewAsCustomer())}
              >
                {busy ? t('auth.hub.opening', 'Opening…') : t('auth.hub.pickForMe', 'Pick one for me')}
              </button>
            </>
          }
        >
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
          {pickerLoading && <p className="text-sm text-text-muted">{t('auth.hub.loading', 'Loading…')}</p>}
          {!pickerLoading && targets && (
            <div className="max-h-80 overflow-y-auto -mx-1">
              {picker === 'employee' && (
                targets.employees.length === 0
                  ? <p className="text-sm text-text-muted px-1">{t('auth.hub.noEmployees', 'No employees with a login to view as.')}</p>
                  : targets.employees.map((e) => (
                      <button
                        key={e.id}
                        disabled={busy}
                        onClick={() => viewAsEmployee(e.id)}
                        className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-surface-sunken flex items-center justify-between gap-3"
                      >
                        <span className="text-sm font-medium text-text-primary">{e.name}</span>
                        <span className="text-xs text-text-muted">{[e.role, e.outletName].filter(Boolean).join(' · ')}</span>
                      </button>
                    ))
              )}
              {picker === 'customer' && (
                targets.customers.length === 0
                  ? <p className="text-sm text-text-muted px-1">{t('auth.hub.noCustomers', 'This tenant has no customers yet.')}</p>
                  : targets.customers.map((c) => (
                      <button
                        key={c.id}
                        disabled={busy}
                        onClick={() => viewAsCustomer(c.id)}
                        className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-surface-sunken flex items-center justify-between gap-3"
                      >
                        <span className="text-sm font-medium text-text-primary">{c.name}</span>
                        <span className="flex items-center gap-2 text-xs text-text-muted">
                          {c.phone}
                          {c.isMember && (
                            <span className="rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5">
                              {t('auth.hub.member', 'Member')}
                            </span>
                          )}
                        </span>
                      </button>
                    ))
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
