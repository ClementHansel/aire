'use client';

/**
 * Client-side auth session management.
 * Stores JWT access token, refresh token, and user info in localStorage.
 */

export interface AuthUser {
  id: string;
  name: string;
  role: 'platform_super_admin' | 'tenant_owner' | 'outlet_admin' | 'cashier';
  tenantId: string;
  outletId?: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

const ACCESS_KEY = 'aire_access_token';
const REFRESH_KEY = 'aire_refresh_token';
const USER_KEY = 'aire_user';

export function setSession(session: AuthSession): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ACCESS_KEY, session.accessToken);
  localStorage.setItem(REFRESH_KEY, session.refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(session.user));
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_KEY);
}

export function getUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  return getAccessToken() !== null;
}

export function logout(): void {
  clearSession();
  if (typeof window !== 'undefined') {
    localStorage.removeItem('aire_impersonating');
    localStorage.removeItem('aire_admin_backup');
    window.location.href = '/';
  }
}

// ── Platform-admin impersonation ─────────────────────────────────────────────
const IMP_KEY = 'aire_impersonating';
const BACKUP_KEY = 'aire_admin_backup';

/** Begin impersonating a tenant: back up the admin session, then swap in the token. */
export function startImpersonation(accessToken: string, user: AuthUser): void {
  if (typeof window === 'undefined') return;
  const backup = {
    access: localStorage.getItem(ACCESS_KEY),
    refresh: localStorage.getItem(REFRESH_KEY),
    user: localStorage.getItem(USER_KEY),
  };
  localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
  localStorage.setItem(ACCESS_KEY, accessToken);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  localStorage.setItem(IMP_KEY, '1');
}

export function isImpersonating(): boolean {
  return typeof window !== 'undefined' && localStorage.getItem(IMP_KEY) === '1';
}

/** Restore the original admin session. */
export function stopImpersonation(): void {
  if (typeof window === 'undefined') return;
  const raw = localStorage.getItem(BACKUP_KEY);
  if (raw) {
    try {
      const b = JSON.parse(raw) as { access: string | null; refresh: string | null; user: string | null };
      if (b.access) localStorage.setItem(ACCESS_KEY, b.access); else localStorage.removeItem(ACCESS_KEY);
      if (b.refresh) localStorage.setItem(REFRESH_KEY, b.refresh); else localStorage.removeItem(REFRESH_KEY);
      if (b.user) localStorage.setItem(USER_KEY, b.user); else localStorage.removeItem(USER_KEY);
    } catch { /* noop */ }
  }
  localStorage.removeItem(BACKUP_KEY);
  localStorage.removeItem(IMP_KEY);
}
