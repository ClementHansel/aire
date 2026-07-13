'use client';

/**
 * Shared render + print layer for the invoice / receipt / report designers.
 * Mirrors the backend DocTemplate shape (apps/backend/src/modules/doc-template).
 * `renderDoc` draws an on-screen preview; `buildDocHtml` produces the print
 * window HTML (modeled on buildCardHtml in MembershipCard.tsx). A repeating
 * `table` element and a `totals` block make it work for documents with
 * line-items, unlike the fixed-field membership card.
 */

export type DocKind = 'invoice' | 'receipt' | 'report' | 'label';
export type DocElementType = 'text' | 'field' | 'logo' | 'image' | 'table' | 'code' | 'divider' | 'totals';
export type DocAlign = 'left' | 'center' | 'right';

export interface DocTableColumn { key: string; label: string; width: number; align?: DocAlign }
export interface DocElement {
  id: string;
  type: DocElementType;
  field?: string;
  text?: string;
  x: number; y: number; w: number; h: number;
  fontSize?: number;
  color?: string;
  align?: DocAlign;
  bold?: boolean;
  columns?: DocTableColumn[];
  codeType?: 'qr' | 'barcode';
  codeSource?: string;
}
export interface DocTemplate {
  kind: DocKind;
  paper: 'A4' | 'thermal80' | 'thermal58';
  width: number;
  height: number;
  backgroundImage: string | null;
  elements: DocElement[];
  reportSections?: Record<string, boolean>;
}

/** Resolved data used to fill a template at render/print time. */
export interface DocData {
  /** field token → display string */
  fields: Record<string, string>;
  /** line-item rows, each keyed by table column key (pre-formatted strings) */
  items: Record<string, string>[];
  /** totals block rows, top to bottom */
  totals: { label: string; value: string; strong?: boolean }[];
  /** logo image URL (for `logo`/`image` elements) */
  logo?: string | null;
  /** code image as a data URL (for `code` elements) */
  code?: string | null;
}

const justify = (a?: DocAlign) => (a === 'center' ? 'center' : a === 'right' ? 'flex-end' : 'flex-start');
const textAlign = (a?: DocAlign) => (a === 'center' ? 'center' : a === 'right' ? 'right' : 'left');

function elementText(el: DocElement, data: DocData): string {
  if (el.type === 'text') return el.text ?? '';
  if (el.type === 'field') return data.fields[el.field ?? ''] ?? '';
  return '';
}

/** On-screen preview. `scale` shrinks the design (width×height) to fit. */
export function DocumentPreview({ template, data, scale = 1 }: { template: DocTemplate; data: DocData; scale?: number }) {
  return (
    <div style={{ position: 'relative', width: template.width * scale, height: template.height * scale, background: '#ffffff', overflow: 'hidden', boxShadow: '0 0 0 1px rgba(0,0,0,0.06)' }}>
      {template.backgroundImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={template.backgroundImage} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      )}
      {template.elements.map((el) => (
        <ElementView key={el.id} el={el} data={data} scale={scale} />
      ))}
    </div>
  );
}

