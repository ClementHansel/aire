'use client';

/**
 * MemberManagementPanel — POS membership CRUD surface.
 *
 * Given a member lookup result, lets the cashier:
 *  - READ: see each membership's plan, expiry, uses left, and registered plates.
 *  - UPDATE: add / edit / remove registered plates (up to the plan's max_plates)
 *    via PUT /api/memberships/:id/plates — the same add-row/remove-row/first-row-
 *    required pattern as the Sell Pack activation step.
 *  - CANCEL: cancel a membership via PATCH /api/memberships/:id/cancel, behind
 *    a confirm dialog.
 *
 * CREATE is the Sell Pack flow (linked to from here for a member with none).
 * Everything is scoped server-side to the cashier's tenant.
 */

import { useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { PlateInput } from '@/components/shared/PlateInput';
import {
  type PlateRow,
  emptyPlateRow,
  prefillPlateRow,
  validatePlateRows,
  canAddPlateRow,
} from '@/lib/membership-plates';
import type { MemberLookupResponse, MembershipDetail } from '@aire/shared/interfaces/member';

export interface MemberManagementPanelProps {
  member: MemberLookupResponse;
  /** Called after any successful mutation so the caller can re-fetch the member. */
  onChanged: () => void;
  /**
   * Brand → type catalog. Registering a plate must go through a real brand, not
   * free text: the brand decides which types are offered, and it is what voucher
   * brand-scoping and the vehicle reports key off, so "Toyoya" typed once
   * silently creates a car nothing can match (AIRIN-153). Optional so a caller
   * without the catalog still renders (the field falls back to free text).
   */
  vehicleBrands?: { id: string; name: string; types: { id: string; name: string }[] }[];
}

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-green-50 text-green-700',
  grace: 'bg-amber-50 text-amber-700',
  suspended: 'bg-orange-50 text-orange-700',
  revoked: 'bg-red-50 text-red-700',
  expired: 'bg-red-50 text-red-700',
  pending: 'bg-sky-50 text-sky-700',
  cancelled: 'bg-surface-sunken text-text-muted',
};

