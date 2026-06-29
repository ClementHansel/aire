import { describe, it, expect } from 'vitest';
import {
  QueueEntry,
  calculatePriority,
  sortQueue,
  createQueueEntry,
  assignBayFromQueue,
  updateQueueStatus,
  getWaitingQueue,
  getInProgressEntries,
  removeCompletedEntry,
  MEMBER_PRIORITY_BOOST,
  BASE_PRIORITY,
} from './index';

function makeEntry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    id: 'entry-1',
    orderId: 'order-1',
    position: 1,
    priority: BASE_PRIORITY,
    isMember: false,
    status: 'waiting',
    createdAt: 1704067200000, // 2024-01-01T10:00:00Z
    ...overrides,
  };
}

describe('calculatePriority', () => {
  it('returns base priority for non-members', () => {
    expect(calculatePriority(false)).toBe(BASE_PRIORITY);
  });

  it('returns base priority + boost for members', () => {
    expect(calculatePriority(true)).toBe(BASE_PRIORITY + MEMBER_PRIORITY_BOOST);
  });

  it('member priority is always higher than regular priority', () => {
    const memberPriority = calculatePriority(true, 1);
    const regularPriority = calculatePriority(false, 1);
    expect(memberPriority).toBeGreaterThan(regularPriority);
  });
});

describe('sortQueue', () => {
  it('sorts by priority DESC (higher priority first)', () => {
    const entries: QueueEntry[] = [
      makeEntry({ id: 'regular', priority: 0, position: 1 }),
      makeEntry({ id: 'member', priority: 10, position: 2 }),
    ];

    const sorted = sortQueue(entries);
    expect(sorted[0].id).toBe('member');
    expect(sorted[1].id).toBe('regular');
  });

  it('sorts by createdAt ASC within same priority (FIFO)', () => {
    const entries: QueueEntry[] = [
      makeEntry({ id: 'later', priority: 0, position: 3, createdAt: 1704067200003 }),
      makeEntry({ id: 'first', priority: 0, position: 1, createdAt: 1704067200001 }),
      makeEntry({ id: 'middle', priority: 0, position: 2, createdAt: 1704067200002 }),
    ];

    const sorted = sortQueue(entries);
    expect(sorted[0].id).toBe('first');
    expect(sorted[1].id).toBe('middle');
    expect(sorted[2].id).toBe('later');
  });

  it('members come before regulars even if regulars have lower position', () => {
    const entries: QueueEntry[] = [
      makeEntry({ id: 'regular-first', priority: BASE_PRIORITY, position: 1, isMember: false }),
      makeEntry({ id: 'member-second', priority: BASE_PRIORITY + MEMBER_PRIORITY_BOOST, position: 2, isMember: true }),
    ];

    const sorted = sortQueue(entries);
    expect(sorted[0].id).toBe('member-second');
    expect(sorted[1].id).toBe('regular-first');
  });

  it('does not mutate the original array', () => {
    const entries: QueueEntry[] = [
      makeEntry({ id: 'b', position: 2 }),
      makeEntry({ id: 'a', position: 1 }),
    ];
    const original = [...entries];
    sortQueue(entries);
    expect(entries[0].id).toBe(original[0].id);
    expect(entries[1].id).toBe(original[1].id);
  });

  it('returns empty array for empty input', () => {
    expect(sortQueue([])).toEqual([]);
  });

  it('correctly orders multiple members by FIFO (createdAt)', () => {
    const entries: QueueEntry[] = [
      makeEntry({ id: 'member-3', priority: 10, position: 3, isMember: true, createdAt: 1704067200003 }),
      makeEntry({ id: 'member-1', priority: 10, position: 1, isMember: true, createdAt: 1704067200001 }),
      makeEntry({ id: 'member-2', priority: 10, position: 2, isMember: true, createdAt: 1704067200002 }),
    ];

    const sorted = sortQueue(entries);
    expect(sorted[0].id).toBe('member-1');
    expect(sorted[1].id).toBe('member-2');
    expect(sorted[2].id).toBe('member-3');
  });
});

