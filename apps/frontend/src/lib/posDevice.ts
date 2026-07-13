'use client';

/**
 * Registered POS-terminal device token.
 *
 * POS is no longer reached from a personal login redirect. Each terminal opens
 * its launch URL once (`/pos/launch?posToken=…`); the token is validated against
 * the backend and stored on the device. The token proves the terminal is an
 * authorized POS and pins its branch (outlet). A cashier then signs in on top
 * with their normal email + password so orders/shifts keep per-cashier attribution.
 */

const TOKEN_KEY = 'aire_pos_device_token';
const OUTLET_KEY = 'aire_pos_outlet_id';
const OUTLET_NAME_KEY = 'aire_pos_outlet_name';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

export interface PosDeviceContext {
  deviceId: string;
  tenantId: string;
  outletId: string;
  outletName: string;
  label: string | null;
}

export function getPosDeviceToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getPosOutletId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(OUTLET_KEY);
}

export function getPosOutletName(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(OUTLET_NAME_KEY);
}

export function setPosDevice(token: string, ctx: PosDeviceContext): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(OUTLET_KEY, ctx.outletId);
  localStorage.setItem(OUTLET_NAME_KEY, ctx.outletName);
}

export function clearPosDevice(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(OUTLET_KEY);
  localStorage.removeItem(OUTLET_NAME_KEY);
}

/** Validate an opaque device token against the backend; resolves its branch. */
export async function validatePosToken(token: string): Promise<PosDeviceContext> {
  const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;
  const res = await fetch(`${base}/pos-devices/validate?posToken=${encodeURIComponent(token)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error((body && (body.message || body.error)) || 'Invalid or disabled POS device');
  }
  return (await res.json()) as PosDeviceContext;
}
