/**
 * Queue management service for the AIRE Operations Platform.
 *
 * Handles queue entry management, member priority ordering,
 * bay assignment from queue, and queue status transitions.
 *
 * Queue ordering: priority DESC, then createdAt ASC (FIFO within same priority).
 * Members receive a priority boost of +10 over regular customers.
 *
 * Requirements: 28.1, 28.2, 28.3
 */

/** Queue entry status lifecycle: waiting → in_progress → completed */
export type QueueStatus = 'waiting' | 'in_progress' | 'completed';

/** Represents a single entry in the queue */
export interface QueueEntry {
  id: string;
  orderId: string;
  position: number;
  priority: number;
  isMember: boolean;
  status: QueueStatus;
  bayId?: string;
  createdAt: number;
}

/** Input for creating a new queue entry */
export interface CreateQueueEntryInput {
  id: string;
  orderId: string;
  isMember: boolean;
  createdAt?: number;
}

/** Result of a bay assignment operation */
export interface BayAssignmentResult {
  success: boolean;
  entry?: QueueEntry;
  error?: string;
}

/** Priority boost given to members over regular customers */
export const MEMBER_PRIORITY_BOOST = 10;

/** Base priority for regular (non-member) customers */
export const BASE_PRIORITY = 0;

/**
 * Calculates the priority score for a queue entry.
 * Members receive a +10 boost to their priority score.
 *
 * @param isMember - Whether the customer is a member
 * @param _position - Position in queue (reserved for future weighting)
 * @returns The calculated priority score
 */
export function calculatePriority(isMember: boolean, _position: number = 0): number {
  return isMember ? BASE_PRIORITY + MEMBER_PRIORITY_BOOST : BASE_PRIORITY;
}

/**
 * Sorts queue entries by priority DESC, then createdAt ASC (FIFO within same priority).
 * This ensures members are served before regular customers,
 * and within the same priority level, earlier arrivals are served first.
 *
 * @param entries - Array of queue entries to sort
 * @returns A new sorted array (does not mutate original)
 */
export function sortQueue(entries: QueueEntry[]): QueueEntry[] {
  return [...entries].sort((a, b) => {
    // Higher priority first (DESC)
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    // Same priority: earlier createdAt first (ASC / FIFO)
    return a.createdAt - b.createdAt;
  });
}

/**
 * Creates a new queue entry with the correct position and priority.
 * Position is determined by the current queue length (next available slot).
 *
 * @param input - The queue entry creation input
 * @param currentQueue - The current state of the queue
 * @returns The newly created QueueEntry
 */
export function createQueueEntry(
  input: CreateQueueEntryInput,
  currentQueue: QueueEntry[],
): QueueEntry {
  const nextPosition = currentQueue.length > 0
    ? Math.max(...currentQueue.map((e) => e.position)) + 1
    : 1;

  const priority = calculatePriority(input.isMember, nextPosition);

  return {
    id: input.id,
    orderId: input.orderId,
    position: nextPosition,
    priority,
    isMember: input.isMember,
    status: 'waiting',
    createdAt: input.createdAt !== undefined ? input.createdAt : Date.now(),
  };
}

/**
 * Assigns a bay to the next waiting entry in the queue (highest priority first).
 * Transitions the entry status from 'waiting' to 'in_progress'.
 *
 * @param queue - Current queue entries
 * @param bayId - The ID of the bay to assign
 * @returns BayAssignmentResult with the updated entry or error
 */
export function assignBayFromQueue(
  queue: QueueEntry[],
  bayId: string,
): BayAssignmentResult {
  const waitingEntries = queue.filter((e) => e.status === 'waiting');

  if (waitingEntries.length === 0) {
    return { success: false, error: 'No waiting entries in queue' };
  }

  const sorted = sortQueue(waitingEntries);
  const nextEntry = sorted[0]!;

  const updatedEntry: QueueEntry = {
    id: nextEntry.id,
    orderId: nextEntry.orderId,
    position: nextEntry.position,
    priority: nextEntry.priority,
    isMember: nextEntry.isMember,
    status: 'in_progress',
    bayId,
    createdAt: nextEntry.createdAt,
  };

  return { success: true, entry: updatedEntry };
}

/**
 * Updates the status of a queue entry.
 * Valid transitions: waiting → in_progress, in_progress → completed.
 *
 * @param entry - The queue entry to update
 * @param newStatus - The target status
 * @returns Updated entry or null if transition is invalid
 */
export function updateQueueStatus(
  entry: QueueEntry,
  newStatus: QueueStatus,
): QueueEntry | null {
  const validTransitions: Record<QueueStatus, QueueStatus[]> = {
    waiting: ['in_progress'],
    in_progress: ['completed'],
    completed: [],
  };

  if (!validTransitions[entry.status].includes(newStatus)) {
    return null;
  }

  return { ...entry, status: newStatus };
}

/**
 * Gets all waiting entries from the queue, sorted by service order.
 *
 * @param queue - Current queue entries
 * @returns Sorted array of waiting entries
 */
export function getWaitingQueue(queue: QueueEntry[]): QueueEntry[] {
  const waiting = queue.filter((e) => e.status === 'waiting');
  return sortQueue(waiting);
}

/**
 * Gets entries currently in progress.
 *
 * @param queue - Current queue entries
 * @returns Array of in-progress entries
 */
export function getInProgressEntries(queue: QueueEntry[]): QueueEntry[] {
  return queue.filter((e) => e.status === 'in_progress');
}

/**
 * Removes a completed entry from the queue.
 *
 * @param queue - Current queue entries
 * @param entryId - ID of the entry to remove
 * @returns New queue array without the specified entry (only removes if completed)
 */
export function removeCompletedEntry(queue: QueueEntry[], entryId: string): QueueEntry[] {
  return queue.filter((e) => !(e.id === entryId && e.status === 'completed'));
}
