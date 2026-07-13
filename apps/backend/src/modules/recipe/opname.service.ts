import { Injectable, Inject, Optional, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';

/**
 * Stock opname (physical count). On create, snapshots current book stock as the
 * "expected" per item; the counter enters actual counts; on close, variance and
 * its value are recorded and inventory is reconciled to the counted quantities.
 * The variance value is the shrinkage/alignment indicator vs the recipe forecast.
 */
@Injectable()
export class OpnameService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  async list(tenantId: string) {
    const r = await this.pool.query(
      `SELECT o.id, o.outlet_id, o.status, o.note, o.created_at, o.closed_at,
              COUNT(i.id) AS item_count,
              COALESCE(SUM(i.variance_value), 0) AS total_variance_value
       FROM stock_opname o
       LEFT JOIN stock_opname_items i ON i.opname_id = o.id
       WHERE o.tenant_id = $1
       GROUP BY o.id
       ORDER BY o.created_at DESC LIMIT 100`,
      [tenantId],
    );
    return r.rows.map((x: any) => ({
      id: x.id, outletId: x.outlet_id, status: x.status, note: x.note,
      createdAt: x.created_at, closedAt: x.closed_at,
      itemCount: parseInt(x.item_count, 10), totalVarianceValue: parseFloat(x.total_variance_value),
    }));
  }

  async create(tenantId: string, outletId: string | null, note: string | undefined, createdBy: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const head = await client.query<{ id: string }>(
        `INSERT INTO stock_opname (tenant_id, outlet_id, status, note, created_by)
         VALUES ($1, $2, 'counting', $3, $4) RETURNING id`,
        [tenantId, outletId, note ?? null, createdBy],
      );
      const opnameId = head.rows[0]!.id;
      // Snapshot current book stock as "expected".
      await client.query(
        `INSERT INTO stock_opname_items (opname_id, inventory_item_id, expected_qty, unit_cost)
         SELECT $1, id, quantity, unit_cost FROM inventory_items
         WHERE tenant_id = $2 AND is_active = true
           AND ($3::uuid IS NULL OR outlet_id = $3::uuid OR outlet_id IS NULL)`,
        [opnameId, tenantId, outletId],
      );
      await client.query('COMMIT');
      return this.get(tenantId, opnameId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async get(tenantId: string, id: string) {
    const head = await this.pool.query(
      `SELECT id, outlet_id, status, note, created_at, closed_at FROM stock_opname WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (head.rows.length === 0) throw new NotFoundException('Opname not found');
    const items = await this.pool.query(
      `SELECT i.id, i.inventory_item_id, ii.name, ii.sku, ii.category, ii.unit, i.expected_qty, i.counted_qty, i.unit_cost, i.variance, i.variance_value
       FROM stock_opname_items i JOIN inventory_items ii ON ii.id = i.inventory_item_id
       WHERE i.opname_id = $1 ORDER BY ii.name`,
      [id],
    );
    const h = head.rows[0];
    return {
      id: h.id, outletId: h.outlet_id, status: h.status, note: h.note, createdAt: h.created_at, closedAt: h.closed_at,
      items: items.rows.map((x: any) => ({
        id: x.id, inventoryItemId: x.inventory_item_id, name: x.name, sku: x.sku, category: x.category, unit: x.unit,
        expectedQty: parseFloat(x.expected_qty),
        countedQty: x.counted_qty == null ? null : parseFloat(x.counted_qty),
        unitCost: parseFloat(x.unit_cost),
        variance: x.variance == null ? null : parseFloat(x.variance),
        varianceValue: x.variance_value == null ? null : parseFloat(x.variance_value),
      })),
    };
  }

  /**
   * Inventory items eligible to be added to an open opname's count sheet: this
   * opname's branch (+ shared/global items) that aren't already on the sheet.
   */
  async availableItems(tenantId: string, opnameId: string) {
    const head = await this.pool.query<{ outlet_id: string | null; status: string }>(
      `SELECT outlet_id, status FROM stock_opname WHERE id = $1 AND tenant_id = $2`,
      [opnameId, tenantId],
    );
    if (head.rows.length === 0) throw new NotFoundException('Opname not found');
    const outletId = head.rows[0]!.outlet_id;
    const r = await this.pool.query(
      `SELECT ii.id, ii.name, ii.sku, ii.unit, ii.quantity, ii.unit_cost
       FROM inventory_items ii
       WHERE ii.tenant_id = $1 AND ii.is_active = true
         AND ($2::uuid IS NULL OR ii.outlet_id = $2::uuid OR ii.outlet_id IS NULL)
         AND ii.id NOT IN (SELECT inventory_item_id FROM stock_opname_items WHERE opname_id = $3)
       ORDER BY ii.name`,
      [tenantId, outletId, opnameId],
    );
    return r.rows.map((x: any) => ({
      id: x.id, name: x.name, sku: x.sku, unit: x.unit,
      quantity: parseFloat(x.quantity), unitCost: parseFloat(x.unit_cost),
    }));
  }

  /** Add one inventory item to an open opname (snapshots its current book stock). */
  async addItem(tenantId: string, opnameId: string, inventoryItemId: string) {
    const chk = await this.pool.query<{ status: string }>(`SELECT status FROM stock_opname WHERE id = $1 AND tenant_id = $2`, [opnameId, tenantId]);
    if (chk.rows.length === 0) throw new NotFoundException('Opname not found');
    if (chk.rows[0]!.status !== 'counting') throw new BadRequestException('Opname is not open for counting');
    const ins = await this.pool.query(
      `INSERT INTO stock_opname_items (opname_id, inventory_item_id, expected_qty, unit_cost)
       SELECT $1, id, quantity, unit_cost FROM inventory_items WHERE id = $2 AND tenant_id = $3 AND is_active = true
       ON CONFLICT (opname_id, inventory_item_id) DO NOTHING RETURNING id`,
      [opnameId, inventoryItemId, tenantId],
    );
    if (ins.rows.length === 0) throw new BadRequestException('Item not found or already on the count sheet');
    return this.get(tenantId, opnameId);
  }

  /** Delete an opname that has not been closed (abandon a mistaken/aborted count). */
  async remove(tenantId: string, id: string) {
    const chk = await this.pool.query<{ status: string }>(`SELECT status FROM stock_opname WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (chk.rows.length === 0) throw new NotFoundException('Opname not found');
    if (chk.rows[0]!.status === 'closed') throw new BadRequestException('Cannot delete a closed opname (it has already reconciled stock)');
    await this.pool.query(`DELETE FROM stock_opname WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    return { ok: true };
  }

  /** Record a physical count for one line, or clear it (countedQty = null → "not counted"). */
  async setCount(tenantId: string, opnameId: string, itemId: string, countedQty: number | null) {
    const chk = await this.pool.query(`SELECT status FROM stock_opname WHERE id = $1 AND tenant_id = $2`, [opnameId, tenantId]);
    if (chk.rows.length === 0) throw new NotFoundException('Opname not found');
    if (chk.rows[0].status !== 'counting') throw new BadRequestException('Opname is not open for counting');
    const qty = countedQty == null || Number.isNaN(countedQty) ? null : countedQty;
    await this.pool.query(
      `UPDATE stock_opname_items SET counted_qty = $3 WHERE opname_id = $1 AND inventory_item_id = $2`,
      [opnameId, itemId, qty],
    );
    return { ok: true };
  }

  /** Close the opname: compute variance, reconcile inventory to counts. */
  async close(tenantId: string, id: string, actor: string) {
    // Reconciliations recorded in-transaction, emitted after COMMIT so the AI
    // feed / accounting see opname stock changes the same way a manual
    // adjustStock would (which the old close() silently bypassed).
    const adjustments: Array<{ itemId: string; name: string; before: number; after: number; variance: number; varianceValue: number }> = [];
    let outletId: string | null = null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const head = await client.query<{ status: string; outlet_id: string | null }>(
        `SELECT status, outlet_id FROM stock_opname WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, tenantId],
      );
      if (head.rows.length === 0) throw new NotFoundException('Opname not found');
      if (head.rows[0]!.status === 'closed') throw new BadRequestException('Opname already closed');
      outletId = head.rows[0]!.outlet_id;

      const items = await client.query<{ inventory_item_id: string; name: string; expected_qty: string; counted_qty: string | null; unit_cost: string }>(
        `SELECT i.inventory_item_id, ii.name, i.expected_qty, i.counted_qty, i.unit_cost
         FROM stock_opname_items i JOIN inventory_items ii ON ii.id = i.inventory_item_id
         WHERE i.opname_id = $1`,
        [id],
      );
      for (const it of items.rows) {
        if (it.counted_qty == null) continue; // uncounted lines are skipped
        const expected = parseFloat(it.expected_qty);
        const counted = parseFloat(it.counted_qty);
        const unitCost = parseFloat(it.unit_cost);
        const variance = counted - expected;
        const varianceValue = variance * unitCost;
        await client.query(
          `UPDATE stock_opname_items SET variance = $2, variance_value = $3 WHERE opname_id = $1 AND inventory_item_id = $4`,
          [id, variance, varianceValue, it.inventory_item_id],
        );
        if (variance !== 0) {
          // Reconcile book stock to the physical count + record the adjustment.
          await client.query(`UPDATE inventory_items SET quantity = $1, updated_at = NOW() WHERE id = $2`, [counted, it.inventory_item_id]);
          await client.query(
            `INSERT INTO inventory_movements (tenant_id, item_id, type, quantity, reason, reference, actor)
             VALUES ($1, $2, 'adjustment', $3, $4, $5, $6)`,
            [tenantId, it.inventory_item_id, counted, 'Opname reconcile', id, actor],
          );
          adjustments.push({ itemId: it.inventory_item_id, name: it.name, before: expected, after: counted, variance, varianceValue });
        }
      }
      await client.query(`UPDATE stock_opname SET status = 'closed', closed_at = NOW() WHERE id = $1`, [id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Post-commit telemetry (best-effort). Each reconciled line surfaces as a
    // stock adjustment; one summary event carries the total variance value.
    for (const a of adjustments) {
      void this.eventBus?.emit({
        type: DomainEventType.InventoryStockAdjusted,
        tenantId, outletId, actor,
        payload: { itemId: a.itemId, name: a.name, type: 'adjustment', quantity: Math.abs(a.variance), before: a.before, after: a.after, source: 'opname', opnameId: id },
      });
    }
    void this.eventBus?.emit({
      type: DomainEventType.StockOpnameClosed,
      tenantId, outletId, actor,
      payload: {
        opnameId: id,
        adjustedItems: adjustments.length,
        totalVarianceValue: adjustments.reduce((s, a) => s + a.varianceValue, 0),
      },
    });

    return this.get(tenantId, id);
  }
}
