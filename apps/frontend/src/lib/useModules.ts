'use client';

import { useEffect, useState } from 'react';
import {
  DEFAULT_VERTICAL,
  TenantCapabilities,
  TenantVertical,
  resolveCapabilities,
} from '@aire/shared';
import { api } from './api';

/** Capabilities assumed while the fetch is in flight or has failed.
 *
 *  Deliberately the car-wash preset: it is the SUPERSET (vehicles + bays + LPR
 *  all on), so a hiccup can never hide a field the tenant genuinely needs. The
 *  cost of guessing wrong is a plate input that briefly appears for a
 *  non-vehicle tenant; the cost of the inverse would be a car wash unable to
 *  record which car it just washed. */
const FALLBACK_CAPABILITIES: TenantCapabilities = resolveCapabilities(DEFAULT_VERTICAL, null);

/**
 * Fetch the modules and capabilities for the current user's tenant.
 *
 * Returns a map of moduleKey -> enabled. While loading (or on error) every
 * module is treated as enabled, so navigation never disappears unexpectedly and
 * a backend hiccup can't lock a tenant out of their own tools.
 */
export function useTenantModules(): {
  modules: Record<string, boolean>;
  vertical: TenantVertical;
  capabilities: TenantCapabilities;
  loading: boolean;
} {
  const [modules, setModules] = useState<Record<string, boolean>>({});
  const [vertical, setVertical] = useState<TenantVertical>(DEFAULT_VERTICAL);
  const [capabilities, setCapabilities] = useState<TenantCapabilities>(FALLBACK_CAPABILITIES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .get<{
        modules: Record<string, boolean>;
        vertical?: TenantVertical;
        capabilities?: TenantCapabilities;
      }>('/modules/me')
      .then((res) => {
        if (!active) return;
        setModules(res.modules ?? {});
        if (res.vertical) setVertical(res.vertical);
        if (res.capabilities) setCapabilities(res.capabilities);
      })
      .catch(() => {
        if (active) setModules({});
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { modules, vertical, capabilities, loading };
}

/**
 * Just the capability flags, for the many components that care whether vehicles
 * exist but not which modules are on.
 */
export function useTenantCapabilities(): {
  capabilities: TenantCapabilities;
  loading: boolean;
} {
  const { capabilities, loading } = useTenantModules();
  return { capabilities, loading };
}

/** A module is enabled unless it is explicitly disabled (default-on). */
export function moduleEnabled(
  modules: Record<string, boolean>,
  key?: string,
): boolean {
  if (!key) return true;
  return modules[key] !== false;
}
