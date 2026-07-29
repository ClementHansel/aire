'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { getUser } from '@/lib/auth';
import {
  type PlateRow,
  emptyPlateRow,
  prefillPlateRow,
  validatePlateRows,
  canAddPlateRow,
} from '@/lib/membership-plates';
import type { MemberLookupResponse } from '@aire/shared/interfaces/member';
import { MembershipCard, buildCardHtml, computeCardCode, type CardTemplate } from './MembershipCard';
import { PlateInput } from '@/components/shared/PlateInput';

interface Membership {
  id: string; customerName: string; customerPhone: string; planName: string;
  displayStatus: 'active' | 'grace' | 'revoked' | 'suspended' | 'expired' | 'pending' | 'cancelled';
  startDate: string; endDate: string; usesCount: number; maxUses: number; suspendedReason: string | null;
  membershipNumber: string | null;
}
interface MembershipEvent { id: string; eventType: string; payload: Record<string, unknown> | null; actor: string | null; createdAt: string }

const MS_BADGE: Record<string, string> = {
  active: 'bg-green-50 text-green-700', grace: 'bg-orange-50 text-orange-700', revoked: 'bg-rose-50 text-rose-700',
  suspended: 'bg-amber-50 text-amber-700', expired: 'bg-gray-100 text-gray-500', pending: 'bg-blue-50 text-blue-700', cancelled: 'bg-red-50 text-red-700',
};
const MS_FILTERS = ['all', 'active', 'grace', 'revoked', 'suspended', 'expired'];
const mmYY = (d: string) => { const [y, m] = (d ?? '').split('-'); return y && m ? `${m}/${y.slice(2)}` : ''; };

/**
 * Members list — every membership sold, manageable. Click a row to open the
 * member's detail (card + info + history + renew/suspend actions). Reuses the
 * `/memberships/manage` endpoint (same data as the CRM members table).
 */
export function MembersPanel() {
  const { t } = useI18n();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailOf, setDetailOf] = useState<Membership | null>(null);
  const [renewFor, setRenewFor] = useState<Membership | null>(null);
  const [cardTemplate, setCardTemplate] = useState<CardTemplate | null>(null);
  const [plans, setPlans] = useState<{ id: string; name: string; price: number }[]>([]);
  const canManage = ['outlet_admin', 'tenant_owner', 'platform_super_admin'].includes(getUser()?.role ?? '');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setMemberships(await api.get<Membership[]>(`/memberships/manage${filter !== 'all' ? `?status=${filter}` : ''}`)); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.members.errLoad', 'Failed to load members')); }
    finally { setLoading(false); }
  }, [filter, t]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<CardTemplate>('/membership-card').then(setCardTemplate).catch(() => {}); }, []);
  useEffect(() => { api.get<{ id: string; name: string; price: number }[]>('/membership-plans').then(setPlans).catch(() => {}); }, []);

  // Keep the open detail row in sync after an action mutates the list.
  const syncDetail = (list: Membership[]) => {
    if (detailOf) { const fresh = list.find((m) => m.id === detailOf.id); if (fresh) setDetailOf(fresh); }
  };
  const reload = async () => {
    try {
      const list = await api.get<Membership[]>(`/memberships/manage${filter !== 'all' ? `?status=${filter}` : ''}`);
      setMemberships(list); syncDetail(list);
    } catch { /* keep prior */ }
  };

  const filtered = memberships.filter((m) => {
    const q = search.trim().toLowerCase();
    return !q || m.customerName.toLowerCase().includes(q) || (m.customerPhone ?? '').toLowerCase().includes(q) || (m.membershipNumber ?? '').toLowerCase().includes(q);
  });

  return (
    <div>
      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="flex gap-1 flex-wrap">
          {MS_FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`badge capitalize ${filter === f ? 'bg-primary-500 text-white' : 'bg-surface-sunken text-text-secondary'}`}>{t(`dash.members.filter.${f}`, f)}</button>
          ))}
        </div>
        <input className="input-field max-w-xs py-1 text-sm" placeholder={t('dash.members.search', 'Search name, phone, or number…')} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="card p-0 overflow-hidden overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b border-border bg-surface-sunken/50">
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.members.member', 'Member')}</th>
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.members.plan', 'Plan')}</th>
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.members.period', 'Period')}</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.members.uses', 'Uses')}</th>
            <th className="text-center px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.members.status', 'Status')}</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr><td colSpan={5} className="px-5 py-6 text-sm text-text-muted text-center">{t('dash.members.loading', 'Loading…')}</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-6 text-sm text-text-muted text-center">{t('dash.members.none', 'No members.')}</td></tr>
            ) : filtered.map((m) => (
              <tr key={m.id} className="cursor-pointer hover:bg-surface-sunken/40" onClick={() => setDetailOf(m)}>
                <td className="px-5 py-3 text-sm font-medium">{m.customerName}<div className="text-xs text-text-muted">{m.customerPhone}</div>{m.membershipNumber && <div className="text-[11px] font-mono text-text-muted">#{m.membershipNumber}</div>}</td>
                <td className="px-5 py-3 text-sm text-text-secondary">{m.planName}</td>
                <td className="px-5 py-3 text-xs text-text-muted">{m.startDate} → {m.endDate}</td>
                <td className="px-5 py-3 text-sm text-right">{m.usesCount}/{m.maxUses}</td>
                <td className="px-5 py-3 text-center"><span className={`badge capitalize ${MS_BADGE[m.displayStatus]}`}>{m.displayStatus}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detailOf && (
        <MemberDetailModal
          member={detailOf}
          cardTemplate={cardTemplate}
          canManage={canManage}
          onClose={() => setDetailOf(null)}
          onRenew={() => setRenewFor(detailOf)}
          onChanged={reload}
        />
      )}

      {renewFor && (
        <RenewModal
          membership={renewFor}
          plans={plans}
          onClose={() => setRenewFor(null)}
          onDone={() => { setRenewFor(null); reload(); }}
        />
      )}
    </div>
  );
}

