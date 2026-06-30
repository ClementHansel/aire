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

  async listPurchaseOrders(tenantId: string, status?: string): Promise<unknown[]> {
    const params: unknown[] = [tenantId];
    let where = 'po.tenant_id = $1';
    if (status) {
      params.push(status);
      where += ` AND po.status = $${params.length}`;
    }
    const res = await this.pool.query(
      `SELECT po.id, po.po_number, po.status, po.total, po.created_at, po.received_at, s.name AS supplier
       FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
       WHERE ${where} ORDER BY po.created_at DESC LIMIT 200`,
      params,
    );
    return res.rows.map((r) => ({
      id: r.id, poNumber: r.po_number, status: r.status, total: parseFloat(r.total),
      supplier: r.supplier, createdAt: r.created_at, receivedAt: r.received_at,
    }));
  }

  async createPurchaseOrder(tenantId: string, dto: CreatePoDto, actor?: string): Promise<Record<string, unknown>> {
    if (!Array.isArray(dto.items) || dto.items.length === 0) {
      throw new BadRequestException('At least one line item is required');
    }
    const total = dto.items.reduce((s, it) => s + it.quantity * it.unitCost, 0);
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
      for (const it of dto.items) {
        await client.query(
          `INSERT INTO purchase_order_items (po_id, item_id, description, quantity, unit_cost, subtotal)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [poId, it.itemId ?? null, it.description, it.quantity, it.unitCost, it.quantity * it.unitCost],
        );
      }
      await client.query('COMMIT');
      void this.eventBus?.emit({
        type: DomainEventType.PurchaseOrderCreated,
        tenantId, actor: actor ?? 'system',
        payload: { poId, poNumber, total, lines: dto.items.length },
      });
      return { id: poId, poNumber, status: 'ordered', total };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Receive a PO: mark received and restock any linked inventory items. */
  async receivePurchaseOrder(tenantId: string, poId: string, actor?: string): Promise<Record<string, unknown>> {
    const po = await this.pool.query<{ status: string; po_number: string }>(
      `SELECT status, po_number FROM purchase_orders WHERE id = $1 AND tenant_id = $2`,
      [poId, tenantId],
    );
    if (po.rows.length === 0) throw new NotFoundException('Purchase order not found');
    if (po.rows[0]!.status === 'received') throw new BadRequestException('Purchase order already received');
    if (po.rows[0]!.status === 'cancelled') throw new BadRequestException('Cannot receive a cancelled purchase order');

    const lines = await this.pool.query<{ item_id: string | null; quantity: string }>(
      `SELECT item_id, quantity FROM purchase_order_items WHERE po_id = $1`,
      [poId],
    );
    await this.pool.query(
      `UPDATE purchase_orders SET status = 'received', received_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [poId],
    );
    // Restock linked items through the inventory service (records movements + low-stock logic).
    for (const line of lines.rows) {
      if (line.item_id) {
        await this.inventory.adjustStock(
          tenantId, line.item_id,
          { type: 'in', quantity: parseFloat(line.quantity), reason: 'PO received', reference: po.rows[0]!.po_number },
          actor,
        );
      }
    }
    void this.eventBus?.emit({
      type: DomainEventType.PurchaseOrderReceived,
      tenantId, actor: actor ?? 'system',
      payload: { poId, poNumber: po.rows[0]!.po_number, restockedLines: lines.rows.filter((l) => l.item_id).length },
    });
    return { id: poId, status: 'received' };
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
