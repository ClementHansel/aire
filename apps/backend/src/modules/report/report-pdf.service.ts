import { Injectable } from '@nestjs/common';
import { SummaryResponse } from '@aire/shared';
import * as fs from 'fs';
import * as path from 'path';
import type { TDocumentDefinitions, Content, ContentTable, TFontDictionary } from 'pdfmake/interfaces';

// pdfmake is pinned to the stable 0.2.x line: its CommonJS main IS the Node server
// PdfPrinter constructor and createPdfKitDocument returns a PDFKit stream (consumed
// via data/end/error). (0.3 is a breaking rewrite — async API + relocated server
// entry — that this code is not written for; do not bump without porting the API.)
// The server printer isn't in @types/pdfmake's surface, so type it locally.
interface PdfKitStream {
  on(event: 'data', cb: (chunk: Buffer) => void): void;
  on(event: 'end', cb: () => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  end(): void;
}
interface PdfPrinter {
  createPdfKitDocument(def: TDocumentDefinitions): PdfKitStream;
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PdfPrinter: new (fonts: TFontDictionary) => PdfPrinter = require('pdfmake');

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

/**
 * Renders the business report as a polished, branded PDF (server-side, no
 * headless browser). Uses pdfmake with the AIRIN brand faces (vendored below)
 * plus bundled Roboto as a glyph-coverage fallback.
 *
 * Layout: a dark, full-bleed AIRIN cover page (wordmark, mono title, tenant/
 * period/scope info cards), then a slim brand masthead + footer (page numbers)
 * on every following page, a title block, KPI band, AIRE/LEAD P&L, two vector
 * bar charts (revenue trend + payment mix), and zebra-striped tables (payment
 * methods, top services, daily sales, shifts).
 */

export interface DailyRow {
  date: string;
  orders: number;
  revenue: number;
  paidOrders: number;
}

export interface ShiftRow {
  operator?: string | null;
  status?: string;
  totalSales?: number | null;
  expected?: number | null;
  counted?: number | null;
  variance?: number | null;
  openedAt?: string;
  [k: string]: unknown;
}

export interface ReportPdfInput {
  tenantName: string;
  outletName: string | null; // null → all branches
  businessUnit?: string; // '', 'AIRE', 'LEAD'
  dateFrom: string;
  dateTo: string;
  generatedAt: Date;
  summary: SummaryResponse;
  daily: DailyRow[];
  shifts: ShiftRow[];
  /**
   * Optional per-section visibility from the tenant's report template
   * (settings.reportTemplate.reportSections). A section is shown unless its key
   * is explicitly false. Keys: kpis, businessUnit, revenueChart, paymentMix,
   * topServices, dailySales, shifts.
   */
  sections?: Record<string, boolean>;
  /** Tenant logo as a base64 data URL, rendered in the masthead when present. */
  logoDataUrl?: string;
}

// ── AIRIN brand palette ───────────────────────────────────────────────────────
// Matches the AIRIN design system (see AIRE Cashier Handbook reference): a deep
// navy "Surface Dark" cover, Brand Blue as the primary accent, a lighter Accent
// Purple for secondary highlights, and a warm Floral White for the wordmark.
const BRAND = '#3d3fa3'; // Brand Blue (primary)
const BRAND_DARK = '#292b6e'; // Brand Blue, darkened for small text on light bg
const SURFACE_DARK = '#141433'; // cover background
const SURFACE_DARK_2 = '#1c1c4a'; // cover gradient stop
const ACCENT_PURPLE = '#8b7ff5'; // secondary accent (charts, cover kicker/labels)
const FLORAL_WHITE = '#fffbf0'; // warm white (wordmark, cover footer rule)
const INK = '#0a0a0a';
const SLATE = '#1e293b';
const MUTED = '#6b7280';
const FAINT = '#9ca3af';
const HAIRLINE = '#e5e7eb';
const SUNKEN = '#f1f0fb'; // brand-tinted near-white (KPI band / zebra rows)
const GREEN = '#0f9d58';
const RED = '#d93025';

@Injectable()
export class ReportPdfService {
  private readonly printer: PdfPrinter;
  private readonly wordmarkSvg: string;

