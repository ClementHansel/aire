'use client';

import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';

/** QR code as a PNG data URL (for membership cards). */
export async function qrDataUrl(text: string, size = 260): Promise<string> {
  try {
    return await QRCode.toDataURL(text, { width: size, margin: 1 });
  } catch {
    return '';
  }
}

/** Code128 barcode as a PNG data URL. */
export function barcodeDataUrl(text: string): string {
  try {
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, text, { format: 'CODE128', displayValue: false, margin: 0, height: 90, width: 2 });
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}