function ElementView({ el, data, scale }: { el: DocElement; data: DocData; scale: number }) {
  const box: React.CSSProperties = {
    position: 'absolute', left: el.x * scale, top: el.y * scale, width: el.w * scale, height: el.h * scale, overflow: 'hidden',
  };
  const fz = (el.fontSize || 12) * scale;

  if (el.type === 'divider') {
    return <div style={{ ...box, borderTop: `${Math.max(1, scale)}px solid ${el.color || '#d1d5db'}` }} />;
  }
  if (el.type === 'logo' || el.type === 'image') {
    return (
      <div style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: justify(el.align) }}>
        {data.logo
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={data.logo} alt="logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          : <span style={{ fontSize: 10 * scale, color: '#9ca3af' }}>[logo]</span>}
      </div>
    );
  }
  if (el.type === 'code') {
    return (
      <div style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: justify(el.align) }}>
        {data.code
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={data.code} alt="code" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          : <span style={{ fontSize: 10 * scale, color: '#9ca3af' }}>[{el.codeType || 'qr'}]</span>}
      </div>
    );
  }
  if (el.type === 'table') {
    const cols = el.columns ?? [];
    return (
      <div style={{ ...box, fontSize: fz, color: el.color || '#111' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} style={{ width: c.width * scale, textAlign: textAlign(c.align), padding: `${3 * scale}px ${4 * scale}px`, borderBottom: `${scale}px solid #111`, fontWeight: 700 }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.items.map((row, ri) => (
              <tr key={ri}>
                {cols.map((c) => (
                  <td key={c.key} style={{ textAlign: textAlign(c.align), padding: `${3 * scale}px ${4 * scale}px`, borderBottom: `${scale}px solid #e5e7eb`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row[c.key] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (el.type === 'totals') {
    return (
      <div style={{ ...box, fontSize: fz, color: el.color || '#111', display: 'flex', flexDirection: 'column', gap: 2 * scale }}>
        {data.totals.map((t, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontWeight: t.strong ? 700 : 500, borderTop: t.strong ? `${scale}px solid #111` : undefined, paddingTop: t.strong ? 4 * scale : 0 }}>
            <span>{t.label}</span><span>{t.value}</span>
          </div>
        ))}
      </div>
    );
  }
  // text | field
  return (
    <div style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: justify(el.align), fontSize: fz, color: el.color || '#111', fontWeight: el.bold ? 700 : 400, whiteSpace: 'nowrap' }}>
      <span>{elementText(el, data)}</span>
    </div>
  );
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

/** Full-size printable HTML for a document (opened in a print window). */
export function buildDocHtml(template: DocTemplate, data: DocData, title = 'Document'): string {
  const parts = template.elements.map((el) => {
    const base = `position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;overflow:hidden;color:${el.color || '#111'};font-size:${el.fontSize || 12}px;`;
    if (el.type === 'divider') {
      return `<div style="${base}border-top:1px solid ${el.color || '#d1d5db'}"></div>`;
    }
    if (el.type === 'logo' || el.type === 'image') {
      return data.logo ? `<div style="${base}display:flex;align-items:center;justify-content:${justify(el.align)}"><img src="${data.logo}" style="max-width:100%;max-height:100%;object-fit:contain"/></div>` : '';
    }
    if (el.type === 'code') {
      return data.code ? `<div style="${base}display:flex;align-items:center;justify-content:${justify(el.align)}"><img src="${data.code}" style="max-width:100%;max-height:100%;object-fit:contain"/></div>` : '';
    }
    if (el.type === 'table') {
      const cols = el.columns ?? [];
      const head = cols.map((c) => `<th style="width:${c.width}px;text-align:${textAlign(c.align)};padding:3px 4px;border-bottom:1px solid #111;font-weight:700">${esc(c.label)}</th>`).join('');
      const body = data.items.map((row) => `<tr>${cols.map((c) => `<td style="text-align:${textAlign(c.align)};padding:3px 4px;border-bottom:1px solid #e5e7eb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(row[c.key] ?? '')}</td>`).join('')}</tr>`).join('');
      return `<div style="${base}"><table style="width:100%;border-collapse:collapse;table-layout:fixed"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    }
    if (el.type === 'totals') {
      const rows = data.totals.map((t) => `<div style="display:flex;justify-content:space-between;font-weight:${t.strong ? 700 : 500};${t.strong ? 'border-top:1px solid #111;padding-top:4px;' : ''}"><span>${esc(t.label)}</span><span>${esc(t.value)}</span></div>`).join('');
      return `<div style="${base}display:flex;flex-direction:column;gap:2px">${rows}</div>`;
    }
    const weight = el.bold ? 700 : 400;
    return `<div style="${base}display:flex;align-items:center;justify-content:${justify(el.align)};font-weight:${weight};white-space:nowrap"><span>${esc(elementText(el, data))}</span></div>`;
  }).join('');

  const bg = template.backgroundImage ? `<img src="${template.backgroundImage}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"/>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>@page{size:${template.width}px ${template.height}px;margin:0}body{margin:0;font-family:Arial,Helvetica,sans-serif}</style></head>
    <body><div style="position:relative;width:${template.width}px;height:${template.height}px;overflow:hidden">${bg}${parts}</div>
    <script>window.onload=()=>window.print()</script></body></html>`;
}
