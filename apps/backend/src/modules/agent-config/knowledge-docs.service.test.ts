import { describe, it, expect, vi } from 'vitest';
import { KnowledgeDocsService, MAX_PROMPT_DOC_CHARS, titleFromFileName } from './knowledge-docs.service';

/** Minimal pg stub: hands back whatever rows the test queues up. */
function poolWith(rows: unknown[], onQuery?: (sql: string, params: unknown[]) => void) {
  return {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      onQuery?.(sql, params);
      return { rows, rowCount: rows.length };
    }),
  } as never;
}

const svc = (pool: never) => new KnowledgeDocsService(pool);

describe('titleFromFileName', () => {
  it('drops the path and extension', () => {
    expect(titleFromFileName('C:/tmp/Harga LEAD 2026.PDF')).toBe('Harga LEAD 2026');
    expect(titleFromFileName('notes.docx')).toBe('notes');
  });
  it('never returns an empty title', () => {
    expect(titleFromFileName(undefined)).toBe('Dokumen');
    expect(titleFromFileName('.txt')).toBe('Dokumen');
  });
});

describe('composeKnowledge', () => {
  it('returns the base text untouched when the tenant has no documents', async () => {
    const out = await svc(poolWith([])).composeKnowledge('t1', 'AIRE cuci mobil.');
    expect(out).toBe('AIRE cuci mobil.');
  });

  it('appends each enabled document under its title, after the base text', async () => {
    const out = await svc(poolWith([
      { title: 'Harga', content: 'Cuci Rp 50.000' },
      { title: 'Ketentuan', content: 'Membership 1 hari 1x cuci' },
    ])).composeKnowledge('t1', 'AIRE cuci mobil.');
    expect(out).toBe('AIRE cuci mobil.\n\n### Harga\nCuci Rp 50.000\n\n### Ketentuan\nMembership 1 hari 1x cuci');
  });

  it('works with no base text at all', async () => {
    const out = await svc(poolWith([{ title: 'Harga', content: 'Cuci Rp 50.000' }])).composeKnowledge('t1', null);
    expect(out).toBe('### Harga\nCuci Rp 50.000');
  });

  it('only asks the DB for enabled, non-empty documents in display order', async () => {
    let sql = '';
    await svc(poolWith([], (q) => { sql = q; })).composeKnowledge('t1', 'base');
    expect(sql).toMatch(/enabled = true/);
    expect(sql).toMatch(/content <> ''/);
    expect(sql).toMatch(/ORDER BY sort_order ASC, created_at ASC/);
  });

  it('spends the prompt budget on the first documents and stops', async () => {
    const out = await svc(poolWith([
      { title: 'A', content: 'a'.repeat(MAX_PROMPT_DOC_CHARS) },
      { title: 'B', content: 'b'.repeat(500) },
    ])).composeKnowledge('t1', null);
    expect(out).toContain('### A');
    expect(out).not.toContain('### B');
  });

  it('truncates the document that straddles the budget rather than dropping it', async () => {
    const out = await svc(poolWith([
      { title: 'A', content: 'a'.repeat(MAX_PROMPT_DOC_CHARS - 10) },
      { title: 'B', content: 'b'.repeat(500) },
    ])).composeKnowledge('t1', null);
    expect(out).toContain('### B');
    expect(out).toContain('…');
    expect((out ?? '').match(/b/g)?.length).toBe(10);
  });

  it('falls back to the base text when the table is unreadable (API ahead of migration 099)', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('relation "ai_knowledge_documents" does not exist'); }) } as never;
    await expect(svc(pool).composeKnowledge('t1', 'base')).resolves.toBe('base');
  });
});

describe('update', () => {
  it('rejects a blank title', async () => {
    await expect(svc(poolWith([])).update('t1', 'd1', { title: '   ' })).rejects.toThrow(/Title is required/);
  });

  it('marks hand-edited text as manual, so it no longer claims to be the file', async () => {
    let sql = '';
    const pool = poolWith([{
      id: 'd1', title: 'Harga', content: 'x', source: 'manual', file_name: 'h.pdf', mime_type: null,
      size_bytes: 1, enabled: true, sort_order: 0, created_at: new Date(), updated_at: new Date(),
    }], (q) => { sql = q; });
    await svc(pool).update('t1', 'd1', { content: 'Cuci Rp 60.000' });
    expect(sql).toMatch(/source = 'manual'/);
  });

  it('scopes every write to the tenant', async () => {
    const seen: unknown[][] = [];
    const pool = poolWith([{
      id: 'd1', title: 'Harga', content: 'x', source: 'manual', file_name: null, mime_type: null,
      size_bytes: 1, enabled: false, sort_order: 0, created_at: new Date(), updated_at: new Date(),
    }], (_q, p) => seen.push(p));
    await svc(pool).update('t1', 'd1', { enabled: false });
    expect(seen[0]).toEqual([false, 'd1', 't1']);
  });
});
