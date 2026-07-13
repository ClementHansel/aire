'use client';

/**
 * Super-admin "point of view" previews launched from the hub. Two kinds:
 *  - staff  — an owner or employee token swapped in via the existing
 *             impersonation backup (restored on exit).
 *  - portal — a customer-portal token stored alongside the (untouched) admin
 *             session; cleared on exit.
 * A small `aire_pov` meta blob drives the global Exit-preview banner so the
 * admin can always get back, whichever surface they land on.
 */

import {
  startImpersonation,
  stopImpersonation,
  isImpersonating,
  type AuthUser,
} from './auth';
import { setPortalToken, clearPortalToken } from './portalApi';

const POV_KEY = 'aire_pov';

export interface PovMeta {
  mode: 'staff' | 'portal';
  /** Human label for the banner, e.g. "Owner", "Employee · Budi", "Customer · Sinta". */
  label: string;
  tenantName: string;
  /** Portal-mode only: the resolved tenant UUID the token is keyed under. */
  tenantUuid?: string;
  /** Where "Exit preview" returns to (defaults to /hub). */
  returnTo: string;
}

export function getPovMeta(): PovMeta | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(POV_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PovMeta;
  } catch {
    return null;
  }
}

/** Begin a staff (owner/employee) POV: swap the token in and mark the preview. */
export function startStaffPov(
  accessToken: string,
  user: AuthUser,
  meta: Omit<PovMeta, 'mode' | 'tenantUuid'>,
): void {
  startImpersonation(accessToken, user);
  localStorage.setItem(POV_KEY, JSON.stringify({ ...meta, mode: 'staff' }));
}

/** Begin a customer-portal POV: store the portal token (admin session untouched). */
export function startPortalPov(
  tenantUuid: string,
  token: string,
  meta: Omit<PovMeta, 'mode' | 'tenantUuid'>,
): void {
  setPortalToken(tenantUuid, token);
  localStorage.setItem(POV_KEY, JSON.stringify({ ...meta, mode: 'portal', tenantUuid }));
}

/** True whenever a POV preview (either kind) is active. */
export function isPovActive(): boolean {
  return isImpersonating() || getPovMeta()?.mode === 'portal';
}

/** End the active preview and return to the admin surface. */
export function exitPov(): void {
  const meta = getPovMeta();
  if (meta?.mode === 'portal' && meta.tenantUuid) clearPortalToken(meta.tenantUuid);
  if (isImpersonating()) stopImpersonation();
  if (typeof window !== 'undefined') {
    localStorage.removeItem(POV_KEY);
    window.location.href = meta?.returnTo || '/hub';
  }
}
