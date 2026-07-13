import { Injectable, Inject } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { StorageService, StoredObject } from '../storage';

/** The business documents a tenant can design a layout for ('label' = barcode product label). */
export type DocKind = 'invoice' | 'receipt' | 'report' | 'label';
export const DOC_KINDS: DocKind[] = ['invoice', 'receipt', 'report', 'label'];

export type DocElementType =
  | 'text' | 'field' | 'logo' | 'image' | 'table' | 'code' | 'divider' | 'totals';
export type DocAlign = 'left' | 'center' | 'right';

export interface DocTableColumn {
  key: string;
  label: string;
  width: number;
  align?: DocAlign;
}

/** A single positioned element on the document canvas. */
export interface DocElement {
  id: string;
  type: DocElementType;
  /** Token key from the kind's field catalog (type 'field'). */
  field?: string;
  /** Literal text (type 'text'). */
  text?: string;
  x: number; y: number; w: number; h: number;
  fontSize?: number;
  color?: string;
  align?: DocAlign;
  bold?: boolean;
  /** Columns for the repeating line-items table (type 'table'). */
  columns?: DocTableColumn[];
  /** Code element (type 'code'). */
  codeType?: 'qr' | 'barcode';
  codeSource?: string;
}

export interface DocTemplate {
  kind: DocKind;
  paper: 'A4' | 'thermal80' | 'thermal58';
  width: number;
  height: number;
  /** Versioned public URL of the background image in object storage, or null. */
  backgroundImage: string | null;
  elements: DocElement[];
  /** Report only: which optional sections/tables are printed. */
  reportSections?: Record<string, boolean>;
}

/** Which `tenants.settings` JSONB key each kind persists under. */
const SETTINGS_KEY: Record<DocKind, string> = {
  invoice: 'invoiceTemplate',
  receipt: 'receiptTemplate',
  report: 'reportTemplate',
  label: 'labelTemplate',
};

/** Object-storage key for a tenant's document background. */
function docBgKey(tenantId: string, kind: DocKind): string {
  return `tenants/${tenantId}/doc-${kind}-bg`;
}

/**
 * Document (invoice / receipt / report) layout templates — a drag-and-drop
 * layout stored per-tenant in `tenants.settings.<kind>Template` (JSONB), modeled
 * on MembershipCardService. Background images live in object storage; the
 * template holds a versioned public streaming URL, never a base64 blob.
 */
