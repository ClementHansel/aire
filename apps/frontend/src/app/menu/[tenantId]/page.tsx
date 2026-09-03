'use client';

/**
 * Public customer-facing eMenu. No authentication — shareable via link/QR.
 * Fetches the tenant's active services (grouped by business unit + category)
 * and membership plans from the public kiosk endpoint.
 */

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { usePublicBranding } from '@/lib/publicBranding';
import { useResolveTenant } from '@/lib/resolveTenant';
import { AirinLogo } from '@/components/shared/AirinLogo';

interface MenuItem { id: string; name: string; category: string; businessUnit: string; price: number; isMainService: boolean }
interface Plan { name: string; durationMonths: number; price: number }
interface Menu { tenantName: string; services: MenuItem[]; products?: MenuItem[]; plans: Plan[] }

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

export default function PublicMenuPage() {
  const { t } = useI18n();
  const { id: tenantId, status } = useResolveTenant();
  const brand = usePublicBranding(tenantId ?? undefined);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const CATEGORY_LABEL: Record<string, string> = {
    car_wash: t('cust.menu.categoryServices', 'Services'),
    add_on: t('cust.menu.categoryAddOns', 'Add-ons'),
    product: t('cust.menu.categoryProducts', 'Products'),
  };
  const UNIT_LABEL: Record<string, string> = {
    AIRE: t('cust.menu.unitAire', 'AIRE · Car Wash'),
    LEAD: t('cust.menu.unitLead', 'LEAD · Detailing & Coating'),
  };

  useEffect(() => {
    if (!tenantId) return;
    const base = process.env.NEXT_PUBLIC_API_URL || '/api';
    fetch(`${base}/kiosk/menu?tenantId=${encodeURIComponent(tenantId)}`)
      .then((r) => { if (!r.ok) throw new Error(t('cust.menu.errorNotAvailable', 'Menu not available')); return r.json(); })
      .then(setMenu)
      .catch((e) => setError(e instanceof Error ? e.message : t('cust.menu.errorFailed', 'Failed to load menu')))
      .finally(() => setLoading(false));
  }, [tenantId, t]);

  if (status === 'notfound') return <div className="min-h-screen bg-surface flex items-center justify-center text-text-muted">{t('cust.menu.notFound', 'Menu not found.')}</div>;
  if (status === 'loading' || loading) return <div className="min-h-screen bg-surface flex items-center justify-center text-text-muted">{t('cust.menu.loading', 'Loading menu…')}</div>;
  if (error || !menu) return <div className="min-h-screen bg-surface flex items-center justify-center text-text-muted">{error || t('cust.menu.notFound', 'Menu not found.')}</div>;

  // Group: businessUnit → category → items. Products are a separate API field
  // but belong on the same display menu (under each unit's "Products" heading).
  const allItems = [...menu.services, ...(menu.products ?? [])];
  const units = Array.from(new Set(allItems.map((s) => s.businessUnit)));

  return (
    <div className="min-h-screen bg-surface">
      <header className="bg-primary-500 text-white">
        <div className="max-w-3xl mx-auto px-5 py-8 text-center">
          {brand.logoUrl ? (
            <div className="inline-flex items-center justify-center w-12 h-12 bg-white/20 rounded-2xl mb-3 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={brand.logoUrl} alt="" className="w-full h-full object-contain" />
            </div>
          ) : (
            <AirinLogo size="lg" showWordmark={false} tone="onDark" className="mb-3" />
          )}
          <h1 className="text-2xl font-bold">{brand.companyName || menu.tenantName}</h1>
          <p className="text-sm text-white/80 mt-1">{t('cust.menu.priceMenu', 'Price Menu')} · clean car. clear mind.</p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-8 space-y-10">
        {units.map((unit) => {
          const unitServices = allItems.filter((s) => s.businessUnit === unit);
          const categories = Array.from(new Set(unitServices.map((s) => s.category)));
          return (
            <section key={unit}>
              <h2 className="text-lg font-bold text-text-primary mb-4 pb-2 border-b-2 border-primary-200">{UNIT_LABEL[unit] ?? unit}</h2>
              {categories.map((cat) => (
                <div key={cat} className="mb-5">
                  <p className="eyebrow mb-2">{CATEGORY_LABEL[cat] ?? cat}</p>
                  <div className="divide-y divide-border">
                    {unitServices.filter((s) => s.category === cat).map((s) => (
                      <div key={s.id} className="flex items-center justify-between py-2.5">
                        <span className="text-sm text-text-primary">{s.name}</span>
                        <span className="text-sm font-semibold text-primary-600 whitespace-nowrap ml-4">{fmt(s.price)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          );
        })}

        {menu.plans.length > 0 && (
          <section>
            <h2 className="text-lg font-bold text-text-primary mb-4 pb-2 border-b-2 border-primary-200">{t('cust.menu.membership', 'Membership')}</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {menu.plans.map((p, i) => (
                <div key={i} className="card">
                  <p className="font-semibold text-text-primary">{p.name}</p>
                  <p className="text-xl font-bold text-primary-600 mt-1">{fmt(p.price)}</p>
                  <p className="text-xs text-text-muted mt-0.5">{p.durationMonths} {t('cust.menu.monthUnit', p.durationMonths > 1 ? 'months' : 'month')}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <p className="text-center text-xs text-text-muted pt-4">{t('cust.menu.disclaimer', 'Prices may vary by branch. Please confirm at the counter.')}</p>
      </main>
    </div>
  );
}
