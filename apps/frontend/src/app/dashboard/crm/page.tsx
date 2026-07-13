'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import BranchFilter from '@/components/dashboard/BranchFilter';

interface GrowthPoint { period: string; newCustomers: number }
interface Customer {
  id: string; name: string; phone: string; createdAt: string; totalVisits: number;
  // Derived: 'active' | 'grace' | 'suspended' | 'inactive' member, or null = never a member.
  membershipStatus: 'active' | 'grace' | 'suspended' | 'inactive' | null;
}
interface CustomerMembershipInfo { id: string; planName: string; status: string; startDate: string; endDate: string; usesCount: number; maxUses: number }
interface CustomerVisit { orderId: string; orderNumber: string; outletName: string; date: string; total: number; services: string[]; paymentMethod: string | null }
interface ServicePreference { serviceId: string; serviceName: string; timesUsed: number; totalSpent: number }
interface CustomerProfile {
  id: string; name: string; phone: string; createdAt: string;
  totalVisits: number; totalSpending: number; lastVisitDate: string | null;
  memberships: CustomerMembershipInfo[]; recentVisits: CustomerVisit[];
  servicePreferences: ServicePreference[]; voucherUsage: { totalRedeemed: number; totalSaved: number };
}

const fmtRp = (n: number) => `Rp ${(n ?? 0).toLocaleString('id-ID')}`;

// Member badge styling by derived status. `null` renders nothing (normal customer).
const MEMBER_BADGE: Record<string, { cls: string; label: string }> = {
  active: { cls: 'bg-green-50 text-green-700', label: 'Member' },
  grace: { cls: 'bg-orange-50 text-orange-700', label: 'Member · grace' },
  suspended: { cls: 'bg-amber-50 text-amber-700', label: 'Member · suspended' },
  inactive: { cls: 'bg-gray-100 text-gray-500', label: 'Past member' },
};

