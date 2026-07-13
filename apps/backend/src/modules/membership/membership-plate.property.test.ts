import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { BadRequestException } from '@nestjs/common';
import { ERR_MEMBERSHIP_MAX_PLATES_EXCEEDED } from '@aire/shared';
import { MembershipPlateService } from './membership-plate.service';
import { MembershipPlateRow } from './interfaces';

/**
 * Property-Based Test: Membership Plate Limit Enforcement (Property 18)
 *
 * **Validates: Requirements 16.1, 16.3**
 *
 * Properties:
 * - For any membership with max_plates=N, adding plates succeeds for count ≤ N and fails at N+1
 * - The Nth plate succeeds, the (N+1)th plate throws BadRequestException
 * - After releasePlates, the plate count should be 0
 * - Every attempt to add beyond max_plates throws the same error code
 */

// --- Arbitraries ---

/** max_plates between 1 and 10 (realistic plan limits) */
const maxPlatesArbitrary = fc.integer({ min: 1, max: 10 });

/** Generate a valid plate string (alphanumeric with optional spaces) */
const plateArbitrary = fc
  .tuple(
    fc.string({ unit: fc.constantFrom('A', 'B', 'C', 'D', 'E', 'F'), minLength: 1, maxLength: 2 }),
    fc.string({ unit: fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), minLength: 1, maxLength: 4 }),
    fc.string({ unit: fc.constantFrom('A', 'B', 'C', 'X', 'Y', 'Z'), minLength: 1, maxLength: 3 }),
  )
  .map(([prefix, num, suffix]) => `${prefix} ${num} ${suffix}`);

// --- Helpers ---

const membershipId = 'membership-test-001';

function createMockPlateRow(plate: string, index: number): MembershipPlateRow {
  const normalized = plate.replace(/\s/g, '').toUpperCase();
  return {
    id: `plate-${index}`,
    membership_id: membershipId,
    plate,
    plate_normalized: normalized,
    brand: null,
    model: null,
    created_at: new Date(),
  };
}

