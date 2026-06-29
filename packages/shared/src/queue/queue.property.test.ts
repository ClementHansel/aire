import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  sortQueue,
  calculatePriority,
  QueueEntry,
  MEMBER_PRIORITY_BOOST,
  BASE_PRIORITY,
} from './index';

/**
 * Property-based tests for queue member priority ordering.
 *
 * **Validates: Requirements 28.2**
 */

// --- Arbitrary Generators ---

let idCounter = 0;

/**
 * Generates a queue entry with the specified member status and a given createdAt timestamp.
 */
function arbQueueEntry(isMember: boolean): fc.Arbitrary<QueueEntry> {
  return fc.record({
    id: fc.string({ minLength: 1, maxLength: 10 }).map((s) => `q-${++idCounter}-${s}`),
    orderId: fc.string({ minLength: 1, maxLength: 10 }).map((s) => `o-${++idCounter}-${s}`),
    position: fc.nat({ max: 1000 }),
    priority: fc.constant(calculatePriority(isMember)),
    isMember: fc.constant(isMember),
    status: fc.constant('waiting' as const),
    createdAt: fc.nat({ max: 1_000_000_000 }),
  });
}

/**
 * Generates a queue entry with arbitrary member status.
 */
const arbAnyQueueEntry: fc.Arbitrary<QueueEntry> = fc
  .boolean()
  .chain((isMember) => arbQueueEntry(isMember));

/**
 * Generates a mixed queue with both member and non-member entries.
 */
const arbMixedQueue: fc.Arbitrary<QueueEntry[]> = fc
  .tuple(
    fc.array(arbQueueEntry(true), { minLength: 1, maxLength: 10 }),
    fc.array(arbQueueEntry(false), { minLength: 1, maxLength: 10 }),
  )
  .map(([members, regulars]) => [...members, ...regulars]);

describe('Queue Member Priority - Property-Based Tests', () => {
  describe('Property 25: Queue Member Priority', () => {
    it('members with same position always have higher priority than non-members', () => {
      fc.assert(
        fc.property(
          fc.nat({ max: 1000 }),
          (position) => {
            const memberPriority = calculatePriority(true);
            const regularPriority = calculatePriority(false);

            expect(memberPriority).toBeGreaterThan(regularPriority);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('in a sorted queue, members appear before non-members at the same creation time', () => {
      fc.assert(
        fc.property(
          fc.nat({ max: 1_000_000_000 }),
          fc.nat({ max: 1000 }),
          (createdAt, position) => {
            const memberEntry: QueueEntry = {
              id: 'member-1',
              orderId: 'order-m1',
              position,
              priority: calculatePriority(true),
              isMember: true,
              status: 'waiting',
              createdAt,
            };
            const regularEntry: QueueEntry = {
              id: 'regular-1',
              orderId: 'order-r1',
              position,
              priority: calculatePriority(false),
              isMember: false,
              status: 'waiting',
              createdAt,
            };

            const sorted = sortQueue([regularEntry, memberEntry]);
            const memberIndex = sorted.findIndex((e) => e.id === 'member-1');
            const regularIndex = sorted.findIndex((e) => e.id === 'regular-1');

            expect(memberIndex).toBeLessThan(regularIndex);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('queue is stable-sorted: same priority maintains FIFO by creation time', () => {
      fc.assert(
        fc.property(
          fc.array(arbQueueEntry(false), { minLength: 2, maxLength: 20 }),
          (entries) => {
            // Give all entries the same priority (all non-members)
            const sorted = sortQueue(entries);

            // For entries with the same priority, earlier createdAt comes first
            for (let i = 0; i < sorted.length - 1; i++) {
              if (sorted[i].priority === sorted[i + 1].priority) {
                expect(sorted[i].createdAt).toBeLessThanOrEqual(sorted[i + 1].createdAt);
              }
            }
          },
        ),
        { numRuns: 200 },
      );
    });

    it('priority is always non-negative', () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          fc.integer({ min: -100, max: 100 }),
          (isMember, basePriority) => {
            const priority = calculatePriority(isMember, basePriority);
            expect(priority).toBeGreaterThanOrEqual(0);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('member priority boost is consistent (always +10)', () => {
      fc.assert(
        fc.property(
          fc.nat({ max: 100 }),
          (basePriority) => {
            const memberPriority = calculatePriority(true, basePriority);
            const regularPriority = calculatePriority(false, basePriority);

            expect(memberPriority - regularPriority).toBe(MEMBER_PRIORITY_BOOST);
            expect(MEMBER_PRIORITY_BOOST).toBe(10);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('sortQueue produces correct ordering for mixed member/regular queues', () => {
      fc.assert(
        fc.property(arbMixedQueue, (entries) => {
          const sorted = sortQueue(entries);

          // Verify sorted invariant: for every consecutive pair,
          // either higher priority first, or same priority with earlier/equal createdAt first
          for (let i = 0; i < sorted.length - 1; i++) {
            const curr = sorted[i];
            const next = sorted[i + 1];

            if (curr.priority !== next.priority) {
              // Higher priority should come first
              expect(curr.priority).toBeGreaterThan(next.priority);
            } else {
              // Same priority: FIFO by creation time
              expect(curr.createdAt).toBeLessThanOrEqual(next.createdAt);
            }
          }
        }),
        { numRuns: 200 },
      );
    });

    it('sortQueue does not lose or duplicate entries', () => {
      fc.assert(
        fc.property(
          fc.array(arbAnyQueueEntry, { minLength: 0, maxLength: 20 }),
          (entries) => {
            const sorted = sortQueue(entries);
            expect(sorted.length).toBe(entries.length);

            // All original entry IDs are present in the sorted result
            const originalIds = entries.map((e) => e.id).sort();
            const sortedIds = sorted.map((e) => e.id).sort();
            expect(sortedIds).toEqual(originalIds);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('sortQueue does not mutate the original array', () => {
      fc.assert(
        fc.property(
          fc.array(arbAnyQueueEntry, { minLength: 1, maxLength: 10 }),
          (entries) => {
            const original = [...entries];
            sortQueue(entries);
            expect(entries).toEqual(original);
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});
