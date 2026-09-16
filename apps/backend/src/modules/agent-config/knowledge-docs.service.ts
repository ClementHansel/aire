import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { extractKnowledgeText, normalizeKnowledgeText, MAX_DOC_CHARS } from './knowledge-extract';

/**
 * Tenant knowledge-base documents (migration 099).
 *
 * The owner uploads a file (or types a note); we store the EXTRACTED TEXT and
 * append the enabled ones to the customer AI's system prompt. Editing a stored
 * document edits exactly what the assistant reads, which is the whole point —
 * "the PDF said the wrong price" is fixed here, not by re-exporting the PDF.
 */

export interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  source: 'upload' | 'manual';
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  /** Length of `content` — lets the UI warn before the prompt budget bites. */
  charCount: number;
}

export interface CreateKnowledgeDocDto {
  title?: string | null;
  content?: string | null;
  enabled?: boolean;
  sortOrder?: number;
}

/** Same fields as creation; every one optional, so callers send only what changed. */
export type UpdateKnowledgeDocDto = CreateKnowledgeDocDto;

/**
 * Total characters of DOCUMENT text injected into one system prompt. Documents
 * are concatenated in display order until this is reached, so an owner who
 * uploads their whole filing cabinet gets their top document in full rather
 * than a prompt that blows the model's context (and the per-message bill).
 */
export const MAX_PROMPT_DOC_CHARS = 20_000;

const MAX_TITLE_LEN = 200;

/** Turn a file name into a human title: "harga-lead 2026.PDF" -> "harga-lead 2026". */
export function titleFromFileName(fileName: string | undefined): string {
  const base = (fileName ?? '').split(/[\\/]/).pop() ?? '';
  const noExt = base.replace(/\.[A-Za-z0-9]{1,8}$/, '').trim();
  return (noExt || 'Dokumen').slice(0, MAX_TITLE_LEN);
}

interface DocRow {
  id: string; title: string; content: string; source: string;
  file_name: string | null; mime_type: string | null; size_bytes: number;
  enabled: boolean; sort_order: number; created_at: Date; updated_at: Date;
}

