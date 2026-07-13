'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { DocumentPreview, buildDocHtml, type DocTemplate, type DocElement, type DocKind, type DocElementType } from './DocumentRenderer';
import { DOC_CATALOGS, type DocCatalog } from './documentCatalogs';

const GRID = 10;
const EDIT_SCALE = 0.5;
const MODAL_SCALE = 0.9;

/** Titles/blurbs per kind (English base; Indonesian comes from id.ts). */
const KIND_META: Record<DocKind, { titleKey: string; title: string; subtitleKey: string; subtitle: string }> = {
  invoice: { titleKey: 'dash.invoiceDesigner.title', title: 'Invoice Designer', subtitleKey: 'dash.invoiceDesigner.subtitle', subtitle: 'Design your A4 invoice. Drag fields, a line-items table and totals onto the page. Invoices print with each order\'s real details.' },
  receipt: { titleKey: 'dash.receiptDesigner.title', title: 'Receipt Designer', subtitleKey: 'dash.receiptDesigner.subtitle', subtitle: 'Design your thermal receipt. Drag fields, items and totals. The POS prints receipts with this layout.' },
  report: { titleKey: 'dash.reportDesigner.title', title: 'Report Designer', subtitleKey: 'dash.reportDesigner.subtitle', subtitle: 'Design the branding header of your printed reports and choose which sections appear in the PDF export.' },
  label: { titleKey: 'dash.labelDesigner.title', title: 'Barcode Label Designer', subtitleKey: 'dash.labelDesigner.subtitle', subtitle: 'Design your product barcode label. Drag the product name, price and barcode onto the label — the Products page prints each product with its own barcode using this layout.' },
};

let uidCounter = 0;
const uid = (type: string) => `${type}-${Date.now().toString(36)}-${uidCounter++}`;

/** Default geometry for a freshly-added element. */
function newElement(type: DocElementType, field: string | undefined, catalog: DocCatalog, tpl: DocTemplate): DocElement {
  const base = { id: uid(type), type, x: 40, y: 40, color: '#111111', align: 'left' as const };
  switch (type) {
    case 'logo': return { ...base, field: 'logo', w: 140, h: 56 };
    case 'image': return { ...base, w: 140, h: 80 };
    case 'code': return { ...base, w: 120, h: 120, codeType: 'qr', align: 'center' };
    case 'divider': return { ...base, w: tpl.width - 80, h: 2, color: '#d1d5db' };
    case 'totals': return { ...base, w: 240, h: 100, fontSize: 13, align: 'right' };
    case 'table': return { ...base, w: tpl.width - 80, h: 300, fontSize: 12, columns: catalog.tableColumns.map((c) => ({ key: c.key, label: c.label, width: Math.floor((tpl.width - 80) / catalog.tableColumns.length), align: c.key === 'name' || c.key === 'line' ? 'left' : 'right' })) };
    case 'text': return { ...base, text: 'Text', w: 240, h: 24, fontSize: 14 };
    default: return { ...base, field, w: 240, h: 24, fontSize: 14 };
  }
}

