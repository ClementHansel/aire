import { Injectable, Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { DomainEvent, EventHandler, EVENT_WILDCARD } from './event.types';

const REDIS_CHANNEL = 'aire:events';

/**
 * EventBus — the central nervous system of the platform.
 *
 * - Persists every event to `domain_events` (queryable history for the AI agent
 *   and the monitoring panel).
 * - Dispatches in-process to subscribers (the AI agent reacts in real time).
 * - Publishes to Redis pub/sub (best-effort) so additional nodes / live
 *   dashboards can stream events.
 *
 * Emitting never throws — a telemetry/event failure must not break a business
 * transaction.
 */
@Injectable()
export class EventBusService implements OnModuleDestroy {
  private readonly logger = new Logger(EventBusService.name);
  private readonly emitter = new EventEmitter();
  private publisher: Redis | null = null;

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {
    this.emitter.setMaxListeners(100);
    const url = process.env.REDIS_URL;
    if (url) {
      try {
        this.publisher = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
        this.publisher.on('error', (e) => this.logger.debug(`Redis publisher error: ${e.message}`));
        this.publisher.connect().catch(() => {
          this.logger.warn('EventBus Redis publisher unavailable; continuing with DB + in-process only');
        });
      } catch {
        this.publisher = null;
      }
    }
  }

  onModuleDestroy(): void {
    this.publisher?.disconnect();
    this.emitter.removeAllListeners();
  }

  /**
   * Emit a domain event: persist, dispatch in-process, publish to Redis.
   * Returns the stored event id. Never throws.
   */
  async emit<T extends Record<string, unknown>>(event: DomainEvent<T>): Promise<string | null> {
    let id: string | null = null;
    try {
      const res = await this.pool.query<{ id: string; created_at: Date }>(
        `INSERT INTO domain_events (tenant_id, outlet_id, type, payload, actor)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, created_at`,
        [
          event.tenantId ?? null,
          event.outletId ?? null,
          event.type,
          JSON.stringify(event.payload ?? {}),
          event.actor ?? null,
        ],
      );
      id = res.rows[0]!.id;
      event.id = id;
      event.createdAt = res.rows[0]!.created_at.toISOString();
    } catch (err) {
      this.logger.error(`Failed to persist event ${event.type}: ${err instanceof Error ? err.message : err}`);
    }

    // In-process dispatch (typed channel + wildcard)
    try {
      this.emitter.emit(event.type, event);
      this.emitter.emit(EVENT_WILDCARD, event);
    } catch (err) {
      this.logger.error(`In-process dispatch failed for ${event.type}: ${err instanceof Error ? err.message : err}`);
    }

    // Best-effort Redis publish
    if (this.publisher && this.publisher.status === 'ready') {
      this.publisher.publish(REDIS_CHANNEL, JSON.stringify(event)).catch(() => undefined);
    }

    return id;
  }

  /** Subscribe to a specific event type. Returns an unsubscribe function. */
  on(type: string, handler: EventHandler): () => void {
    const wrapped = (e: DomainEvent) => {
      Promise.resolve(handler(e)).catch((err) =>
        this.logger.error(`Event handler for ${type} threw: ${err instanceof Error ? err.message : err}`),
      );
    };
    this.emitter.on(type, wrapped);
    return () => this.emitter.off(type, wrapped);
  }

  /** Subscribe to every event. Returns an unsubscribe function. */
  onAny(handler: EventHandler): () => void {
    return this.on(EVENT_WILDCARD, handler);
  }

  /** Recent events for a tenant (most recent first). */
  async recent(
    tenantId: string,
    opts: { limit?: number; type?: string } = {},
  ): Promise<DomainEvent[]> {
    const limit = Math.min(opts.limit ?? 50, 200);
    const params: unknown[] = [tenantId];
    let where = 'tenant_id = $1';
    if (opts.type) {
      params.push(opts.type);
      where += ` AND type = $${params.length}`;
    }
    params.push(limit);
    const res = await this.pool.query(
      `SELECT id, tenant_id, outlet_id, type, payload, actor, created_at
       FROM domain_events WHERE ${where}
       ORDER BY created_at DESC LIMIT $${params.length}`,
      params,
    );
    return res.rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      outletId: r.outlet_id,
      type: r.type,
      payload: r.payload,
      actor: r.actor,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));
  }

  /** Event counts grouped by type over a recent window (monitoring). */
  async throughput(tenantId: string, sinceMinutes = 60): Promise<{ type: string; count: number }[]> {
    const res = await this.pool.query<{ type: string; count: string }>(
      `SELECT type, COUNT(*) AS count
       FROM domain_events
       WHERE tenant_id = $1 AND created_at > NOW() - ($2 || ' minutes')::interval
       GROUP BY type ORDER BY count DESC`,
      [tenantId, String(sinceMinutes)],
    );
    return res.rows.map((r) => ({ type: r.type, count: parseInt(r.count, 10) }));
  }
}
