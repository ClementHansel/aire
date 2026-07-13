'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { MembershipCard, sideOf, type CardTemplate, type CardElement, type CardData, type CardSide } from './MembershipCard';

const GRID = 10;
const PREVIEW_SCALE = 0.5;   // interactive preview (front/back flip)
const EDIT_SCALE = 0.42;     // small editor canvas
const MODAL_SCALE = 0.85;    // full-size editing modal canvas
const SAMPLE: CardData = { name: 'Budi Santoso', number: 'A0000100 0001', validUntil: '12/26' };
const ALL_FIELDS: CardElement['field'][] = ['name', 'number', 'validUntil', 'code'];

/** Default geometry for a freshly-added field. */
const FIELD_DEFAULTS: Record<CardElement['field'], Omit<CardElement, 'field'>> = {
  name: { x: 40, y: 360, w: 420, h: 40, fontSize: 30, color: '#111111', align: 'left' },
  number: { x: 40, y: 410, w: 420, h: 32, fontSize: 24, color: '#111111', align: 'left' },
  validUntil: { x: 40, y: 452, w: 240, h: 24, fontSize: 16, color: '#333333', align: 'left' },
  code: { x: 560, y: 330, w: 200, h: 140, fontSize: 0, color: '#000000', align: 'center' },
};

/**
 * A draggable, snap-to-grid canvas for one side of the card. Rendered at both a
 * small size (inline) and near full size (in the editing modal); the same drag
 * math works at any `scale`.
 */