describe('createQueueEntry', () => {
  it('creates an entry with position 1 for empty queue', () => {
    const entry = createQueueEntry(
      { id: 'e1', orderId: 'o1', isMember: false },
      [],
    );

    expect(entry.position).toBe(1);
    expect(entry.status).toBe('waiting');
    expect(entry.priority).toBe(BASE_PRIORITY);
    expect(entry.isMember).toBe(false);
  });

  it('creates an entry with next position based on current queue', () => {
    const existing: QueueEntry[] = [
      makeEntry({ position: 1 }),
      makeEntry({ position: 2 }),
    ];

    const entry = createQueueEntry(
      { id: 'e3', orderId: 'o3', isMember: false },
      existing,
    );

    expect(entry.position).toBe(3);
  });

  it('assigns member priority for member entries', () => {
    const entry = createQueueEntry(
      { id: 'e1', orderId: 'o1', isMember: true },
      [],
    );

    expect(entry.priority).toBe(BASE_PRIORITY + MEMBER_PRIORITY_BOOST);
    expect(entry.isMember).toBe(true);
  });

  it('assigns base priority for non-member entries', () => {
    const entry = createQueueEntry(
      { id: 'e1', orderId: 'o1', isMember: false },
      [],
    );

    expect(entry.priority).toBe(BASE_PRIORITY);
  });

  it('uses provided createdAt timestamp', () => {
    const ts = 1718457000000; // 2024-06-15T14:30:00Z
    const entry = createQueueEntry(
      { id: 'e1', orderId: 'o1', isMember: false, createdAt: ts },
      [],
    );

    expect(entry.createdAt).toBe(ts);
  });

  it('uses current timestamp when createdAt not provided', () => {
    const before = Date.now();
    const entry = createQueueEntry(
      { id: 'e1', orderId: 'o1', isMember: false },
      [],
    );
    const after = Date.now();

    expect(entry.createdAt).toBeGreaterThanOrEqual(before);
    expect(entry.createdAt).toBeLessThanOrEqual(after);
  });
});

