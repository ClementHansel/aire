'use client';

import { getAccessToken, getRefreshToken, setSession, clearSession, getUser } from './auth';

/**
 * API client wrapper.
 * - Prepends the API base URL
 * - Attaches the JWT access token
 * - Auto-refreshes the token on 401 and retries once
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function buildUrl(path: string): string {
  // path is expected like "/services" or "/settings/:id"
  const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  try {
    const res = await fetch(buildUrl('/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    const user = getUser();
    if (!user) return false;
    setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken, user });
    return true;
  } catch {
    return false;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(buildUrl(path), { ...options, headers });

  // Auto-refresh on 401, retry once
  if (res.status === 401 && retry) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return apiFetch<T>(path, options, false);
    }
    clearSession();
    if (typeof window !== 'undefined') window.location.href = '/';
    throw new ApiError(401, 'Session expired');
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      (body && (body.message || body.error)) || `Request failed (${res.status})`;
    throw new ApiError(res.status, message, body);
  }

  return body as T;
}

export const api = {
  get: <T = unknown>(path: string) => apiFetch<T>(path, { method: 'GET' }),
  post: <T = unknown>(path: string, data?: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  put: <T = unknown>(path: string, data?: unknown) =>
    apiFetch<T>(path, { method: 'PUT', body: data ? JSON.stringify(data) : undefined }),
  patch: <T = unknown>(path: string, data?: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
  delete: <T = unknown>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
};
