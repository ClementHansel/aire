import { Injectable, Inject, Optional, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';

/**
 * TaxInvoiceService — Indonesian Faktur Pajak (tax invoice) issuance +
 * e-Faktur / Coretax bulk-import export.
 *
 * Scope is EXPORT FILE ONLY — there is no live government API integration here.
 * Seller identity + the enable toggle live in tenants.settings.taxInvoice
 * (default OFF); issued invoices live in the tax_invoices table.
 */

/** Seller config stored in tenants.settings.taxInvoice. */
export interface TaxInvoiceConfig {
  enabled: boolean;
  sellerNpwp: string;
  sellerName: string;
  sellerAddress: string;
  /** Coretax transaction code (kode transaksi), e.g. '04' (other value / DPP nilai lain). */
  kodeTransaksi: string;
  /** Prefix used when building the faktur number (default '010'). */
  fakturPrefix: string;
}

const DEFAULT_CONFIG: TaxInvoiceConfig = {
  enabled: false,
  sellerNpwp: '',
  sellerName: '',
  sellerAddress: '',
  kodeTransaksi: '04',
  fakturPrefix: '',
};

export interface UpdateCustomerTaxDto {
  npwp?: string | null;
  nik?: string | null;
  taxName?: string | null;
  taxAddress?: string | null;
}

export interface GenerateTaxInvoiceDto {
  orderId: string;
  buyerNpwp?: string;
  buyerNik?: string;
  buyerName?: string;
  buyerAddress?: string;
  kodeTransaksi?: string;
}

export interface TaxInvoiceRow {
  id: string;
  fakturNumber: string;
  kodeTransaksi: string;
  orderId: string | null;
  orderNumber: string | null;
  outletId: string | null;
  buyerNpwp: string | null;
  buyerNik: string | null;
  buyerName: string | null;
  buyerAddress: string | null;
  dpp: number;
  ppn: number;
  status: string;
  issuedAt: string;
  exportedAt: string | null;
}

export interface ExportFile {
  filename: string;
  contentType: string;
  content: string;
}

/**
 * Build the Coretax / e-Faktur bulk-import file from a set of issued tax invoices.
 *
 * IMPORTANT: The exact Coretax column order/labels and delimiter change with
 * government (DJP) updates. That volatility is deliberately isolated here in a
 * single function so a future format revision touches only this one place. The
 * `csv` format is a plain comma-separated variant for spreadsheet review.
 */
export function buildCoretaxFile(
  invoices: TaxInvoiceRow[],
  sellerNpwp: string,
  format: 'coretax' | 'csv',
): string {
  const delimiter = format === 'coretax' ? ';' : ',';
  const columns = [
    'KodeTransaksi',
    'FakturNumber',
    'InvoiceDate',
    'BuyerNPWP',
    'BuyerName',
    'DPP',
    'PPN',
    'SellerNPWP',
  ];
  const esc = (v: unknown): string => {
    const s = v == null ? '' : String(v);
    // Quote if the value contains the delimiter, a quote, or a newline.
    return /["\r\n]|[;,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = invoices.map((inv) =>
    [
      inv.kodeTransaksi,
      inv.fakturNumber,
      (inv.issuedAt || '').slice(0, 10),
      inv.buyerNpwp ?? '',
      inv.buyerName ?? '',
      inv.dpp.toFixed(2),
      inv.ppn.toFixed(2),
      sellerNpwp,
    ]
      .map(esc)
      .join(delimiter),
  );
  return [columns.map(esc).join(delimiter), ...rows].join('\r\n');
}

@Injectable()
export class TaxInvoiceService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  // ── Config (tenants.settings.taxInvoice) ────────────────────────────────

  async getConfig(tenantId: string): Promise<TaxInvoiceConfig> {
    const r = await this.pool.query<{ cfg: Partial<TaxInvoiceConfig> | null }>(
      `SELECT settings->'taxInvoice' AS cfg FROM tenants WHERE id = $1`,
      [tenantId],
    );
    const cfg = r.rows[0]?.cfg;
    return { ...DEFAULT_CONFIG, ...(cfg && typeof cfg === 'object' ? cfg : {}) };
  }

  async setConfig(tenantId: string, patch: Partial<TaxInvoiceConfig>): Promise<TaxInvoiceConfig> {
    const current = await this.getConfig(tenantId);
    const next: TaxInvoiceConfig = {
      enabled: patch.enabled ?? current.enabled,
      sellerNpwp: (patch.sellerNpwp ?? current.sellerNpwp).trim(),
      sellerName: (patch.sellerName ?? current.sellerName).trim(),
      sellerAddress: (patch.sellerAddress ?? current.sellerAddress).trim(),
      kodeTransaksi: (patch.kodeTransaksi ?? current.kodeTransaksi).trim() || '04',
      fakturPrefix: (patch.fakturPrefix ?? current.fakturPrefix).trim(),
    };
    // Merge into settings.taxInvoice, preserving other settings keys.
    await this.pool.query(
      `UPDATE tenants
       SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{taxInvoice}', $2::jsonb, true),
           updated_at = NOW()
       WHERE id = $1`,
      [tenantId, JSON.stringify(next)],
    );
    return this.getConfig(tenantId);
  }

  // ── Buyer tax identity on the customer record ───────────────────────────

  async updateCustomerTax(tenantId: string, customerId: string, dto: UpdateCustomerTaxDto): Promise<Record<string, unknown>> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (dto.npwp !== undefined) set('npwp', dto.npwp || null);
    if (dto.nik !== undefined) set('nik', dto.nik || null);
    if (dto.taxName !== undefined) set('tax_name', dto.taxName || null);
    if (dto.taxAddress !== undefined) set('tax_address', dto.taxAddress || null);
    if (sets.length === 0) throw new BadRequestException('Nothing to update');
    sets.push('updated_at = NOW()');
    params.push(customerId, tenantId);
    const res = await this.pool.query(
      `UPDATE customers SET ${sets.join(', ')}
       WHERE id = $${params.length - 1} AND tenant_id = $${params.length}
       RETURNING id, npwp, nik, tax_name, tax_address`,
      params,
    );
    if (res.rows.length === 0) throw new NotFoundException('Customer not found');
    const r = res.rows[0]!;
    return { id: r.id, npwp: r.npwp, nik: r.nik, taxName: r.tax_name, taxAddress: r.tax_address };
  }

  // ── Generate a Faktur Pajak from a paid order ───────────────────────────

  async generate(tenantId: string, dto: GenerateTaxInvoiceDto, actor?: string): Promise<TaxInvoiceRow> {
    if (!dto?.orderId) throw new BadRequestException('orderId is required');
    const ord = await this.pool.query<{
      id: string; order_number: string; total: string; tax: string | null;
      outlet_id: string | null; customer_id: string | null; status: string;
    }>(
      `SELECT id, order_number, total, tax, outlet_id, customer_id, status
       FROM orders WHERE id = $1 AND tenant_id = $2`,
      [dto.orderId, tenantId],
    );
    if (ord.rows.length === 0) throw new NotFoundException('Order not found');
    const o = ord.rows[0]!;
    if (!['paid', 'confirmed', 'completed'].includes(o.status)) {
      throw new BadRequestException('Tax invoice can only be issued for a paid/confirmed/completed order');
    }

    // Reject a duplicate up front (also protected by uq_tax_invoice_order).
    const dup = await this.pool.query<{ id: string }>(
      `SELECT id FROM tax_invoices WHERE order_id = $1 AND status <> 'void'`,
      [o.id],
    );
    if (dup.rows.length > 0) throw new ConflictException('A tax invoice already exists for this order');

    // Money model: total is tax-inclusive. PPN = order.tax (clamped), DPP = total - PPN.
    const total = parseFloat(o.total) || 0;
    const ppn = Math.min(parseFloat(o.tax ?? '0') || 0, total);
    const dpp = total - ppn;

    // Buyer identity: explicit body values, else fall back to the customer record.
    let buyer = {
      npwp: dto.buyerNpwp?.trim() || null as string | null,
      nik: dto.buyerNik?.trim() || null as string | null,
      name: dto.buyerName?.trim() || null as string | null,
      address: dto.buyerAddress?.trim() || null as string | null,
    };
    if (o.customer_id && (!buyer.npwp || !buyer.name || !buyer.address || !buyer.nik)) {
      const cust = await this.pool.query<{ npwp: string | null; nik: string | null; tax_name: string | null; tax_address: string | null; name: string | null }>(
        `SELECT npwp, nik, tax_name, tax_address, name FROM customers WHERE id = $1 AND tenant_id = $2`,
        [o.customer_id, tenantId],
      );
      const c = cust.rows[0];
      if (c) {
        buyer = {
          npwp: buyer.npwp ?? c.npwp,
          nik: buyer.nik ?? c.nik,
          name: buyer.name ?? c.tax_name ?? c.name,
          address: buyer.address ?? c.tax_address,
        };
      }
    }

    const config = await this.getConfig(tenantId);
    const kodeTransaksi = (dto.kodeTransaksi?.trim() || config.kodeTransaksi || '04');
    const prefix = config.fakturPrefix?.trim() || '010';
    const year = new Date().getFullYear();

    // Per-tenant running sequence: count existing invoices + 1, zero-padded to 8.
    const seqRes = await this.pool.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM tax_invoices WHERE tenant_id = $1`,
      [tenantId],
    );
    const seq = (parseInt(seqRes.rows[0]!.n, 10) + 1).toString().padStart(8, '0');
    const fakturNumber = `${prefix}.${year}.${seq}`;

    let ins;
    try {
      ins = await this.pool.query(
        `INSERT INTO tax_invoices
           (tenant_id, outlet_id, order_id, faktur_number, kode_transaksi,
            buyer_npwp, buyer_nik, buyer_name, buyer_address, dpp, ppn, status, issued_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'issued',NOW(),$12)
         RETURNING id, faktur_number, kode_transaksi, order_id, outlet_id,
                   buyer_npwp, buyer_nik, buyer_name, buyer_address, dpp, ppn, status, issued_at, exported_at`,
        [tenantId, o.outlet_id, o.id, fakturNumber, kodeTransaksi,
         buyer.npwp, buyer.nik, buyer.name, buyer.address, dpp, ppn, actor ?? null],
      );
    } catch (err) {
      // Unique-violation guard (race on order or faktur number).
      if (err && typeof err === 'object' && (err as { code?: string }).code === '23505') {
        throw new ConflictException('A tax invoice already exists for this order');
      }
      throw err;
    }

    const row = this.mapRow({ ...ins.rows[0]!, order_number: o.order_number });

    void this.eventBus?.emit({
      type: DomainEventType.TaxInvoiceIssued,
      tenantId, outletId: o.outlet_id ?? undefined, actor: actor ?? 'system',
      payload: { taxInvoiceId: row.id, fakturNumber: row.fakturNumber, orderId: o.id, dpp, ppn },
    });

    return row;
  }

  // ── Read ────────────────────────────────────────────────────────────────

  async list(tenantId: string, from?: string, to?: string): Promise<TaxInvoiceRow[]> {
    const params: unknown[] = [tenantId];
    let where = `ti.tenant_id = $1 AND ti.status <> 'void'`;
    if (from) { params.push(from); where += ` AND ti.issued_at::date >= $${params.length}`; }
    if (to) { params.push(to); where += ` AND ti.issued_at::date <= $${params.length}`; }
    const res = await this.pool.query(
      `SELECT ti.id, ti.faktur_number, ti.kode_transaksi, ti.order_id, ti.outlet_id,
              ti.buyer_npwp, ti.buyer_nik, ti.buyer_name, ti.buyer_address,
              ti.dpp, ti.ppn, ti.status, ti.issued_at, ti.exported_at,
              o.order_number
       FROM tax_invoices ti
       LEFT JOIN orders o ON o.id = ti.order_id
       WHERE ${where}
       ORDER BY ti.issued_at DESC LIMIT 500`,
      params,
    );
    return res.rows.map((r) => this.mapRow(r));
  }

  async getOne(tenantId: string, id: string): Promise<TaxInvoiceRow & { sellerNpwp: string; sellerName: string; sellerAddress: string }> {
    const res = await this.pool.query(
      `SELECT ti.id, ti.faktur_number, ti.kode_transaksi, ti.order_id, ti.outlet_id,
              ti.buyer_npwp, ti.buyer_nik, ti.buyer_name, ti.buyer_address,
              ti.dpp, ti.ppn, ti.status, ti.issued_at, ti.exported_at,
              o.order_number
       FROM tax_invoices ti
       LEFT JOIN orders o ON o.id = ti.order_id
       WHERE ti.id = $1 AND ti.tenant_id = $2`,
      [id, tenantId],
    );
    if (res.rows.length === 0) throw new NotFoundException('Tax invoice not found');
    const config = await this.getConfig(tenantId);
    return {
      ...this.mapRow(res.rows[0]!),
      sellerNpwp: config.sellerNpwp,
      sellerName: config.sellerName,
      sellerAddress: config.sellerAddress,
    };
  }

  // ── Coretax export (marks issued invoices exported) ─────────────────────

  async exportRange(tenantId: string, from: string | undefined, to: string | undefined, format: 'coretax' | 'csv'): Promise<ExportFile> {
    const invoices = await this.list(tenantId, from, to);
    const exportable = invoices.filter((i) => i.status === 'issued' || i.status === 'exported');
    const config = await this.getConfig(tenantId);
    const content = buildCoretaxFile(exportable, config.sellerNpwp, format);

    // Mark the freshly issued ones as exported (idempotent — re-export keeps them exported).
    const toMark = exportable.filter((i) => i.status === 'issued').map((i) => i.id);
    if (toMark.length > 0) {
      await this.pool.query(
        `UPDATE tax_invoices SET status = 'exported', exported_at = NOW(), updated_at = NOW()
         WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND status = 'issued'`,
        [tenantId, toMark],
      );
    }

    const stamp = `${from ?? 'all'}-to-${to ?? 'all'}`;
    return {
      filename: `${format === 'coretax' ? 'coretax' : 'faktur'}-${stamp}.csv`,
      contentType: 'text/csv',
      content,
    };
  }

  // ── Mapping ──────────────────────────────────────────────────────────────

  private mapRow(r: Record<string, unknown>): TaxInvoiceRow {
    return {
      id: r.id as string,
      fakturNumber: r.faktur_number as string,
      kodeTransaksi: r.kode_transaksi as string,
      orderId: (r.order_id as string | null) ?? null,
      orderNumber: (r.order_number as string | null) ?? null,
      outletId: (r.outlet_id as string | null) ?? null,
      buyerNpwp: (r.buyer_npwp as string | null) ?? null,
      buyerNik: (r.buyer_nik as string | null) ?? null,
      buyerName: (r.buyer_name as string | null) ?? null,
      buyerAddress: (r.buyer_address as string | null) ?? null,
      dpp: parseFloat(String(r.dpp)) || 0,
      ppn: parseFloat(String(r.ppn)) || 0,
      status: r.status as string,
      issuedAt: r.issued_at instanceof Date ? r.issued_at.toISOString() : String(r.issued_at),
      exportedAt: r.exported_at ? (r.exported_at instanceof Date ? r.exported_at.toISOString() : String(r.exported_at)) : null,
    };
  }
}
