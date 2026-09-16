import { describe, it, expect } from 'vitest';
import {
  classifyKnowledgeFile, normalizeKnowledgeText, htmlToText, extractKnowledgeText,
  MAX_DOC_CHARS, MAX_KNOWLEDGE_FILE_BYTES, TRUNCATION_MARKER,
} from './knowledge-extract';

const file = (name: string, type: string, body: string | Buffer) => ({
  originalname: name,
  mimetype: type,
  buffer: Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8'),
  size: Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body),
});

describe('classifyKnowledgeFile', () => {
  it('reads the mime type when the browser sends a useful one', () => {
    expect(classifyKnowledgeFile('text/plain', 'a.bin')).toBe('text');
    expect(classifyKnowledgeFile('application/pdf', 'a')).toBe('pdf');
    expect(classifyKnowledgeFile('text/html; charset=utf-8', 'a')).toBe('html');
  });

  it('falls back to the extension — Windows sends octet-stream for .md/.csv', () => {
    expect(classifyKnowledgeFile('application/octet-stream', 'harga.md')).toBe('text');
    expect(classifyKnowledgeFile('application/octet-stream', 'HARGA.PDF')).toBe('pdf');
    expect(classifyKnowledgeFile(undefined, 'terms.docx')).toBe('docx');
  });

  it('returns null for anything we cannot read as text', () => {
    expect(classifyKnowledgeFile('image/png', 'scan.png')).toBeNull();
    expect(classifyKnowledgeFile('application/zip', 'bundle.zip')).toBeNull();
  });
});

describe('normalizeKnowledgeText', () => {
  it('normalises newlines and collapses blank-line runs', () => {
    expect(normalizeKnowledgeText('a\r\n\r\n\r\n\r\nb  \nc')).toBe('a\n\nb\nc');
  });

  it('strips the zero-width/BOM junk PDF extraction leaves behind', () => {
    expect(normalizeKnowledgeText('﻿Rp 50.000​')).toBe('Rp 50.000');
  });

  it('truncates a document past the per-document cap and says so', () => {
    const out = normalizeKnowledgeText('x'.repeat(MAX_DOC_CHARS + 500));
    expect(out.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(out.length).toBe(MAX_DOC_CHARS + TRUNCATION_MARKER.length);
  });
});

describe('htmlToText', () => {
  it('drops scripts/styles and keeps the readable text', () => {
    const text = htmlToText('<style>p{color:red}</style><p>Cuci mobil <b>Rp&nbsp;50.000</b></p><script>alert(1)</script><li>Wax</li>');
    expect(text).toContain('Cuci mobil');
    expect(text).toContain('Rp 50.000');
    expect(text).toContain('- Wax');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
  });
});

describe('extractKnowledgeText', () => {
  it('reads a plain-text upload', async () => {
    const out = await extractKnowledgeText(file('harga.txt', 'text/plain', 'Cuci mobil Rp 50.000\n\n\nWax Rp 150.000'));
    expect(out.kind).toBe('text');
    expect(out.text).toBe('Cuci mobil Rp 50.000\n\nWax Rp 150.000');
  });

  it('rejects a missing or empty file', async () => {
    await expect(extractKnowledgeText(undefined)).rejects.toThrow(/No file uploaded/);
    await expect(extractKnowledgeText(file('a.txt', 'text/plain', ''))).rejects.toThrow(/No file uploaded/);
  });

  it('rejects an unsupported type, naming what is accepted', async () => {
    await expect(extractKnowledgeText(file('scan.png', 'image/png', 'x'))).rejects.toThrow(/Unsupported file type.*\.pdf/s);
  });

  it('rejects an oversized file before parsing it', async () => {
    const big = Buffer.alloc(MAX_KNOWLEDGE_FILE_BYTES + 1, 0x61);
    await expect(extractKnowledgeText(file('big.txt', 'text/plain', big))).rejects.toThrow(/too large/);
  });

  it('rejects a file whose text is only whitespace', async () => {
    await expect(extractKnowledgeText(file('blank.txt', 'text/plain', '   \n\n  '))).rejects.toThrow(/No text found/);
  });
});