function today(): string { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function daysAgo(n: number): string { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

function Bars({ data }: { data: { label: string; value: number }[] }) {
  const { t } = useI18n();
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-1.5">
      {data.length === 0 ? <p className="text-sm text-text-muted italic">{t('dash.crm.noData', 'No data.')}</p> : data.map((d, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 text-text-muted truncate">{d.label}</span>
          <div className="flex-1 bg-surface-sunken rounded h-5 overflow-hidden"><div className="h-full bg-primary-500 rounded" style={{ width: `${(d.value / max) * 100}%` }} /></div>
          <span className="w-10 text-right font-mono text-text-secondary">{d.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function CrmPage() {
  const { t } = useI18n();
  const [dateFrom, setDateFrom] = useState(daysAgo(30));
  const [dateTo, setDateTo] = useState(today());
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day');
  const [growth, setGrowth] = useState<GrowthPoint[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState<'all' | 'members' | 'non'>('all');
  const [branch, setBranch] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Customer | null>(null);
  const [detailOf, setDetailOf] = useState<Customer | null>(null);

  const loadGrowth = useCallback(async () => {
    try { setGrowth(await api.get<GrowthPoint[]>(`/reports/customer-growth?dateFrom=${dateFrom}&dateTo=${dateTo}&granularity=${granularity}`)); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.crm.errFailed', 'Failed')); }
  }, [dateFrom, dateTo, granularity, t]);

  const loadCustomers = useCallback(async () => {
    try {
      const res = await api.get<{ customers: Customer[]; total: number }>(`/customers/list?page=${page}&pageSize=${pageSize}${search ? `&search=${encodeURIComponent(search)}` : ''}${branch ? `&outletId=${branch}` : ''}${segment !== 'all' ? `&segment=${segment}` : ''}`);
      setCustomers(res.customers); setTotal(res.total);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  }, [page, pageSize, search, branch, segment]);

  useEffect(() => { loadGrowth(); }, [loadGrowth]);
  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  const del = async (c: Customer) => {
    if (!confirm(`${t('dash.crm.deleteCustomerConfirm', 'Delete customer')} ${c.name}?`)) return;
    try { await api.delete(`/customers/${c.id}`); await loadCustomers(); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.crm.errDelete', 'Delete failed')); }
  };
  const save = async (patch: { name: string; phone: string }) => {
    if (!editing) return;
    try { await api.put(`/customers/${editing.id}`, patch); setEditing(null); await loadCustomers(); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.crm.errSave', 'Save failed')); }
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const totalNew = growth.reduce((a, b) => a + b.newCustomers, 0);

  return (
    <div data-testid="crm-page">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary">{t('dash.crm.title', 'Customers')}</h1>
        <p className="mt-1 text-sm text-text-secondary">{t('dash.crm.subtitle', 'Every customer — members and non-members. Manage members from the Memberships page.')}</p>
      </div>
      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      <div className="card mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div><label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.crm.from', 'From')}</label><input aria-label={t('dash.crm.dateFrom', 'Date From')} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field" /></div>
          <div><label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.crm.to', 'To')}</label><input aria-label={t('dash.crm.dateTo', 'Date To')} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field" /></div>
          <div><label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.crm.groupBy', 'Group by')}</label>
            <select aria-label={t('dash.crm.granularity', 'Granularity')} value={granularity} onChange={(e) => setGranularity(e.target.value as 'day' | 'week' | 'month')} className="input-field">
              <option value="day">{t('dash.crm.daily', 'Daily')}</option><option value="week">{t('dash.crm.weekly', 'Weekly')}</option><option value="month">{t('dash.crm.monthly', 'Monthly')}</option>
            </select></div>
          <div className="card bg-surface-sunken px-4 py-2"><p className="text-xs text-text-muted">{t('dash.crm.newCustomers', 'New customers')}</p><p className="text-xl font-bold">{totalNew}</p></div>
        </div>
      </div>

      <div className="card mb-6"><h2 className="section-title mb-3">{t('dash.crm.newCustomers', 'New customers')} ({granularity})</h2><Bars data={growth.map((g) => ({ label: g.period, value: g.newCustomers }))} /></div>

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-text-primary">{t('dash.crm.customers', 'Customers')} ({total})</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1">
              {(['all', 'members', 'non'] as const).map((s) => (
                <button key={s} onClick={() => { setSegment(s); setPage(1); }} className={`badge ${segment === s ? 'bg-primary-500 text-white' : 'bg-surface-sunken text-text-secondary'}`}>
                  {s === 'all' ? t('dash.crm.segAll', 'All') : s === 'members' ? t('dash.crm.segMembers', 'Members') : t('dash.crm.segNon', 'Non-members')}
                </button>
              ))}
            </div>
            <BranchFilter value={branch} onChange={(v) => { setBranch(v); setPage(1); }} />
            <input aria-label={t('dash.crm.searchNamePhone', 'Search name or phone…')} className="input-field max-w-xs py-1 text-sm" placeholder={t('dash.crm.searchNamePhone', 'Search name or phone…')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
        </div>
        <table className="w-full">
          <thead><tr className="border-b border-border bg-surface-sunken/50">
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.crm.name', 'Name')}</th>
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.crm.phone', 'Phone')}</th>
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.crm.membership', 'Membership')}</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.crm.visits', 'Visits')}</th>
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.crm.firstSeen', 'First seen')}</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.crm.actions', 'Actions')}</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {customers.length === 0 ? <tr><td colSpan={6} className="px-5 py-6 text-sm text-text-muted text-center">{t('dash.crm.noCustomers', 'No customers.')}</td></tr> : customers.map((c) => (
              <tr key={c.id} className="cursor-pointer hover:bg-surface-sunken/40" onClick={() => setDetailOf(c)}>
                <td className="px-5 py-3 text-sm font-medium text-primary-600">{c.name}</td>
                <td className="px-5 py-3 text-sm">{c.phone}</td>
                <td className="px-5 py-3">
                  {c.membershipStatus
                    ? <span className={`badge text-xs ${MEMBER_BADGE[c.membershipStatus]?.cls ?? ''}`}>{MEMBER_BADGE[c.membershipStatus]?.label ?? c.membershipStatus}</span>
                    : <span className="text-xs text-text-muted">{t('dash.crm.normalCustomer', 'Customer')}</span>}
                </td>
                <td className="px-5 py-3 text-sm text-right">{c.totalVisits}</td>
                <td className="px-5 py-3 text-xs text-text-muted">{new Date(c.createdAt).toLocaleDateString()}</td>
                <td className="px-5 py-3 text-right whitespace-nowrap">
                  <button className="btn-ghost text-xs" onClick={(e) => { e.stopPropagation(); setEditing(c); }}>{t('dash.crm.edit', 'Edit')}</button>
                  <button className="btn-ghost text-xs text-red-600" onClick={(e) => { e.stopPropagation(); del(c); }}>{t('dash.crm.delete', 'Delete')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-5 py-3 border-t border-border text-sm">
          <span className="text-text-muted">{t('dash.crm.page', 'Page')} {page} / {pages}</span>
          <div className="flex gap-2">
            <button className="btn-ghost text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t('dash.crm.prev', 'Prev')}</button>
            <button className="btn-ghost text-xs" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t('dash.crm.next', 'Next')}</button>
          </div>
        </div>
      </div>

      {detailOf && (
        <CustomerDetailModal
          customer={detailOf}
          onClose={() => setDetailOf(null)}
          onEdit={() => { setEditing(detailOf); setDetailOf(null); }}
        />
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
          <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="section-title mb-4">{t('dash.crm.editCustomer', 'Edit customer')}</h3>
            <EditCustomer customer={editing} onSave={save} onClose={() => setEditing(null)} />
          </div>
        </div>
      )}
    </div>
  );
}

const MS_BADGE: Record<string, string> = {
  active: 'bg-green-50 text-green-700', grace: 'bg-orange-50 text-orange-700', revoked: 'bg-rose-50 text-rose-700',
  suspended: 'bg-amber-50 text-amber-700', expired: 'bg-gray-100 text-gray-500', pending: 'bg-blue-50 text-blue-700', cancelled: 'bg-red-50 text-red-700',
};

function CustomerDetailModal({ customer, onClose, onEdit }: { customer: Customer; onClose: () => void; onEdit: () => void }) {
  const { t } = useI18n();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setProfile(null); setError('');
    api.get<CustomerProfile>(`/customers/${customer.id}/profile`)
      .then(setProfile)
      .catch((e) => setError(e instanceof Error ? e.message : t('dash.crm.errProfile', 'Failed to load profile')));
  }, [customer.id, t]);

  const isMember = customer.membershipStatus != null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-text-primary">{customer.name}</h3>
            <p className="text-sm text-text-muted">{customer.phone}</p>
          </div>
          {customer.membershipStatus
            ? <span className={`badge text-xs ${MEMBER_BADGE[customer.membershipStatus]?.cls ?? ''}`}>{MEMBER_BADGE[customer.membershipStatus]?.label ?? customer.membershipStatus}</span>
            : <span className="badge bg-surface-sunken text-text-secondary text-xs">{t('dash.crm.normalCustomer', 'Customer')}</span>}
        </div>

        {error && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-sm text-red-700 mb-3">{error}</div>}
        {!profile && !error ? (
          <p className="text-sm text-text-muted">{t('dash.crm.loading', 'Loading…')}</p>
        ) : profile && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <div className="card bg-surface-sunken px-3 py-2"><p className="text-xs text-text-muted">{t('dash.crm.visits', 'Visits')}</p><p className="text-lg font-bold">{profile.totalVisits}</p></div>
              <div className="card bg-surface-sunken px-3 py-2"><p className="text-xs text-text-muted">{t('dash.crm.totalSpend', 'Total spend')}</p><p className="text-lg font-bold">{fmtRp(profile.totalSpending)}</p></div>
              <div className="card bg-surface-sunken px-3 py-2"><p className="text-xs text-text-muted">{t('dash.crm.lastVisit', 'Last visit')}</p><p className="text-sm font-semibold">{profile.lastVisitDate ? new Date(profile.lastVisitDate).toLocaleDateString() : '—'}</p></div>
              <div className="card bg-surface-sunken px-3 py-2"><p className="text-xs text-text-muted">{t('dash.crm.vouchersUsed', 'Vouchers')}</p><p className="text-lg font-bold">{profile.voucherUsage.totalRedeemed}</p></div>
            </div>

            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold">{t('dash.crm.memberships', 'Memberships')}</h4>
                {isMember && <a href="/dashboard/memberships?tab=members" className="text-xs text-primary-600 hover:underline">{t('dash.crm.manageInMembers', 'Manage in Members →')}</a>}
              </div>
              {profile.memberships.length === 0 ? (
                <p className="text-sm text-text-muted">{t('dash.crm.noMemberships', 'Not a member.')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {profile.memberships.map((m) => (
                    <li key={m.id} className="flex items-center justify-between text-sm border border-border rounded-lg px-3 py-2">
                      <div><span className="font-medium">{m.planName}</span><span className="text-xs text-text-muted"> · {m.startDate} → {m.endDate}</span></div>
                      <div className="flex items-center gap-2"><span className="text-xs text-text-muted">{m.usesCount}/{m.maxUses}</span><span className={`badge capitalize text-xs ${MS_BADGE[m.status] ?? 'bg-surface-sunken text-text-secondary'}`}>{m.status}</span></div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {profile.servicePreferences.length > 0 && (
              <div className="mb-5">
                <h4 className="text-sm font-semibold mb-2">{t('dash.crm.topServices', 'Top services')}</h4>
                <div className="flex flex-wrap gap-1">
                  {profile.servicePreferences.slice(0, 6).map((s) => (
                    <span key={s.serviceId} className="badge bg-surface-sunken text-text-secondary text-xs">{s.serviceName} ×{s.timesUsed}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-2">
              <h4 className="text-sm font-semibold mb-2">{t('dash.crm.recentVisits', 'Recent visits')}</h4>
              {profile.recentVisits.length === 0 ? (
                <p className="text-sm text-text-muted">{t('dash.crm.noVisits', 'No visits yet.')}</p>
              ) : (
                <ul className="space-y-1 max-h-52 overflow-auto">
                  {profile.recentVisits.map((v) => (
                    <li key={v.orderId} className="flex items-center justify-between text-sm border-b border-border py-1.5">
                      <div className="min-w-0">
                        <span className="text-xs text-text-muted">{new Date(v.date).toLocaleDateString()} · {v.outletName}</span>
                        {v.services.length > 0 && <p className="text-xs text-text-secondary truncate">{v.services.join(', ')}</p>}
                      </div>
                      <span className="font-medium shrink-0 ml-3">{fmtRp(v.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        <div className="flex gap-2 justify-end mt-4">
          <button className="btn-secondary" onClick={onEdit}>{t('dash.crm.edit', 'Edit')}</button>
          <button className="btn-secondary" onClick={onClose}>{t('dash.crm.close', 'Close')}</button>
        </div>
      </div>
    </div>
  );
}

function EditCustomer({ customer, onSave, onClose }: { customer: Customer; onSave: (p: { name: string; phone: string }) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone);
  return (
    <>
      <div className="space-y-3">
        <div><label className="block text-sm font-medium mb-1.5">{t('dash.crm.name', 'Name')}</label><input aria-label={t('dash.crm.name', 'Name')} className="input-field" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="block text-sm font-medium mb-1.5">{t('dash.crm.phone', 'Phone')}</label><input aria-label={t('dash.crm.phone', 'Phone')} className="input-field" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
      </div>
      <div className="flex gap-2 justify-end mt-4">
        <button className="btn-secondary" onClick={onClose}>{t('dash.crm.cancel', 'Cancel')}</button>
        <button className="btn-primary" onClick={() => onSave({ name, phone })}>{t('dash.crm.save', 'Save')}</button>
      </div>
    </>
  );
}
