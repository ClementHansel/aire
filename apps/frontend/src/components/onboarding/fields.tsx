'use client';

import { BusinessUnit, ServiceCategory } from '@aire/shared';
import { Field } from '@/components/dashboard/ui';
import { useI18n } from '@/lib/i18n';

// ── Shared input shapes reused by the tenant wizard and admin create wizard ──

export interface LegalEntityInput { name: string; npwp: string; address: string; phone: string }
export const EMPTY_LEGAL: LegalEntityInput = { name: '', npwp: '', address: '', phone: '' };

export interface BranchInput { name: string; code: string; legalEntityId: string; address: string; phone: string; serviceChargePct: string; taxPct: string }
export const EMPTY_BRANCH: BranchInput = { name: '', code: '', legalEntityId: '', address: '', phone: '', serviceChargePct: '', taxPct: '' };

export interface ServiceInput { name: string; category: string; businessUnit: string; price: string }
export const EMPTY_SERVICE: ServiceInput = { name: '', category: ServiceCategory.CarWash, businessUnit: BusinessUnit.Aire, price: '' };

/** Company legal entity (PT) — name + tax details for invoices/receipts. */
export function LegalEntityFields({ value, onChange }: { value: LegalEntityInput; onChange: (v: LegalEntityInput) => void }) {
  const { t } = useI18n();
  const set = (patch: Partial<LegalEntityInput>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-4">
      <Field label={t('onboarding.legal.name', 'Company legal name (PT)')}>
        <input className="input-field" value={value.name} onChange={(e) => set({ name: e.target.value })} required placeholder={t('onboarding.legal.namePlaceholder', 'e.g. PT Cuci Bersih Sejahtera')} />
      </Field>
      <Field label={t('onboarding.legal.npwp', 'NPWP (tax ID)')}>
        <input className="input-field" value={value.npwp} onChange={(e) => set({ npwp: e.target.value })} placeholder="00.000.000.0-000.000" />
      </Field>
      <Field label={t('onboarding.legal.address', 'Registered address')}>
        <input className="input-field" value={value.address} onChange={(e) => set({ address: e.target.value })} placeholder="Jl. ..." />
      </Field>
      <Field label={t('onboarding.legal.phone', 'Phone')}>
        <input className="input-field" value={value.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="021..." />
      </Field>
    </div>
  );
}

/** First branch/outlet. `legalEntities` feeds the PT assignment select. */
export function BranchFields({ value, onChange, legalEntities }: { value: BranchInput; onChange: (v: BranchInput) => void; legalEntities: { id: string; name: string }[] }) {
  const { t } = useI18n();
  const set = (patch: Partial<BranchInput>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-4">
      <Field label={t('onboarding.branch.name', 'Branch name')}>
        <input className="input-field" value={value.name} onChange={(e) => set({ name: e.target.value })} required placeholder={t('onboarding.branch.namePlaceholder', 'e.g. Outlet Bintaro')} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('onboarding.branch.code', 'Branch code (3 letters)')}>
          <input className="input-field uppercase" maxLength={8} value={value.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder="BTR" />
        </Field>
        {legalEntities.length > 0 && (
          <Field label={t('onboarding.branch.legalEntity', 'Legal entity (PT)')}>
            <select className="input-field" value={value.legalEntityId} onChange={(e) => set({ legalEntityId: e.target.value })}>
              <option value="">{t('onboarding.branch.legalEntityNone', '— None —')}</option>
              {legalEntities.map((le) => <option key={le.id} value={le.id}>{le.name}</option>)}
            </select>
          </Field>
        )}
      </div>
      <Field label={t('onboarding.branch.address', 'Address')}>
        <input className="input-field" value={value.address} onChange={(e) => set({ address: e.target.value })} placeholder="Jl. ..." />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label={t('onboarding.branch.phone', 'Phone (WhatsApp)')}>
          <input className="input-field" value={value.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="08118005650" />
        </Field>
        <Field label={t('onboarding.branch.serviceCharge', 'Service charge %')}>
          <input className="input-field" type="number" min={0} value={value.serviceChargePct} onChange={(e) => set({ serviceChargePct: e.target.value })} placeholder="0" />
        </Field>
        <Field label={t('onboarding.branch.tax', 'Tax (PPN) %')}>
          <input className="input-field" type="number" min={0} value={value.taxPct} onChange={(e) => set({ taxPct: e.target.value })} placeholder="11" />
        </Field>
      </div>
    </div>
  );
}

/** A single starter service so the POS is usable immediately. */
export function ServiceFields({ value, onChange }: { value: ServiceInput; onChange: (v: ServiceInput) => void }) {
  const { t } = useI18n();
  const set = (patch: Partial<ServiceInput>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-4">
      <Field label={t('onboarding.service.name', 'Service name')}>
        <input className="input-field" value={value.name} onChange={(e) => set({ name: e.target.value })} required placeholder={t('onboarding.service.namePlaceholder', 'e.g. Cuci Mobil Reguler')} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label={t('onboarding.service.category', 'Category')}>
          <select className="input-field" value={value.category} onChange={(e) => set({ category: e.target.value })}>
            <option value={ServiceCategory.CarWash}>{t('onboarding.service.catWash', 'Car wash')}</option>
            <option value={ServiceCategory.Product}>{t('onboarding.service.catProduct', 'Product')}</option>
            <option value={ServiceCategory.AddOn}>{t('onboarding.service.catAddOn', 'Add-on')}</option>
          </select>
        </Field>
        <Field label={t('onboarding.service.unit', 'Business unit')}>
          <select className="input-field" value={value.businessUnit} onChange={(e) => set({ businessUnit: e.target.value })}>
            <option value={BusinessUnit.Aire}>{t('onboarding.service.unitAire', 'Car wash (AIRE)')}</option>
            <option value={BusinessUnit.Lead}>{t('onboarding.service.unitLead', 'Detailing (LEAD)')}</option>
          </select>
        </Field>
        <Field label={t('onboarding.service.price', 'Price (IDR)')}>
          <input className="input-field" type="number" min={0} value={value.price} onChange={(e) => set({ price: e.target.value })} required placeholder="50000" />
        </Field>
      </div>
    </div>
  );
}