  constructor() {
    // Brand faces are vendored under src/assets (nest-cli.json copies them to
    // dist/assets on build/watch — see "assets" in nest-cli.json), so resolve
    // relative to this compiled file rather than process.cwd().
    const assetsDir = path.join(__dirname, '..', '..', 'assets');
    const fontFile = (rel: string): Buffer => {
      const p = path.join(assetsDir, 'fonts', rel);
      if (!fs.existsSync(p)) throw new Error(`Vendored report font missing: ${p}`);
      return fs.readFileSync(p);
    };

    // pdfmake ships Roboto as base64 in build/vfs_fonts. Kept registered (but
    // unused by defaultStyle) purely as a fallback family for any glyph outside
    // Inter/JetBrains Mono's coverage. The export shape has varied across
    // versions, so unwrap defensively, then hand Buffers to the server-side
    // printer (which wants font data, not browser vfs).
    const mod: any = require('pdfmake/build/vfs_fonts');
    const vfs: Record<string, string> = mod?.pdfMake?.vfs ?? mod?.vfs ?? mod?.default?.pdfMake?.vfs ?? mod;
    const robotoFont = (name: string): Buffer => {
      const data = vfs[name];
      if (!data) throw new Error(`pdfmake bundled font missing: ${name}`);
      return Buffer.from(data, 'base64');
    };

    this.printer = new PdfPrinter({
      // Body face. Regression note: pdfmake's bundled Roboto build drops the
      // "fi" ligature glyph ("Confidential" → "Confdential", "Microfiber" →
      // "Microfber") — Inter renders it correctly, which this fixes.
      Inter: {
        normal: fontFile('inter/Inter-Regular.ttf'),
        bold: fontFile('inter/Inter-Bold.ttf'),
        italics: fontFile('inter/Inter-Italic.ttf'),
        bolditalics: fontFile('inter/Inter-BoldItalic.ttf'),
      },
      // Headline face — mono, per the AIRIN brand system (titles/section
      // headers). --font-mono in the web app.
      JetBrainsMono: {
        normal: fontFile('jetbrains-mono/JetBrainsMono-Regular.ttf'),
        bold: fontFile('jetbrains-mono/JetBrainsMono-Bold.ttf'),
        italics: fontFile('jetbrains-mono/JetBrainsMono-Italic.ttf'),
        bolditalics: fontFile('jetbrains-mono/JetBrainsMono-BoldItalic.ttf'),
      },
      Roboto: {
        normal: robotoFont('Roboto-Regular.ttf'),
        bold: robotoFont('Roboto-Medium.ttf'),
        italics: robotoFont('Roboto-Italic.ttf'),
        bolditalics: robotoFont('Roboto-MediumItalic.ttf'),
      },
    } as any);

    this.wordmarkSvg = fs.readFileSync(path.join(assetsDir, 'brand', 'airin-wordmark-white.svg'), 'utf8');
  }

  async build(input: ReportPdfInput): Promise<Buffer> {
    const doc = this.printer.createPdfKitDocument(this.docDefinition(input));
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    });
  }

