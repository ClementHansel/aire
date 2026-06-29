/**
 * Queue Board display page.
 * Shows real-time queue status, bay assignments, and estimated wait times
 * for customers on a dedicated TV/monitor display.
 *
 * Requirements: 28.1, 28.4
 */
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  QueueEntry,
  QueueStatus,
  sortQueue,
} from '@aire/shared/queue';

/** Extended queue entry with display-specific fields for the board */
export interface QueueBoardEntry {
  id: string;
  orderId: string;
  position: number;
  customerName: string;
  licensePlate?: string;
  isMember: boolean;
  status: QueueStatus;
  bayId?: string;
  bayName?: string;
  estimatedWaitMinutes?: number;
  createdAt: number;
}

/** Props for the QueueBoardPage (used for testing with initial data) */
export interface QueueBoardPageProps {
  params: { outletId: string };
}

/** Average service time in minutes used for wait estimation */
const AVG_SERVICE_TIME_MINUTES = 15;

/**
 * Calculates estimated wait time based on position in sorted queue
 * and number of bays currently in use.
 */
export function calculateEstimatedWait(
  position: number,
  activeBays: number,
): number {
  if (activeBays <= 0) return position * AVG_SERVICE_TIME_MINUTES;
  return Math.ceil((position / activeBays) * AVG_SERVICE_TIME_MINUTES);
}

/**
 * Maps QueueEntry data to QueueBoardEntry with display info.
 */
function mapToDisplayEntries(
  entries: QueueEntry[],
  customerNames: Record<string, string>,
  licensePlates: Record<string, string>,
  bayNames: Record<string, string>,
  activeBays: number,
): QueueBoardEntry[] {
  const sorted = sortQueue(entries.filter((e) => e.status === 'waiting'));
  const inProgress = entries.filter((e) => e.status === 'in_progress');

  const waitingDisplay: QueueBoardEntry[] = sorted.map((entry, index) => ({
    id: entry.id,
    orderId: entry.orderId,
    position: index + 1,
    customerName: customerNames[entry.orderId] || 'Customer',
    licensePlate: licensePlates[entry.orderId],
    isMember: entry.isMember,
    status: entry.status,
    estimatedWaitMinutes: calculateEstimatedWait(index + 1, activeBays),
    createdAt: entry.createdAt,
  }));

  const inProgressDisplay: QueueBoardEntry[] = inProgress.map((entry) => ({
    id: entry.id,
    orderId: entry.orderId,
    position: entry.position,
    customerName: customerNames[entry.orderId] || 'Customer',
    licensePlate: licensePlates[entry.orderId],
    isMember: entry.isMember,
    status: entry.status,
    bayId: entry.bayId,
    bayName: entry.bayId ? bayNames[entry.bayId] || `Bay ${entry.bayId}` : undefined,
    createdAt: entry.createdAt,
  }));

  return [...inProgressDisplay, ...waitingDisplay];
}

/**
 * Queue Board page component.
 * Displays real-time queue information intended for customer-facing screens.
 * Auto-updates via WebSocket (placeholder for Socket.IO integration).
 */