describe('assignBayFromQueue', () => {
  it('assigns bay to the highest priority waiting entry', () => {
    const queue: QueueEntry[] = [
      makeEntry({ id: 'regular', priority: 0, position: 1, status: 'waiting' }),
      makeEntry({ id: 'member', priority: 10, position: 2, status: 'waiting', isMember: true }),
    ];

    const result = assignBayFromQueue(queue, 'bay-1');

    expect(result.success).toBe(true);
    expect(result.entry?.id).toBe('member');
    expect(result.entry?.status).toBe('in_progress');
    expect(result.entry?.bayId).toBe('bay-1');
  });

  it('assigns bay to earliest createdAt when all same priority (FIFO)', () => {
    const queue: QueueEntry[] = [
      makeEntry({ id: 'second', priority: 0, position: 2, status: 'waiting', createdAt: 1704067200002 }),
      makeEntry({ id: 'first', priority: 0, position: 1, status: 'waiting', createdAt: 1704067200001 }),
    ];

    const result = assignBayFromQueue(queue, 'bay-1');

    expect(result.success).toBe(true);
    expect(result.entry?.id).toBe('first');
  });

  it('skips non-waiting entries', () => {
    const queue: QueueEntry[] = [
      makeEntry({ id: 'in-progress', priority: 10, position: 1, status: 'in_progress' }),
      makeEntry({ id: 'waiting', priority: 0, position: 2, status: 'waiting' }),
    ];

    const result = assignBayFromQueue(queue, 'bay-1');

    expect(result.success).toBe(true);
    expect(result.entry?.id).toBe('waiting');
  });

  it('returns error when no waiting entries exist', () => {
    const queue: QueueEntry[] = [
      makeEntry({ id: 'done', status: 'completed' }),
      makeEntry({ id: 'active', status: 'in_progress' }),
    ];

    const result = assignBayFromQueue(queue, 'bay-1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('No waiting entries in queue');
    expect(result.entry).toBeUndefined();
  });

  it('returns error for empty queue', () => {
    const result = assignBayFromQueue([], 'bay-1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('No waiting entries in queue');
  });
});

describe('updateQueueStatus', () => {
  it('transitions from waiting to in_progress', () => {
    const entry = makeEntry({ status: 'waiting' });
    const result = updateQueueStatus(entry, 'in_progress');

    expect(result).not.toBeNull();
    expect(result?.status).toBe('in_progress');
  });

  it('transitions from in_progress to completed', () => {
    const entry = makeEntry({ status: 'in_progress' });
    const result = updateQueueStatus(entry, 'completed');

    expect(result).not.toBeNull();
    expect(result?.status).toBe('completed');
  });

  it('rejects invalid transition: waiting to completed', () => {
    const entry = makeEntry({ status: 'waiting' });
    const result = updateQueueStatus(entry, 'completed');

    expect(result).toBeNull();
  });

  it('rejects invalid transition: in_progress to waiting', () => {
    const entry = makeEntry({ status: 'in_progress' });
    const result = updateQueueStatus(entry, 'waiting');

    expect(result).toBeNull();
  });

  it('rejects invalid transition: completed to waiting', () => {
    const entry = makeEntry({ status: 'completed' });
    const result = updateQueueStatus(entry, 'waiting');

    expect(result).toBeNull();
  });

  it('rejects invalid transition: completed to in_progress', () => {
    const entry = makeEntry({ status: 'completed' });
    const result = updateQueueStatus(entry, 'in_progress');

    expect(result).toBeNull();
  });

  it('does not mutate the original entry', () => {
    const entry = makeEntry({ status: 'waiting' });
    updateQueueStatus(entry, 'in_progress');

    expect(entry.status).toBe('waiting');
  });
});

describe('getWaitingQueue', () => {
  it('returns only waiting entries sorted by priority and createdAt', () => {
    const queue: QueueEntry[] = [
      makeEntry({ id: 'regular-2', priority: 0, position: 2, status: 'waiting', createdAt: 1704067200004 }),
      makeEntry({ id: 'in-progress', priority: 10, position: 1, status: 'in_progress', createdAt: 1704067200001 }),
      makeEntry({ id: 'member-3', priority: 10, position: 3, status: 'waiting', isMember: true, createdAt: 1704067200003 }),
      makeEntry({ id: 'regular-1', priority: 0, position: 1, status: 'waiting', createdAt: 1704067200002 }),
    ];

    const result = getWaitingQueue(queue);

    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('member-3');
    expect(result[1].id).toBe('regular-1');
    expect(result[2].id).toBe('regular-2');
  });

  it('returns empty array when no waiting entries', () => {
    const queue: QueueEntry[] = [
      makeEntry({ status: 'in_progress' }),
      makeEntry({ status: 'completed' }),
    ];

    expect(getWaitingQueue(queue)).toEqual([]);
  });
});

describe('getInProgressEntries', () => {
  it('returns only in_progress entries', () => {
    const queue: QueueEntry[] = [
      makeEntry({ id: 'waiting', status: 'waiting' }),
      makeEntry({ id: 'active-1', status: 'in_progress' }),
      makeEntry({ id: 'active-2', status: 'in_progress' }),
      makeEntry({ id: 'done', status: 'completed' }),
    ];

    const result = getInProgressEntries(queue);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('active-1');
    expect(result[1].id).toBe('active-2');
  });

  it('returns empty array when no in_progress entries', () => {
    const queue: QueueEntry[] = [
      makeEntry({ status: 'waiting' }),
      makeEntry({ status: 'completed' }),
    ];

    expect(getInProgressEntries(queue)).toEqual([]);
  });
});

describe('removeCompletedEntry', () => {
  it('removes a completed entry by id', () => {
    const queue: QueueEntry[] = [
      makeEntry({ id: 'e1', status: 'completed' }),
      makeEntry({ id: 'e2', status: 'waiting' }),
    ];

    const result = removeCompletedEntry(queue, 'e1');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('e2');
  });

  it('does not remove a non-completed entry with matching id', () => {
    const queue: QueueEntry[] = [
      makeEntry({ id: 'e1', status: 'waiting' }),
      makeEntry({ id: 'e2', status: 'in_progress' }),
    ];

    const result = removeCompletedEntry(queue, 'e1');

    expect(result).toHaveLength(2);
  });

  it('returns same queue if id not found', () => {
    const queue: QueueEntry[] = [
      makeEntry({ id: 'e1', status: 'completed' }),
    ];

    const result = removeCompletedEntry(queue, 'nonexistent');

    expect(result).toHaveLength(1);
  });

  it('does not mutate the original array', () => {
    const queue: QueueEntry[] = [
      makeEntry({ id: 'e1', status: 'completed' }),
    ];

    removeCompletedEntry(queue, 'e1');

    expect(queue).toHaveLength(1);
  });
});
