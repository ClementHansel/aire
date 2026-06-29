import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

/**
 * Queue status returned for a customer checking their order via kiosk.
 */
export interface KioskQueueStatus {
  orderNumber: string;
  orderId: string;
  customerName: string;
  position: number;
  totalWaiting: number;
  estimatedWaitMinutes: number;
  status: 'waiting' | 'in_progress' | 'completed' | 'not_found';
  bayName?: string;
}

/**
 * Queue entry returned after joining the queue.
 */
export interface KioskQueueEntry {
  id: string;
  orderId: string;
  orderNumber: string;
  position: number;
  priority: number;
  isMember: boolean;
  estimatedWaitMinutes: number;
  createdAt: string;
}

/** Average service time per vehicle in minutes (used for wait time estimation) */
const AVG_SERVICE_TIME_MINUTES = 15;

/**
 * Kiosk service providing self-service queue operations.
 *
 * - Queue status check by order number
 * - Join queue for a paid order
 *
 * Requirements: 27.1, 27.2, 27.3
 */
@Injectable()
export class KioskService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * Look up queue status by order number.
   * Returns position, estimated wait time, and current status.
   *
   * Requirement 27.3: Display queue position and estimated wait time after order.
   */
  async getQueueStatus(orderNumber: string): Promise<KioskQueueStatus> {
    if (!orderNumber || orderNumber.trim() === '') {
      throw new BadRequestException('Order number is required');
    }

    // Find the order
    const orderResult = await this.pool.query(
      `SELECT o.id, o.order_number, o.customer_name, o.status AS order_status,
              qe.id AS queue_entry_id, qe.position, qe.priority, qe.status AS queue_status,
              qe.bay_id, b.name AS bay_name
       FROM orders o
       LEFT JOIN queue_entries qe ON qe.order_id = o.id
       LEFT JOIN bays b ON b.id = qe.bay_id
       WHERE o.order_number = $1
       ORDER BY qe.created_at DESC
       LIMIT 1`,
      [orderNumber.trim()],
    );

    if (orderResult.rows.length === 0) {
      return {
        orderNumber,
        orderId: '',
        customerName: '',
        position: 0,
        totalWaiting: 0,
        estimatedWaitMinutes: 0,
        status: 'not_found',
      };
    }

    const row = orderResult.rows[0];

    // If no queue entry exists
    if (!row.queue_entry_id) {
      return {
        orderNumber: row.order_number,
        orderId: row.id,
        customerName: row.customer_name,
        position: 0,
        totalWaiting: 0,
        estimatedWaitMinutes: 0,
        status: 'not_found',
      };
    }

    const queueStatus = row.queue_status as 'waiting' | 'in_progress' | 'completed';

    // Count entries ahead in queue (higher priority or same priority with lower position)
    const aheadResult = await this.pool.query(
      `SELECT COUNT(*) as count FROM queue_entries
       WHERE status = 'waiting'
         AND outlet_id = (SELECT outlet_id FROM orders WHERE id = $1)
         AND (priority > $2 OR (priority = $2 AND position < $3))`,
      [row.id, row.priority, row.position],
    );

    const entriesAhead = parseInt(aheadResult.rows[0].count, 10);

    // Count total waiting
    const totalResult = await this.pool.query(
      `SELECT COUNT(*) as count FROM queue_entries
       WHERE status = 'waiting'
         AND outlet_id = (SELECT outlet_id FROM orders WHERE id = $1)`,
      [row.id],
    );

    const totalWaiting = parseInt(totalResult.rows[0].count, 10);

    // Estimate wait time based on position ahead
    const estimatedWaitMinutes = queueStatus === 'waiting'
      ? entriesAhead * AVG_SERVICE_TIME_MINUTES
      : 0;

    return {
      orderNumber: row.order_number,
      orderId: row.id,
      customerName: row.customer_name,
      position: queueStatus === 'waiting' ? entriesAhead + 1 : 0,
      totalWaiting,
      estimatedWaitMinutes,
      status: queueStatus,
      bayName: row.bay_name ?? undefined,
    };
  }

  /**
   * Add a paid order to the queue.
   * Only orders with status 'paid' or 'confirmed' can join the queue.
   *
   * Requirement 27.2: Self-check-in, service selection, QRIS payment flow.
   * Requirement 27.3: Display queue position and estimated wait time after order.
   */
  async joinQueue(orderId: string, outletId: string): Promise<KioskQueueEntry> {
    if (!orderId || orderId.trim() === '') {
      throw new BadRequestException('Order ID is required');
    }
    if (!outletId || outletId.trim() === '') {
      throw new BadRequestException('Outlet ID is required');
    }

    // Verify order exists and is in a valid state
    const orderResult = await this.pool.query(
      `SELECT id, order_number, status, customer_id, membership_id
       FROM orders
       WHERE id = $1 AND outlet_id = $2`,
      [orderId, outletId],
    );

    if (orderResult.rows.length === 0) {
      throw new NotFoundException('Order not found in this outlet');
    }

    const order = orderResult.rows[0];

    if (!['paid', 'confirmed'].includes(order.status)) {
      throw new BadRequestException(
        `Order must be paid before joining the queue. Current status: ${order.status}`,
      );
    }

    // Check if already in queue
    const existingEntry = await this.pool.query(
      `SELECT id FROM queue_entries WHERE order_id = $1 AND status != 'completed'`,
      [orderId],
    );

    if (existingEntry.rows.length > 0) {
      throw new BadRequestException('Order is already in the queue');
    }

    // Determine if customer is a member (gets priority boost)
    const isMember = !!order.membership_id;

    // Get next position
    const positionResult = await this.pool.query(
      `SELECT COALESCE(MAX(position), 0) + 1 as next_position
       FROM queue_entries
       WHERE outlet_id = $1`,
      [outletId],
    );

    const position = parseInt(positionResult.rows[0].next_position, 10);
    const priority = isMember ? 10 : 0; // MEMBER_PRIORITY_BOOST = 10

    // Insert queue entry
    const insertResult = await this.pool.query(
      `INSERT INTO queue_entries (outlet_id, order_id, position, priority, is_member, status)
       VALUES ($1, $2, $3, $4, $5, 'waiting')
       RETURNING id, order_id, position, priority, is_member, status, created_at`,
      [outletId, orderId, position, priority, isMember],
    );

    const entry = insertResult.rows[0];

    // Calculate estimated wait time
    const aheadResult = await this.pool.query(
      `SELECT COUNT(*) as count FROM queue_entries
       WHERE status = 'waiting'
         AND outlet_id = $1
         AND (priority > $2 OR (priority = $2 AND position < $3))`,
      [outletId, priority, position],
    );

    const entriesAhead = parseInt(aheadResult.rows[0].count, 10);
    const estimatedWaitMinutes = entriesAhead * AVG_SERVICE_TIME_MINUTES;

    return {
      id: entry.id,
      orderId: entry.order_id,
      orderNumber: order.order_number,
      position: entriesAhead + 1,
      priority: entry.priority,
      isMember: entry.is_member,
      estimatedWaitMinutes,
      createdAt: entry.created_at.toISOString(),
    };
  }
}