function EditorCanvas({
  tpl, side, scale, sel, onSelect, onChange, onBackgroundClick, t,
}: {
  tpl: CardTemplate;
  side: CardSide;
  scale: number;
  sel: number | null;
  onSelect: (i: number | null) => void;
  onChange: (i: number, patch: Partial<CardElement>) => void;
  onBackgroundClick?: () => void;
  t: (k: string, d?: string) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ idx: number; offX: number; offY: number } | null>(null);
  const { backgroundImage, elements } = sideOf(tpl, side);

  const pointFromEvent = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    return { px: (e.clientX - rect.left) / scale, py: (e.clientY - rect.top) / scale };
  };
  const onDownEl = (e: React.PointerEvent, i: number) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(i);
    const el = elements[i];
    if (!el) return;
    const { px, py } = pointFromEvent(e);
    drag.current = { idx: i, offX: px - el.x, offY: py - el.y };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const el = elements[drag.current.idx];
    if (!el) return;
    const { px, py } = pointFromEvent(e);
    let x = Math.round((px - drag.current.offX) / GRID) * GRID;
    let y = Math.round((py - drag.current.offY) / GRID) * GRID;
    x = Math.max(0, Math.min(x, tpl.width - el.w));
    y = Math.max(0, Math.min(y, tpl.height - el.h));
    onChange(drag.current.idx, { x, y });
  };
  const endDrag = () => { drag.current = null; };

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onClick={(e) => { if (e.target !== e.currentTarget) return; if (onBackgroundClick) onBackgroundClick(); else onSelect(null); }}
      className="relative border border-border rounded-xl overflow-hidden shadow-sm touch-none select-none"
      style={{ width: tpl.width * scale, height: tpl.height * scale, background: '#ffffff', cursor: onBackgroundClick ? 'zoom-in' : 'default' }}
    >
      {backgroundImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={backgroundImage} alt="" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
      ) : (
        <div className="absolute inset-2 rounded-lg border border-dashed border-border pointer-events-none flex items-center justify-center">
          <span className="text-[11px] text-text-muted">{t('dash.membershipCard.noBackground', 'No background')}</span>
        </div>
      )}
      {elements.map((el, i) => (
        <div
          key={i}
          onPointerDown={(e) => onDownEl(e, i)}
          className={`absolute cursor-move ${sel === i ? 'ring-2 ring-primary-500' : 'ring-1 ring-black/20'}`}
          style={{
            left: el.x * scale, top: el.y * scale, width: el.w * scale, height: el.h * scale,
            fontSize: (el.fontSize || 16) * scale, color: el.color,
            background: sel === i ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.35)',
            display: 'flex', alignItems: 'center',
            justifyContent: el.align === 'center' ? 'center' : el.align === 'right' ? 'flex-end' : 'flex-start',
            overflow: 'hidden', whiteSpace: 'nowrap',
          }}
        >
          {el.field === 'code'
            ? <span className="text-[10px] text-black/60 px-1">[{tpl.idType === 'number_barcode' ? t('dash.membershipCard.codeBarcode', 'Barcode') : tpl.idType === 'number_qr' ? t('dash.membershipCard.codeQr', 'QR') : t('dash.membershipCard.codeNone', 'no code')}]</span>
            : <span style={{ fontWeight: el.field === 'name' ? 700 : 500 }} className="px-1">{el.field === 'name' ? SAMPLE.name : el.field === 'number' ? SAMPLE.number : `Valid until ${SAMPLE.validUntil}`}</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * The full membership-card designer (preview + drag-and-drop editor + controls).
 * Shared by the standalone /dashboard/membership-card page and the "Cards" tab of
 * the Memberships page. `showHeading` hides the page title when embedded in a tab.
 */
export function MembershipCardDesigner({ showHeading = true }: { showHeading?: boolean }) {
  const { t } = useI18n();
  const FIELD_LABELS: Record<CardElement['field'], string> = {
    name: t('dash.membershipCard.fieldName', 'Member name'),
    number: t('dash.membershipCard.fieldNumber', 'Membership number'),
    validUntil: t('dash.membershipCard.fieldValidUntil', 'Valid until'),
    code: t('dash.membershipCard.fieldCode', 'Barcode / QR'),
  };
  const [tpl, setTpl] = useState<CardTemplate | null>(null);
  const [editSide, setEditSide] = useState<CardSide>('front');
  const [sel, setSel] = useState<number | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get<CardTemplate>('/membership-card').then(setTpl).catch(() => setMsg(t('dash.membershipCard.loadTemplateFailed', 'Failed to load template')));
  }, []);

  // Switching the side you edit clears the selection (indices are per-side).
  const switchSide = (side: CardSide) => { setEditSide(side); setSel(null); };

  /** Apply a transform to the elements array of the side currently being edited. */
  const patchSideElements = (updater: (els: CardElement[]) => CardElement[]) =>
    setTpl((prev) => {
      if (!prev) return prev;
      return editSide === 'back'
        ? { ...prev, backElements: updater(prev.backElements ?? []) }
        : { ...prev, elements: updater(prev.elements) };
    });

  const updateEl = (idx: number, patch: Partial<CardElement>) =>
    patchSideElements((els) => els.map((el, i) => (i === idx ? { ...el, ...patch } : el)));

  const addField = (field: CardElement['field']) => {
    patchSideElements((els) => [...els, { field, ...FIELD_DEFAULTS[field] }]);
    setSel(sideOf(tpl!, editSide).elements.length); // new element lands at the end
  };

  const removeField = (idx: number) => {
    patchSideElements((els) => els.filter((_, i) => i !== idx));
    setSel(null);
  };

  const changeIdType = (idType: CardTemplate['idType']) => {
    setTpl((prev) => {
      if (!prev) return prev;
      // "Number only" has no code, so drop any placed code fields on both sides.
      if (idType === 'number') {
        return {
          ...prev, idType,
          elements: prev.elements.filter((el) => el.field !== 'code'),
          backElements: (prev.backElements ?? []).filter((el) => el.field !== 'code'),
        };
      }
      return { ...prev, idType };
    });
    setSel(null);
  };

  const onUploadBg = async (side: CardSide, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      // Persists the image to object storage; keep local element edits, just swap the bg URL.
      const res = await api.upload<CardTemplate>(`/membership-card/background?side=${side}`, fd);
      setTpl((prev) => (prev ? { ...prev, backgroundImage: res.backgroundImage, backBackgroundImage: res.backBackgroundImage ?? null } : prev));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t('dash.membershipCard.saveFailed', 'Save failed'));
    }
  };

  const removeBg = async (side: CardSide) => {
    setMsg('');
    try {
      await api.delete(`/membership-card/background?side=${side}`);
      setTpl((prev) => (prev ? (side === 'back' ? { ...prev, backBackgroundImage: null } : { ...prev, backgroundImage: null }) : prev));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t('dash.membershipCard.saveFailed', 'Save failed'));
    }
  };

  const save = async () => {
    if (!tpl) return;
    setSaving(true); setMsg('');
    try { await api.put('/membership-card', tpl); setMsg(t('dash.membershipCard.saved', 'Saved.')); }
    catch (e) { setMsg(e instanceof Error ? e.message : t('dash.membershipCard.saveFailed', 'Save failed')); }
    finally { setSaving(false); }
  };

  if (!tpl) return <div className="card text-sm text-text-muted max-w-md">{t('dash.membershipCard.loading', 'Loading card designer…')}</div>;

  const sideData = sideOf(tpl, editSide);
  const selEl = sel != null ? sideData.elements[sel] : null;
  const placed = new Set(sideData.elements.map((el) => el.field));
  const addable = ALL_FIELDS.filter((f) => !placed.has(f) && (f !== 'code' || tpl.idType !== 'number'));
  const sideBg = editSide === 'back' ? tpl.backBackgroundImage ?? null : tpl.backgroundImage;

  const SideTabs = ({ value, onChange }: { value: CardSide; onChange: (s: CardSide) => void }) => (
    <div className="inline-flex rounded-lg border border-border overflow-hidden">
      {(['front', 'back'] as CardSide[]).map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={`px-3 py-1.5 text-sm ${value === s ? 'bg-primary-500 text-white' : 'bg-surface text-text-secondary hover:bg-surface-sunken'}`}
        >
          {s === 'front' ? t('dash.membershipCard.front', 'Front') : t('dash.membershipCard.back', 'Back')}
        </button>
      ))}
    </div>
  );

  return (
    <div className="max-w-5xl">
      {showHeading && (
        <>
          <h1 className="text-2xl font-bold text-text-primary mb-1">{t('dash.membershipCard.title', 'Membership Card Designer')}</h1>
          <p className="text-sm text-text-secondary mb-4">{t('dash.membershipCard.subtitle', "Design the front and back of the card. Drag fields onto the card (snaps to grid) — click the small canvas to edit it full size. Cards render/print with each member's details.")}</p>
        </>
      )}
      {msg && <div className="rounded-lg bg-sky-50 border border-sky-200 p-2 text-sm text-sky-800 mb-4">{msg}</div>}

      {/* Interactive preview — click the card (or the buttons) to flip front/back */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="section-title">{t('dash.membershipCard.preview', 'Preview')}</h2>
          <SideTabs value={flipped ? 'back' : 'front'} onChange={(s) => setFlipped(s === 'back')} />
        </div>
        <div className="flex flex-col items-center gap-2">
          <div style={{ perspective: 1400, width: tpl.width * PREVIEW_SCALE, height: tpl.height * PREVIEW_SCALE }}>
            <div
              onClick={() => setFlipped((f) => !f)}
              title={t('dash.membershipCard.clickToFlip', 'Click to flip')}
              style={{
                position: 'relative', width: '100%', height: '100%', cursor: 'pointer',
                transformStyle: 'preserve-3d', transition: 'transform .6s',
                transform: flipped ? 'rotateY(180deg)' : 'none',
              }}
            >
              <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden' }}>
                <MembershipCard template={tpl} data={SAMPLE} scale={PREVIEW_SCALE} side="front" />
              </div>
              <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                <MembershipCard template={tpl} data={SAMPLE} scale={PREVIEW_SCALE} side="back" />
              </div>
            </div>
          </div>
          <p className="text-xs text-text-muted">{t('dash.membershipCard.clickToFlipHint', 'Click the card to flip between front and back')}</p>
        </div>
      </div>

      {/* Editor — smaller canvas below the preview + controls */}
      <div className="flex flex-wrap gap-6">
        <div>
          <div className="mb-2"><SideTabs value={editSide} onChange={switchSide} /></div>
          <EditorCanvas tpl={tpl} side={editSide} scale={EDIT_SCALE} sel={sel} onSelect={setSel} onChange={updateEl} onBackgroundClick={() => setZoom(true)} t={t} />
          <p className="text-xs text-text-muted mt-2">
            {t('dash.membershipCard.card', 'Card')} {tpl.width}×{tpl.height}px · {t('dash.membershipCard.grid', 'grid')} {GRID}px ·{' '}
            <button className="text-primary-600 hover:underline" onClick={() => setZoom(true)}>{t('dash.membershipCard.editFullSize', 'Edit full size')}</button>
          </p>
        </div>

        {/* Controls */}
        <div className="flex-1 min-w-[260px] space-y-4">
          <div className="card">
            <label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.membershipCard.codeType', 'Code type')}</label>
            <select className="input-field" value={tpl.idType} onChange={(e) => changeIdType(e.target.value as CardTemplate['idType'])}>
              <option value="number">{t('dash.membershipCard.numberOnly', 'Number only')}</option>
              <option value="number_barcode">{t('dash.membershipCard.numberBarcode', 'Number + Barcode')}</option>
              <option value="number_qr">{t('dash.membershipCard.numberQr', 'Number + QR')}</option>
            </select>
          </div>

          <div className="card">
            <label className="block text-xs font-medium text-text-secondary mb-1">
              {t('dash.membershipCard.backgroundImage', 'Background image')} — {editSide === 'front' ? t('dash.membershipCard.front', 'Front') : t('dash.membershipCard.back', 'Back')}
            </label>
            <input type="file" accept="image/*" onChange={(e) => void onUploadBg(editSide, e)} className="text-sm" />
            {sideBg && <button className="btn-ghost text-xs text-rose-600 mt-2" onClick={() => void removeBg(editSide)}>{t('dash.membershipCard.removeBackground', 'Remove background')}</button>}
          </div>

          <div className="card">
            <p className="text-xs font-medium text-text-secondary mb-2">{t('dash.membershipCard.fieldsHint', 'Fields — click a field on the card to edit')}</p>
            {/* Placed fields (click to select) */}
            <div className="flex flex-wrap gap-1 mb-2">
              {sideData.elements.length === 0 && <span className="text-xs text-text-muted">{t('dash.membershipCard.noFields', 'No fields on this side yet — add one below.')}</span>}
              {sideData.elements.map((el, i) => (
                <button key={i} onClick={() => setSel(i)} className={`badge ${sel === i ? 'bg-primary-500 text-white' : 'bg-surface-sunken text-text-secondary'}`}>{FIELD_LABELS[el.field]}</button>
              ))}
            </div>
            {/* Add-field palette (depends on the chosen code type) */}
            {addable.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 mb-1">
                <span className="text-xs text-text-muted mr-1">{t('dash.membershipCard.addField', 'Add:')}</span>
                {addable.map((f) => (
                  <button key={f} onClick={() => addField(f)} className="badge bg-surface border border-dashed border-border text-text-secondary hover:bg-surface-sunken">+ {FIELD_LABELS[f]}</button>
                ))}
              </div>
            )}
            {selEl && (
              <div className="space-y-2 border-t border-border pt-3 mt-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{FIELD_LABELS[selEl.field]}</p>
                  <button className="text-xs text-rose-600 hover:underline" onClick={() => removeField(sel!)}>{t('dash.membershipCard.removeField', 'Remove')}</button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {selEl.field !== 'code' && (
                    <>
                      <label>{t('dash.membershipCard.fontSize', 'Font size')}<input type="number" className="input-field py-1" value={selEl.fontSize} onChange={(e) => updateEl(sel!, { fontSize: Number(e.target.value) })} /></label>
                      <label className="col-span-2">{t('dash.membershipCard.colour', 'Colour')}<input type="color" className="input-field py-1 h-9" value={selEl.color} onChange={(e) => updateEl(sel!, { color: e.target.value })} /></label>
                    </>
                  )}
                  <label>{t('dash.membershipCard.align', 'Align')}
                    <select className="input-field py-1" value={selEl.align} onChange={(e) => updateEl(sel!, { align: e.target.value as CardElement['align'] })}>
                      <option value="left">{t('dash.membershipCard.alignLeft', 'Left')}</option><option value="center">{t('dash.membershipCard.alignCenter', 'Center')}</option><option value="right">{t('dash.membershipCard.alignRight', 'Right')}</option>
                    </select>
                  </label>
                  <label>{t('dash.membershipCard.width', 'Width')}<input type="number" className="input-field py-1" value={selEl.w} onChange={(e) => updateEl(sel!, { w: Number(e.target.value) })} /></label>
                  <label>{t('dash.membershipCard.height', 'Height')}<input type="number" className="input-field py-1" value={selEl.h} onChange={(e) => updateEl(sel!, { h: Number(e.target.value) })} /></label>
                </div>
              </div>
            )}
          </div>

          <button className="btn-primary w-full" onClick={save} disabled={saving}>{saving ? t('dash.membershipCard.saving', 'Saving…') : t('dash.membershipCard.saveCardDesign', 'Save card design')}</button>
        </div>
      </div>

      {/* Full-size editing modal */}
      {zoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setZoom(false)}>
          <div className="bg-surface rounded-xl shadow-xl p-4 max-w-full max-h-full overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3 gap-4">
              <div className="flex items-center gap-3">
                <h3 className="font-semibold text-text-primary">{t('dash.membershipCard.editFullSize', 'Edit full size')}</h3>
                <SideTabs value={editSide} onChange={switchSide} />
              </div>
              <button className="btn-ghost text-sm" onClick={() => setZoom(false)}>{t('common.close', 'Close')}</button>
            </div>
            <EditorCanvas tpl={tpl} side={editSide} scale={MODAL_SCALE} sel={sel} onSelect={setSel} onChange={updateEl} t={t} />
            <p className="text-xs text-text-muted mt-2">{t('dash.membershipCard.dragHint', 'Drag fields to position them (snaps to grid).')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