export function MemberManagementPanel({ member, onChanged, vehicleBrands = [] }: MemberManagementPanelProps) {
  const { t } = useI18n();

  // Plate editor — one membership editable at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRows, setEditRows] = useState<PlateRow[]>([emptyPlateRow()]);
  const [editError, setEditError] = useState('');
  const [saving, setSaving] = useState(false);

  // Cancel confirm — one membership at a time.
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');

  const startEdit = (m: MembershipDetail) => {
    setEditingId(m.id);
    setEditError('');
    setEditRows(
      m.plates.length > 0
        ? m.plates.map((p) => prefillPlateRow(p.plate, p.brand, p.model))
        : [emptyPlateRow()],
    );
  };
  const cancelEdit = () => { setEditingId(null); setEditRows([emptyPlateRow()]); setEditError(''); };

  const updateRow = (i: number, field: keyof PlateRow, value: string) =>
    setEditRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  const addRow = (maxPlates: number | undefined) => {
    if (canAddPlateRow(editRows.length, maxPlates)) setEditRows((prev) => [...prev, emptyPlateRow()]);
  };
  const removeRow = (i: number) => setEditRows((prev) => prev.filter((_, idx) => idx !== i));

  const savePlates = async () => {
    if (!editingId) return;
    const validation = validatePlateRows(editRows, t('pos.member.registerAtLeastOnePlate', 'Register at least one plate.'));
    if (!validation.ok) { setEditError(validation.error); return; }
    // Every plate carries a brand once there is a catalog to pick one from — a
    // brandless member car is invisible to brand-scoped vouchers and to the
    // vehicle reports (AIRIN-153).
    if (vehicleBrands.length > 0 && validation.plates.some((p) => !p.brand.trim())) {
      setEditError(t('pos.member.brandRequired', 'Pick a brand for every plate.'));
      return;
    }
    setSaving(true); setEditError('');
    try {
      await api.put(`/memberships/${editingId}/plates`, {
        plates: validation.plates.map((p) => ({ plate: p.plate, brand: p.brand || undefined, model: p.model || undefined })),
      });
      cancelEdit();
      onChanged();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : t('pos.member.savePlatesFailed', 'Failed to save plates'));
    } finally {
      setSaving(false);
    }
  };

  const confirmCancel = async () => {
    if (!cancelId) return;
    setCancelling(true); setCancelError('');
    try {
      await api.patch(`/memberships/${cancelId}/cancel`, { reason: cancelReason.trim() || undefined });
      setCancelId(null);
      setCancelReason('');
      onChanged();
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : t('pos.member.cancelFailed', 'Failed to cancel membership'));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="card mb-3" data-testid="member-management-panel">
      <h3 className="text-sm font-semibold text-text-primary mb-2">{t('pos.member.manageMembership', 'Manage membership')}</h3>
      <div className="space-y-3">
        {member.memberships.map((m) => {
          const cancellable = m.status !== 'cancelled' && m.status !== 'pending';
          return (
            <div key={m.id} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-text-primary text-sm">{m.planName}</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {t('pos.member.expires', 'Expires')} {m.endDate} · {m.usesCount}/{m.maxUses} {t('pos.member.uses', 'uses')} · {m.dailyLimit}{t('pos.sellpack.perDay', '/day')}
                  </p>
                </div>
                <span className={`badge capitalize ${STATUS_STYLE[m.status] ?? ''}`} data-testid={`member-status-${m.id}`}>{m.status}</span>
              </div>

              {editingId === m.id ? (
                <div className="mt-3 space-y-2">
                  {editRows.map((r, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <div className="flex-1 grid grid-cols-3 gap-2">
                        <PlateInput
                          className={`input-field ${i === 0 && editError ? 'border-red-400 focus:ring-red-300' : ''}`}
                          placeholder={t('pos.sellpack.plateReq', 'Plate *')}
                          value={r.plate}
                          onChange={(v) => updateRow(i, 'plate', v)}
                          testId={`edit-plate-input-${i}`}
                        />
                        {/* Brand is CHOSEN, and the type list follows from it —
                            adding a plate without picking a brand is what left
                            member cars unmatchable (AIRIN-153). */}
                        {vehicleBrands.length > 0 ? (
                          <select
                            className="input-field"
                            aria-label={t('pos.sellpack.brand', 'Brand')}
                            value={r.brand}
                            onChange={(e) => {
                              updateRow(i, 'brand', e.target.value);
                              // The old type belongs to the old brand; keeping it
                              // would pair a Honda with an Avanza.
                              updateRow(i, 'model', '');
                            }}
                          >
                            <option value="">{t('pos.sellpack.pickBrand', 'Select brand…')}</option>
                            {vehicleBrands.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
                          </select>
                        ) : (
                          <input className="input-field" placeholder={t('pos.sellpack.brand', 'Brand')} value={r.brand} onChange={(e) => updateRow(i, 'brand', e.target.value)} />
                        )}
                        <input
                          className="input-field"
                          placeholder={t('pos.sellpack.model', 'Model')}
                          list={`mm-types-${i}`}
                          value={r.model}
                          onChange={(e) => updateRow(i, 'model', e.target.value)}
                        />
                        <datalist id={`mm-types-${i}`}>
                          {(vehicleBrands.find((b) => b.name === r.brand)?.types ?? []).map((vt) => <option key={vt.id} value={vt.name} />)}
                        </datalist>
                      </div>
                      {editRows.length > 1 && <button onClick={() => removeRow(i)} className="w-9 h-9 rounded bg-surface-sunken text-text-secondary shrink-0">✕</button>}
                    </div>
                  ))}
                  {editError && <p className="text-sm text-red-600">{editError}</p>}
                  {canAddPlateRow(editRows.length, m.maxPlates) && (
                    <button onClick={() => addRow(m.maxPlates)} className="btn-ghost text-sm">+ {t('pos.sellpack.addPlate', 'Add license plate')}</button>
                  )}
                  <div className="flex gap-2 justify-end pt-1">
                    <button className="btn-secondary" onClick={cancelEdit} disabled={saving}>{t('pos.sellpack.cancel', 'Cancel')}</button>
                    <button className="btn-primary" onClick={savePlates} disabled={saving}>{saving ? t('pos.member.saving', 'Saving…') : t('pos.member.savePlates', 'Save plates')}</button>
                  </div>
                </div>
              ) : (
                <>
                  {m.plates.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {m.plates.map((p) => (
                        <span key={p.plate} className="badge bg-surface-sunken text-text-secondary" data-testid={`member-plate-${p.plate}`}>
                          {p.plate}{p.brand && ` (${p.brand}${p.model ? ` ${p.model}` : ''})`}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 justify-end mt-2">
                    <button className="btn-secondary text-sm" onClick={() => startEdit(m)}>{t('pos.member.editPlates', 'Edit plates')}</button>
                    {cancellable && (
                      <button className="btn-secondary text-sm text-red-600" onClick={() => { setCancelId(m.id); setCancelReason(''); setCancelError(''); }}>
                        {t('pos.member.cancelMembership', 'Cancel membership')}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Cancel confirm dialog */}
      {cancelId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="card w-full max-w-sm">
            <h3 className="section-title">{t('pos.member.cancelMembership', 'Cancel membership')}</h3>
            <p className="text-sm text-text-secondary mt-1">
              {t('pos.member.cancelWarning', 'This ends the membership and releases its registered plates. This cannot be undone.')}
            </p>
            <input
              className="input-field mt-3"
              placeholder={t('pos.member.reasonOptional', 'Reason (optional)')}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
            {cancelError && <p className="mt-2 text-sm text-red-600">{cancelError}</p>}
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn-secondary" onClick={() => setCancelId(null)} disabled={cancelling}>{t('pos.sellpack.cancel', 'Cancel')}</button>
              <button className="btn-primary bg-red-600 hover:bg-red-700" onClick={confirmCancel} disabled={cancelling}>
                {cancelling ? t('pos.member.cancelling', 'Cancelling…') : t('pos.member.confirmCancel', 'Confirm cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
