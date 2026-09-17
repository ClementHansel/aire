'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export interface BusinessUnit {
  id: string;
  /** The value stored in every `business_unit` column. Not editable once created. */
  code: string;
  name: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
}

/**
 * What the hook reports before the tenant's real units arrive: NOTHING.
 *
 * This used to be a literal AIRE/LEAD pair, on the reasoning that an empty list
 * would render a till with no tabs. That reasoning only held while every tenant
 * WAS AIRE/LEAD. For any other tenant those codes match none of their services,
 * so the fallback rendered two tabs that were guaranteed to be empty — and
 * labelled them with another company's brands. A brief tab-less moment, which
 * the consuming effects resolve as soon as the fetch lands, is the better of the
 * two (AIRIN-176).
 */
export const FALLBACK_BUSINESS_UNITS: BusinessUnit[] = [];

/**
 * The tenant's business units (AIRIN-176).
 *
 * Consumers must tolerate an empty list: it is both the pre-fetch state and the
 * genuine answer for a tenant who has retired every unit. The POS, reports and
 * service form all snap to `units[0]` once the list lands.
 */
export function useBusinessUnits(activeOnly = true): {
  units: BusinessUnit[];
  loading: boolean;
  label: (code: string | null | undefined) => string;
  reload: () => void;
} {
  const [units, setUnits] = useState<BusinessUnit[]>(FALLBACK_BUSINESS_UNITS);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    api
      .get<BusinessUnit[]>(`/business-units${activeOnly ? '?activeOnly=true' : ''}`)
      .then((res) => {
        if (!active) return;
        if (Array.isArray(res) && res.length > 0) setUnits(res);
      })
      .catch(() => {
        /* keep the fallback — see the note above */
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeOnly, nonce]);

  /** Display name for a stored code. An unknown code (a deactivated or deleted
   *  unit still referenced by an old order) shows the raw code rather than
   *  blanking the cell. */
  const label = useCallback(
    (code: string | null | undefined) => {
      if (!code) return '';
      return units.find((u) => u.code === code)?.name ?? code;
    },
    [units],
  );

  return { units, loading, label, reload: () => setNonce((n) => n + 1) };
}