describe('Property 18: Membership Plate Limit Enforcement', () => {
  let service: MembershipPlateService;
  let mockPool: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = { query: vi.fn() };
    service = new MembershipPlateService(mockPool as any);
  });

  it('limit enforcement: for any max_plates=N, adding plates succeeds for count ≤ N and fails at N+1', async () => {
    await fc.assert(
      fc.asyncProperty(
        maxPlatesArbitrary,
        fc.array(plateArbitrary, { minLength: 1, maxLength: 11 }),
        async (maxPlates, plates) => {
          // We need at least maxPlates + 1 plates to test boundary
          const platesToAdd = plates.slice(0, maxPlates + 1);
          if (platesToAdd.length < maxPlates + 1) return; // skip if not enough plates generated

          let currentCount = 0;

          for (let i = 0; i < platesToAdd.length; i++) {
            // Reset mock for each addPlate call
            mockPool.query.mockReset();

            // getMaxPlatesForMembership
            mockPool.query.mockResolvedValueOnce({ rows: [{ max_plates: maxPlates }] });
            // getPlateCount
            mockPool.query.mockResolvedValueOnce({ rows: [{ count: String(currentCount) }] });

            if (currentCount < maxPlates) {
              // Should succeed — INSERT + audit log
              const plateRow = createMockPlateRow(platesToAdd[i]!, i);
              mockPool.query.mockResolvedValueOnce({ rows: [plateRow] });
              mockPool.query.mockResolvedValueOnce({ rows: [] });

              const result = await service.addPlate(membershipId, platesToAdd[i]!);
              expect(result).toBeDefined();
              expect(result.membershipId).toBe(membershipId);
              currentCount++;
            } else {
              // Should fail — plate limit exceeded
              await expect(
                service.addPlate(membershipId, platesToAdd[i]!),
              ).rejects.toThrow(BadRequestException);
            }
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('exact boundary: the Nth plate succeeds, the (N+1)th plate throws BadRequestException', async () => {
    await fc.assert(
      fc.asyncProperty(
        maxPlatesArbitrary,
        plateArbitrary,
        plateArbitrary,
        async (maxPlates, nthPlate, extraPlate) => {
          // --- Add the Nth plate (currentCount = maxPlates - 1) ---
          mockPool.query.mockReset();
          mockPool.query.mockResolvedValueOnce({ rows: [{ max_plates: maxPlates }] });
          mockPool.query.mockResolvedValueOnce({ rows: [{ count: String(maxPlates - 1) }] });
          const plateRow = createMockPlateRow(nthPlate, maxPlates - 1);
          mockPool.query.mockResolvedValueOnce({ rows: [plateRow] });
          mockPool.query.mockResolvedValueOnce({ rows: [] });

          const result = await service.addPlate(membershipId, nthPlate);
          expect(result).toBeDefined();

          // --- Attempt the (N+1)th plate (currentCount = maxPlates) ---
          mockPool.query.mockReset();
          mockPool.query.mockResolvedValueOnce({ rows: [{ max_plates: maxPlates }] });
          mockPool.query.mockResolvedValueOnce({ rows: [{ count: String(maxPlates) }] });

          await expect(
            service.addPlate(membershipId, extraPlate),
          ).rejects.toThrow(BadRequestException);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('release completeness: after releasePlates, the plate count should be 0', async () => {
    await fc.assert(
      fc.asyncProperty(
        maxPlatesArbitrary,
        fc.array(plateArbitrary, { minLength: 1, maxLength: 10 }),
        async (maxPlates, plates) => {
          const plateCount = Math.min(plates.length, maxPlates);
          const existingPlateRows: MembershipPlateRow[] = plates
            .slice(0, plateCount)
            .map((plate, i) => createMockPlateRow(plate, i));

          mockPool.query.mockReset();

          // releasePlates first calls getPlates (SELECT)
          mockPool.query.mockResolvedValueOnce({ rows: existingPlateRows });
          // Then DELETE all
          mockPool.query.mockResolvedValueOnce({ rowCount: plateCount });
          // Then audit log
          mockPool.query.mockResolvedValueOnce({ rows: [] });

          await service.releasePlates(membershipId);

          // Verify DELETE was called with the membership ID
          const deleteCall = mockPool.query.mock.calls[1];
          expect(deleteCall[0]).toContain('DELETE FROM membership_plates WHERE membership_id');
          expect(deleteCall[1][0]).toBe(membershipId);

          // Simulate post-release state: verify that if we now query count, it's 0
          mockPool.query.mockResolvedValueOnce({ rows: [{ max_plates: maxPlates }] });
          mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
          const newPlateRow = createMockPlateRow(plates[0]!, 0);
          mockPool.query.mockResolvedValueOnce({ rows: [newPlateRow] });
          mockPool.query.mockResolvedValueOnce({ rows: [] });

          // After release, adding a plate should succeed (count is 0)
          const result = await service.addPlate(membershipId, plates[0]!);
          expect(result).toBeDefined();
        },
      ),
      { numRuns: 50 },
    );
  });

  it('consistent rejection: every attempt to add beyond max_plates throws the same error code', async () => {
    await fc.assert(
      fc.asyncProperty(
        maxPlatesArbitrary,
        fc.array(plateArbitrary, { minLength: 2, maxLength: 5 }),
        async (maxPlates, extraPlates) => {
          const errors: string[] = [];

          for (const plate of extraPlates) {
            mockPool.query.mockReset();
            // getMaxPlatesForMembership
            mockPool.query.mockResolvedValueOnce({ rows: [{ max_plates: maxPlates }] });
            // getPlateCount — already at max
            mockPool.query.mockResolvedValueOnce({ rows: [{ count: String(maxPlates) }] });

            try {
              await service.addPlate(membershipId, plate);
              // Should not reach here
              errors.push('NO_ERROR');
            } catch (e: any) {
              expect(e).toBeInstanceOf(BadRequestException);
              errors.push(e.message);
            }
          }

          // All error messages should be the same error code
          const uniqueErrors = [...new Set(errors)];
          expect(uniqueErrors).toHaveLength(1);
          expect(uniqueErrors[0]).toBe(ERR_MEMBERSHIP_MAX_PLATES_EXCEEDED);
        },
      ),
      { numRuns: 100 },
    );
  });
});