/** A draggable, snap-to-grid canvas. Same drag math works at any `scale`. */
function EditorCanvas({ tpl, catalog, scale, sel, onSelect, onChange }: {
  tpl: DocTemplate; catalog: DocCatalog; scale: number; sel: string | null;
  onSelect: (id: string | null) => void; onChange: (id: string, patch: Partial<DocElement>) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; offX: number; offY: number } | null>(null);

  const pointFromEvent = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    return { px: (e.clientX - rect.left) / scale, py: (e.clientY - rect.top) / scale };
  };
  const onDownEl = (e: React.PointerEvent, el: DocElement) => {
    e.preventDefault(); e.stopPropagation();
    onSelect(el.id);
    const { px, py } = pointFromEvent(e);
    drag.current = { id: el.id, offX: px - el.x, offY: py - el.y };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const el = tpl.elements.find((x) => x.id === drag.current!.id);
    if (!el) return;
    const { px, py } = pointFromEvent(e);
    let x = Math.round((px - drag.current.offX) / GRID) * GRID;
    let y = Math.round((py - drag.current.offY) / GRID) * GRID;
    x = Math.max(0, Math.min(x, tpl.width - el.w));
    y = Math.max(0, Math.min(y, tpl.height - el.h));
    onChange(drag.current.id, { x, y });
  };
  const endDrag = () => { drag.current = null; };

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onClick={(e) => { if (e.target === e.currentTarget) onSelect(null); }}
      className="relative border border-border rounded-xl overflow-hidden shadow-sm touch-none select-none"
      style={{ width: tpl.width * scale, height: tpl.height * scale, background: '#ffffff' }}
    >
      {tpl.backgroundImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={tpl.backgroundImage} alt="" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
      )}
      {tpl.elements.map((el) => (
        <div
          key={el.id}
          onPointerDown={(e) => onDownEl(e, el)}
          className={`absolute cursor-move ${sel === el.id ? 'ring-2 ring-primary-500 z-10' : 'ring-1 ring-black/15'}`}
          style={{
            left: el.x * scale, top: el.y * scale, width: el.w * scale, height: el.h * scale,
            fontSize: (el.fontSize || 12) * scale, color: el.color,
            background: sel === el.id ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.4)',
            display: 'flex', alignItems: 'center',
            justifyContent: el.align === 'center' ? 'center' : el.align === 'right' ? 'flex-end' : 'flex-start',
            overflow: 'hidden', whiteSpace: 'nowrap',
          }}
        >
          <EditorElementLabel el={el} catalog={catalog} />
        </div>
      ))}
    </div>
  );
}

function EditorElementLabel({ el, catalog }: { el: DocElement; catalog: DocCatalog }) {
  if (el.type === 'divider') return <div className="w-full border-t" style={{ borderColor: el.color }} />;
  if (el.type === 'logo' || el.type === 'image') return <span className="text-[10px] text-black/50 px-1">[logo]</span>;
  if (el.type === 'code') return <span className="text-[10px] text-black/50 px-1">[{el.codeType || 'qr'}]</span>;
  if (el.type === 'totals') return <span className="text-[10px] text-black/60 px-1 font-semibold">[totals]</span>;
  if (el.type === 'table') return <span className="text-[10px] text-black/60 px-1 font-semibold">[{(el.columns ?? []).map((c) => c.label).join(' · ')}]</span>;
  if (el.type === 'text') return <span className="px-1" style={{ fontWeight: el.bold ? 700 : 400 }}>{el.text}</span>;
  const label = catalog.fields.find((f) => f.field === el.field)?.label ?? el.field ?? '';
  const sample = catalog.sample.fields[el.field ?? ''] ?? label;
  return <span className="px-1" style={{ fontWeight: el.bold ? 700 : 400 }}>{sample}</span>;
}

