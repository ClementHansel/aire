'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { getPovMeta, isPovActive, exitPov, type PovMeta } from '@/lib/pov';

/**
 * Global floating banner shown while a super-admin is previewing a tenant POV
 * (owner / employee / customer). Mounted once in the root layout so it follows
 * the admin onto /dashboard, /employee and /portal, and always offers a way out.
 */
export default function PovBanner() {
  const { t } = useI18n();
  const [meta, setMeta] = useState<PovMeta | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(isPovActive());
    setMeta(getPovMeta());
  }, []);

  if (!active) return null;

  const label = meta?.label ?? t('pov.banner.someone', 'this tenant');
  const tenant = meta?.tenantName ? ` · ${meta.tenantName}` : '';

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 rounded-full border border-amber-300 bg-amber-50 px-4 py-2 shadow-lg">
      <span className="text-sm text-amber-900">
        👁️ {t('pov.banner.viewingAs', 'Viewing as')} <strong>{label}</strong>{tenant}
      </span>
      <button
        onClick={exitPov}
        className="rounded-full bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
      >
        {t('pov.banner.exit', 'Exit preview')}
      </button>
    </div>
  );
}
