import { BadRequestException } from '@nestjs/common';

/**
 * Turn an uploaded knowledge-base file into the plain text the AI will read.
 *
 * Only text ever reaches the model, so extraction happens ONCE here at upload
 * time and the result is stored (and stays editable) — the original file is
 * never kept. Anything we cannot read reliably is rejected with a 400 that
 * names the accepted formats, rather than silently storing mojibake that the
 * assistant would later quote at a customer.
 */

/** Max upload size for one knowledge document. */
export const MAX_KNOWLEDGE_FILE_BYTES = 8 * 1024 * 1024;

/** Max extracted text kept for ONE document (~10k tokens). Longer input is truncated. */
export const MAX_DOC_CHARS = 40_000;

/** Marker appended when a document was cut at {@link MAX_DOC_CHARS}. */
export const TRUNCATION_MARKER = '\n\n[…dokumen dipotong karena terlalu panjang…]';

/** Extensions the dashboard file picker offers (kept in sync with the UI's `accept`). */
export const KNOWLEDGE_ACCEPT = '.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.pdf,.docx';

const PLAIN_TEXT_TYPES = new Set([
  'text/plain', 'text/markdown', 'text/x-markdown', 'text/csv', 'text/tab-separated-values',
  'application/json', 'text/json',
]);
const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);
const PDF_TYPES = new Set(['application/pdf']);
const DOCX_TYPES = new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

const EXT_KIND: Record<string, 'text' | 'html' | 'pdf' | 'docx'> = {
  txt: 'text', md: 'text', markdown: 'text', csv: 'text', tsv: 'text', json: 'text', log: 'text',
  html: 'html', htm: 'html',
  pdf: 'pdf',
  docx: 'docx',
};

export type KnowledgeFileKind = 'text' | 'html' | 'pdf' | 'docx';

/**
 * Decide how to read a file. Browsers are inconsistent about the mime type they
 * attach (Windows often sends `application/octet-stream` for .md), so the
 * extension is consulted as well and either signal is enough.
 */
export function classifyKnowledgeFile(mimeType: string | undefined, fileName: string | undefined): KnowledgeFileKind | null {
  const mt = ((mimeType ?? '').split(';')[0] ?? '').trim().toLowerCase();
  if (PLAIN_TEXT_TYPES.has(mt)) return 'text';
  if (HTML_TYPES.has(mt)) return 'html';
  if (PDF_TYPES.has(mt)) return 'pdf';
  if (DOCX_TYPES.has(mt)) return 'docx';
  const ext = (fileName ?? '').split('.').pop()?.toLowerCase() ?? '';
  return EXT_KIND[ext] ?? null;
}

// Control/zero-width junk that PDF and DOCX extraction leaves behind. Built from
// codepoints rather than written literally so the pattern itself stays readable.
const CONTROL_CHARS = new RegExp(
  `[${['\\u0000-\\u0008', '\\u000B', '\\u000C', '\\u000E-\\u001F', '\\uFEFF', '\\u200B-\\u200D'].join('')}]`,
  'g',
);

/** Collapse runaway whitespace and cap the length, so one huge file can't own the prompt. */
export function normalizeKnowledgeText(raw: string): string {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length <= MAX_DOC_CHARS) return text;
  return text.slice(0, MAX_DOC_CHARS).trimEnd() + TRUNCATION_MARKER;
}

/** Strip tags/scripts from an HTML export into readable text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]{2,}/g, ' ');
}

/**
 * Extract the text of one uploaded file.
 *
 * PDF and DOCX parsers are required lazily: they are only needed on the upload
 * path, a tenant uploading a .txt should not pay their (large) module load, and
 * a missing parser degrades to a clean 400 instead of breaking API boot.
 */
export async function extractKnowledgeText(
  file: { buffer?: Buffer; mimetype?: string; originalname?: string; size?: number } | undefined,
): Promise<{ text: string; kind: KnowledgeFileKind }> {
  if (!file || !file.buffer || file.buffer.length === 0) throw new BadRequestException('No file uploaded');
  if (file.buffer.length > MAX_KNOWLEDGE_FILE_BYTES) {
    throw new BadRequestException(`File is too large (max ${Math.round(MAX_KNOWLEDGE_FILE_BYTES / (1024 * 1024))} MB)`);
  }

  const kind = classifyKnowledgeFile(file.mimetype, file.originalname);
  if (!kind) {
    throw new BadRequestException(
      `Unsupported file type${file.mimetype ? ` (${file.mimetype})` : ''}. Accepted: ${KNOWLEDGE_ACCEPT}`,
    );
  }

  let raw: string;
  if (kind === 'text') {
    raw = file.buffer.toString('utf8');
  } else if (kind === 'html') {
    raw = htmlToText(file.buffer.toString('utf8'));
  } else if (kind === 'pdf') {
    raw = await extractPdf(file.buffer);
  } else {
    raw = await extractDocx(file.buffer);
  }

  const text = normalizeKnowledgeText(raw);
  if (!text) {
    throw new BadRequestException(
      kind === 'pdf'
        ? 'No text found in this PDF — it looks like a scan. Upload a text-based PDF, or paste the text as a note.'
        : 'No text found in this file',
    );
  }
  return { text, kind };
}

interface PdfParseV2 { new (opts: { data: Buffer }): { getText(): Promise<{ text?: string }>; destroy(): Promise<void> } }

async function extractPdf(buffer: Buffer): Promise<string> {
  let mod: { PDFParse?: PdfParseV2; default?: unknown } & Record<string, unknown>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('pdf-parse');
  } catch {
    throw new BadRequestException('PDF support is not available on this server — paste the text as a note instead');
  }
  try {
    // pdf-parse v2 exports a PDFParse class; v1 exported a single function.
    // Handle both so a dependency bump in either direction can't break upload.
    if (typeof mod.PDFParse === 'function') {
      const parser = new mod.PDFParse({ data: buffer });
      try {
        const out = await parser.getText();
        return out?.text ?? '';
      } finally {
        await parser.destroy().catch(() => undefined);
      }
    }
    const legacy = (mod.default ?? mod) as unknown as (data: Buffer) => Promise<{ text?: string }>;
    const out = await legacy(buffer);
    return out?.text ?? '';
  } catch {
    throw new BadRequestException('Could not read this PDF — it may be encrypted, scanned, or corrupted');
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  let mammoth: { extractRawText: (input: { buffer: Buffer }) => Promise<{ value?: string }> };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mammoth = require('mammoth');
  } catch {
    throw new BadRequestException('Word support is not available on this server — paste the text as a note instead');
  }
  try {
    const out = await mammoth.extractRawText({ buffer });
    return out?.value ?? '';
  } catch {
    throw new BadRequestException('Could not read this Word file — save it as .docx and try again');
  }
}
