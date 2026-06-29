import { describe, it, expect } from 'vitest';
import { checkVoidAuthorization, VoidAuthorizationInput } from './void-authorization';
import { Role } from '../enums';
import {
  ERR_VOID_REASON_REQUIRED,
  ERR_VOID_PIN_REQUIRED,
  ERR_VOID_PIN_INVALID,
} from '../error-codes';

/** Helper to create a base input with sensible defaults */
function makeInput(overrides: Partial<VoidAuthorizationInput> = {}): VoidAuthorizationInput {
  return {
    role: Role.Cashier,
    reason: 'Customer changed their mind',
    adminPin: undefined,
    orderCreatedAt: '2024-01-15T10:00:00.000Z',
    currentTime: '2024-01-15T10:30:00.000Z', // 30 min elapsed
    freeVoidWindowMinutes: 0, // default: no free window
    ...overrides,
  };
}

/** A verifyPin stub that accepts '123456' as valid */
const validPin = (pin: string) => pin === '123456';

/** A verifyPin stub that always rejects */
const invalidPin = () => false;

describe('checkVoidAuthorization', () => {
  describe('reason validation', () => {
    it('rejects void with empty reason', () => {
      const input = makeInput({ reason: '' });
      const result = checkVoidAuthorization(input, validPin);

      expect(result.authorized).toBe(false);
      expect(result.error?.code).toBe(ERR_VOID_REASON_REQUIRED);
    });

    it('rejects void with whitespace-only reason', () => {
      const input = makeInput({ reason: '   ' });
      const result = checkVoidAuthorization(input, validPin);

      expect(result.authorized).toBe(false);
      expect(result.error?.code).toBe(ERR_VOID_REASON_REQUIRED);
    });

    it('rejects void with tab/newline-only reason', () => {
      const input = makeInput({ reason: '\t\n  ' });
      const result = checkVoidAuthorization(input, validPin);

      expect(result.authorized).toBe(false);
      expect(result.error?.code).toBe(ERR_VOID_REASON_REQUIRED);
    });
  });

  describe('TenantOwner bypass', () => {
    it('authorizes TenantOwner without PIN regardless of elapsed time', () => {
      const input = makeInput({
        role: Role.TenantOwner,
        currentTime: '2024-01-15T18:00:00.000Z', // 8 hours later
        freeVoidWindowMinutes: 0,
      });
      const result = checkVoidAuthorization(input, invalidPin);

      expect(result.authorized).toBe(true);
      expect(result.requiresPin).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it('authorizes TenantOwner within free void window', () => {
      const input = makeInput({
        role: Role.TenantOwner,
        currentTime: '2024-01-15T10:01:00.000Z', // 1 min later
        freeVoidWindowMinutes: 5,
      });
      const result = checkVoidAuthorization(input, invalidPin);

      expect(result.authorized).toBe(true);
      expect(result.requiresPin).toBe(false);
    });

    it('still requires reason even for TenantOwner', () => {
      const input = makeInput({
        role: Role.TenantOwner,
        reason: '',
      });
      const result = checkVoidAuthorization(input, validPin);

      expect(result.authorized).toBe(false);
      expect(result.error?.code).toBe(ERR_VOID_REASON_REQUIRED);
    });
  });

  describe('within free void window', () => {
    it('authorizes Cashier with reason only when within free window', () => {
      const input = makeInput({
        role: Role.Cashier,
        orderCreatedAt: '2024-01-15T10:00:00.000Z',
        currentTime: '2024-01-15T10:03:00.000Z', // 3 min elapsed
        freeVoidWindowMinutes: 5,
      });
      const result = checkVoidAuthorization(input, invalidPin);

      expect(result.authorized).toBe(true);
      expect(result.requiresPin).toBe(false);
    });

    it('authorizes OutletAdmin with reason only when within free window', () => {
      const input = makeInput({
        role: Role.OutletAdmin,
        orderCreatedAt: '2024-01-15T10:00:00.000Z',
        currentTime: '2024-01-15T10:03:00.000Z', // 3 min elapsed
        freeVoidWindowMinutes: 5,
      });
      const result = checkVoidAuthorization(input, invalidPin);

      expect(result.authorized).toBe(true);
      expect(result.requiresPin).toBe(false);
    });

    it('authorizes at exact boundary of free window', () => {
      const input = makeInput({
        role: Role.Cashier,
        orderCreatedAt: '2024-01-15T10:00:00.000Z',
        currentTime: '2024-01-15T10:05:00.000Z', // exactly 5 min
        freeVoidWindowMinutes: 5,
      });
      const result = checkVoidAuthorization(input, invalidPin);

      expect(result.authorized).toBe(true);
      expect(result.requiresPin).toBe(false);
    });

    it('authorizes when freeVoidWindowMinutes is 0 and elapsed is 0', () => {
      const input = makeInput({
        role: Role.Cashier,
        orderCreatedAt: '2024-01-15T10:00:00.000Z',
        currentTime: '2024-01-15T10:00:00.000Z', // 0 min elapsed
        freeVoidWindowMinutes: 0,
      });
      const result = checkVoidAuthorization(input, invalidPin);

      expect(result.authorized).toBe(true);
      expect(result.requiresPin).toBe(false);
    });
  });

  describe('after free void window - PIN required', () => {
    it('rejects when no PIN is provided after free window', () => {
      const input = makeInput({
        role: Role.Cashier,
        orderCreatedAt: '2024-01-15T10:00:00.000Z',
        currentTime: '2024-01-15T10:06:00.000Z', // 6 min elapsed
        freeVoidWindowMinutes: 5,
        adminPin: undefined,
      });
      const result = checkVoidAuthorization(input, validPin);

      expect(result.authorized).toBe(false);
      expect(result.requiresPin).toBe(true);
      expect(result.error?.code).toBe(ERR_VOID_PIN_REQUIRED);
    });

    it('authorizes with valid PIN after free window', () => {
      const input = makeInput({
        role: Role.Cashier,
        orderCreatedAt: '2024-01-15T10:00:00.000Z',
        currentTime: '2024-01-15T10:06:00.000Z', // 6 min elapsed
        freeVoidWindowMinutes: 5,
        adminPin: '123456',
      });
      const result = checkVoidAuthorization(input, validPin);

      expect(result.authorized).toBe(true);
      expect(result.requiresPin).toBe(true);
    });

    it('rejects with invalid PIN after free window', () => {
      const input = makeInput({
        role: Role.Cashier,
        orderCreatedAt: '2024-01-15T10:00:00.000Z',
        currentTime: '2024-01-15T10:06:00.000Z', // 6 min elapsed
        freeVoidWindowMinutes: 5,
        adminPin: '999999',
      });
      const result = checkVoidAuthorization(input, invalidPin);

      expect(result.authorized).toBe(false);
      expect(result.requiresPin).toBe(true);
      expect(result.error?.code).toBe(ERR_VOID_PIN_INVALID);
    });

    it('rejects PIN with wrong length', () => {
      const input = makeInput({
        role: Role.Cashier,
        orderCreatedAt: '2024-01-15T10:00:00.000Z',
        currentTime: '2024-01-15T10:06:00.000Z',
        freeVoidWindowMinutes: 5,
        adminPin: '12345', // 5 digits
      });
      const result = checkVoidAuthorization(input, validPin);

      expect(result.authorized).toBe(false);
      expect(result.requiresPin).toBe(true);
      expect(result.error?.code).toBe(ERR_VOID_PIN_INVALID);
    });

    it('rejects PIN with non-numeric characters', () => {
      const input = makeInput({
        role: Role.Cashier,
        orderCreatedAt: '2024-01-15T10:00:00.000Z',
        currentTime: '2024-01-15T10:06:00.000Z',
        freeVoidWindowMinutes: 5,
        adminPin: '12ab56',
      });
      const result = checkVoidAuthorization(input, validPin);

      expect(result.authorized).toBe(false);
      expect(result.requiresPin).toBe(true);
      expect(result.error?.code).toBe(ERR_VOID_PIN_INVALID);
    });
  });

  describe('default freeVoidWindowMinutes = 0', () => {
    it('requires PIN immediately when freeVoidWindowMinutes is 0 and time has passed', () => {
      const input = makeInput({
        role: Role.Cashier,
        orderCreatedAt: '2024-01-15T10:00:00.000Z',
        currentTime: '2024-01-15T10:00:01.000Z', // 1 second later
        freeVoidWindowMinutes: 0,
        adminPin: undefined,
      });
      const result = checkVoidAuthorization(input, validPin);

      expect(result.authorized).toBe(false);
      expect(result.requiresPin).toBe(true);
      expect(result.error?.code).toBe(ERR_VOID_PIN_REQUIRED);
    });
  });

  describe('PlatformSuperAdmin role', () => {
    it('requires PIN for PlatformSuperAdmin after free window (not exempt)', () => {
      const input = makeInput({
        role: Role.PlatformSuperAdmin,
        orderCreatedAt: '2024-01-15T10:00:00.000Z',
        currentTime: '2024-01-15T10:30:00.000Z',
        freeVoidWindowMinutes: 0,
        adminPin: undefined,
      });
      const result = checkVoidAuthorization(input, validPin);

      expect(result.authorized).toBe(false);
      expect(result.requiresPin).toBe(true);
      expect(result.error?.code).toBe(ERR_VOID_PIN_REQUIRED);
    });
  });

  describe('OutletAdmin role', () => {
    it('requires PIN for OutletAdmin after free window', () => {
      const input = makeInput({
        role: Role.OutletAdmin,
        orderCreatedAt: '2024-01-15T10:00:00.000Z',
        currentTime: '2024-01-15T10:30:00.000Z',
        freeVoidWindowMinutes: 5,
        adminPin: undefined,
      });
      const result = checkVoidAuthorization(input, validPin);

      expect(result.authorized).toBe(false);
      expect(result.requiresPin).toBe(true);
      expect(result.error?.code).toBe(ERR_VOID_PIN_REQUIRED);
    });
  });
});
