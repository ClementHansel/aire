import { Injectable, Inject, Optional, BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';
import { InventoryService } from '../inventory/inventory.service';

export interface CreateSupplierDto {
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
}

export interface UpdateSupplierDto {
  name?: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
}

export interface ImportSupplierRow {
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface PoLineDto {
  itemId?: string;
  description: string;
  quantity: number;
  unitCost: number;
}

export interface CreatePoDto {
  supplierId?: string;
  notes?: string;
  items: PoLineDto[];
}

export interface GrnLineDto {
  poItemId: string;
  quantity: number;
  unitCost?: number;
}

export interface CreateGrnDto {
  lines: GrnLineDto[];
  notes?: string;
}

/**
 * ProcurementService — suppliers + purchase orders. Receiving a PO restocks the
 * linked inventory items. Self-reliant; emits events.
 */
@Injectable()
export class ProcurementService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly inventory: InventoryService,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  async listSuppliers(tenantId: string): Promise<unknown[]> {
    const res = await this.pool.query(
      `SELECT id, name, contact_name, phone, email, address FROM suppliers
       WHERE tenant_id = $1 AND is_active = true ORDER BY name ASC`,
      [tenantId],
    );
    return res.rows.map((r) => ({
      id: r.id, name: r.name, contactName: r.contact_name, phone: r.phone, email: r.email, address: r.address,
    }));
  }

  async createSupplier(tenantId: string, dto: CreateSupplierDto, actor?: string): Promise<Record<string, unknown>> {
    if (!dto.name?.trim()) throw new BadRequestException('name is required');
    const res = await this.pool.query(
      `INSERT INTO suppliers (tenant_id, name, contact_name, phone, email, address)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name`,
      [tenantId, dto.name.trim(), dto.contactName ?? null, dto.phone ?? null, dto.email ?? null, dto.address ?? null],
    );
    void this.eventBus?.emit({
      type: DomainEventType.SupplierCreated,
      tenantId, actor: actor ?? 'system',
      payload: { supplierId: res.rows[0]!.id, name: res.rows[0]!.name },
    });
    return res.rows[0]!;
  }

  /** One supplier with the inventory items sourced from them (name/price) + purchase-order stats. */
  async getSupplier(tenantId: string, id: string): Promise<Record<string, unknown>> {
    const sup = await this.pool.query(
      `SELECT id, name, contact_name, phone, email, address FROM suppliers WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (sup.rows.length === 0) throw new NotFoundException('Supplier not found');
    const items = await this.pool.query(
      `SELECT id, name, sku, unit, quantity, unit_cost FROM inventory_items
       WHERE tenant_id = $1 AND supplier_id = $2 AND is_active = true ORDER BY name ASC`,
      [tenantId, id],
    );
    const stats = await this.pool.query<{ po_count: string; open_count: string; lifetime: string }>(
      `SELECT COUNT(*) AS po_count,
              COUNT(*) FILTER (WHERE status = 'ordered') AS open_count,
              COALESCE(SUM(total) FILTER (WHERE status <> 'cancelled'), 0) AS lifetime
       FROM purchase_orders WHERE tenant_id = $1 AND supplier_id = $2`,
      [tenantId, id],
    );
    const r = sup.rows[0]!;
    const st = stats.rows[0]!;
    return {
      id: r.id, name: r.name, contactName: r.contact_name, phone: r.phone, email: r.email, address: r.address,
      items: items.rows.map((it) => ({
        id: it.id, name: it.name, sku: it.sku, unit: it.unit,
        quantity: parseFloat(it.quantity), unitCost: parseFloat(it.unit_cost),
      })),
      stats: { poCount: parseInt(st.po_count, 10), openPoCount: parseInt(st.open_count, 10), lifetimeValue: parseFloat(st.lifetime) },
    };
  }

  /** Bulk import suppliers from CSV rows. Matches existing (active) suppliers by name and updates
   *  their contact fields; otherwise inserts a new supplier. */
  async importSuppliers(tenantId: string, rows: ImportSupplierRow[]): Promise<ImportResult> {
    const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
    if (!Array.isArray(rows) || rows.length === 0) throw new BadRequestException('No rows to import');
    if (rows.length > 5000) throw new BadRequestException('Too many rows (max 5000)');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM suppliers WHERE tenant_id = $1 AND is_active = true`, [tenantId]);
      const idByName = new Map(existing.rows.map((r) => [r.name.trim().toLowerCase(), r.id]));
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        const name = String(row.name ?? '').trim();
        if (!name) { result.skipped++; result.errors.push(`Row ${i + 2}: missing name`); continue; }
        const vals = [
          row.contactName ? String(row.contactName).trim() : null,
          row.phone ? String(row.phone).trim() : null,
          row.email ? String(row.email).trim() : null,
          row.address ? String(row.address).trim() : null,
        ];
        const existId = idByName.get(name.toLowerCase());
        if (existId) {
          await client.query(
            `UPDATE suppliers SET contact_name=$1, phone=$2, email=$3, address=$4, updated_at=NOW() WHERE id=$5 AND tenant_id=$6`,
            [...vals, existId, tenantId]);
          result.updated++;
        } else {
          const ins = await client.query<{ id: string }>(
            `INSERT INTO suppliers (tenant_id, name, contact_name, phone, email, address) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [tenantId, name, ...vals]);
          idByName.set(name.toLowerCase(), ins.rows[0]!.id);
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
    return result;
  }

  async updateSupplier(tenantId: string, id: string, dto: UpdateSupplierDto): Promise<Record<string, unknown>> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (dto.name !== undefined) {
      if (!dto.name.trim()) throw new BadRequestException('name cannot be empty');
      set('name', dto.name.trim());
    }
    if (dto.contactName !== undefined) set('contact_name', dto.contactName || null);
    if (dto.phone !== undefined) set('phone', dto.phone || null);
    if (dto.email !== undefined) set('email', dto.email || null);
    if (dto.address !== undefined) set('address', dto.address || null);
    if (sets.length === 0) throw new BadRequestException('Nothing to update');
    sets.push('updated_at = NOW()');
    params.push(id, tenantId);
    const res = await this.pool.query(
      `UPDATE suppliers SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND tenant_id = $${params.length} RETURNING id, name, contact_name, phone, email, address`,
      params,
    );
    if (res.rows.length === 0) throw new NotFoundException('Supplier not found');
    const r = res.rows[0]!;
    return { id: r.id, name: r.name, contactName: r.contact_name, phone: r.phone, email: r.email, address: r.address };
  }

  async deactivateSupplier(tenantId: string, id: string): Promise<{ id: string; deactivated: true }> {
    const res = await this.pool.query(
      `UPDATE suppliers SET is_active = false, updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [id, tenantId],
    );
    if (res.rows.length === 0) throw new NotFoundException('Supplier not found');
    return { id, deactivated: true };
  }

  async listPurchaseOrders(tenantId: string, status?: string): Promise<unknown[]> {
    const params: unknown[] = [tenantId];
    let where = 'po.tenant_id = $1';
    if (status) {
      params.push(status);
      where += ` AND po.status = $${params.length}`;
    }
    const res = await this.pool.query(
      `SELECT po.id, po.po_number, po.status, po.total, po.notes, po.supplier_id, po.created_at, po.received_at,
              s.name AS supplier, COUNT(poi.id) AS item_count
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN purchase_order_items poi ON poi.po_id = po.id
       WHERE ${where}
       GROUP BY po.id, s.name
       ORDER BY po.created_at DESC LIMIT 200`,
      params,
    );
    return res.rows.map((r) => ({
      id: r.id, poNumber: r.po_number, status: r.status, total: parseFloat(r.total), notes: r.notes,
      supplierId: r.supplier_id, supplier: r.supplier, itemCount: parseInt(r.item_count, 10),
      createdAt: r.created_at, receivedAt: r.received_at,
    }));
  }

  /** One PO with its line items (each showing whether it's linked to an inventory item). */
  async getPurchaseOrder(tenantId: string, poId: string): Promise<Record<string, unknown>> {
    const po = await this.pool.query(
      `SELECT po.id, po.po_number, po.status, po.total, po.notes, po.supplier_id, po.created_at, po.received_at,
              s.name AS supplier
       FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.id = $1 AND po.tenant_id = $2`,
      [poId, tenantId],
    );
    if (po.rows.length === 0) throw new NotFoundException('Purchase order not found');
    const lines = await this.pool.query(
      `SELECT poi.id, poi.item_id, poi.description, poi.quantity, poi.received_quantity, poi.unit_cost, poi.subtotal, i.name AS item_name, i.unit AS item_unit
       FROM purchase_order_items poi LEFT JOIN inventory_items i ON i.id = poi.item_id
       WHERE poi.po_id = $1 ORDER BY poi.description ASC`,
      [poId],
    );
    const r = po.rows[0]!;
    return {
      id: r.id, poNumber: r.po_number, status: r.status, total: parseFloat(r.total), notes: r.notes,
      supplierId: r.supplier_id, supplier: r.supplier, createdAt: r.created_at, receivedAt: r.received_at,
      items: lines.rows.map((l) => ({
        id: l.id, itemId: l.item_id, itemName: l.item_name, itemUnit: l.item_unit,
        description: l.description, quantity: parseFloat(l.quantity),
        receivedQuantity: parseFloat(l.received_quantity),
        unitCost: parseFloat(l.unit_cost), subtotal: parseFloat(l.subtotal),
      })),
    };
  }

  /** Cancel an unreceived PO. Received POs cannot be cancelled (stock already moved). */
  async cancelPurchaseOrder(tenantId: string, poId: string): Promise<{ id: string; status: 'cancelled' }> {
    const po = await this.pool.query<{ status: string }>(
      `SELECT status FROM purchase_orders WHERE id = $1 AND tenant_id = $2`,
      [poId, tenantId],
    );
    if (po.rows.length === 0) throw new NotFoundException('Purchase order not found');
    if (po.rows[0]!.status === 'received') throw new BadRequestException('Cannot cancel a received purchase order');
    if (po.rows[0]!.status === 'cancelled') throw new BadRequestException('Purchase order already cancelled');
    await this.pool.query(
      `UPDATE purchase_orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [poId],
    );
    void this.eventBus?.emit({
      type: DomainEventType.PurchaseOrderCancelled,
      tenantId, actor: 'system',
      payload: { poId },
    });
    return { id: poId, status: 'cancelled' };
  }

  async createPurchaseOrder(tenantId: string, dto: CreatePoDto, actor?: string): Promise<Record<string, unknown>> {
    const rawItems = Array.isArray(dto.items) ? dto.items : [];
    // Normalize line items — accept camelCase (frontend) or snake_case (AI tools).
    const items = rawItems.map((it) => {
      const any = it as unknown as Record<string, unknown>;
      return {
        itemId: (any.itemId ?? any.item_id ?? null) as string | null,
        description: String(any.description ?? ''),
        quantity: Number(any.quantity),
        unitCost: Number(any.unitCost ?? any.unit_cost),
      };
    });
    if (items.length === 0) throw new BadRequestException('At least one line item is required');
    for (const it of items) {
      if (!it.description.trim()) throw new BadRequestException('Each line item needs a description');
      if (!Number.isFinite(it.quantity) || it.quantity <= 0) throw new BadRequestException('Each line item needs a positive quantity');
      if (!Number.isFinite(it.unitCost) || it.unitCost < 0) throw new BadRequestException('Each line item needs a valid unit cost');
    }
    const total = items.reduce((s, it) => s + it.quantity * it.unitCost, 0);
    const poNumber = `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 9000 + 1000)}`;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const po = await client.query<{ id: string }>(
        `INSERT INTO purchase_orders (tenant_id, supplier_id, po_number, status, total, notes, created_by)
         VALUES ($1,$2,$3,'ordered',$4,$5,$6) RETURNING id`,
        [tenantId, dto.supplierId ?? null, poNumber, total, dto.notes ?? null, actor ?? null],
      );
      const poId = po.rows[0]!.id;
      for (const it of items) {
        await client.query(
          `INSERT INTO purchase_order_items (po_id, item_id, description, quantity, unit_cost, subtotal)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [poId, it.itemId, it.description, it.quantity, it.unitCost, it.quantity * it.unitCost],
        );
      }
      await client.query('COMMIT');
      void this.eventBus?.emit({
        type: DomainEventType.PurchaseOrderCreated,
        tenantId, actor: actor ?? 'system',
        payload: { poId, poNumber, total, lines: items.length },
      });
      return { id: poId, poNumber, status: 'ordered', total };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Legacy "receive everything" action — receives all remaining (unreceived) quantity on
   * every line via a single GRN, flipping the PO to 'received'. Kept for existing callers
   * (POST .../receive). Delegates to createGoodsReceipt so behaviour stays consistent.
   */
  async receivePurchaseOrder(tenantId: string, poId: string, actor?: string): Promise<Record<string, unknown>> {
    const po = await this.pool.query<{ status: string }>(
      `SELECT status FROM purchase_orders WHERE id = $1 AND tenant_id = $2`,
      [poId, tenantId],
    );
    if (po.rows.length === 0) throw new NotFoundException('Purchase order not found');
    if (po.rows[0]!.status === 'received') throw new BadRequestException('Purchase order already received');
    if (po.rows[0]!.status === 'cancelled') throw new BadRequestException('Cannot receive a cancelled purchase order');

    const lines = await this.pool.query<{ id: string; quantity: string; received_quantity: string }>(
      `SELECT id, quantity, received_quantity FROM purchase_order_items WHERE po_id = $1`,
      [poId],
    );
    const grnLines: GrnLineDto[] = lines.rows
      .map((l) => ({ poItemId: l.id, remaining: parseFloat(l.quantity) - parseFloat(l.received_quantity) }))
      .filter((l) => l.remaining > 0)
      .map((l) => ({ poItemId: l.poItemId, quantity: l.remaining }));
    if (grnLines.length === 0) throw new BadRequestException('Nothing left to receive on this purchase order');

    await this.createGoodsReceipt(tenantId, poId, { lines: grnLines }, actor);
    return { id: poId, status: 'received' };
  }

  /**
   * Record a Goods Receipt Note (GRN) — one physical delivery against a PO. Supports partial
   * receiving: each line receives some quantity, incrementing purchase_order_items.received_quantity
   * and restocking linked inventory. Recomputes the PO status to 'received' (all lines full) or
   * 'partially_received'. Over-receipt (received + now > ordered) is rejected.
   */
  async createGoodsReceipt(tenantId: string, poId: string, dto: CreateGrnDto, actor?: string): Promise<Record<string, unknown>> {
    const inputLines = Array.isArray(dto?.lines) ? dto.lines : [];
    if (inputLines.length === 0) throw new BadRequestException('At least one line is required');
    const normLines = inputLines.map((l) => {
      const any = l as unknown as Record<string, unknown>;
      return {
        poItemId: String(any.poItemId ?? any.po_item_id ?? ''),
        quantity: Number(any.quantity),
        unitCost: any.unitCost ?? any.unit_cost,
      };
    });
    for (const l of normLines) {
      if (!l.poItemId) throw new BadRequestException('Each line needs a poItemId');
      if (!Number.isFinite(l.quantity) || l.quantity <= 0) throw new BadRequestException('Each line needs a positive quantity');
    }

    const restock: Array<{ itemId: string; quantity: number }> = [];
    let grnId = '';
    let grnNumber = '';

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const po = await client.query<{ status: string; po_number: string }>(
        `SELECT status, po_number FROM purchase_orders WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [poId, tenantId],
      );
      if (po.rows.length === 0) throw new NotFoundException('Purchase order not found');
      const status = po.rows[0]!.status;
      if (!['draft', 'ordered', 'partially_received'].includes(status)) {
        throw new BadRequestException(`Cannot receive a purchase order with status '${status}'`);
      }
      const poNumber = po.rows[0]!.po_number;

      // Load this PO's lines to validate ownership, unit cost fallback and over-receipt.
      const poItems = await client.query<{ id: string; item_id: string | null; quantity: string; received_quantity: string; unit_cost: string }>(
        `SELECT id, item_id, quantity, received_quantity, unit_cost FROM purchase_order_items WHERE po_id = $1`,
        [poId],
      );
      const byId = new Map(poItems.rows.map((r) => [r.id, r]));

      // grn_number = GRN-YYYYMMDD-NNN, per-tenant per-day sequence.
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const prefix = `GRN-${day}-`;
      const seq = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM goods_receipts WHERE tenant_id = $1 AND grn_number LIKE $2`,
        [tenantId, `${prefix}%`],
      );
      grnNumber = `${prefix}${String(parseInt(seq.rows[0]!.count, 10) + 1).padStart(3, '0')}`;

      const grn = await client.query<{ id: string; received_at: string }>(
        `INSERT INTO goods_receipts (tenant_id, po_id, grn_number, received_by, notes)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, received_at`,
        [tenantId, poId, grnNumber, actor ?? null, dto.notes ?? null],
      );
      grnId = grn.rows[0]!.id;

      for (const line of normLines) {
        const poItem = byId.get(line.poItemId);
        if (!poItem) throw new BadRequestException('Line does not belong to this purchase order');
        const ordered = parseFloat(poItem.quantity);
        const already = parseFloat(poItem.received_quantity);
        if (already + line.quantity > ordered + 1e-9) {
          throw new BadRequestException(`Over-receipt on a line: ${already + line.quantity} exceeds ordered ${ordered}`);
        }
        const unitCost = Number.isFinite(Number(line.unitCost)) ? Number(line.unitCost) : parseFloat(poItem.unit_cost);
        await client.query(
          `INSERT INTO goods_receipt_items (grn_id, po_item_id, quantity, unit_cost) VALUES ($1,$2,$3,$4)`,
          [grnId, line.poItemId, line.quantity, unitCost],
        );
        await client.query(
          `UPDATE purchase_order_items SET received_quantity = received_quantity + $1 WHERE id = $2`,
          [line.quantity, line.poItemId],
        );
        if (poItem.item_id) restock.push({ itemId: poItem.item_id, quantity: line.quantity });
      }

      // Recompute PO status from the (now updated) received quantities.
      const remaining = await client.query<{ outstanding: string }>(
        `SELECT COUNT(*) AS outstanding FROM purchase_order_items WHERE po_id = $1 AND received_quantity < quantity`,
        [poId],
      );
      const fullyReceived = parseInt(remaining.rows[0]!.outstanding, 10) === 0;
      await client.query(
        `UPDATE purchase_orders
         SET status = $2, received_at = ${fullyReceived ? 'NOW()' : 'received_at'}, updated_at = NOW()
         WHERE id = $1`,
        [poId, fullyReceived ? 'received' : 'partially_received'],
      );

      await client.query('COMMIT');

      // Restock linked items through the inventory service (records movements + low-stock logic).
      // adjustStock manages its own pool connection — the existing behaviour mirrored from
      // receivePurchaseOrder — so it runs after COMMIT of the GRN transaction.
      for (const r of restock) {
        await this.inventory.adjustStock(
          tenantId, r.itemId,
          { type: 'in', quantity: r.quantity, reason: 'GRN received', reference: grnNumber },
          actor,
        );
      }
      void this.eventBus?.emit({
        type: DomainEventType.GoodsReceived,
        tenantId, actor: actor ?? 'system',
        payload: { poId, poNumber, grnId, grnNumber, lines: normLines.length, restockedLines: restock.length },
      });
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }

    return this.getGoodsReceipt(tenantId, grnId);
  }

  /** List GRNs for a tenant, optionally scoped to one PO. Includes a line count. */
  async listGoodsReceipts(tenantId: string, poId?: string): Promise<unknown[]> {
    const params: unknown[] = [tenantId];
    let where = 'g.tenant_id = $1';
    if (poId) {
      params.push(poId);
      where += ` AND g.po_id = $${params.length}`;
    }
    const res = await this.pool.query(
      `SELECT g.id, g.po_id, g.grn_number, g.notes, g.received_by, g.received_at, g.created_at,
              po.po_number, COUNT(gi.id) AS line_count, COALESCE(SUM(gi.quantity), 0) AS total_quantity
       FROM goods_receipts g
       LEFT JOIN purchase_orders po ON po.id = g.po_id
       LEFT JOIN goods_receipt_items gi ON gi.grn_id = g.id
       WHERE ${where}
       GROUP BY g.id, po.po_number
       ORDER BY g.received_at DESC LIMIT 200`,
      params,
    );
    return res.rows.map((r) => ({
      id: r.id, poId: r.po_id, poNumber: r.po_number, grnNumber: r.grn_number, notes: r.notes,
      receivedBy: r.received_by, receivedAt: r.received_at, createdAt: r.created_at,
      lineCount: parseInt(r.line_count, 10), totalQuantity: parseFloat(r.total_quantity),
    }));
  }

  /** One GRN with its receipt lines (joined to PO-line descriptions). */
  async getGoodsReceipt(tenantId: string, grnId: string): Promise<Record<string, unknown>> {
    const g = await this.pool.query(
      `SELECT g.id, g.po_id, g.grn_number, g.notes, g.received_by, g.received_at, g.created_at, po.po_number
       FROM goods_receipts g LEFT JOIN purchase_orders po ON po.id = g.po_id
       WHERE g.id = $1 AND g.tenant_id = $2`,
      [grnId, tenantId],
    );
    if (g.rows.length === 0) throw new NotFoundException('Goods receipt not found');
    const lines = await this.pool.query(
      `SELECT gi.id, gi.po_item_id, gi.quantity, gi.unit_cost, poi.description, poi.item_id, i.name AS item_name, i.unit AS item_unit
       FROM goods_receipt_items gi
       LEFT JOIN purchase_order_items poi ON poi.id = gi.po_item_id
       LEFT JOIN inventory_items i ON i.id = poi.item_id
       WHERE gi.grn_id = $1 ORDER BY poi.description ASC`,
      [grnId],
    );
    const r = g.rows[0]!;
    return {
      id: r.id, poId: r.po_id, poNumber: r.po_number, grnNumber: r.grn_number, notes: r.notes,
      receivedBy: r.received_by, receivedAt: r.received_at, createdAt: r.created_at,
      items: lines.rows.map((l) => ({
        id: l.id, poItemId: l.po_item_id, itemId: l.item_id, itemName: l.item_name, itemUnit: l.item_unit,
        description: l.description, quantity: parseFloat(l.quantity), unitCost: parseFloat(l.unit_cost),
      })),
    };
  }

  async summary(tenantId: string): Promise<Record<string, unknown>> {
    const res = await this.pool.query<{ suppliers: string; open_pos: string; open_value: string }>(
      `SELECT
         (SELECT COUNT(*) FROM suppliers WHERE tenant_id = $1 AND is_active = true) AS suppliers,
         (SELECT COUNT(*) FROM purchase_orders WHERE tenant_id = $1 AND status = 'ordered') AS open_pos,
         (SELECT COALESCE(SUM(total),0) FROM purchase_orders WHERE tenant_id = $1 AND status = 'ordered') AS open_value`,
      [tenantId],
    );
    const r = res.rows[0]!;
    return {
      suppliers: parseInt(r.suppliers, 10),
      openPurchaseOrders: parseInt(r.open_pos, 10),
      openPurchaseValue: parseFloat(r.open_value),
    };
  }
}
