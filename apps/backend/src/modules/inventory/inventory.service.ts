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

export interface UpdateItemDto {
  name?: string;
  sku?: string | null;
  category?: string | null;
  unit?: string;
  reorderLevel?: number;
  unitCost?: number;
  supplierId?: string | null;
  outletId?: string | null;
}

export interface ImportItemRow {
  sku?: string;
  name: string;
  category?: string;
  unit?: string;
  quantity?: number | string;
  reorderLevel?: number | string;
  unitCost?: number | string;
  supplier?: string; // supplier NAME — resolved to an existing supplier by name
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
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

  async list(tenantId: string, opts: { lowStockOnly?: boolean; outletIds?: string[] | null } = {}): Promise<unknown[]> {
    const params: unknown[] = [tenantId];
    let where = 'i.tenant_id = $1 AND i.is_active = true';
    if (opts.lowStockOnly) where += ' AND i.quantity <= i.reorder_level';
    if (opts.outletIds != null) { params.push(opts.outletIds); where += ` AND i.outlet_id = ANY($${params.length}::uuid[])`; }
    const res = await this.pool.query(
      `SELECT i.id, i.sku, i.name, i.category, i.unit, i.quantity, i.reorder_level, i.unit_cost,
              i.supplier_id, i.outlet_id, s.name AS supplier_name
       FROM inventory_items i LEFT JOIN suppliers s ON s.id = i.supplier_id
       WHERE ${where} ORDER BY i.name ASC`,
      params,
    );
    return res.rows.map(this.map);
  }

  /** Distinct category names for this tenant (for filter dropdowns / typeahead). */
  async categories(tenantId: string): Promise<string[]> {
    const res = await this.pool.query<{ category: string }>(
      `SELECT DISTINCT category FROM inventory_items
       WHERE tenant_id = $1 AND is_active = true AND category IS NOT NULL AND category <> ''
       ORDER BY category ASC`,
      [tenantId],
    );
    return res.rows.map((r) => r.category);
  }