@Injectable()
export class KnowledgeDocsService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  private static map(r: DocRow): KnowledgeDocument {
    const content = r.content ?? '';
    return {
      id: r.id,
      title: r.title,
      content,
      source: r.source === 'upload' ? 'upload' : 'manual',
      fileName: r.file_name ?? null,
      mimeType: r.mime_type ?? null,
      sizeBytes: r.size_bytes ?? 0,
      enabled: r.enabled !== false,
      sortOrder: r.sort_order ?? 0,
      createdAt: r.created_at?.toISOString?.() ?? String(r.created_at),
      updatedAt: r.updated_at?.toISOString?.() ?? String(r.updated_at),
      charCount: content.length,
    };
  }

  /** Every document of a tenant, in the order the prompt will concatenate them. */
  async list(tenantId: string): Promise<KnowledgeDocument[]> {
    const r = await this.pool.query<DocRow>(
      `SELECT id, title, content, source, file_name, mime_type, size_bytes, enabled, sort_order, created_at, updated_at
         FROM ai_knowledge_documents
        WHERE tenant_id = $1
        ORDER BY sort_order ASC, created_at ASC`,
      [tenantId],
    );
    return r.rows.map(KnowledgeDocsService.map);
  }

  async get(tenantId: string, id: string): Promise<KnowledgeDocument> {
    const r = await this.pool.query<DocRow>(
      `SELECT id, title, content, source, file_name, mime_type, size_bytes, enabled, sort_order, created_at, updated_at
         FROM ai_knowledge_documents WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    const row = r.rows[0];
    if (!row) throw new NotFoundException('Knowledge document not found');
    return KnowledgeDocsService.map(row);
  }

  /** Create a typed note (no file). */
  async create(tenantId: string, dto: CreateKnowledgeDocDto, userId?: string | null): Promise<KnowledgeDocument> {
    const title = (dto.title ?? '').trim().slice(0, MAX_TITLE_LEN) || 'Catatan baru';
    const content = normalizeKnowledgeText(dto.content ?? '');
    const r = await this.pool.query<DocRow>(
      `INSERT INTO ai_knowledge_documents (tenant_id, title, content, source, size_bytes, enabled, sort_order, created_by)
       VALUES ($1, $2, $3, 'manual', $4, COALESCE($5, true), COALESCE($6, $7), $8)
       RETURNING id, title, content, source, file_name, mime_type, size_bytes, enabled, sort_order, created_at, updated_at`,
      [
        tenantId, title, content, Buffer.byteLength(content, 'utf8'),
        dto.enabled ?? null, dto.sortOrder ?? null, await this.nextSortOrder(tenantId), userId ?? null,
      ],
    );
    return KnowledgeDocsService.map(r.rows[0]!);
  }

  /**
   * Upload a file as a NEW document. The file itself is not stored — only the
   * text we extracted from it, plus its name/type/size for provenance.
   */
  async upload(
    tenantId: string,
    file: Express.Multer.File | undefined,
    title: string | undefined,
    userId?: string | null,
  ): Promise<KnowledgeDocument> {
    const { text } = await extractKnowledgeText(file);
    const f = file as Express.Multer.File;
    const r = await this.pool.query<DocRow>(
      `INSERT INTO ai_knowledge_documents (tenant_id, title, content, source, file_name, mime_type, size_bytes, sort_order, created_by)
       VALUES ($1, $2, $3, 'upload', $4, $5, $6, $7, $8)
       RETURNING id, title, content, source, file_name, mime_type, size_bytes, enabled, sort_order, created_at, updated_at`,
      [
        tenantId,
        (title ?? '').trim().slice(0, MAX_TITLE_LEN) || titleFromFileName(f.originalname),
        text, f.originalname ?? null, f.mimetype ?? null, f.size ?? f.buffer?.length ?? 0,
        await this.nextSortOrder(tenantId), userId ?? null,
      ],
    );
    return KnowledgeDocsService.map(r.rows[0]!);
  }

  /**
   * Replace an EXISTING document's text with a freshly uploaded file, keeping
   * its id, position and enabled state — the "the price list changed, here's
   * the new sheet" path, which must not orphan the old document.
   */
  async replaceFile(
    tenantId: string,
    id: string,
    file: Express.Multer.File | undefined,
    userId?: string | null,
  ): Promise<KnowledgeDocument> {
    await this.get(tenantId, id); // 404s before we bother parsing
    const { text } = await extractKnowledgeText(file);
    const f = file as Express.Multer.File;
    const r = await this.pool.query<DocRow>(
      `UPDATE ai_knowledge_documents
          SET content = $1, source = 'upload', file_name = $2, mime_type = $3, size_bytes = $4, created_by = COALESCE(created_by, $5)
        WHERE id = $6 AND tenant_id = $7
      RETURNING id, title, content, source, file_name, mime_type, size_bytes, enabled, sort_order, created_at, updated_at`,
      [text, f.originalname ?? null, f.mimetype ?? null, f.size ?? f.buffer?.length ?? 0, userId ?? null, id, tenantId],
    );
    const row = r.rows[0];
    if (!row) throw new NotFoundException('Knowledge document not found');
    return KnowledgeDocsService.map(row);
  }

  /** Edit an existing document: title, text, on/off, position. Send only what changed. */
  async update(tenantId: string, id: string, dto: UpdateKnowledgeDocDto): Promise<KnowledgeDocument> {
    const set: string[] = [];
    const v: unknown[] = [];
    let i = 1;
    if (dto.title !== undefined) {
      const title = (dto.title ?? '').trim().slice(0, MAX_TITLE_LEN);
      if (!title) throw new BadRequestException('Title is required');
      set.push(`title = $${i++}`); v.push(title);
    }
    if (dto.content !== undefined) {
      const content = normalizeKnowledgeText(dto.content ?? '');
      // Editing is how a truncated upload gets fixed, so the same cap applies.
      if (content.length > MAX_DOC_CHARS) throw new BadRequestException(`Document is too long (max ${MAX_DOC_CHARS} characters)`);
      set.push(`content = $${i++}`); v.push(content);
      set.push(`size_bytes = $${i++}`); v.push(Buffer.byteLength(content, 'utf8'));
      // Hand-edited text is no longer "what that file said".
      set.push(`source = 'manual'`);
    }
    if (dto.enabled !== undefined) { set.push(`enabled = $${i++}`); v.push(!!dto.enabled); }
    if (dto.sortOrder !== undefined) { set.push(`sort_order = $${i++}`); v.push(Math.trunc(Number(dto.sortOrder) || 0)); }
    if (!set.length) return this.get(tenantId, id);

    v.push(id, tenantId);
    const r = await this.pool.query<DocRow>(
      `UPDATE ai_knowledge_documents SET ${set.join(', ')}
        WHERE id = $${i} AND tenant_id = $${i + 1}
      RETURNING id, title, content, source, file_name, mime_type, size_bytes, enabled, sort_order, created_at, updated_at`,
      v,
    );
    const row = r.rows[0];
    if (!row) throw new NotFoundException('Knowledge document not found');
    return KnowledgeDocsService.map(row);
  }

  async remove(tenantId: string, id: string): Promise<{ ok: true }> {
    const r = await this.pool.query('DELETE FROM ai_knowledge_documents WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    if (!r.rowCount) throw new NotFoundException('Knowledge document not found');
    return { ok: true };
  }

  /**
   * The text block the AI actually reads: the tenant's free-text product
   * knowledge followed by every ENABLED document, in display order, capped at
   * {@link MAX_PROMPT_DOC_CHARS}. Returns the base unchanged when the tenant has
   * no documents, so nothing about the existing prompt changes until they upload
   * one.
   */
  async composeKnowledge(tenantId: string, base: string | null): Promise<string | null> {
    let rows: { title: string; content: string }[];
    try {
      const r = await this.pool.query<{ title: string; content: string }>(
        `SELECT title, content FROM ai_knowledge_documents
          WHERE tenant_id = $1 AND enabled = true AND content <> ''
          ORDER BY sort_order ASC, created_at ASC`,
        [tenantId],
      );
      rows = r.rows;
    } catch {
      // A knowledge document must never be the reason a customer gets no reply
      // (e.g. the API running ahead of migration 099).
      return base;
    }
    if (!rows.length) return base;

    const parts: string[] = [];
    let budget = MAX_PROMPT_DOC_CHARS;
    for (const d of rows) {
      if (budget <= 0) break;
      const body = d.content.length > budget ? `${d.content.slice(0, budget).trimEnd()}…` : d.content;
      budget -= body.length;
      parts.push(`### ${d.title}\n${body}`);
    }
    const docs = parts.join('\n\n');
    const head = base?.trim();
    return head ? `${head}\n\n${docs}` : docs;
  }

  /** Next free position, so a new document lands at the end of the list. */
  private async nextSortOrder(tenantId: string): Promise<number> {
    const r = await this.pool.query<{ next: number | null }>(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM ai_knowledge_documents WHERE tenant_id = $1',
      [tenantId],
    );
    return r.rows[0]?.next ?? 0;
  }
}
