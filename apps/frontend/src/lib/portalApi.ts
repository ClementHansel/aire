'use client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

const tokenKey = (tenantId: string) => `aire_portal_token_${tenantId}`;

export function getPortalToken(tenantId: string): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(tokenKey(tenantId));
}
export function setPortalToken(tenantId: string, token: string): void {
  localStorage.setItem(tokenKey(tenantId), token);
}
export function clearPortalToken(tenantId: string): void {
  localStorage.removeItem(tokenKey(tenantId));
}

/** Thrown when the customer token is missing/expired — the UI drops to login. */
export class PortalAuthError extends Error {}

/**
 * Fetch against the customer-portal API. Attaches the customer token (unless
 * `auth: false`). A 401 clears the token and throws PortalAuthError so callers
 * can send the user back to the OTP login.
 */
export async function portalApi<T>(
  tenantId: string,
  path: string,
  opts: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, headers: extra, ...rest } = opts;
  const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(extra as Record<string, string>) };
  if (auth) {
    const tk = getPortalToken(tenantId);
    if (tk) headers['Authorization'] = `Bearer ${tk}`;
  }
  const res = await fetch(`${base}${path}`, { ...rest, headers });
  if (res.status === 401) {
    clearPortalToken(tenantId);
    throw new PortalAuthError('Session expired. Please sign in again.');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body && (body.message || body.error)) || `Request failed (${res.status})`);
  return body as T;
}
