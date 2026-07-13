'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * Fetch the current user's effective RBAC permission keys.
 *
 * `['*']` means "all permissions" (owners, or any user without a restricted
 * custom role). While loading or on error we treat the user as unrestricted so a
 * backend hiccup never hides tools the user is actually allowed to use — the
 * server-side guard remains the real enforcement point.
 */
export function usePermissions(): {
  permissions: string[];
  loading: boolean;
  has: (key?: string) => boolean;
} {
  const [permissions, setPermissions] = useState<string[]>(['*']);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .get<{ permissions: string[] }>('/permissions/me')
      .then((res) => { if (active) setPermissions(res.permissions ?? ['*']); })
      .catch(() => { if (active) setPermissions(['*']); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const has = (key?: string) => {
    if (!key) return true;
    if (permissions.includes('*')) return true;
    return permissions.includes(key);
  };

  return { permissions, loading, has };
}

/** Pure helper for gating outside the hook (e.g. filtering a nav list). */
export function hasPermission(permissions: string[], key?: string): boolean {
  if (!key) return true;
  if (permissions.includes('*')) return true;
  return permissions.includes(key);
}
