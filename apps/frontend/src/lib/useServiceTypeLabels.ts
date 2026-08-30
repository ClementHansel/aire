'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

/**
 * The three service type codes. Fixed deliberately — see the backend's
 * `SERVICE_TYPE_CODES`: `car_wash` is what the POS "cart needs a main service"
 * rule keys off, and `product` is what splits the Services page from the
 * Products page. A tenant renames these; a tenant does not add to them.
 */
export type ServiceTypeCode = 'car_wash' | 'add_on' | 'product';

export interface ServiceTypeLabel {
  code: ServiceTypeCode;
  label: string;
  customized: boolean;
}

/** Built-in wording. Also the fallback while the fetch is in flight or fails. */
export const DEFAULT_SERVICE_TYPE_LABELS: Record<ServiceTypeCode, string> = {
  car_wash: 'Car Wash',
  add_on: 'Add-on',
  product: 'Product',
};

/** i18n keys for the built-in wording, so an un-renamed tenant still gets Indonesian. */
export const SERVICE_TYPE_I18N_KEYS: Record<ServiceTypeCode, string> = {
  car_wash: 'dash.services.catCarWash',
  add_on: 'dash.services.catAddOn',
  product: 'dash.services.catProduct',
};

/**
 * The tenant's own wording for each service type (AIRIN-175).
 *
 * `label(code, t)` is the accessor every surface should use. The precedence is
 * deliberate: a tenant's rename wins outright, and only an UNRENAMED type falls
 * through to the translated built-in. Translating a tenant's own words would be
 * wrong — "Utama" is what they chose to call it, in any locale.
 */
export function useServiceTypeLabels(): {
  types: ServiceTypeLabel[];
  loading: boolean;
  label: (code: string, t?: (key: string, fallback: string) => string) => string;
  reload: () => void;
} {
  const [types, setTypes] = useState<ServiceTypeLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    api
      .get<ServiceTypeLabel[]>('/service-types')
      .then((res) => {
        if (active) setTypes(Array.isArray(res) ? res : []);
      })
      .catch(() => {
        // Fall back to built-ins: a naming lookup must never blank out a POS
        // button or a report row.
        if (active) setTypes([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  const label = useCallback(
    (code: string, t?: (key: string, fallback: string) => string) => {
      const custom = types.find((x) => x.code === code && x.customized);
      if (custom) return custom.label;
      const key = SERVICE_TYPE_I18N_KEYS[code as ServiceTypeCode];
      const fallback = DEFAULT_SERVICE_TYPE_LABELS[code as ServiceTypeCode] ?? code;
      return t && key ? t(key, fallback) : fallback;
    },
    [types],
  );

  return { types, loading, label, reload: () => setNonce((n) => n + 1) };
}