function MemberDetailModal({ member, cardTemplate, canManage, onClose, onRenew, onChanged }: {
  member: Membership;
  cardTemplate: CardTemplate | null;
  canManage: boolean;
  onClose: () => void;
  onRenew: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [events, setEvents] = useState<MembershipEvent[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Registered plates — the list endpoint (/memberships/manage) doesn't carry
  // plates or the plan's maxPlates, so this modal re-resolves them via the same
  // member-lookup endpoint the POS uses (GET /members/lookup), then picks out
  // this one membership by id (AIRIN-103).
  const [lookup, setLookup] = useState<MemberLookupResponse | null>(null);
  const [lookupLoading, setLookupLoading] = useState(true);
  const [editingPlates, setEditingPlates] = useState(false);
  const [plateRows, setPlateRows] = useState<PlateRow[]>([emptyPlateRow()]);
  const [plateError, setPlateError] = useState('');
  const [platesSaving, setPlatesSaving] = useState(false);

  useEffect(() => {
    setEvents(null);
    api.get<MembershipEvent[]>(`/memberships/${member.id}/events`).then(setEvents).catch(() => setEvents([]));
  }, [member.id]);

  const loadLookup = useCallback(async () => {
    setLookupLoading(true);
    try {
      // Prefer the membership number when issued — it's unambiguous — falling
      // back to phone (a pending/newly-sold membership may not have one yet).
      const q = member.membershipNumber
        ? `number=${encodeURIComponent(member.membershipNumber)}`
        : `phone=${encodeURIComponent(member.customerPhone)}`;
      setLookup(await api.get<MemberLookupResponse>(`/members/lookup?${q}`));
    } catch {
      setLookup(null);
    } finally {
      setLookupLoading(false);
    }
  }, [member.membershipNumber, member.customerPhone]);

  useEffect(() => { loadLookup(); }, [loadLookup]);

  const plateDetail = lookup?.memberships.find((m) => m.id === member.id) ?? null;

  const startEditPlates = () => {
    setPlateError('');
    setPlateRows(
      plateDetail && plateDetail.plates.length > 0
        ? plateDetail.plates.map((p) => prefillPlateRow(p.plate, p.brand, p.model))
        : [emptyPlateRow()],
    );
    setEditingPlates(true);
  };
  const cancelEditPlates = () => { setEditingPlates(false); setPlateError(''); };
  const updatePlateRow = (i: number, field: keyof PlateRow, value: string) =>
    setPlateRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  const addPlateRow = () => {
    if (canAddPlateRow(plateRows.length, plateDetail?.maxPlates)) setPlateRows((prev) => [...prev, emptyPlateRow()]);
  };
  const removePlateRow = (i: number) => setPlateRows((prev) => prev.filter((_, idx) => idx !== i));

  const savePlates = async () => {
    const validation = validatePlateRows(plateRows, t('dash.members.registerAtLeastOnePlate', 'Register at least one plate.'));
    if (!validation.ok) { setPlateError(validation.error); return; }
    setPlatesSaving(true); setPlateError('');
    try {
      await api.put(`/memberships/${member.id}/plates`, {
        plates: validation.plates.map((p) => ({ plate: p.plate, brand: p.brand || undefined, model: p.model || undefined })),
      });
      setEditingPlates(false);
      await loadLookup();
      onChanged();
    } catch (e) {
      // Surface the server's max-plates error as-is rather than duplicating that
      // rule client-side — the UI only pre-limits how many rows can be added.
      setPlateError(e instanceof Error ? e.message : t('dash.members.savePlatesFailed', 'Failed to save plates'));
    } finally {
      setPlatesSaving(false);
    }
  };

  const printCard = async () => {
    if (!cardTemplate || !member.membershipNumber) return;
    const code = await computeCardCode(cardTemplate.idType, member.membershipNumber);
    const html = buildCardHtml(cardTemplate, { name: member.customerName, number: member.membershipNumber, validUntil: mmYY(member.endDate) }, code);
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  };
  const suspend = async () => {
    const reason = window.prompt(`${t('dash.members.suspendPrompt', 'Suspend this membership? Enter a reason (rule breach):')}`, '');
    if (reason === null) return;
    setBusy(true); setErr('');
    try { await api.patch(`/memberships/${member.id}/suspend`, { reason }); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : t('dash.members.errSuspend', 'Suspend failed')); }
    finally { setBusy(false); }
  };
  const reactivate = async () => {
    setBusy(true); setErr('');
    try { await api.patch(`/memberships/${member.id}/reactivate`, {}); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : t('dash.members.errReactivate', 'Reactivate failed')); }
    finally { setBusy(false); }
  };

  const canRenew = canManage && ['active', 'grace', 'revoked', 'expired'].includes(member.displayStatus);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-text-primary">{member.customerName}</h3>
            <p className="text-sm text-text-muted">{member.customerPhone}{member.membershipNumber && <span className="font-mono"> · #{member.membershipNumber}</span>}</p>
          </div>
          <span className={`badge capitalize ${MS_BADGE[member.displayStatus]}`}>{member.displayStatus}</span>
        </div>

        {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-sm text-red-700 mb-3">{err}</div>}

        <div className="flex flex-wrap gap-6">
          <div className="shrink-0">
            {cardTemplate && member.membershipNumber ? (
              <MembershipCard template={cardTemplate} data={{ name: member.customerName, number: member.membershipNumber, validUntil: mmYY(member.endDate) }} scale={0.5} />
            ) : (
              <div className="w-[340px] h-[210px] rounded-xl border border-dashed border-border flex items-center justify-center text-xs text-text-muted text-center px-4">
                {member.membershipNumber ? t('dash.members.noCardTemplate', 'No card design yet — set one up in the Cards tab.') : t('dash.members.noNumberYet', 'No membership number issued yet.')}
              </div>
            )}
          </div>

          <div className="flex-1 min-w-[220px] space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-text-secondary">{t('dash.members.plan', 'Plan')}</span><span className="font-medium">{member.planName}</span></div>
            <div className="flex justify-between"><span className="text-text-secondary">{t('dash.members.period', 'Period')}</span><span className="font-medium">{member.startDate} → {member.endDate}</span></div>
            <div className="flex justify-between"><span className="text-text-secondary">{t('dash.members.uses', 'Uses')}</span><span className="font-medium">{member.usesCount}/{member.maxUses}</span></div>
            {member.displayStatus === 'suspended' && member.suspendedReason && (
              <div className="flex justify-between"><span className="text-text-secondary">{t('dash.members.reason', 'Reason')}</span><span className="font-medium text-amber-700">{member.suspendedReason}</span></div>
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              {member.membershipNumber && cardTemplate && <button className="btn-secondary text-xs" disabled={busy} onClick={printCard}>{t('dash.members.printCard', 'Print card')}</button>}
              {canRenew && <button className="btn-primary text-xs" disabled={busy} onClick={onRenew}>{t('dash.members.renew', 'Renew')}</button>}
              {canManage && member.displayStatus === 'active' && <button className="btn-secondary text-xs" disabled={busy} onClick={suspend}>{t('dash.members.suspend', 'Suspend')}</button>}
              {canManage && member.displayStatus === 'suspended' && <button className="btn-secondary text-xs" disabled={busy} onClick={reactivate}>{t('dash.members.reactivate', 'Reactivate')}</button>}
            </div>
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-border" data-testid="member-plates-section">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold">{t('dash.members.plates', 'Registered plates')}</h4>
            {canManage && !editingPlates && !lookupLoading && plateDetail && (
              <button className="btn-secondary text-xs" onClick={startEditPlates}>{t('dash.members.editPlates', 'Edit plates')}</button>
            )}
          </div>

          {lookupLoading ? (
            <p className="text-sm text-text-muted">{t('dash.members.loading', 'Loading…')}</p>
          ) : !plateDetail ? (
            <p className="text-sm text-text-muted">{t('dash.members.platesUnavailable', 'Plate info unavailable.')}</p>
          ) : editingPlates ? (
            <div className="space-y-2">
              {plateRows.map((r, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <div className="flex-1 grid grid-cols-3 gap-2">
                    <PlateInput
                      className={`input-field ${i === 0 && plateError ? 'border-red-400 focus:ring-red-300' : ''}`}
                      placeholder={t('dash.members.plateReq', 'Plate *')}
                      value={r.plate}
                      onChange={(v) => updatePlateRow(i, 'plate', v)}
                      testId={`member-edit-plate-input-${i}`}
                    />
                    <input className="input-field" placeholder={t('dash.members.brand', 'Brand')} value={r.brand} onChange={(e) => updatePlateRow(i, 'brand', e.target.value)} />
                    <input className="input-field" placeholder={t('dash.members.model', 'Model')} value={r.model} onChange={(e) => updatePlateRow(i, 'model', e.target.value)} />
                  </div>
                  {plateRows.length > 1 && <button onClick={() => removePlateRow(i)} className="w-9 h-9 rounded bg-surface-sunken text-text-secondary shrink-0">✕</button>}
                </div>
              ))}
              {plateError && <p className="text-sm text-red-600">{plateError}</p>}
              {canAddPlateRow(plateRows.length, plateDetail.maxPlates) && (
                <button onClick={addPlateRow} className="btn-ghost text-sm">+ {t('dash.members.addPlate', 'Add license plate')}</button>
              )}
              <div className="flex gap-2 justify-end pt-1">
                <button className="btn-secondary" onClick={cancelEditPlates} disabled={platesSaving}>{t('dash.members.cancel', 'Cancel')}</button>
                <button className="btn-primary" onClick={savePlates} disabled={platesSaving}>{platesSaving ? t('dash.members.saving', 'Saving…') : t('dash.members.savePlates', 'Save plates')}</button>
              </div>
            </div>
          ) : plateDetail.plates.length === 0 ? (
            <p className="text-sm text-text-muted">{t('dash.members.noPlates', 'No plates registered.')}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {plateDetail.plates.map((p) => (
                <span key={p.plate} className="badge bg-surface-sunken text-text-secondary" data-testid={`member-detail-plate-${p.plate}`}>
                  {p.plate}{p.brand && ` (${p.brand}${p.model ? ` ${p.model}` : ''})`}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="mt-5 pt-4 border-t border-border">
          <h4 className="text-sm font-semibold mb-2">{t('dash.members.history', 'History')}</h4>
          {events === null ? (
            <p className="text-sm text-text-muted">{t('dash.members.loading', 'Loading…')}</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-text-muted">{t('dash.members.noEvents', 'No events recorded yet.')}</p>
          ) : (
            <ul className="space-y-2 max-h-56 overflow-auto">
              {events.map((ev) => (
                <li key={ev.id} className="flex items-start gap-3 text-sm">
                  <span className="badge bg-surface-sunken text-text-secondary capitalize shrink-0">{ev.eventType.replace(/_/g, ' ')}</span>
                  <div className="min-w-0">
                    <p className="text-xs text-text-muted">{new Date(ev.createdAt).toLocaleString()}</p>
                    {ev.payload && Object.keys(ev.payload).length > 0 && (
                      <p className="text-xs text-text-secondary truncate">{Object.entries(ev.payload).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end mt-4"><button className="btn-secondary" onClick={onClose}>{t('dash.members.close', 'Close')}</button></div>
      </div>
    </div>
  );
}

function RenewModal({ membership, plans, onClose, onDone }: {
  membership: { id: string; customerName: string; planName: string };
  plans: { id: string; name: string; price: number }[];
  onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const [planId, setPlanId] = useState(plans[0]?.id ?? '');
  const [method, setMethod] = useState<'cash' | 'edc' | 'transfer'>('cash');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const plan = plans.find((p) => p.id === planId);
  useEffect(() => { if (plan) setAmount(String(plan.price)); }, [plan]);
  const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
  const doRenew = async () => {
    if (!planId) { setErr(t('dash.members.pickPlan', 'Pick a plan')); return; }
    setBusy(true); setErr('');
    try {
      const r = await api.post<{ order: { id: string } }>(`/memberships/${membership.id}/renew`, { planId });
      await api.post(`/orders/${r.order.id}/pay`, { method, amountReceived: method === 'cash' ? Number(amount) : undefined });
      await api.post('/memberships/apply-renewal', { orderId: r.order.id });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : t('dash.members.errRenewal', 'Renewal failed')); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-1">{t('dash.members.renewMembership', 'Renew membership')}</h3>
        <p className="text-xs text-text-muted mb-3">{membership.customerName} · {t('dash.members.currently', 'currently')} {membership.planName}</p>
        {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-sm text-red-700 mb-3">{err}</div>}
        <label className="block text-sm font-medium mb-1">{t('dash.members.plan', 'Plan')}</label>
        <select className="input-field mb-3" value={planId} onChange={(e) => setPlanId(e.target.value)}>
          {plans.length === 0 && <option value="">{t('dash.members.noPlans', 'No plans')}</option>}
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmt(p.price)}</option>)}
        </select>
        <label className="block text-sm font-medium mb-1">{t('dash.members.payment', 'Payment')}</label>
        <select className="input-field mb-3" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
          <option value="cash">{t('dash.members.cash', 'Cash')}</option><option value="edc">{t('dash.members.edcDebit', 'EDC / Debit')}</option><option value="transfer">{t('dash.members.transfer', 'Transfer')}</option>
        </select>
        {method === 'cash' && (
          <div className="mb-3">
            <label className="block text-sm font-medium mb-1">{t('dash.members.amountReceived', 'Amount received')}</label>
            <input type="number" className="input-field" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button className="btn-secondary" onClick={onClose}>{t('dash.members.cancel', 'Cancel')}</button>
          <button className="btn-primary" onClick={doRenew} disabled={busy || !planId}>{busy ? t('dash.members.renewing', 'Renewing…') : t('dash.members.renewCollect', 'Renew & collect')}</button>
        </div>
      </div>
    </div>
  );
}
