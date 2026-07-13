'use client';

import { useEffect, useState } from 'react';
import { qrDataUrl, barcodeDataUrl } from '@/lib/cardCodes';

export type CardIdType = 'number' | 'number_barcode' | 'number_qr';
export interface CardElement {
  field: 'name' | 'number' | 'code' | 'validUntil';
  x: number; y: number; w: number; h: number;
  fontSize: number; color: string; align: 'left' | 'center' | 'right';
}
export type CardSide = 'front' | 'back';
export interface CardTemplate {
  idType: CardIdType;
  width: number; height: number;
  backgroundImage: string | null;
  elements: CardElement[];
  backBackgroundImage?: string | null;
  backElements?: CardElement[];
}
export interface CardData { name: string; number: string; validUntil: string }

/** Background + fields for one side of the card (defaults to the front). */
export function sideOf(template: CardTemplate, side: CardSide) {
  return side === 'back'
    ? { backgroundImage: template.backBackgroundImage ?? null, elements: template.backElements ?? [] }
    : { backgroundImage: template.backgroundImage, elements: template.elements };
}

/** The code (QR/barcode) image for a card, as a data URL. */
export async function computeCardCode(idType: CardIdType, number: string): Promise<string> {
  if (!number) return '';
  if (idType === 'number_qr') return qrDataUrl(number);
  if (idType === 'number_barcode') return barcodeDataUrl(number);
  return '';
}

function fieldText(field: CardElement['field'], data: CardData): string {
  if (field === 'name') return data.name;
  if (field === 'number') return data.number;
  if (field === 'validUntil') return data.validUntil ? `Valid until ${data.validUntil}` : '';
  return '';
}

/** On-screen card preview/render. `scale` shrinks the design (width×height) to fit. */
export function MembershipCard({ template, data, scale = 1, side = 'front' }: { template: CardTemplate; data: CardData; scale?: number; side?: CardSide }) {
  const [codeUrl, setCodeUrl] = useState('');
  useEffect(() => {
    let alive = true;
    computeCardCode(template.idType, data.number).then((u) => { if (alive) setCodeUrl(u); });
    return () => { alive = false; };
  }, [template.idType, data.number]);

  const { backgroundImage, elements } = sideOf(template, side);
  return (
    <div style={{ position: 'relative', width: template.width * scale, height: template.height * scale, background: '#e5e7eb', borderRadius: 12 * scale, overflow: 'hidden' }}>
      {backgroundImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={backgroundImage} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      )}
      {elements.map((el, i) => (
        <div key={i} style={{
          position: 'absolute', left: el.x * scale, top: el.y * scale, width: el.w * scale, height: el.h * scale,
          color: el.color, fontSize: (el.fontSize || 16) * scale, overflow: 'hidden',
          display: 'flex', alignItems: 'center',
          justifyContent: el.align === 'center' ? 'center' : el.align === 'right' ? 'flex-end' : 'flex-start',
        }}>
          {el.field === 'code'
            // eslint-disable-next-line @next/next/no-img-element
            ? (codeUrl ? <img src={codeUrl} alt="code" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : null)
            : <span style={{ fontWeight: el.field === 'name' ? 700 : 500, lineHeight: 1.1, whiteSpace: 'nowrap' }}>{fieldText(el.field, data)}</span>}
        </div>
      ))}
    </div>
  );
}

/** Full-size printable HTML for a card (opened in a print window). Prints the back as a second page when it has fields. */
export function buildCardHtml(template: CardTemplate, data: CardData, codeUrl: string): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
  const facePage = (side: CardSide, breakBefore: boolean): string => {
    const { backgroundImage, elements } = sideOf(template, side);
    const els = elements.map((el) => {
      const base = `position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;display:flex;align-items:center;justify-content:${el.align === 'center' ? 'center' : el.align === 'right' ? 'flex-end' : 'flex-start'};overflow:hidden;color:${el.color};font-size:${el.fontSize || 16}px;`;
      if (el.field === 'code') {
        return codeUrl ? `<div style="${base}"><img src="${codeUrl}" style="max-width:100%;max-height:100%;object-fit:contain"/></div>` : '';
      }
      const weight = el.field === 'name' ? 700 : 500;
      return `<div style="${base}font-weight:${weight};white-space:nowrap">${esc(fieldText(el.field, data))}</div>`;
    }).join('');
    const bg = backgroundImage ? `<img src="${backgroundImage}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"/>` : '';
    const pageBreak = breakBefore ? 'break-before:page;' : '';
    return `<div style="position:relative;width:${template.width}px;height:${template.height}px;overflow:hidden;${pageBreak}">${bg}${els}</div>`;
  };
  const hasBack = (template.backElements?.length ?? 0) > 0 || !!template.backBackgroundImage;
  const pages = facePage('front', false) + (hasBack ? facePage('back', true) : '');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Membership Card</title>
    <style>@page{size:${template.width}px ${template.height}px;margin:0}body{margin:0}</style></head>
    <body>${pages}
    <script>window.onload=()=>window.print()</script></body></html>`;
}
