import { describe, it, expect } from 'vitest';
import { checkQuota, recordUsage, MembershipQuotaState, DailyUsageRecord } from './quota-tracker';
import { MembershipStatus } from '../enums';

describe('checkQuota', () => {
  const baseMembership: MembershipQuotaState = {
    membershipId: 'mem-001',
    usesCount: 5,
    maxUses: 30,
    dailyLimit: 1,
    status: MembershipStatus.Active,
  };

  const today = '2024-06-15';

  describe('normal usage (within limits)', () => {
    it('should allow usage when within all limits', () => {
      const result = checkQuota(baseMembership, 'B1234ABC', [], today);

      expect(result.canUse).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(result.usesRemaining).toBe(25);
      expect(result.dailyUsesToday).toBe(0);
      expect(result.shouldExpire).toBe(false);
      expect(result.warning).toBeUndefined();
    });

    it('should allow usage when daily limit is higher and no usages today', () => {
      const membership: MembershipQuotaState = {
        ...baseMembership,
        dailyLimit: 3,
      };

      const result = checkQuota(membership, 'B1234ABC', [], today);

      expect(result.canUse).toBe(true);
      expect(result.dailyUsesToday).toBe(0);
    });

    it('should allow usage when plate has used today but under daily limit', () => {
      const membership: MembershipQuotaState = {
        ...baseMembership,
        dailyLimit: 3,
      };
      const usages: DailyUsageRecord[] = [
        { plateNormalized: 'B1234ABC', usedAt: '2024-06-15T08:00:00+07:00' },
        { plateNormalized: 'B1234ABC', usedAt: '2024-06-15T12:00:00+07:00' },
      ];

      const result = checkQuota(membership, 'B1234ABC', usages, today);

      expect(result.canUse).toBe(true);
      expect(result.dailyUsesToday).toBe(2);
      expect(result.shouldExpire).toBe(false);
    });
  });

  describe('daily limit reached', () => {
    it('should reject usage when daily limit of 1 is reached', () => {
      const usages: DailyUsageRecord[] = [
        { plateNormalized: 'B1234ABC', usedAt: '2024-06-15T08:00:00+07:00' },
      ];

      const result = checkQuota(baseMembership, 'B1234ABC', usages, today);

      expect(result.canUse).toBe(false);
      expect(result.reason).toBe('daily_limit_reached');
      expect(result.dailyUsesToday).toBe(1);
      expect(result.shouldExpire).toBe(false);
      expect(result.warning).toBe('Vehicle already washed today');
    });

    it('should reject usage when daily limit of 2 is reached', () => {
      const membership: MembershipQuotaState = {
        ...baseMembership,
        dailyLimit: 2,
      };
      const usages: DailyUsageRecord[] = [
        { plateNormalized: 'B1234ABC', usedAt: '2024-06-15T08:00:00+07:00' },
        { plateNormalized: 'B1234ABC', usedAt: '2024-06-15T14:00:00+07:00' },
      ];

      const result = checkQuota(membership, 'B1234ABC', usages, today);

      expect(result.canUse).toBe(false);
      expect(result.reason).toBe('daily_limit_reached');
      expect(result.dailyUsesToday).toBe(2);
      expect(result.warning).toBe('Vehicle already washed today');
    });
  });

  describe('lifetime quota exhausted', () => {
    it('should reject usage when lifetime quota is already used up', () => {
      const membership: MembershipQuotaState = {
        ...baseMembership,
        usesCount: 30,
        maxUses: 30,
      };

      const result = checkQuota(membership, 'B1234ABC', [], today);

      expect(result.canUse).toBe(false);
      expect(result.reason).toBe('quota_exhausted');
      expect(result.usesRemaining).toBe(0);
      expect(result.shouldExpire).toBe(true);
    });

    it('should reject usage when uses exceed max (edge case)', () => {
      const membership: MembershipQuotaState = {
        ...baseMembership,
        usesCount: 35,
        maxUses: 30,
      };

      const result = checkQuota(membership, 'B1234ABC', [], today);

      expect(result.canUse).toBe(false);
      expect(result.reason).toBe('quota_exhausted');
      expect(result.usesRemaining).toBe(0);
      expect(result.shouldExpire).toBe(true);
    });
  });

  describe('last available use (shouldExpire = true)', () => {
    it('should allow usage but flag shouldExpire when this is the last use', () => {
      const membership: MembershipQuotaState = {
        ...baseMembership,
        usesCount: 29,
        maxUses: 30,
      };

      const result = checkQuota(membership, 'B1234ABC', [], today);

      expect(result.canUse).toBe(true);
      expect(result.usesRemaining).toBe(1);
      expect(result.shouldExpire).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });

  describe('multiple plates on same day', () => {
    it('should allow different plates independently within daily limit', () => {
      const usages: DailyUsageRecord[] = [
        { plateNormalized: 'B1234ABC', usedAt: '2024-06-15T08:00:00+07:00' },
      ];

      // Plate B1234ABC already used today (should be rejected)
      const result1 = checkQuota(baseMembership, 'B1234ABC', usages, today);
      expect(result1.canUse).toBe(false);
      expect(result1.reason).toBe('daily_limit_reached');

      // Plate D5678XYZ has NOT been used today (should be allowed)
      const result2 = checkQuota(baseMembership, 'D5678XYZ', usages, today);
      expect(result2.canUse).toBe(true);
      expect(result2.dailyUsesToday).toBe(0);
    });

    it('should track each plate usage count independently', () => {
      const membership: MembershipQuotaState = {
        ...baseMembership,
        dailyLimit: 2,
      };
      const usages: DailyUsageRecord[] = [
        { plateNormalized: 'B1234ABC', usedAt: '2024-06-15T08:00:00+07:00' },
        { plateNormalized: 'B1234ABC', usedAt: '2024-06-15T10:00:00+07:00' },
        { plateNormalized: 'D5678XYZ', usedAt: '2024-06-15T09:00:00+07:00' },
      ];

      // B1234ABC has 2 uses → at daily limit
      const result1 = checkQuota(membership, 'B1234ABC', usages, today);
      expect(result1.canUse).toBe(false);
      expect(result1.dailyUsesToday).toBe(2);

      // D5678XYZ has 1 use → still under daily limit
      const result2 = checkQuota(membership, 'D5678XYZ', usages, today);
      expect(result2.canUse).toBe(true);
      expect(result2.dailyUsesToday).toBe(1);
    });
  });

  describe('date boundary (yesterday does not count today)', () => {
    it('should not count yesterday usages toward today daily limit', () => {
      const yesterday = '2024-06-14';
      const usages: DailyUsageRecord[] = [
        { plateNormalized: 'B1234ABC', usedAt: '2024-06-14T23:59:00+07:00' },
      ];

      // Check today — yesterday usage should not count
      const result = checkQuota(baseMembership, 'B1234ABC', usages, today);

      expect(result.canUse).toBe(true);
      expect(result.dailyUsesToday).toBe(0);
    });

    it('should only count usages matching the currentDateWIB', () => {
      const usages: DailyUsageRecord[] = [
        { plateNormalized: 'B1234ABC', usedAt: '2024-06-14T23:30:00+07:00' }, // yesterday
        { plateNormalized: 'B1234ABC', usedAt: '2024-06-15T00:05:00+07:00' }, // today
      ];

      const result = checkQuota(baseMembership, 'B1234ABC', usages, today);

      expect(result.canUse).toBe(false);
      expect(result.reason).toBe('daily_limit_reached');
      expect(result.dailyUsesToday).toBe(1);
    });
  });

  describe('priority: lifetime quota exhausted takes precedence over daily limit', () => {
    it('should return quota_exhausted even if plate has daily uses', () => {
      const membership: MembershipQuotaState = {
        ...baseMembership,
        usesCount: 30,
        maxUses: 30,
      };
      const usages: DailyUsageRecord[] = [
        { plateNormalized: 'B1234ABC', usedAt: '2024-06-15T08:00:00+07:00' },
      ];

      const result = checkQuota(membership, 'B1234ABC', usages, today);

      expect(result.canUse).toBe(false);
      expect(result.reason).toBe('quota_exhausted');
    });
  });
});

describe('recordUsage', () => {
  it('should increment usesCount by 1', () => {
    const state: MembershipQuotaState = {
      membershipId: 'mem-001',
      usesCount: 5,
      maxUses: 30,
      dailyLimit: 1,
      status: MembershipStatus.Active,
    };

    const result = recordUsage(state);

    expect(result.usesCount).toBe(6);
    expect(result.status).toBe(MembershipStatus.Active);
  });

  it('should not mutate the original state', () => {
    const state: MembershipQuotaState = {
      membershipId: 'mem-001',
      usesCount: 5,
      maxUses: 30,
      dailyLimit: 1,
      status: MembershipStatus.Active,
    };

    const result = recordUsage(state);

    expect(state.usesCount).toBe(5); // original unchanged
    expect(result.usesCount).toBe(6);
  });

  it('should set status to expired when usesCount reaches maxUses', () => {
    const state: MembershipQuotaState = {
      membershipId: 'mem-001',
      usesCount: 29,
      maxUses: 30,
      dailyLimit: 1,
      status: MembershipStatus.Active,
    };

    const result = recordUsage(state);

    expect(result.usesCount).toBe(30);
    expect(result.status).toBe(MembershipStatus.Expired);
  });

  it('should set status to expired when usesCount exceeds maxUses', () => {
    const state: MembershipQuotaState = {
      membershipId: 'mem-001',
      usesCount: 30,
      maxUses: 30,
      dailyLimit: 1,
      status: MembershipStatus.Active,
    };

    const result = recordUsage(state);

    expect(result.usesCount).toBe(31);
    expect(result.status).toBe(MembershipStatus.Expired);
  });

  it('should preserve all other fields unchanged', () => {
    const state: MembershipQuotaState = {
      membershipId: 'mem-specific',
      usesCount: 10,
      maxUses: 50,
      dailyLimit: 2,
      status: MembershipStatus.Active,
    };

    const result = recordUsage(state);

    expect(result.membershipId).toBe('mem-specific');
    expect(result.maxUses).toBe(50);
    expect(result.dailyLimit).toBe(2);
  });
});
