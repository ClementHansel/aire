import { describe, it, expect } from 'vitest';
import { VoucherType } from '../enums';
import {
  VoucherData,
  VoucherEvaluationContext,
  evaluateVoucher,
} from './index';

function makeVoucher(overrides: Partial<VoucherData> = {}): VoucherData {
  return {
    type: VoucherType.Fixed,
    value: 25000,
    maxUses: 5,
    currentUses: 0,
    startDate: null,
    expiryDate: null,
    outletIds: null,
    brandScope: null,
    serviceIds: null,
    minOrderAmount: 0,
    isActive: true,
    isParentCode: false,
    ...overrides,
  };
}

function makeContext(overrides: Partial<VoucherEvaluationContext> = {}): VoucherEvaluationContext {
  return {
    outletId: 'outlet-1',
    vehicleBrand: 'Toyota',
    serviceIdsInCart: ['svc-1', 'svc-2'],
    orderSubtotal: 100000,
    currentDate: '2025-06-15',
    ...overrides,
  };
}

describe('evaluateVoucher', () => {
  describe('error states (mutually exclusive, priority order)', () => {
    it('returns not_found when voucher is null', () => {
      const result = evaluateVoucher(null, makeContext());
      expect(result).toEqual({ status: 'not_found' });
    });

    it('returns parent_code when isParentCode is true', () => {
      const voucher = makeVoucher({ isParentCode: true });
      const result = evaluateVoucher(voucher, makeContext());
      expect(result).toEqual({ status: 'parent_code' });
    });

    it('returns inactive when voucher is not active', () => {
      const voucher = makeVoucher({ isActive: false });
      const result = evaluateVoucher(voucher, makeContext());
      expect(result).toEqual({ status: 'inactive' });
    });

    it('returns fully_redeemed when currentUses >= maxUses', () => {
      const voucher = makeVoucher({ maxUses: 3, currentUses: 3 });
      const result = evaluateVoucher(voucher, makeContext());
      expect(result).toEqual({ status: 'fully_redeemed' });
    });

    it('returns fully_redeemed when currentUses exceeds maxUses', () => {
      const voucher = makeVoucher({ maxUses: 3, currentUses: 5 });
      const result = evaluateVoucher(voucher, makeContext());
      expect(result).toEqual({ status: 'fully_redeemed' });
    });

    it('returns expired when expiryDate is before currentDate', () => {
      const voucher = makeVoucher({ expiryDate: '2025-06-01' });
      const context = makeContext({ currentDate: '2025-06-15' });
      const result = evaluateVoucher(voucher, context);
      expect(result).toEqual({ status: 'expired' });
    });

    it('returns not_yet_active when startDate is after currentDate', () => {
      const voucher = makeVoucher({ startDate: '2025-07-01' });
      const context = makeContext({ currentDate: '2025-06-15' });
      const result = evaluateVoucher(voucher, context);
      expect(result).toEqual({ status: 'not_yet_active', startDate: '2025-07-01' });
    });
  });

  describe('priority ordering of error states', () => {
    it('parent_code takes priority over inactive', () => {
      const voucher = makeVoucher({ isParentCode: true, isActive: false });
      const result = evaluateVoucher(voucher, makeContext());
      expect(result.status).toBe('parent_code');
    });

    it('inactive takes priority over fully_redeemed', () => {
      const voucher = makeVoucher({ isActive: false, maxUses: 1, currentUses: 5 });
      const result = evaluateVoucher(voucher, makeContext());
      expect(result.status).toBe('inactive');
    });

    it('fully_redeemed takes priority over expired', () => {
      const voucher = makeVoucher({
        maxUses: 1,
        currentUses: 1,
        expiryDate: '2025-01-01',
      });
      const context = makeContext({ currentDate: '2025-06-15' });
      const result = evaluateVoucher(voucher, context);
      expect(result.status).toBe('fully_redeemed');
    });

    it('expired takes priority over not_yet_active', () => {
      // This scenario is logically odd (expired AND not yet active), but tests priority
      const voucher = makeVoucher({
        expiryDate: '2025-05-01',
        startDate: '2025-07-01',
      });
      const context = makeContext({ currentDate: '2025-06-15' });
      const result = evaluateVoucher(voucher, context);
      expect(result.status).toBe('expired');
    });
  });

  describe('condition checks (valid_not_applicable)', () => {
    it('returns outlet mismatch when outletId is not in voucher outletIds', () => {
      const voucher = makeVoucher({ outletIds: ['outlet-2', 'outlet-3'] });
      const context = makeContext({ outletId: 'outlet-1' });
      const result = evaluateVoucher(voucher, context);

      expect(result).toEqual({
        status: 'valid_not_applicable',
        type: VoucherType.Fixed,
        discountValue: 25000,
        reason: 'Voucher is not valid for this outlet',
      });
    });

    it('returns brand mismatch when vehicleBrand is not in brandScope', () => {
      const voucher = makeVoucher({ brandScope: ['Honda', 'Suzuki'] });
      const context = makeContext({ vehicleBrand: 'Toyota' });
      const result = evaluateVoucher(voucher, context);

      expect(result).toEqual({
        status: 'valid_not_applicable',
        type: VoucherType.Fixed,
        discountValue: 25000,
        reason: 'Voucher is not valid for this vehicle brand',
      });
    });

    it('returns brand mismatch when vehicleBrand is undefined and brandScope is set', () => {
      const voucher = makeVoucher({ brandScope: ['Honda'] });
      const context = makeContext({ vehicleBrand: undefined });
      const result = evaluateVoucher(voucher, context);

      expect(result).toEqual({
        status: 'valid_not_applicable',
        type: VoucherType.Fixed,
        discountValue: 25000,
        reason: 'Voucher is not valid for this vehicle brand',
      });
    });

    it('returns service mismatch when no cart services match voucher serviceIds', () => {
      const voucher = makeVoucher({ serviceIds: ['svc-5', 'svc-6'] });
      const context = makeContext({ serviceIdsInCart: ['svc-1', 'svc-2'] });
      const result = evaluateVoucher(voucher, context);

      expect(result).toEqual({
        status: 'valid_not_applicable',
        type: VoucherType.Fixed,
        discountValue: 25000,
        reason: 'Voucher is not valid for the services in cart',
      });
    });

    it('returns min order not met when orderSubtotal is below minOrderAmount', () => {
      const voucher = makeVoucher({ minOrderAmount: 150000 });
      const context = makeContext({ orderSubtotal: 100000 });
      const result = evaluateVoucher(voucher, context);

      expect(result).toEqual({
        status: 'valid_not_applicable',
        type: VoucherType.Fixed,
        discountValue: 25000,
        reason: 'Minimum order amount of 150000 not met',
      });
    });
  });

  describe('condition check priority ordering', () => {
    it('outlet mismatch takes priority over brand mismatch', () => {
      const voucher = makeVoucher({
        outletIds: ['outlet-2'],
        brandScope: ['Honda'],
      });
      const context = makeContext({ outletId: 'outlet-1', vehicleBrand: 'Toyota' });
      const result = evaluateVoucher(voucher, context);
      expect(result.status).toBe('valid_not_applicable');
      if (result.status === 'valid_not_applicable') {
        expect(result.reason).toContain('outlet');
      }
    });

    it('brand mismatch takes priority over service mismatch', () => {
      const voucher = makeVoucher({
        brandScope: ['Honda'],
        serviceIds: ['svc-5'],
      });
      const context = makeContext({
        vehicleBrand: 'Toyota',
        serviceIdsInCart: ['svc-1'],
      });
      const result = evaluateVoucher(voucher, context);
      if (result.status === 'valid_not_applicable') {
        expect(result.reason).toContain('brand');
      }
    });

    it('service mismatch takes priority over min order not met', () => {
      const voucher = makeVoucher({
        serviceIds: ['svc-5'],
        minOrderAmount: 200000,
      });
      const context = makeContext({
        serviceIdsInCart: ['svc-1'],
        orderSubtotal: 100000,
      });
      const result = evaluateVoucher(voucher, context);
      if (result.status === 'valid_not_applicable') {
        expect(result.reason).toContain('services');
      }
    });
  });

  describe('valid_applicable state', () => {
    it('returns valid_applicable for a fixed voucher with all conditions met', () => {
      const voucher = makeVoucher({
        type: VoucherType.Fixed,
        value: 25000,
      });
      const result = evaluateVoucher(voucher, makeContext());

      expect(result).toEqual({
        status: 'valid_applicable',
        type: VoucherType.Fixed,
        discountValue: 25000,
      });
    });

    it('returns valid_applicable for a percentage voucher with all conditions met', () => {
      const voucher = makeVoucher({
        type: VoucherType.Percentage,
        value: 15,
      });
      const result = evaluateVoucher(voucher, makeContext());

      expect(result).toEqual({
        status: 'valid_applicable',
        type: VoucherType.Percentage,
        discountValue: 15,
      });
    });

    it('returns valid_applicable for a service_pack voucher with all conditions met', () => {
      const voucher = makeVoucher({
        type: VoucherType.ServicePack,
        value: 0,
      });
      const result = evaluateVoucher(voucher, makeContext());

      expect(result).toEqual({
        status: 'valid_applicable',
        type: VoucherType.ServicePack,
        discountValue: 0,
      });
    });

    it('returns valid_applicable when outlet matches one in outletIds', () => {
      const voucher = makeVoucher({ outletIds: ['outlet-1', 'outlet-2'] });
      const context = makeContext({ outletId: 'outlet-1' });
      const result = evaluateVoucher(voucher, context);
      expect(result.status).toBe('valid_applicable');
    });

    it('returns valid_applicable when brand matches one in brandScope', () => {
      const voucher = makeVoucher({ brandScope: ['Toyota', 'Honda'] });
      const context = makeContext({ vehicleBrand: 'Toyota' });
      const result = evaluateVoucher(voucher, context);
      expect(result.status).toBe('valid_applicable');
    });

    it('returns valid_applicable when at least one cart service matches serviceIds', () => {
      const voucher = makeVoucher({ serviceIds: ['svc-2', 'svc-5'] });
      const context = makeContext({ serviceIdsInCart: ['svc-1', 'svc-2', 'svc-3'] });
      const result = evaluateVoucher(voucher, context);
      expect(result.status).toBe('valid_applicable');
    });

    it('returns valid_applicable when orderSubtotal meets minOrderAmount', () => {
      const voucher = makeVoucher({ minOrderAmount: 100000 });
      const context = makeContext({ orderSubtotal: 100000 });
      const result = evaluateVoucher(voucher, context);
      expect(result.status).toBe('valid_applicable');
    });

    it('returns valid_applicable when orderSubtotal exceeds minOrderAmount', () => {
      const voucher = makeVoucher({ minOrderAmount: 50000 });
      const context = makeContext({ orderSubtotal: 100000 });
      const result = evaluateVoucher(voucher, context);
      expect(result.status).toBe('valid_applicable');
    });

    it('returns valid_applicable when all scopes are null (all outlets/brands/services)', () => {
      const voucher = makeVoucher({
        outletIds: null,
        brandScope: null,
        serviceIds: null,
        minOrderAmount: 0,
      });
      const result = evaluateVoucher(voucher, makeContext());
      expect(result.status).toBe('valid_applicable');
    });
  });

  describe('date boundary conditions', () => {
    it('is valid on exact expiryDate (not expired)', () => {
      const voucher = makeVoucher({ expiryDate: '2025-06-15' });
      const context = makeContext({ currentDate: '2025-06-15' });
      const result = evaluateVoucher(voucher, context);
      // expiryDate is NOT less than currentDate, so not expired
      expect(result.status).toBe('valid_applicable');
    });

    it('is valid on exact startDate (active)', () => {
      const voucher = makeVoucher({ startDate: '2025-06-15' });
      const context = makeContext({ currentDate: '2025-06-15' });
      const result = evaluateVoucher(voucher, context);
      // startDate is NOT greater than currentDate, so active
      expect(result.status).toBe('valid_applicable');
    });

    it('is expired when expiryDate is one day before currentDate', () => {
      const voucher = makeVoucher({ expiryDate: '2025-06-14' });
      const context = makeContext({ currentDate: '2025-06-15' });
      const result = evaluateVoucher(voucher, context);
      expect(result.status).toBe('expired');
    });

    it('is not_yet_active when startDate is one day after currentDate', () => {
      const voucher = makeVoucher({ startDate: '2025-06-16' });
      const context = makeContext({ currentDate: '2025-06-15' });
      const result = evaluateVoucher(voucher, context);
      expect(result).toEqual({ status: 'not_yet_active', startDate: '2025-06-16' });
    });
  });

  describe('edge cases', () => {
    it('handles minOrderAmount of 0 as no restriction', () => {
      const voucher = makeVoucher({ minOrderAmount: 0 });
      const context = makeContext({ orderSubtotal: 0 });
      const result = evaluateVoucher(voucher, context);
      expect(result.status).toBe('valid_applicable');
    });

    it('handles empty serviceIdsInCart with null serviceIds (no restriction)', () => {
      const voucher = makeVoucher({ serviceIds: null });
      const context = makeContext({ serviceIdsInCart: [] });
      const result = evaluateVoucher(voucher, context);
      expect(result.status).toBe('valid_applicable');
    });

    it('returns service mismatch when serviceIdsInCart is empty and serviceIds is set', () => {
      const voucher = makeVoucher({ serviceIds: ['svc-1'] });
      const context = makeContext({ serviceIdsInCart: [] });
      const result = evaluateVoucher(voucher, context);
      expect(result.status).toBe('valid_not_applicable');
      if (result.status === 'valid_not_applicable') {
        expect(result.reason).toContain('services');
      }
    });

    it('handles maxUses of 1 with currentUses of 0', () => {
      const voucher = makeVoucher({ maxUses: 1, currentUses: 0 });
      const result = evaluateVoucher(voucher, makeContext());
      expect(result.status).toBe('valid_applicable');
    });
  });
});