  // ── Formatting helpers ──────────────────────────────────────────────────────
  private rp(n: number): string {
    return 'Rp ' + Math.round(n).toLocaleString('id-ID');
  }
  private rpCompact(n: number): string {
    const a = Math.abs(n);
    if (a >= 1_000_000_000) return 'Rp ' + (n / 1_000_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' M';
    if (a >= 1_000_000) return 'Rp ' + (n / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt';
    return this.rp(n);
  }
  private fmtDate(d: string | Date): string {
    const dt = typeof d === 'string' ? new Date(d) : d;
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // ── Cover page (AIRIN brand system) ──────────────────────────────────────────
  // A dark, full-bleed first page: wordmark, mono kicker + title, tenant/period
  // subtitle, and a 2x2 grid of labeled info cards, mirroring the cover of the
  // AIRE Cashier Handbook reference. `background` paints the surface (it draws
  // ignoring pageMargins, so it bleeds to the page edge); the content below
  // sits inside the normal margins on top of it.
  private coverBackground(pageSize: { width: number; height: number }): Content {
    return {
      canvas: [
        { type: 'rect', x: 0, y: 0, w: pageSize.width, h: pageSize.height, linearGradient: [SURFACE_DARK, SURFACE_DARK_2] },
        { type: 'ellipse', x: pageSize.width * 0.82, y: pageSize.height * 0.34, r1: 260, r2: 340, color: ACCENT_PURPLE, fillOpacity: 0.14 },
        { type: 'ellipse', x: pageSize.width * 0.98, y: pageSize.height * 0.6, r1: 200, r2: 270, color: BRAND, fillOpacity: 0.28 },
      ],
    };
  }

  // Returned shape is a table Column (has `width`), which the shared `Content`
  // type doesn't model — same widening `buCard` already uses below.
  private coverCard(label: string, value: string): any {
    const w = 237;
    const h = 60;
    return {
      width: w,
      stack: [
        {
          canvas: [
            { type: 'rect', x: 0, y: 0, w, h, r: 7, color: FLORAL_WHITE, fillOpacity: 0.07 },
            { type: 'rect', x: 0, y: 0, w, h, r: 7, lineColor: FLORAL_WHITE, lineWidth: 0.75, fillOpacity: 0 },
          ],
        },
        {
          text: label.toUpperCase(),
          font: 'JetBrainsMono',
          fontSize: 7,
          color: ACCENT_PURPLE,
          characterSpacing: 0.6,
          margin: [14, -h + 13, 14, 0] as [number, number, number, number],
        },
        { text: value, font: 'Inter', bold: true, fontSize: 10.5, color: FLORAL_WHITE, margin: [14, 5, 14, 0] as [number, number, number, number] },
      ],
    };
  }

  private coverPage(input: ReportPdfInput, scope: string, unit: string, periodLabel: string): Content[] {
    return [
      { svg: this.wordmarkSvg, width: 118, margin: [0, 8, 0, 0] as [number, number, number, number] },
      {
        text: 'BUSINESS REPORT / OPERATIONS SUMMARY',
        font: 'JetBrainsMono',
        fontSize: 8.5,
        color: ACCENT_PURPLE,
        characterSpacing: 1,
        margin: [0, 130, 0, 16] as [number, number, number, number],
      },
      { text: 'Business Report', font: 'JetBrainsMono', bold: true, fontSize: 32, color: FLORAL_WHITE, margin: [0, 0, 0, 12] as [number, number, number, number] },
      {
        text: input.tenantName,
        font: 'Inter',
        bold: true,
        fontSize: 13,
        color: FLORAL_WHITE,
        margin: [0, 0, 0, 3] as [number, number, number, number],
      },
      {
        text: `${unit} · ${periodLabel}`,
        font: 'Inter',
        fontSize: 10.5,
        color: '#c7c6ec',
        margin: [0, 0, 0, 46] as [number, number, number, number],
      },
      {
        columns: [this.coverCard('BUSINESS', input.tenantName), { width: 15, text: '' }, this.coverCard('PERIOD', periodLabel)],
        margin: [0, 0, 0, 15] as [number, number, number, number],
      },
      {
        columns: [this.coverCard('SCOPE', scope), { width: 15, text: '' }, this.coverCard('GENERATED', this.fmtDate(input.generatedAt))],
        margin: [0, 0, 0, 0] as [number, number, number, number],
      },
      {
        text: 'Powered by AIRIN',
        font: 'JetBrainsMono',
        fontSize: 8,
        color: '#8886c2',
        absolutePosition: { x: 40, y: 780 },
      },
      { text: '', pageBreak: 'after' },
    ];
  }

  // ── Horizontal bar chart as a borderless table (label | bar | value) ────────
  private hBarChart(rows: { label: string; value: number; display: string }[], color = BRAND, barMax = 300): Content {
    if (rows.length === 0) {
      return { text: 'No data for this period.', italics: true, fontSize: 9, color: FAINT, margin: [0, 2, 0, 8] };
    }
    const max = Math.max(1, ...rows.map((r) => r.value));
    const body = rows.map((r) => {
      const w = Math.max(1, (r.value / max) * barMax);
      return [
        { text: r.label, fontSize: 8, color: SLATE, margin: [0, 2, 0, 0] as [number, number, number, number] },
        {
          canvas: [
            { type: 'rect', x: 0, y: 2, w: barMax, h: 9, r: 2, color: SUNKEN },
            { type: 'rect', x: 0, y: 2, w, h: 9, r: 2, color },
          ],
        },
        { text: r.display, fontSize: 8, color: MUTED, alignment: 'right', noWrap: true, margin: [0, 2, 0, 0] as [number, number, number, number] },
      ];
    });
    return {
      table: { widths: [64, barMax, 'auto'], body: body as any },
      layout: 'noBorders',
      margin: [0, 2, 0, 8],
    } as ContentTable;
  }

  private bucketRevenue(daily: DailyRow[]): { label: string; value: number; display: string }[] {
    if (daily.length === 0) return [];
    let pairs: { key: string; value: number }[];
    if (daily.length <= 31) {
      pairs = daily.map((d) => ({ key: d.date.slice(5), value: d.revenue })); // MM-DD
    } else {
      const m = new Map<string, number>();
      for (const d of daily) m.set(d.date.slice(0, 7), (m.get(d.date.slice(0, 7)) ?? 0) + d.revenue);
      pairs = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, value]) => ({ key, value }));
    }
    return pairs.map((p) => ({ label: p.key, value: p.value, display: this.rpCompact(p.value) }));
  }

