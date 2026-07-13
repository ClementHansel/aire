import type { DocKind, DocData } from './DocumentRenderer';

/** A placeable field token in the add-field palette. */
export interface FieldDef { field: string; label: string }
/** A toggleable optional report section (report kind only). */
export interface SectionDef { key: string; label: string }

export interface DocCatalog {
  kind: DocKind;
  /** Field tokens offered in the "add field" palette. */
  fields: FieldDef[];
  allowLogo: boolean;
  allowCode: boolean;
  allowTable: boolean;
  allowTotals: boolean;
  /** Column keys the table element may show (labels editable per column). */
  tableColumns: { key: string; label: string }[];
  /** Sample data for the live preview. */
  sample: DocData;
  /** Report-only: optional sections gated by template.reportSections. */
  sections?: SectionDef[];
}

const INVOICE: DocCatalog = {
  kind: 'invoice',
  fields: [
    { field: 'company_name', label: 'Company name' },
    { field: 'legal_name', label: 'Legal name (PT)' },
    { field: 'npwp', label: 'NPWP (tax id)' },
    { field: 'company_address', label: 'Company address' },
    { field: 'company_phone', label: 'Company phone' },
    { field: 'invoice_number', label: 'Invoice number' },
    { field: 'invoice_date', label: 'Invoice date' },
    { field: 'customer_name', label: 'Customer name' },
    { field: 'customer_phone', label: 'Customer phone' },
    { field: 'license_plate', label: 'License plate' },
    { field: 'payment_method', label: 'Payment method' },
    { field: 'note', label: 'Note' },
  ],
  allowLogo: true, allowCode: true, allowTable: true, allowTotals: true,
  tableColumns: [
    { key: 'name', label: 'Item' },
    { key: 'quantity', label: 'Qty' },
    { key: 'unitPrice', label: 'Unit Price' },
    { key: 'subtotal', label: 'Amount' },
  ],
  sample: {
    fields: {
      company_name: 'Airin Car Wash', legal_name: 'PT Airin Bersih Sejahtera', npwp: '01.234.567.8-901.000',
      company_address: 'Jl. Merdeka No. 10, Jakarta', company_phone: '+62 21 555 0100',
      invoice_number: 'INV-20260712-001', invoice_date: '12/07/2026',
      customer_name: 'Budi Santoso', customer_phone: '+62 812 3456 7890', license_plate: 'B 1234 XYZ',
      payment_method: 'QRIS', note: 'Terima kasih',
    },
    items: [
      { name: 'Cuci Mobil Premium', quantity: '1', unitPrice: 'Rp 75.000', subtotal: 'Rp 75.000' },
      { name: 'Poles Body', quantity: '1', unitPrice: 'Rp 120.000', subtotal: 'Rp 120.000' },
    ],
    totals: [
      { label: 'Subtotal', value: 'Rp 195.000' },
      { label: 'Service charge', value: 'Rp 9.750' },
      { label: 'Tax (11%)', value: 'Rp 22.523' },
      { label: 'Discount', value: '- Rp 0' },
      { label: 'Total', value: 'Rp 227.273', strong: true },
    ],
    logo: null, code: null,
  },
};

const RECEIPT: DocCatalog = {
  kind: 'receipt',
  fields: [
    { field: 'outlet_name', label: 'Branch name' },
    { field: 'outlet_address', label: 'Branch address' },
    { field: 'outlet_phone', label: 'Branch phone' },
    { field: 'order_number', label: 'Order number' },
    { field: 'datetime', label: 'Date & time' },
    { field: 'customer_name', label: 'Customer name' },
    { field: 'license_plate', label: 'License plate' },
    { field: 'operator_name', label: 'Operator' },
    { field: 'payment_method', label: 'Payment method' },
  ],
  allowLogo: true, allowCode: true, allowTable: true, allowTotals: true,
  tableColumns: [
    { key: 'line', label: 'Item' },
    { key: 'subtotal', label: 'Amount' },
  ],
  sample: {
    fields: {
      outlet_name: 'Airin — Cabang Menteng', outlet_address: 'Jl. Menteng Raya 5', outlet_phone: '+62 21 555 0111',
      order_number: 'ORD-20260712-014', datetime: '12/07/2026 14:32',
      customer_name: 'Budi Santoso', license_plate: 'B 1234 XYZ', operator_name: 'Andi', payment_method: 'QRIS',
    },
    items: [
      { line: '1× Cuci Mobil Premium', subtotal: 'Rp 75.000' },
      { line: '1× Poles Body', subtotal: 'Rp 120.000' },
    ],
    totals: [{ label: 'Total', value: 'Rp 195.000', strong: true }],
    logo: null, code: null,
  },
};

const REPORT: DocCatalog = {
  kind: 'report',
  fields: [
    { field: 'tenant_name', label: 'Company name' },
    { field: 'report_title', label: 'Report title' },
    { field: 'date_range', label: 'Date range' },
    { field: 'generated_at', label: 'Generated at' },
  ],
  allowLogo: true, allowCode: false, allowTable: false, allowTotals: false,
  tableColumns: [],
  sample: {
    fields: {
      tenant_name: 'Airin Car Wash', report_title: 'Sales Report', date_range: '01–31 Jul 2026',
      generated_at: 'Generated 12/07/2026 15:00',
    },
    items: [], totals: [], logo: null, code: null,
  },
  sections: [
    { key: 'kpis', label: 'KPI summary band' },
    { key: 'businessUnit', label: 'Business-unit P&L (AIRE / LEAD)' },
    { key: 'revenueChart', label: 'Revenue trend chart' },
    { key: 'paymentMix', label: 'Payment-mix chart' },
    { key: 'topServices', label: 'Top services table' },
    { key: 'dailySales', label: 'Daily sales table' },
    { key: 'shifts', label: 'Shift reconciliation table' },
  ],
};

const LABEL: DocCatalog = {
  kind: 'label',
  fields: [
    { field: 'product_name', label: 'Product name' },
    { field: 'price', label: 'Price' },
    { field: 'barcode', label: 'Barcode number' },
  ],
  allowLogo: false, allowCode: true, allowTable: false, allowTotals: false,
  tableColumns: [],
  sample: {
    fields: {
      product_name: 'Meguiar’s Car Wax',
      price: 'Rp 125.000',
      barcode: '2000000000015',
    },
    items: [], totals: [], logo: null, code: null,
  },
};

export const DOC_CATALOGS: Record<DocKind, DocCatalog> = { invoice: INVOICE, receipt: RECEIPT, report: REPORT, label: LABEL };