@Injectable()
export class DocTemplateService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly storage: StorageService,
  ) {}

  private defaultTemplate(kind: DocKind): DocTemplate {
    if (kind === 'label') {
      // Small thermal product label ~ 400×240px: product name, price, and a
      // barcode bound to the product's barcode value.
      return {
        kind, paper: 'thermal58', width: 400, height: 240, backgroundImage: null,
        elements: [
          { id: 'product_name', type: 'field', field: 'product_name', x: 20, y: 16, w: 360, h: 28, fontSize: 18, color: '#111111', align: 'center', bold: true },
          { id: 'price', type: 'field', field: 'price', x: 20, y: 48, w: 360, h: 24, fontSize: 20, color: '#111111', align: 'center', bold: true },
          { id: 'barcode', type: 'code', codeType: 'barcode', codeSource: 'barcode', x: 60, y: 88, w: 280, h: 100, fontSize: 0, color: '#000000', align: 'center' },
          { id: 'barcode_text', type: 'field', field: 'barcode', x: 20, y: 194, w: 360, h: 20, fontSize: 13, color: '#333333', align: 'center' },
        ],
      };
    }
    if (kind === 'receipt') {
      // Thermal 80mm ≈ 280px design width; tall enough for the item table + totals.
      return {
        kind, paper: 'thermal80', width: 280, height: 640, backgroundImage: null,
        elements: [
          { id: 'outlet_name', type: 'field', field: 'outlet_name', x: 20, y: 16, w: 240, h: 24, fontSize: 15, color: '#111111', align: 'center', bold: true },
          { id: 'meta', type: 'field', field: 'order_number', x: 20, y: 44, w: 240, h: 16, fontSize: 11, color: '#555555', align: 'center' },
          { id: 'datetime', type: 'field', field: 'datetime', x: 20, y: 62, w: 240, h: 16, fontSize: 11, color: '#555555', align: 'center' },
          { id: 'items', type: 'table', x: 20, y: 96, w: 240, h: 380, fontSize: 12, color: '#111111', columns: [
            { key: 'line', label: 'Item', width: 170, align: 'left' },
            { key: 'subtotal', label: 'Amount', width: 70, align: 'right' },
          ] },
          { id: 'totals', type: 'totals', x: 20, y: 500, w: 240, h: 60, fontSize: 13, color: '#111111', align: 'right' },
          { id: 'footer', type: 'text', text: 'Terima kasih!', x: 20, y: 580, w: 240, h: 20, fontSize: 11, color: '#555555', align: 'center' },
        ],
      };
    }
    if (kind === 'report') {
      return {
        kind, paper: 'A4', width: 595, height: 842, backgroundImage: null,
        elements: [
          { id: 'logo', type: 'logo', field: 'logo', x: 40, y: 32, w: 120, h: 48, align: 'left' },
          { id: 'title', type: 'field', field: 'report_title', x: 320, y: 32, w: 235, h: 30, fontSize: 22, color: '#111111', align: 'right', bold: true },
          { id: 'range', type: 'field', field: 'date_range', x: 320, y: 66, w: 235, h: 18, fontSize: 12, color: '#555555', align: 'right' },
          { id: 'company', type: 'field', field: 'tenant_name', x: 40, y: 90, w: 300, h: 20, fontSize: 13, color: '#333333', align: 'left' },
        ],
        reportSections: { kpis: true, businessUnit: true, revenueChart: true, paymentMix: true, topServices: true, dailySales: true, shifts: true },
      };
    }
    // invoice — A4 portrait
    return {
      kind, paper: 'A4', width: 595, height: 842, backgroundImage: null,
      elements: [
        { id: 'logo', type: 'logo', field: 'logo', x: 40, y: 32, w: 140, h: 56, align: 'left' },
        { id: 'company', type: 'field', field: 'company_name', x: 40, y: 96, w: 300, h: 24, fontSize: 18, color: '#111111', align: 'left', bold: true },
        { id: 'address', type: 'field', field: 'company_address', x: 40, y: 122, w: 300, h: 36, fontSize: 11, color: '#555555', align: 'left' },
        { id: 'npwp', type: 'field', field: 'npwp', x: 40, y: 158, w: 300, h: 16, fontSize: 11, color: '#555555', align: 'left' },
        { id: 'heading', type: 'text', text: 'INVOICE', x: 355, y: 32, w: 200, h: 34, fontSize: 26, color: '#1652f0', align: 'right', bold: true },
        { id: 'number', type: 'field', field: 'invoice_number', x: 355, y: 70, w: 200, h: 18, fontSize: 12, color: '#555555', align: 'right' },
        { id: 'date', type: 'field', field: 'invoice_date', x: 355, y: 90, w: 200, h: 18, fontSize: 12, color: '#555555', align: 'right' },
        { id: 'billto', type: 'field', field: 'customer_name', x: 40, y: 210, w: 300, h: 22, fontSize: 14, color: '#111111', align: 'left', bold: true },
        { id: 'phone', type: 'field', field: 'customer_phone', x: 40, y: 232, w: 300, h: 18, fontSize: 11, color: '#555555', align: 'left' },
        { id: 'items', type: 'table', x: 40, y: 280, w: 515, h: 380, fontSize: 12, color: '#111111', columns: [
          { key: 'name', label: 'Item', width: 275, align: 'left' },
          { key: 'quantity', label: 'Qty', width: 60, align: 'center' },
          { key: 'unitPrice', label: 'Unit Price', width: 90, align: 'right' },
          { key: 'subtotal', label: 'Amount', width: 90, align: 'right' },
        ] },
        { id: 'totals', type: 'totals', x: 315, y: 680, w: 240, h: 100, fontSize: 13, color: '#111111', align: 'right' },
        { id: 'footer', type: 'text', text: 'Thank you for your business.', x: 40, y: 800, w: 515, h: 20, fontSize: 11, color: '#555555', align: 'center' },
      ],
    };
  }

  /** Fill in fields missing from older saved templates. */
  private normalize(kind: DocKind, tpl: DocTemplate): DocTemplate {
    return {
      ...tpl,
      kind,
      backgroundImage: tpl.backgroundImage ?? null,
      elements: Array.isArray(tpl.elements) ? tpl.elements : [],
      ...(kind === 'report' ? { reportSections: tpl.reportSections ?? {} } : {}),
    };
  }

  async get(tenantId: string, kind: DocKind): Promise<DocTemplate> {
    const r = await this.pool.query<{ tpl: DocTemplate | null }>(
      `SELECT settings->$2 AS tpl FROM tenants WHERE id = $1`,
      [tenantId, SETTINGS_KEY[kind]],
    );
    const tpl = r.rows[0]?.tpl;
    return tpl && Array.isArray(tpl.elements) ? this.normalize(kind, tpl) : this.defaultTemplate(kind);
  }

  async set(tenantId: string, kind: DocKind, template: DocTemplate): Promise<DocTemplate> {
    let next = this.normalize(kind, template);
    // Never persist an inline data-URL background (would reintroduce blobs in
    // Postgres). A data: value means an old client — preserve the stored URL.
    if (typeof next.backgroundImage === 'string' && next.backgroundImage.startsWith('data:')) {
      const existing = await this.get(tenantId, kind);
      next = { ...next, backgroundImage: existing.backgroundImage };
    }
    // Merge into settings.<kind>Template, preserving other settings keys.
    await this.pool.query(
      `UPDATE tenants
       SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), ARRAY[$2], $3::jsonb, true),
           updated_at = NOW()
       WHERE id = $1`,
      [tenantId, SETTINGS_KEY[kind], JSON.stringify(next)],
    );
    return this.get(tenantId, kind);
  }

  /** Upload the document background to object storage; returns the updated template. */
  async setBackground(tenantId: string, kind: DocKind, buffer: Buffer, contentType: string): Promise<DocTemplate> {
    await this.storage.put(docBgKey(tenantId, kind), buffer, contentType);
    const version = createHash('sha256').update(buffer).digest('hex').slice(0, 12);
    const url = `/api/public/doc-template/${kind}/background?tenantId=${encodeURIComponent(tenantId)}&v=${version}`;
    const current = await this.get(tenantId, kind);
    return this.set(tenantId, kind, { ...current, backgroundImage: url });
  }

  async removeBackground(tenantId: string, kind: DocKind): Promise<DocTemplate> {
    await this.storage.delete(docBgKey(tenantId, kind)).catch(() => undefined);
    const current = await this.get(tenantId, kind);
    return this.set(tenantId, kind, { ...current, backgroundImage: null });
  }

  /** Stream the stored background for a tenant/kind (or null if none). */
  async getBackground(tenantId: string, kind: DocKind): Promise<StoredObject | null> {
    return this.storage.get(docBgKey(tenantId, kind));
  }
}