  // ── KPI band ────────────────────────────────────────────────────────────────
  private kpiBand(s: SummaryResponse): Content {
    const cell = (label: string, value: string, color = INK) => ({
      stack: [
        { text: label.toUpperCase(), fontSize: 7, color: MUTED, characterSpacing: 0.5, margin: [0, 0, 0, 3] as [number, number, number, number] },
        { text: value, fontSize: 15, bold: true, color },
      ],
      margin: [10, 10, 10, 10] as [number, number, number, number],
    });
    return {
      table: {
        widths: ['*', '*', '*', '*', '*'],
        body: [[
          cell('Total Orders', String(s.totalOrders)),
          cell('Revenue', this.rpCompact(s.revenue), BRAND),
          cell('Paid', String(s.paidCount), GREEN),
          cell('Cancelled', String(s.cancelledCount), s.cancelledCount > 0 ? RED : INK),
          cell('Members Served', String(s.uniqueMembers)),
        ]],
      },
      layout: {
        fillColor: () => SUNKEN,
        hLineWidth: () => 0,
        vLineWidth: (i: number) => (i === 0 || i === 5 ? 0 : 1),
        vLineColor: () => '#ffffff',
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 0,
        paddingBottom: () => 0,
      },
      margin: [0, 0, 0, 16],
    } as ContentTable;
  }

