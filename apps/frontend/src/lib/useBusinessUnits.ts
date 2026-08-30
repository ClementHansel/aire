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
 * The two units every tenant is seeded with (migration 096). Used ONLY as a
 * fallback while the fetch is in flight or has failed — never as the allowed
 * set, which is whatever the tenant owns (AIRIN-176).
 */
export const FALLBACK_BUSINESS_UNITS: BusinessUnit[] = [
  { id: 'fallback-aire', code: 'AIRE', name: 'AIRE', color: '#0ea5e9', sortOrder: 0, isActive: true },
  { id: 'fallback-lead', code: 'LEAD', name: 'LEAD', color: '#8b5cf6', sortOrder: 1, isActive: true },
];

/**
 * The tenant's business units (AIRIN-176).
 *
 * Falling back to AIRE/LEAD rather than an empty list is deliberate: these
 * drive the POS catalog tabs, so an empty list would render a till with no way
 * to reach any service. A stale-but-working tab beats a blank one.
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
