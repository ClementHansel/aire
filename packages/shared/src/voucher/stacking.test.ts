import { describe, it, expect } from 'vitest';
import { canStackVoucher, AppliedVoucher } from './stacking';
import { VoucherType } from '../enums';

function makeVoucher(overrides: Partial<AppliedVoucher> = {}): AppliedVoucher {
  return {
    code: 'VOUCHER-001',
    type: VoucherType.Fixed,
    discountValue: 10000,
    ...overrides,
  };
}

describe('canStackVoucher', () => {
  describe('empty applied list', () => {
    it('allows FIXED voucher when no vouchers are applied', () => {
      const result = canStackVoucher(VoucherType.Fixed, []);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('allows PERCENTAGE voucher when no vouchers are applied', () => {
      const result = canStackVoucher(VoucherType.Percentage, []);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('allows SERVICE_PACK voucher when no vouchers are applied', () => {
      const result = canStackVoucher(VoucherType.ServicePack, []);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });

  describe('rejecting duplicate types', () => {
    it('rejects second FIXED voucher when one already exists', () => {
      const applied = [makeVoucher({ type: VoucherType.Fixed })];
      const result = canStackVoucher(VoucherType.Fixed, applied);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('A FIXED voucher is already applied');
    });

    it('rejects second PERCENTAGE voucher when one already exists', () => {
      const applied = [makeVoucher({ type: VoucherType.Percentage, code: 'PCT-001' })];
      const result = canStackVoucher(VoucherType.Percentage, applied);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('A PERCENTAGE voucher is already applied');
    });

    it('rejects second SERVICE_PACK voucher when one already exists', () => {
      const applied = [makeVoucher({ type: VoucherType.ServicePack, code: 'SP-001' })];
      const result = canStackVoucher(VoucherType.ServicePack, applied);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('A SERVICE_PACK voucher is already applied');
    });
  });

  describe('allowing different types to coexist', () => {
    it('allows PERCENTAGE when FIXED is already applied', () => {
      const applied = [makeVoucher({ type: VoucherType.Fixed })];
      const result = canStackVoucher(VoucherType.Percentage, applied);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('allows SERVICE_PACK when FIXED is already applied', () => {
      const applied = [makeVoucher({ type: VoucherType.Fixed })];
      const result = canStackVoucher(VoucherType.ServicePack, applied);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('allows SERVICE_PACK when FIXED and PERCENTAGE are already applied', () => {
      const applied = [
        makeVoucher({ type: VoucherType.Fixed, code: 'FIX-001' }),
        makeVoucher({ type: VoucherType.Percentage, code: 'PCT-001' }),
      ];
      const result = canStackVoucher(VoucherType.ServicePack, applied);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('allows all 3 types simultaneously (FIXED + PERCENTAGE + SERVICE_PACK)', () => {
      const applied: AppliedVoucher[] = [];

      // Add FIXED
      const r1 = canStackVoucher(VoucherType.Fixed, applied);
      expect(r1.allowed).toBe(true);
      applied.push(makeVoucher({ type: VoucherType.Fixed, code: 'FIX-001' }));

      // Add PERCENTAGE
      const r2 = canStackVoucher(VoucherType.Percentage, applied);
      expect(r2.allowed).toBe(true);
      applied.push(makeVoucher({ type: VoucherType.Percentage, code: 'PCT-001' }));

      // Add SERVICE_PACK
      const r3 = canStackVoucher(VoucherType.ServicePack, applied);
      expect(r3.allowed).toBe(true);
      applied.push(makeVoucher({ type: VoucherType.ServicePack, code: 'SP-001' }));

      // Now all slots are full — reject any additional voucher
      expect(canStackVoucher(VoucherType.Fixed, applied).allowed).toBe(false);
      expect(canStackVoucher(VoucherType.Percentage, applied).allowed).toBe(false);
      expect(canStackVoucher(VoucherType.ServicePack, applied).allowed).toBe(false);
    });
  });
});