  // ── Generic data table with brand header + zebra rows ────────────────────────
  private dataTable(
    headers: { text: string; align?: 'left' | 'right' }[],
    rows: (string | { text: string; color?: string })[][],
    widths: (string | number)[],
    emptyText: string,
  ): Content {
    if (rows.length === 0) {
      return { text: emptyText, italics: true, fontSize: 9, color: FAINT, margin: [0, 4, 0, 12] };
    }
    const head = headers.map((h) => ({
      text: h.text.toUpperCase(),
      fontSize: 7.5,
      bold: true,
      color: '#ffffff',
      alignment: h.align ?? 'left',
      margin: [0, 3, 0, 3] as [number, number, number, number],
    }));
    const body = rows.map((r) =>
      r.map((c, i) => {
        const val = typeof c === 'string' ? { text: c } : c;
        return {
          text: val.text,
          fontSize: 8.5,
          color: (val as any).color ?? SLATE,
          alignment: headers[i]?.align ?? 'left',
          margin: [0, 2.5, 0, 2.5] as [number, number, number, number],
        };
      }),
    );
    return {
      table: { headerRows: 1, widths: widths as any, body: [head, ...body] as any },
      layout: {
        fillColor: (rowIndex: number) => (rowIndex === 0 ? BRAND : rowIndex % 2 === 0 ? SUNKEN : null),
        hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 0 : 0.5),
        hLineColor: () => HAIRLINE,
        vLineWidth: () => 0,
        paddingLeft: () => 8,
        paddingRight: () => 8,
      },
      margin: [0, 0, 0, 16],
    } as ContentTable;
  }

  // Section titles follow the AIRIN brand system: a short Brand-Blue vertical
  // bar accent to the left of a mono-face heading (e.g. "▎ 1. Getting started"
  // in the reference handbook).
  private sectionTitle(text: string): Content {
    return {
      columns: [
        { width: 3, canvas: [{ type: 'rect', x: 0, y: 1, w: 3, h: 12, r: 1, color: BRAND }] },
        { width: 'auto', text, font: 'JetBrainsMono', bold: true, fontSize: 11, color: SURFACE_DARK, margin: [7, 0, 0, 0] as [number, number, number, number] },
      ],
      columnGap: 0,
      margin: [0, 4, 0, 6] as [number, number, number, number],
    };
  }

  private docDefinition(input: ReportPdfInput): TDocumentDefinitions {
    const s = input.summary;
    const scope = input.outletName ?? 'All branches (consolidated)';
    const unit = input.businessUnit === 'AIRE' ? 'AIRE · Car Wash' : input.businessUnit === 'LEAD' ? 'LEAD · Detailing' : 'All business units';
    const periodLabel = `${this.fmtDate(input.dateFrom)} – ${this.fmtDate(input.dateTo)}`;

    const payments = Object.entries(s.byPaymentMethod ?? {});
    const paymentChart = payments.map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: v.revenue, display: this.rpCompact(v.revenue) }));
    const revenueChart = this.bucketRevenue(input.daily);

    const bu = (k: 'AIRE' | 'LEAD') => s.byBusinessUnit?.[k] ?? { revenue: 0, count: 0 };

    // A section prints unless the tenant's report template explicitly disabled it.
    const on = (key: string) => input.sections?.[key] !== false;

    // Masthead columns: optional logo · title/company · period/scope.
    // Typed loosely: pdfmake columns mix images and width-bearing stacks.
    const titleColumns: any[] = [];
    if (input.logoDataUrl) {
      titleColumns.push({ image: input.logoDataUrl, fit: [120, 44] });
    }
    titleColumns.push(
      {
        stack: [
          { text: 'Business Report', font: 'JetBrainsMono', bold: true, fontSize: 19, color: SURFACE_DARK },
          { text: input.tenantName, fontSize: 10, color: MUTED, margin: [0, 3, 0, 0] as [number, number, number, number] },
        ],
      },
      {
        width: 'auto',
        stack: [
          { text: periodLabel, fontSize: 10, bold: true, color: BRAND_DARK, alignment: 'right' },
          { text: scope, fontSize: 9, color: SLATE, alignment: 'right', margin: [0, 2, 0, 0] as [number, number, number, number] },
          { text: unit, fontSize: 9, color: MUTED, alignment: 'right' },
        ],
      },
    );

    const content: Content[] = [
      // Cover page (AIRIN brand system) — page-breaks into the report body below.
      ...this.coverPage(input, scope, unit, periodLabel),
      // Title block
      { columns: titleColumns, columnGap: 12, margin: [0, 0, 0, 4] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: BRAND }], margin: [0, 0, 0, 16] },
    ];

    if (on('kpis')) content.push(this.kpiBand(s));

    if (on('businessUnit')) {
      // Mirror the dashboard (AIRIN-130): when the report is filtered to one unit
      // the summary only carries that unit, so printing both would show a
      // zero-revenue card for the excluded one and read as a data error.
      // Untyped so the spacer column literal keeps pdfmake's contextual inference.
      const buCards =
        input.businessUnit === 'AIRE' ? [this.buCard('AIRE · Car Wash', bu('AIRE'), BRAND)]
          : input.businessUnit === 'LEAD' ? [this.buCard('LEAD · Detailing', bu('LEAD'), ACCENT_PURPLE)]
            : [
                this.buCard('AIRE · Car Wash', bu('AIRE'), BRAND),
                { width: 12, text: '' },
                this.buCard('LEAD · Detailing', bu('LEAD'), ACCENT_PURPLE),
              ];
      content.push(
        this.sectionTitle('Revenue by business unit'),
        { columns: buCards, margin: [0, 0, 0, 16] },
      );
    }

    if (on('revenueChart')) {
      content.push(
        this.sectionTitle(revenueChart.length > 31 ? 'Revenue trend (monthly)' : 'Revenue trend (daily)'),
        this.hBarChart(revenueChart, BRAND, 320),
      );
    }

    if (on('paymentMix')) {
      content.push(
        this.sectionTitle('Payment mix (by revenue)'),
        this.hBarChart(paymentChart, ACCENT_PURPLE, 320),
        { text: '', margin: [0, 0, 0, 8] },
        this.sectionTitle('Payment methods'),
        this.dataTable(
          [{ text: 'Method' }, { text: 'Count', align: 'right' }, { text: 'Revenue', align: 'right' }],
          payments.map(([k, v]) => [this.cap(k.replace(/_/g, ' ')), String(v.count), this.rp(v.revenue)]),
          ['*', 80, 130],
          'No payments in this period.',
        ),
      );
    }

    if (on('topServices')) {
      content.push(
        this.sectionTitle('Top services'),
        this.dataTable(
          [{ text: 'Service' }, { text: 'Qty', align: 'right' }, { text: 'Revenue', align: 'right' }],
          (s.byService ?? []).map((sv) => [sv.name, String(sv.quantity), this.rp(sv.revenue)]),
          ['*', 80, 130],
          'No service data in this period.',
        ),
      );
    }

    if (on('dailySales')) {
      content.push(
        this.sectionTitle('Daily sales'),
        this.dataTable(
          [{ text: 'Date' }, { text: 'Orders', align: 'right' }, { text: 'Paid', align: 'right' }, { text: 'Revenue', align: 'right' }],
          input.daily.map((d) => [d.date, String(d.orders), String(d.paidOrders), this.rp(d.revenue)]),
          ['*', 70, 70, 130],
          'No sales in this period.',
        ),
      );
    }

    if (on('shifts')) {
      content.push(
        this.sectionTitle('Shifts (register sessions)'),
        this.dataTable(
          [
            { text: 'Operator' },
            { text: 'Opened' },
            { text: 'Status' },
            { text: 'Sales', align: 'right' },
            { text: 'Expected', align: 'right' },
            { text: 'Counted', align: 'right' },
            { text: 'Variance', align: 'right' },
          ],
          input.shifts.map((sh) => [
            (sh.operator as string) ?? '—',
            sh.openedAt ? this.fmtDate(sh.openedAt as string) : '—',
            this.cap((sh.status as string) ?? '—'),
            sh.totalSales != null ? this.rp(sh.totalSales) : '—',
            sh.expected != null ? this.rp(sh.expected) : '—',
            sh.counted != null ? this.rp(sh.counted) : '—',
            sh.variance != null
              ? { text: this.rp(sh.variance), color: sh.variance < 0 ? RED : sh.variance > 0 ? GREEN : SLATE }
              : '—',
          ]),
          ['*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
          'No shifts in this period.',
        ),
      );
    }

    return {
      pageSize: 'A4',
      pageMargins: [40, 58, 40, 44],
      defaultStyle: { font: 'Inter', fontSize: 9, color: SLATE },
      info: {
        title: `AIRIN Business Report ${input.dateFrom} to ${input.dateTo}`,
        author: 'AIRIN Operations Platform',
      },
      // The cover (page 1) paints its own full-bleed dark background and
      // footer; every later page gets the standard masthead/footer below.
      background: (currentPage, pageSize) => (currentPage === 1 ? this.coverBackground(pageSize) : null),
      header: (currentPage: number) =>
        currentPage === 1
          ? undefined
          : {
              margin: [40, 18, 40, 0],
              columns: [
                { text: [{ text: 'AIRIN', bold: true, font: 'JetBrainsMono', color: BRAND }, { text: '  ·  Operations Platform', color: FAINT }], fontSize: 9 },
                { text: 'Business Report', alignment: 'right', fontSize: 8, color: FAINT },
              ],
            },
      footer: (currentPage: number, pageCount: number) =>
        currentPage === 1
          ? undefined
          : {
              margin: [40, 6, 40, 0],
              columns: [
                {
                  text: [
                    { text: 'AIRIN', bold: true, font: 'JetBrainsMono', color: BRAND, fontSize: 7.5 },
                    { text: `  ·  Confidential — ${input.tenantName}`, fontSize: 7.5, color: FAINT },
                  ],
                },
                {
                  text: `Generated ${this.fmtDate(input.generatedAt)}   ·   Page ${currentPage} of ${pageCount}`,
                  alignment: 'right',
                  fontSize: 7.5,
                  color: FAINT,
                },
              ],
            },
      content,
    };
  }

  private buCard(label: string, v: { revenue: number; count: number }, accent: string): Content {
    return {
      width: '*',
      table: {
        widths: ['*'],
        body: [[
          {
            stack: [
              { text: label, fontSize: 9, bold: true, color: accent },
              { text: this.rp(v.revenue), fontSize: 16, bold: true, color: INK, margin: [0, 4, 0, 0] as [number, number, number, number] },
              { text: `${v.count} orders`, fontSize: 8, color: MUTED, margin: [0, 2, 0, 0] as [number, number, number, number] },
            ],
            margin: [12, 10, 12, 10] as [number, number, number, number],
          },
        ]],
      },
      layout: {
        fillColor: () => SUNKEN,
        hLineWidth: () => 0,
        vLineWidth: () => 0,
      },
    } as any;
  }

  private cap(s: string): string {
    return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
  }
}