export default function QueueBoardPage({ params }: QueueBoardPageProps) {
  const { outletId } = params;

  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({});
  const [licensePlates, setLicensePlates] = useState<Record<string, string>>({});
  const [bayNames, setBayNames] = useState<Record<string, string>>({});
  const [activeBays, setActiveBays] = useState<number>(3);
  const [connected, setConnected] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  /**
   * Placeholder for WebSocket connection to receive real-time updates.
   * Will be replaced with Socket.IO integration:
   * - join:queue-board { outletId }
   * - Listen for 'queue:updated' events
   */
  useEffect(() => {
    // TODO: Replace with Socket.IO connection
    // const socket = io(WEBSOCKET_URL);
    // socket.emit('join:queue-board', { outletId });
    // socket.on('queue:updated', (data) => {
    //   setEntries(data.queue);
    //   setCustomerNames(data.customerNames);
    //   setLicensePlates(data.licensePlates);
    //   setBayNames(data.bayNames);
    //   setActiveBays(data.activeBays);
    //   setLastUpdated(new Date());
    //   setConnected(true);
    // });
    // socket.on('connect', () => setConnected(true));
    // socket.on('disconnect', () => setConnected(false));
    // return () => { socket.disconnect(); };

    // Placeholder: mark as connected for display purposes
    setConnected(true);
    setLastUpdated(new Date());
  }, [outletId]);

  /** Handle queue update from WebSocket (exposed for testing) */
  const handleQueueUpdate = useCallback(
    (data: {
      queue: QueueEntry[];
      customerNames: Record<string, string>;
      licensePlates: Record<string, string>;
      bayNames: Record<string, string>;
      activeBays: number;
    }) => {
      setEntries(data.queue);
      setCustomerNames(data.customerNames);
      setLicensePlates(data.licensePlates);
      setBayNames(data.bayNames);
      setActiveBays(data.activeBays);
      setLastUpdated(new Date());
    },
    [],
  );
  // Keep reference alive for future WebSocket integration
  void handleQueueUpdate;

  const displayEntries = mapToDisplayEntries(
    entries,
    customerNames,
    licensePlates,
    bayNames,
    activeBays,
  );

  const waitingEntries = displayEntries.filter((e) => e.status === 'waiting');
  const inProgressEntries = displayEntries.filter((e) => e.status === 'in_progress');

  return (
    <div className="queue-board" data-testid="queue-board" data-outlet-id={outletId}>
      {/* Header */}
      <header className="queue-board__header" data-testid="queue-board-header">
        <h1 className="queue-board__title">Queue Status</h1>
        <div className="queue-board__status">
          <span
            className={`queue-board__connection ${connected ? 'queue-board__connection--online' : 'queue-board__connection--offline'}`}
            data-testid="connection-status"
            aria-label={connected ? 'Connected' : 'Disconnected'}
          >
            {connected ? '● Online' : '○ Offline'}
          </span>
          {lastUpdated && (
            <span className="queue-board__last-updated" data-testid="last-updated">
              Updated: {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </header>

      {/* In Progress / Being Served */}
      <section className="queue-board__section" data-testid="in-progress-section">
        <h2 className="queue-board__section-title">Now Serving</h2>
        {inProgressEntries.length === 0 ? (
          <p className="queue-board__empty" data-testid="no-in-progress">
            No vehicles currently being served
          </p>
        ) : (
          <div className="queue-board__grid" data-testid="in-progress-grid" role="list">
            {inProgressEntries.map((entry) => (
              <QueueCard key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </section>

      {/* Waiting Queue */}
      <section className="queue-board__section" data-testid="waiting-section">
        <h2 className="queue-board__section-title">
          Waiting ({waitingEntries.length})
        </h2>
        {waitingEntries.length === 0 ? (
          <p className="queue-board__empty" data-testid="no-waiting">
            No vehicles in queue
          </p>
        ) : (
          <div className="queue-board__list" data-testid="waiting-list" role="list">
            {waitingEntries.map((entry) => (
              <QueueCard key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** Individual queue entry card for the board display */
function QueueCard({ entry }: { entry: QueueBoardEntry }) {
  return (
    <div
      className={`queue-card queue-card--${entry.status}`}
      data-testid={`queue-card-${entry.id}`}
      role="listitem"
      aria-label={`${entry.customerName} - ${entry.status === 'in_progress' ? 'Now serving' : `Position ${entry.position}`}`}
    >
      {/* Position or Bay Assignment */}
      <div className="queue-card__badge" data-testid="queue-card-badge">
        {entry.status === 'in_progress' && entry.bayName ? (
          <span className="queue-card__bay" data-testid="queue-card-bay">
            {entry.bayName}
          </span>
        ) : (
          <span className="queue-card__position" data-testid="queue-card-position">
            #{entry.position}
          </span>
        )}
      </div>

      {/* Customer Info */}
      <div className="queue-card__info">
        <span className="queue-card__name" data-testid="queue-card-name">
          {entry.customerName}
        </span>
        {entry.licensePlate && (
          <span className="queue-card__plate" data-testid="queue-card-plate">
            {entry.licensePlate}
          </span>
        )}
      </div>

      {/* Status / Wait Time */}
      <div className="queue-card__meta">
        {entry.isMember && (
          <span className="queue-card__member-badge" data-testid="queue-card-member">
            MEMBER
          </span>
        )}
        {entry.status === 'waiting' && entry.estimatedWaitMinutes != null && (
          <span className="queue-card__wait" data-testid="queue-card-wait">
            ~{entry.estimatedWaitMinutes} min
          </span>
        )}
        {entry.status === 'in_progress' && (
          <span className="queue-card__serving" data-testid="queue-card-serving">
            In Progress
          </span>
        )}
      </div>
    </div>
  );
}
