/**
 * Void authorization logic for the AIRE Operations Platform.
 *
 * Determines whether a void (order cancellation) request is authorized based on:
 * - User role (TenantOwner bypasses PIN requirement)
 * - Time elapsed since order creation vs. free void window
 * - Valid admin PIN verification when required
 *
 * Requirements: 21.1, 21.2, 21.3
 */

import { Role } from '../enums';
import {
  ERR_VOID_REASON_REQUIRED,
  ERR_VOID_PIN_REQUIRED,
  ERR_VOID_PIN_INVALID,
} from '../error-codes';
import { ADMIN_PIN_LENGTH } from '../constants';

/**
 * Input data required to evaluate void authorization.
 */
export interface VoidAuthorizationInput {
  /** The role of the user requesting the void */
  role: Role;
  /** Reason for the void (must be non-empty) */
  reason: string;
  /** Optional 6-digit admin PIN for authorization after free window */
  adminPin?: string;
  /** ISO datetime when the order was created */
  orderCreatedAt: string;
  /** ISO datetime representing the current time */
  currentTime: string;
  /** Free void window in minutes (from outlet settings, default 0) */
  freeVoidWindowMinutes: number;
}

/**
 * Result of void authorization check.
 */
export interface VoidAuthorizationResult {
  /** Whether the void is authorized */
  authorized: boolean;
  /** Whether PIN is required for this void */
  requiresPin: boolean;
  /** Error details if not authorized */
  error?: { code: string; message: string };
}

/**
 * Calculates elapsed minutes between two ISO datetime strings.
 */
function getElapsedMinutes(orderCreatedAt: string, currentTime: string): number {
  const created = new Date(orderCreatedAt).getTime();
  const now = new Date(currentTime).getTime();
  return (now - created) / (1000 * 60);
}

/**
 * Checks whether a void request is authorized.
 *
 * Logic flow:
 * 1. If reason is empty/whitespace → unauthorized (ERR_VOID_REASON_REQUIRED)
 * 2. If role is TenantOwner → authorized (no PIN needed, regardless of timing)
 * 3. Calculate elapsed minutes since orderCreatedAt
 * 4. If elapsed <= freeVoidWindowMinutes → authorized (reason only, no PIN)
 * 5. If elapsed > freeVoidWindowMinutes:
 *    - If no adminPin provided → unauthorized (ERR_VOID_PIN_REQUIRED)
 *    - If adminPin provided → verify with verifyPin callback
 *      - If valid → authorized
 *      - If invalid → unauthorized (ERR_VOID_PIN_INVALID)
 *
 * @param input - The void authorization input data
 * @param verifyPin - Callback to verify the admin PIN (e.g., bcrypt compare)
 * @returns The authorization result
 */
export function checkVoidAuthorization(
  input: VoidAuthorizationInput,
  verifyPin: (pin: string) => boolean,
): VoidAuthorizationResult {
  // 1. Reason is required
  if (!input.reason || input.reason.trim().length === 0) {
    return {
      authorized: false,
      requiresPin: false,
      error: {
        code: ERR_VOID_REASON_REQUIRED,
        message: 'A reason is required to void an order',
      },
    };
  }

  // 2. TenantOwner bypasses PIN requirement regardless of timing
  if (input.role === Role.TenantOwner) {
    return {
      authorized: true,
      requiresPin: false,
    };
  }

  // 3. Calculate elapsed time
  const elapsedMinutes = getElapsedMinutes(input.orderCreatedAt, input.currentTime);

  // 4. Within free void window → authorized with reason only
  if (elapsedMinutes <= input.freeVoidWindowMinutes) {
    return {
      authorized: true,
      requiresPin: false,
    };
  }

  // 5. After free void window → PIN required
  if (!input.adminPin) {
    return {
      authorized: false,
      requiresPin: true,
      error: {
        code: ERR_VOID_PIN_REQUIRED,
        message: 'Admin PIN is required to void orders after the free void window',
      },
    };
  }

  // Validate PIN format (must be exactly 6 digits)
  if (input.adminPin.length !== ADMIN_PIN_LENGTH || !/^\d+$/.test(input.adminPin)) {
    return {
      authorized: false,
      requiresPin: true,
      error: {
        code: ERR_VOID_PIN_INVALID,
        message: 'Invalid admin PIN',
      },
    };
  }

  // Verify PIN with callback
  if (verifyPin(input.adminPin)) {
    return {
      authorized: true,
      requiresPin: true,
    };
  }

  // PIN verification failed
  return {
    authorized: false,
    requiresPin: true,
    error: {
      code: ERR_VOID_PIN_INVALID,
      message: 'Invalid admin PIN',
    },
  };
}