  /** Recent stock movements for one item (the ledger behind its current quantity). */
  async listMovements(tenantId: string, itemId: string, limit = 50): Promise<unknown[]> {
    // Ensure the item belongs to the tenant before exposing its ledger.
    await this.get(tenantId, itemId);
    const res = await this.pool.query(
      `SELECT id, type, quantity, reason, reference, actor, created_at
       FROM inventory_movements WHERE tenant_id = $1 AND item_id = $2
       ORDER BY created_at DESC LIMIT $3`,
      [tenantId, itemId, Math.min(Math.max(limit, 1), 200)],
    );
    return res.rows.map((r) => ({
      id: r.id, type: r.type, quantity: parseFloat(r.quantity),
      reason: r.reason, reference: r.reference, actor: r.actor, createdAt: r.created_at,
    }));
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

  /** Where this item has come from: its purchase-order lines, newest first (origin tracking). */
  async listSources(tenantId: string, itemId: string): Promise<unknown[]> {
    await this.get(tenantId, itemId); // tenant ownership check
    const res = await this.pool.query(
      `SELECT po.id AS po_id, po.po_number, po.status, po.created_at, po.received_at,
              poi.quantity, poi.unit_cost, s.id AS supplier_id, s.name AS supplier
       FROM purchase_order_items poi
       JOIN purchase_orders po ON po.id = poi.po_id
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       WHERE poi.item_id = $1 AND po.tenant_id = $2
       ORDER BY po.created_at DESC LIMIT 50`,
      [itemId, tenantId],
    );
    return res.rows.map((r) => ({
      poId: r.po_id, poNumber: r.po_number, status: r.status, supplierId: r.supplier_id, supplier: r.supplier,
      quantity: parseFloat(r.quantity), unitCost: parseFloat(r.unit_cost),
      createdAt: r.created_at, receivedAt: r.received_at,
    }));
  }

  /**
   * Bulk import from CSV rows. Matches existing items by SKU (case-insensitive) and updates
   * their attributes; otherwise inserts a new item. Quantity is only applied to NEW items —
   * stock changes on existing items must go through adjustStock so the ledger stays truthful.
   * `supplier` is a name, resolved to an existing supplier; unknown names are left unlinked.
   */
  async importItems(tenantId: string, rows: ImportItemRow[], actor?: string): Promise<ImportResult> {
    const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
    if (!Array.isArray(rows) || rows.length === 0) throw new BadRequestException('No rows to import');
    if (rows.length > 5000) throw new BadRequestException('Too many rows (max 5000)');

    const num = (v: unknown, def = 0): number => {
      if (v === undefined || v === null || v === '') return def;
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ''));
      return Number.isFinite(n) ? n : def;
    };

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Lookup maps for supplier-name → id and sku → existing item id.
      const sup = await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM suppliers WHERE tenant_id = $1 AND is_active = true`, [tenantId]);
      const supByName = new Map(sup.rows.map((r) => [r.name.trim().toLowerCase(), r.id]));
      const existing = await client.query<{ id: string; sku: string | null }>(
        `SELECT id, sku FROM inventory_items WHERE tenant_id = $1 AND is_active = true AND sku IS NOT NULL`, [tenantId]);
      const idBySku = new Map(existing.rows.filter((r) => r.sku).map((r) => [r.sku!.trim().toLowerCase(), r.id]));

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        const line = i + 2; // account for header row in user-facing messages
        const name = String(row.name ?? '').trim();
        if (!name) { result.skipped++; result.errors.push(`Row ${line}: missing name`); continue; }
        const sku = row.sku ? String(row.sku).trim() : '';
        const supplierId = row.supplier ? supByName.get(String(row.supplier).trim().toLowerCase()) ?? null : null;
        if (row.supplier && !supplierId) result.errors.push(`Row ${line}: supplier "${row.supplier}" not found — left unlinked`);
        const category = row.category ? String(row.category).trim() : null;
        const unit = row.unit ? String(row.unit).trim() : 'pcs';
        const reorder = num(row.reorderLevel);
        const cost = num(row.unitCost);

        const existId = sku ? idBySku.get(sku.toLowerCase()) : undefined;
        if (existId) {
          await client.query(
            `UPDATE inventory_items SET name=$1, category=$2, unit=$3, reorder_level=$4, unit_cost=$5,
             supplier_id = COALESCE($6, supplier_id), updated_at = NOW() WHERE id=$7 AND tenant_id=$8`,
            [name, category, unit, reorder, cost, supplierId, existId, tenantId]);
          result.updated++;
        } else {
          const ins = await client.query<{ id: string; sku: string | null }>(
            `INSERT INTO inventory_items (tenant_id, sku, name, category, unit, quantity, reorder_level, unit_cost, supplier_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, sku`,
            [tenantId, sku || null, name, category, unit, num(row.quantity), reorder, cost, supplierId]);
          if (sku) idBySku.set(sku.toLowerCase(), ins.rows[0]!.id); // dedupe repeated SKUs within one file
          result.created++;
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    void this.eventBus?.emit({
      type: DomainEventType.InventoryItemCreated,
      tenantId, actor: actor ?? 'system',
      payload: { import: true, created: result.created, updated: result.updated },
    });
    return result;
  }

  /** Update item attributes (everything except quantity — that goes through adjustStock). */
  async update(tenantId: string, id: string, dto: UpdateItemDto, actor?: string): Promise<Record<string, unknown>> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (dto.name !== undefined) {
      if (!dto.name.trim()) throw new BadRequestException('name cannot be empty');
      set('name', dto.name.trim());
    }
    if (dto.sku !== undefined) set('sku', dto.sku || null);
    if (dto.category !== undefined) set('category', dto.category || null);
    if (dto.unit !== undefined) set('unit', dto.unit || 'pcs');
    if (dto.reorderLevel !== undefined) set('reorder_level', dto.reorderLevel);
    if (dto.unitCost !== undefined) set('unit_cost', dto.unitCost);
    if (dto.supplierId !== undefined) set('supplier_id', dto.supplierId || null);
    if (dto.outletId !== undefined) set('outlet_id', dto.outletId || null);
    if (sets.length === 0) return this.get(tenantId, id);
    sets.push('updated_at = NOW()');
    params.push(id, tenantId);
    const res = await this.pool.query(
      `UPDATE inventory_items SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND tenant_id = $${params.length} RETURNING *`,
      params,
    );
    if (res.rows.length === 0) throw new NotFoundException('Inventory item not found');
    void this.eventBus?.emit({
      type: DomainEventType.InventoryItemCreated,
      tenantId, actor: actor ?? 'system',
      payload: { itemId: id, name: res.rows[0]!.name, updated: true },
    });
    return this.map(res.rows[0]);
  }

  /** Soft-delete (deactivate) an item so it drops out of lists but keeps its ledger. */
  async deactivate(tenantId: string, id: string): Promise<{ id: string; deactivated: true }> {
    const res = await this.pool.query(
      `UPDATE inventory_items SET is_active = false, updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [id, tenantId],
    );
    if (res.rows.length === 0) throw new NotFoundException('Inventory item not found');
    return { id, deactivated: true };
  }

  /** Adjust stock and record a movement. Emits low-stock alert if crossed. */
  async adjustStock(tenantId: string, id: string, dto: AdjustStockDto, actor?: string): Promise<Record<string, unknown>> {
    if (!dto.quantity || dto.quantity <= 0) throw new BadRequestException('quantity must be positive');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query<{ quantity: string; reorder_level: string; name: string; outlet_id: string | null }>(
        `SELECT quantity, reorder_level, name, outlet_id FROM inventory_items WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, tenantId],
      );
      if (cur.rows.length === 0) throw new NotFoundException('Inventory item not found');
      const before = parseFloat(cur.rows[0]!.quantity);
      const reorder = parseFloat(cur.rows[0]!.reorder_level);
      const outletId = cur.rows[0]!.outlet_id;
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
        tenantId, outletId, actor: actor ?? 'system',
        payload: { itemId: id, name: cur.rows[0]!.name, type: dto.type, quantity: dto.quantity, before, after },
      });
      if (before > reorder && after <= reorder) {
        void this.eventBus?.emit({
          type: DomainEventType.InventoryLowStock,
          tenantId, outletId, actor: 'system',
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

  async summary(tenantId: string, outletIds?: string[] | null): Promise<Record<string, unknown>> {
    const res = await this.pool.query<{ items: string; low: string; value: string }>(
      `SELECT COUNT(*) AS items,
              COUNT(*) FILTER (WHERE quantity <= reorder_level) AS low,
              COALESCE(SUM(quantity * unit_cost), 0) AS value
       FROM inventory_items
       WHERE tenant_id = $1 AND is_active = true AND ($2::uuid[] IS NULL OR outlet_id = ANY($2::uuid[]))`,
      [tenantId, outletIds ?? null],
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
    supplierName: r.supplier_name ?? null,
    outletId: r.outlet_id,
  });
}
