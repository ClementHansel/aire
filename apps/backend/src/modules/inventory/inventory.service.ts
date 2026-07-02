import { Injectable, Inject, Optional, BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';

export interface CreateItemDto {
  name: string;
  sku?: string;
  category?: string;
  unit?: string;
  quantity?: number;
  reorderLevel?: number;
  unitCost?: number;
  supplierId?: string;
  outletId?: string;
}

export interface AdjustStockDto {
  type: 'in' | 'out' | 'adjustment';
  quantity: number;
  reason?: string;
  reference?: string;
}

/**
 * InventoryService — stock items + movements. Self-reliant CRUD; emits events
 * the AI agent and monitoring can observe. Low-stock crossings emit an alert.
 */
@Injectable()
export class InventoryService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  async list(tenantId: string, opts: { lowStockOnly?: boolean; outletId?: string } = {}): Promise<unknown[]> {
    const params: unknown[] = [tenantId];
    let where = 'tenant_id = $1 AND is_active = true';
    if (opts.lowStockOnly) where += ' AND quantity <= reorder_level';
    if (opts.outletId) { params.push(opts.outletId); where += ` AND outlet_id = $${params.length}`; }
    const res = await this.pool.query(
      `SELECT id, sku, name, category, unit, quantity, reorder_level, unit_cost, supplier_id, outlet_id
       FROM inventory_items WHERE ${where} ORDER BY name ASC`,
      params,
    );
    return res.rows.map(this.map);
  }

  async get(tenantId: string, id: string): Promise<Record<string, unknown>> {
    const res = await this.pool.query(
      `SELECT * FROM inventory_items WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (res.rows.length === 0) throw new NotFoundException('Inventory item not found');
    return this.map(res.rows[0]);
  }

  async create(tenantId: string, dto: CreateItemDto, actor?: string): Promise<Record<string, unknown>> {
    if (!dto.name?.trim()) throw new BadRequestException('name is required');
    const res = await this.pool.query(
      `INSERT INTO inventory_items
        (tenant_id, outlet_id, sku, name, category, unit, quantity, reorder_level, unit_cost, supplier_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        tenantId, dto.outletId ?? null, dto.sku ?? null, dto.name.trim(), dto.category ?? null,
        dto.unit ?? 'pcs', dto.quantity ?? 0, dto.reorderLevel ?? 0, dto.unitCost ?? 0, dto.supplierId ?? null,
      ],
    );
    const item = this.map(res.rows[0]);
    void this.eventBus?.emit({
      type: DomainEventType.InventoryItemCreated,
      tenantId, actor: actor ?? 'system',
      payload: { itemId: item.id, name: item.name, quantity: item.quantity },
    });
    return item;
  }

  /** Adjust stock and record a movement. Emits low-stock alert if crossed. */
  async adjustStock(tenantId: string, id: string, dto: AdjustStockDto, actor?: string): Promise<Record<string, unknown>> {
    if (!dto.quantity || dto.quantity <= 0) throw new BadRequestException('quantity must be positive');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query<{ quantity: string; reorder_level: string; name: string }>(
        `SELECT quantity, reorder_level, name FROM inventory_items WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, tenantId],
      );
      if (cur.rows.length === 0) throw new NotFoundException('Inventory item not found');
      const before = parseFloat(cur.rows[0]!.quantity);
      const reorder = parseFloat(cur.rows[0]!.reorder_level);
      const delta = dto.type === 'out' ? -dto.quantity : dto.type === 'in' ? dto.quantity : dto.quantity;
      const after = dto.type === 'adjustment' ? dto.quantity : before + delta;
      if (after < 0) throw new BadRequestException('Resulting quantity cannot be negative');

      await client.query(`UPDATE inventory_items SET quantity = $1, updated_at = NOW() WHERE id = $2`, [after, id]);
      await client.query(
        `INSERT INTO inventory_movements (tenant_id, item_id, type, quantity, reason, reference, actor)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tenantId, id, dto.type, dto.quantity, dto.reason ?? null, dto.reference ?? null, actor ?? 'system'],
      );
      await client.query('COMMIT');

      void this.eventBus?.emit({
        type: DomainEventType.InventoryStockAdjusted,
        tenantId, actor: actor ?? 'system',
        payload: { itemId: id, name: cur.rows[0]!.name, type: dto.type, quantity: dto.quantity, before, after },
      });
      if (before > reorder && after <= reorder) {
        void this.eventBus?.emit({
          type: DomainEventType.InventoryLowStock,
          tenantId, actor: 'system',
          payload: { itemId: id, name: cur.rows[0]!.name, quantity: after, reorderLevel: reorder },
        });
      }
      return this.get(tenantId, id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async summary(tenantId: string, outletId?: string): Promise<Record<string, unknown>> {
    const res = await this.pool.query<{ items: string; low: string; value: string }>(
      `SELECT COUNT(*) AS items,
              COUNT(*) FILTER (WHERE quantity <= reorder_level) AS low,
              COALESCE(SUM(quantity * unit_cost), 0) AS value
       FROM inventory_items
       WHERE tenant_id = $1 AND is_active = true AND ($2::uuid IS NULL OR outlet_id = $2::uuid)`,
      [tenantId, outletId ?? null],
    );
    const r = res.rows[0]!;
    return { totalItems: parseInt(r.items, 10), lowStockItems: parseInt(r.low, 10), stockValue: parseFloat(r.value) };
  }

  private map = (r: Record<string, any>): Record<string, unknown> => ({
    id: r.id,
    sku: r.sku,
    name: r.name,
    category: r.category,
    unit: r.unit,
    quantity: parseFloat(r.quantity),
    reorderLevel: parseFloat(r.reorder_level),
    unitCost: parseFloat(r.unit_cost),
    supplierId: r.supplier_id,
    outletId: r.outlet_id,
  });
}
