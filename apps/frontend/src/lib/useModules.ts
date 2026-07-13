'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * Fetch the modules enabled for the current user's tenant.
 *
 * Returns a map of moduleKey -> enabled. While loading (or on error) every
 * module is treated as enabled, so navigation never disappears unexpectedly and
 * a backend hiccup can't lock a tenant out of their own tools.
 */
export function useTenantModules(): {
  modules: Record<string, boolean>;
  loading: boolean;
} {
  const [modules, setModules] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .get<{ modules: Record<string, boolean> }>('/modules/me')
      .then((res) => {
        if (active) setModules(res.modules ?? {});
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

  return { modules, loading };
}

/** A module is enabled unless it is explicitly disabled (default-on). */
export function moduleEnabled(
  modules: Record<string, boolean>,
  key?: string,
): boolean {
  if (!key) return true;
  return modules[key] !== false;
}