export function DocumentDesigner({ kind, showHeading = true }: { kind: DocKind; showHeading?: boolean }) {
  const { t } = useI18n();
  const catalog = DOC_CATALOGS[kind];
  const meta = KIND_META[kind];
  const [tpl, setTpl] = useState<DocTemplate | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get<DocTemplate>(`/doc-template/${kind}`).then(setTpl).catch(() => setMsg(t('dash.docDesigner.loadFailed', 'Failed to load template')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const patchElements = (updater: (els: DocElement[]) => DocElement[]) =>
    setTpl((prev) => (prev ? { ...prev, elements: updater(prev.elements) } : prev));
  const updateEl = (id: string, patch: Partial<DocElement>) =>
    patchElements((els) => els.map((el) => (el.id === id ? { ...el, ...patch } : el)));
  const removeEl = (id: string) => { patchElements((els) => els.filter((el) => el.id !== id)); setSel(null); };
  const addEl = (type: DocElementType, field?: string) => {
    if (!tpl) return;
    const el = newElement(type, field, catalog, tpl);
    patchElements((els) => [...els, el]);
    setSel(el.id);
  };

  const onUploadBg = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.upload<DocTemplate>(`/doc-template/${kind}/background`, fd);
      setTpl((prev) => (prev ? { ...prev, backgroundImage: res.backgroundImage } : prev));
    } catch (err) { setMsg(err instanceof Error ? err.message : t('dash.docDesigner.saveFailed', 'Save failed')); }
  };
  const removeBg = async () => {
    setMsg('');
    try { await api.delete(`/doc-template/${kind}/background`); setTpl((prev) => (prev ? { ...prev, backgroundImage: null } : prev)); }
    catch (err) { setMsg(err instanceof Error ? err.message : t('dash.docDesigner.saveFailed', 'Save failed')); }
  };

  const save = async () => {
    if (!tpl) return;
    setSaving(true); setMsg('');
    try { await api.put(`/doc-template/${kind}`, tpl); setMsg(t('dash.docDesigner.saved', 'Saved.')); }
    catch (e) { setMsg(e instanceof Error ? e.message : t('dash.docDesigner.saveFailed', 'Save failed')); }
    finally { setSaving(false); }
  };

  const previewPrint = () => {
    if (!tpl) return;
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) { setMsg(t('dash.docDesigner.popupBlocked', 'Allow pop-ups to preview the print.')); return; }
    w.document.write(buildDocHtml(tpl, catalog.sample, meta.title));
    w.document.close();
  };

  if (!tpl) return <div className="card text-sm text-text-muted max-w-md">{t('dash.docDesigner.loading', 'Loading designer…')}</div>;

  const selEl = tpl.elements.find((el) => el.id === sel) ?? null;
  const placedFields = new Set(tpl.elements.filter((e) => e.type === 'field').map((e) => e.field));
  const addableFields = catalog.fields.filter((f) => !placedFields.has(f.field));
  const previewScale = tpl.width > 400 ? EDIT_SCALE : 0.9;

  return (
    <div className={showHeading ? 'max-w-6xl' : ''}>
      {showHeading && (
        <>
          <h1 className="text-2xl font-bold text-text-primary mb-1">{t(meta.titleKey, meta.title)}</h1>
          <p className="text-sm text-text-secondary mb-4">{t(meta.subtitleKey, meta.subtitle)}</p>
        </>
      )}
      {msg && <div className="rounded-lg bg-sky-50 border border-sky-200 p-2 text-sm text-sky-800 mb-4">{msg}</div>}

      {/* Preview at the top (full width), like the membership card designer */}
      <div className="card mb-6" data-testid="doc-preview-top">
        <h2 className="section-title mb-3">{t('dash.docDesigner.preview', 'Preview with sample data')}</h2>
        <div className="overflow-auto flex justify-center py-2">
          <DocumentPreview template={tpl} data={catalog.sample} scale={previewScale} />
        </div>
      </div>

      {/* Editor below — canvas on the left, controls on the right */}
      <div className="flex flex-wrap gap-6">
        {/* Canvas */}
        <div>
          <EditorCanvas tpl={tpl} catalog={catalog} scale={previewScale} sel={sel} onSelect={setSel} onChange={updateEl} />
          <p className="text-xs text-text-muted mt-2">
            {tpl.width}×{tpl.height}px · {t('dash.docDesigner.grid', 'grid')} {GRID}px ·{' '}
            <button className="text-primary-600 hover:underline" onClick={() => setZoom(true)}>{t('dash.docDesigner.editFullSize', 'Edit full size')}</button> ·{' '}
            <button className="text-primary-600 hover:underline" onClick={previewPrint}>{t('dash.docDesigner.previewPrint', 'Preview print')}</button>
          </p>
        </div>

        {/* Controls */}
        <div className="flex-1 min-w-[280px] space-y-4">
          {/* Add elements */}
          <div className="card">
            <p className="text-xs font-medium text-text-secondary mb-2">{t('dash.docDesigner.addElements', 'Add elements')}</p>
            <div className="flex flex-wrap items-center gap-1 mb-2">
              <button onClick={() => addEl('text')} className="badge bg-surface border border-dashed border-border text-text-secondary hover:bg-surface-sunken">+ {t('dash.docDesigner.text', 'Text')}</button>
              {catalog.allowLogo && <button onClick={() => addEl('logo')} className="badge bg-surface border border-dashed border-border text-text-secondary hover:bg-surface-sunken">+ {t('dash.docDesigner.logo', 'Logo')}</button>}
              {catalog.allowTable && <button onClick={() => addEl('table')} className="badge bg-surface border border-dashed border-border text-text-secondary hover:bg-surface-sunken">+ {t('dash.docDesigner.itemsTable', 'Items table')}</button>}
              {catalog.allowTotals && <button onClick={() => addEl('totals')} className="badge bg-surface border border-dashed border-border text-text-secondary hover:bg-surface-sunken">+ {t('dash.docDesigner.totals', 'Totals')}</button>}
              {catalog.allowCode && <button onClick={() => addEl('code')} className="badge bg-surface border border-dashed border-border text-text-secondary hover:bg-surface-sunken">+ {t('dash.docDesigner.code', 'QR / Barcode')}</button>}
              <button onClick={() => addEl('divider')} className="badge bg-surface border border-dashed border-border text-text-secondary hover:bg-surface-sunken">+ {t('dash.docDesigner.divider', 'Divider')}</button>
            </div>
            {addableFields.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-xs text-text-muted mr-1">{t('dash.docDesigner.addField', 'Field:')}</span>
                {addableFields.map((f) => (
                  <button key={f.field} onClick={() => addEl('field', f.field)} className="badge bg-surface border border-dashed border-border text-text-secondary hover:bg-surface-sunken">+ {f.label}</button>
                ))}
              </div>
            )}
          </div>

          {/* Placed elements */}
          <div className="card">
            <p className="text-xs font-medium text-text-secondary mb-2">{t('dash.docDesigner.elementsHint', 'Elements — click one on the page (or here) to edit')}</p>
            <div className="flex flex-wrap gap-1">
              {tpl.elements.length === 0 && <span className="text-xs text-text-muted">{t('dash.docDesigner.noElements', 'Nothing placed yet — add elements above.')}</span>}
              {tpl.elements.map((el) => (
                <button key={el.id} onClick={() => setSel(el.id)} className={`badge ${sel === el.id ? 'bg-primary-500 text-white' : 'bg-surface-sunken text-text-secondary'}`}>{elementLabel(el, catalog)}</button>
              ))}
            </div>
            {selEl && <ElementProperties el={selEl} catalog={catalog} tpl={tpl} onChange={(p) => updateEl(selEl.id, p)} onRemove={() => removeEl(selEl.id)} t={t} />}
          </div>

          {/* Background */}
          <div className="card">
            <label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.docDesigner.backgroundImage', 'Background image (optional)')}</label>
            <input type="file" accept="image/*" onChange={(e) => void onUploadBg(e)} className="text-sm" />
            {tpl.backgroundImage && <button className="btn-ghost text-xs text-rose-600 mt-2" onClick={() => void removeBg()}>{t('dash.docDesigner.removeBackground', 'Remove background')}</button>}
          </div>

          {/* Report sections */}
          {kind === 'report' && catalog.sections && (
            <div className="card">
              <p className="text-xs font-medium text-text-secondary mb-2">{t('dash.reportDesigner.sections', 'Sections in the PDF export')}</p>
              <div className="space-y-1">
                {catalog.sections.map((s) => (
                  <label key={s.key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={tpl.reportSections?.[s.key] !== false} onChange={(e) => setTpl((prev) => (prev ? { ...prev, reportSections: { ...(prev.reportSections ?? {}), [s.key]: e.target.checked } } : prev))} />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          <button className="btn-primary w-full" onClick={save} disabled={saving}>{saving ? t('dash.docDesigner.saving', 'Saving…') : t('dash.docDesigner.save', 'Save layout')}</button>
        </div>
      </div>

      {/* Full-size editing modal */}
      {zoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setZoom(false)}>
          <div className="bg-surface rounded-xl shadow-xl p-4 max-w-full max-h-full overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3 gap-4">
              <h3 className="font-semibold text-text-primary">{t('dash.docDesigner.editFullSize', 'Edit full size')}</h3>
              <button className="btn-ghost text-sm" onClick={() => setZoom(false)}>{t('common.close', 'Close')}</button>
            </div>
            <EditorCanvas tpl={tpl} catalog={catalog} scale={MODAL_SCALE} sel={sel} onSelect={setSel} onChange={updateEl} />
            <p className="text-xs text-text-muted mt-2">{t('dash.docDesigner.dragHint', 'Drag elements to position them (snaps to grid).')}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function elementLabel(el: DocElement, catalog: DocCatalog): string {
  if (el.type === 'field') return catalog.fields.find((f) => f.field === el.field)?.label ?? el.field ?? 'field';
  if (el.type === 'text') return `“${(el.text ?? '').slice(0, 12)}”`;
  return el.type;
}

function ElementProperties({ el, catalog, tpl, onChange, onRemove, t }: {
  el: DocElement; catalog: DocCatalog; tpl: DocTemplate;
  onChange: (patch: Partial<DocElement>) => void; onRemove: () => void; t: (k: string, d?: string) => string;
}) {
  const textual = el.type === 'text' || el.type === 'field' || el.type === 'totals';
  return (
    <div className="space-y-2 border-t border-border pt-3 mt-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{elementLabel(el, catalog)}</p>
        <button className="text-xs text-rose-600 hover:underline" onClick={onRemove}>{t('dash.docDesigner.removeElement', 'Remove')}</button>
      </div>

      {el.type === 'text' && (
        <label className="block text-xs">{t('dash.docDesigner.textContent', 'Text')}
          <input type="text" className="input-field py-1" value={el.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} />
        </label>
      )}

      {el.type === 'code' && (
        <label className="block text-xs">{t('dash.docDesigner.codeType', 'Code type')}
          <select className="input-field py-1" value={el.codeType ?? 'qr'} onChange={(e) => onChange({ codeType: e.target.value as 'qr' | 'barcode' })}>
            <option value="qr">QR</option><option value="barcode">Barcode</option>
          </select>
        </label>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs">
        {textual && (
          <label>{t('dash.docDesigner.fontSize', 'Font size')}<input type="number" className="input-field py-1" value={el.fontSize ?? 12} onChange={(e) => onChange({ fontSize: Number(e.target.value) })} /></label>
        )}
        {(textual || el.type === 'divider') && (
          <label>{t('dash.docDesigner.colour', 'Colour')}<input type="color" className="input-field py-1 h-9" value={el.color ?? '#111111'} onChange={(e) => onChange({ color: e.target.value })} /></label>
        )}
        {textual && (
          <>
            <label>{t('dash.docDesigner.align', 'Align')}
              <select className="input-field py-1" value={el.align ?? 'left'} onChange={(e) => onChange({ align: e.target.value as 'left' | 'center' | 'right' })}>
                <option value="left">{t('dash.docDesigner.alignLeft', 'Left')}</option><option value="center">{t('dash.docDesigner.alignCenter', 'Center')}</option><option value="right">{t('dash.docDesigner.alignRight', 'Right')}</option>
              </select>
            </label>
            <label className="flex items-end gap-2">{t('dash.docDesigner.bold', 'Bold')}<input type="checkbox" checked={!!el.bold} onChange={(e) => onChange({ bold: e.target.checked })} /></label>
          </>
        )}
        <label>{t('dash.docDesigner.width', 'Width')}<input type="number" className="input-field py-1" value={el.w} onChange={(e) => onChange({ w: Math.min(Number(e.target.value), tpl.width) })} /></label>
        <label>{t('dash.docDesigner.height', 'Height')}<input type="number" className="input-field py-1" value={el.h} onChange={(e) => onChange({ h: Number(e.target.value) })} /></label>
      </div>

      {el.type === 'table' && (
        <div className="border-t border-border pt-2 mt-1">
          <p className="text-xs font-medium text-text-secondary mb-1">{t('dash.docDesigner.columns', 'Columns')}</p>
          {(el.columns ?? []).map((c, ci) => (
            <div key={c.key} className="flex items-center gap-1 mb-1">
              <input className="input-field py-1 text-xs flex-1" value={c.label} onChange={(e) => onChange({ columns: (el.columns ?? []).map((x, i) => (i === ci ? { ...x, label: e.target.value } : x)) })} />
              <input type="number" title={t('dash.docDesigner.colWidth', 'Column width')} className="input-field py-1 text-xs w-16" value={c.width} onChange={(e) => onChange({ columns: (el.columns ?? []).map((x, i) => (i === ci ? { ...x, width: Number(e.target.value) } : x)) })} />
              <select className="input-field py-1 text-xs w-16" value={c.align ?? 'left'} onChange={(e) => onChange({ columns: (el.columns ?? []).map((x, i) => (i === ci ? { ...x, align: e.target.value as 'left' | 'center' | 'right' } : x)) })}>
                <option value="left">L</option><option value="center">C</option><option value="right">R</option>
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
