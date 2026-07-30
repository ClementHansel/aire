'use client';

/**
 * The two post-payment steps a pack sale needs, lifted out of the retired
 * /pos/*\/sell-pack page so the merged POS screen can host them unchanged:
 *
 * - PlateRegistrationModal: a paid membership is 'pending' until its plates are
 *   registered; this activates it. The first row pre-fills from the plate the
 *   cashier already typed on the order, so the usual upsell is one tap.
 * - VoucherCodesModal: shows the codes generated for a paid voucher pack. They
 *   are displayed once, hence the explicit warning.
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

export interface IssuedPack {
  parentCode: string;
  childCodes: string[];
  expiryDate: string | null;
  whatsappDelivered: boolean;
}

export function PlateRegistrationModal({
  membershipId, planName, maxPlates, prefill, vehicleBrands, onDone,
}: {
  membershipId: string;
  planName: string;
  maxPlates: number;
  prefill: { plate?: string; brand?: string; model?: string };
  vehicleBrands: { id: string; name: string; types: { id: string; name: string }[] }[];
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [plates, setPlates] = useState<PlateRow[]>([prefillPlateRow(prefill.plate, prefill.brand, prefill.model)]);
  const [plateError, setPlateError] = useState('');
  const [activating, setActivating] = useState(false);

  const update = (i: number, field: keyof PlateRow, value: string) => {
    setPlates((prev) => prev.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)));
    if (i === 0 && field === 'plate') setPlateError('');
  };

  const activate = async () => {
    const validation = validatePlateRows(plates, t('pos.sellpack.registerAtLeastOnePlate', 'Register at least one plate.'));
    if (!validation.ok) { setPlateError(validation.error); return; }
    setActivating(true);
    try {
      await api.post(`/memberships/${membershipId}/activate`, { plates: validation.plates });
      onDone();
    } catch (e) {
      setPlateError(e instanceof Error ? e.message : t('pos.sellpack.activationFailed', 'Activation failed'));
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-lg" data-testid="plate-registration-modal">
        <h3 className="section-title">{t('pos.sellpack.registerVehicles', 'Register Vehicles')}</h3>
        <p className="text-sm text-text-secondary mt-1">
          {planName} — {t('pos.sellpack.paymentReceivedRegister', 'Payment received. Register up to')} {maxPlates}{' '}
          {maxPlates > 1 ? t('pos.sellpack.plates', 'plates') : t('pos.sellpack.plate', 'plate')} {t('pos.sellpack.toActivate', 'to activate the membership.')}
        </p>
        <div className="mt-4 space-y-3 max-h-[50vh] overflow-auto">
          {plates.map((p, i) => (
            <div key={i} className="flex gap-2 items-start">
              <div className="flex-1 grid grid-cols-3 gap-2">
                <PlateInput
                  className={`input-field ${i === 0 && plateError ? 'border-red-400 focus:ring-red-300' : ''}`}
                  placeholder={t('pos.sellpack.plateReq', 'Plate *')}
                  value={p.plate}
                  onChange={(v) => update(i, 'plate', v)}
                  testId={`plate-input-${i}`}
                />
                <input className="input-field" placeholder={t('pos.new.vehicleBrand', 'Vehicle brand')} list={`veh-brands-activate-${i}`} value={p.brand} onChange={(e) => update(i, 'brand', e.target.value)} />
                <datalist id={`veh-brands-activate-${i}`}>{vehicleBrands.map((b) => <option key={b.id} value={b.name} />)}</datalist>
                <input className="input-field" placeholder={t('pos.new.vehicleType', 'Vehicle type')} list={`veh-types-activate-${i}`} value={p.model} onChange={(e) => update(i, 'model', e.target.value)} />
                <datalist id={`veh-types-activate-${i}`}>{(vehicleBrands.find((b) => b.name === p.brand)?.types ?? []).map((ty) => <option key={ty.id} value={ty.name} />)}</datalist>
              </div>
              {plates.length > 1 && (
                <button onClick={() => setPlates((prev) => prev.filter((_, idx) => idx !== i))} className="w-9 h-9 rounded bg-surface-sunken text-text-secondary shrink-0">✕</button>
              )}
            </div>
          ))}
        </div>
        {plateError && <p className="mt-2 text-sm text-red-600">{plateError}</p>}
        {canAddPlateRow(plates.length, maxPlates) && (
          <button onClick={() => setPlates((prev) => [...prev, emptyPlateRow()])} className="btn-ghost mt-3 text-sm">
            + {t('pos.sellpack.addPlate', 'Add license plate')}
          </button>
        )}
        <div className="flex justify-end mt-5">
          <button className="btn-primary" onClick={activate} disabled={activating}>
            {activating ? t('pos.sellpack.activating', 'Activating…') : t('pos.sellpack.saveActivate', 'Save & Activate')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function VoucherCodesModal({ issued, issuing, error, onClose }: {
  issued: IssuedPack | null;
  issuing: boolean;
  error: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-md" data-testid="voucher-codes-modal">
        {issuing && <p className="text-sm text-text-secondary">{t('pos.sellpack.generatingCodes', 'Generating voucher codes…')}</p>}
        {issued && (
          <>
            <div className="text-center">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3"><span className="text-2xl">✓</span></div>
              <h3 className="text-lg font-semibold text-text-primary">{t('pos.sellpack.voucherPackSold', 'Voucher Pack Sold')}</h3>
              <p className="text-sm text-text-secondary mt-1">
                {issued.whatsappDelivered
                  ? t('pos.sellpack.codesSent', 'Codes sent to the customer via WhatsApp.')
                  : t('pos.sellpack.codesPending', 'Codes generated. WhatsApp delivery pending — share them now.')}
              </p>
            </div>
            <div className="mt-4">
              <p className="text-xs text-text-muted mb-1">
                {t('pos.sellpack.packCode', 'Pack code:')} <span className="font-mono">{issued.parentCode}</span>
                {issued.expiryDate ? ` · ${t('pos.sellpack.expires', 'expires')} ${issued.expiryDate}` : ''}
              </p>
              <div className="rounded-lg border border-border bg-surface-sunken p-3 max-h-48 overflow-auto grid grid-cols-2 gap-1.5">
                {issued.childCodes.map((c) => <span key={c} className="font-mono text-sm text-text-primary">{c}</span>)}
              </div>
              <p className="mt-2 text-xs text-text-muted">{t('pos.sellpack.codesShownOnce', 'These codes are shown once. The customer can redeem them at checkout.')}</p>
            </div>
          </>
        )}
        {!issuing && !issued && <p className="text-sm text-red-600 text-center">{error || t('pos.sellpack.issuingCodes', 'Issuing voucher codes…')}</p>}
        <button className="btn-primary w-full mt-5" onClick={onClose}>{t('pos.sellpack.close', 'Close')}</button>
      </div>
    </div>
  );
}
