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
    window.location.href = '/';
  }
}
