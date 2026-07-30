'use client';

/**
 * POS pack catalog — membership plans and voucher packs, sold from the SAME
 * screen as an ordinary wash (Samuel 2026-07-30: "supaya jadinya ga ada halaman
 * jual paket, semua di satu halaman aja").
 *
 * This is a picker only. The selected pack becomes a line on the current order,
 * so one payment settles the wash and the plan together — see
 * CreateOrderRequest.membershipPlanId.
 */

import { useI18n } from '@/lib/i18n';

export interface MembershipPlanDTO {
  id: string;
  name: string;
  price: number;
  durationMonths: number;
  maxUses: number;
  dailyLimit: number;
  maxPlates: number;
}

export interface VoucherTemplateDTO {
  id: string;
  name: string;
  type: 'fixed' | 'percentage' | 'service_pack';
  value: number;
  maxUses: number;
  salePrice: number;
  validityDays: number | null;
}

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

export function voucherSummary(tpl: VoucherTemplateDTO, tr: (key: string, fallback?: string) => string): string {
  const benefit =
    tpl.type === 'fixed'
      ? `${fmt(tpl.value)} ${tr('pos.sellpack.off', 'off')}`
      : tpl.type === 'percentage'
        ? `${tpl.value}% ${tr('pos.sellpack.off', 'off')}`
        : tr('pos.sellpack.prepaidService', 'prepaid service');
  const validity = tpl.validityDays ? ` · ${tr('pos.sellpack.valid', 'valid')} ${tpl.validityDays} ${tr('pos.sellpack.days', 'days')}` : '';
  return `${tpl.maxUses} ${tr('pos.sellpack.codes', 'codes')} · ${benefit}${validity}`;
}

export function PackCatalog({
  plans, templates, selectedPlanId, selectedTemplateId, onPickPlan, onPickTemplate,
}: {
  plans: MembershipPlanDTO[];
  templates: VoucherTemplateDTO[];
  selectedPlanId: string | null;
  selectedTemplateId: string | null;
  /** Called with null when the already-selected pack is tapped again (deselect). */
  onPickPlan: (plan: MembershipPlanDTO | null) => void;
  onPickTemplate: (tpl: VoucherTemplateDTO | null) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="space-y-5" data-testid="pack-catalog">
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-1">{t('pos.sellpack.membershipPlans', 'Membership Plans')}</h3>
        <p className="text-xs text-text-muted mb-3">
          {t('pos.new.packUpsellHint', 'Sold together with a wash, the wash on this order is free — the plan still shows as an upsell in the reports.')}
        </p>
        {plans.length === 0 ? (
          <div className="card text-sm text-text-muted">{t('pos.sellpack.noPlans', 'No membership plans yet. Create them in the dashboard.')}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {plans.map((plan) => {
              const isSel = selectedPlanId === plan.id;
              return (
                <button
                  key={plan.id}
                  onClick={() => onPickPlan(isSel ? null : plan)}
                  aria-pressed={isSel}
                  data-testid={`pack-plan-${plan.id}`}
                  className={`card text-left transition-all active:scale-[0.99] ${isSel ? 'border-primary-400 ring-2 ring-primary-100' : 'hover:border-primary-300 hover:shadow-md'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-text-primary">{plan.name}</p>
                    <span className="text-primary-600 font-semibold whitespace-nowrap">{fmt(plan.price)}</span>
                  </div>
                  <div className="mt-2 text-sm text-text-secondary space-y-0.5">
                    <p>{plan.durationMonths} {plan.durationMonths > 1 ? t('pos.sellpack.months', 'months') : t('pos.sellpack.month', 'month')} · {plan.maxUses} {t('pos.sellpack.washes', 'washes')} · {plan.dailyLimit}{t('pos.sellpack.perDay', '/day')}</p>
                    <p>{t('pos.sellpack.upTo', 'Up to')} {plan.maxPlates} {plan.maxPlates > 1 ? t('pos.sellpack.plates', 'plates') : t('pos.sellpack.plate', 'plate')}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-3">{t('pos.sellpack.voucherPacks', 'Voucher Packs')}</h3>
        {templates.length === 0 ? (
          <div className="card text-sm text-text-muted">{t('pos.sellpack.noVoucherPacks', 'No voucher packs configured. Create voucher templates in the dashboard.')}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {templates.map((tpl) => {
              const isSel = selectedTemplateId === tpl.id;
              return (
                <button
                  key={tpl.id}
                  onClick={() => onPickTemplate(isSel ? null : tpl)}
                  aria-pressed={isSel}
                  data-testid={`pack-voucher-${tpl.id}`}
                  className={`card text-left transition-all active:scale-[0.99] ${isSel ? 'border-primary-400 ring-2 ring-primary-100' : 'hover:border-primary-300 hover:shadow-md'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-text-primary">{tpl.name}</p>
                    <span className="text-primary-600 font-semibold whitespace-nowrap">{fmt(tpl.salePrice)}</span>
                  </div>
                  <p className="mt-2 text-sm text-text-secondary">{voucherSummary(tpl, t)}</p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
