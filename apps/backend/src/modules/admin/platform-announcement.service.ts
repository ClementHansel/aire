import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

export type AnnouncementSeverity = 'info' | 'warning' | 'critical';
export type AnnouncementAudience = 'all' | 'plan' | 'tenant';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: AnnouncementSeverity;
  audience: AnnouncementAudience;
  target: string | null;
  published: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnnouncementDto {
  title: string;
  body: string;
  severity?: AnnouncementSeverity;
  audience?: AnnouncementAudience;
  target?: string | null;
  published?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
}

export interface SupportNote {
  id: string;
  tenantId: string;
  body: string;
  pinned: boolean;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
}

const SEVERITIES: AnnouncementSeverity[] = ['info', 'warning', 'critical'];
const AUDIENCES: AnnouncementAudience[] = ['all', 'plan', 'tenant'];

/**
 * Platform announcements (broadcast to tenants) and internal per-tenant support
 * notes (a lightweight support log the tenant never sees).
 */
@Injectable()
export class PlatformAnnouncementService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  // ── Announcements ───────────────────────────────────────────────────────────

  async list(): Promise<Announcement[]> {
    const r = await this.pool.query(`SELECT * FROM platform_announcements ORDER BY created_at DESC`);
    return r.rows.map((x: any) => this.mapAnnouncement(x));
  }

  async create(dto: CreateAnnouncementDto, createdBy: string): Promise<Announcement> {
    this.validate(dto);
    const r = await this.pool.query(
      `INSERT INTO platform_announcements (title, body, severity, audience, target, published, starts_at, ends_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        dto.title.trim(), dto.body.trim(), dto.severity ?? 'info', dto.audience ?? 'all',
        dto.audience && dto.audience !== 'all' ? (dto.target ?? null) : null,
        dto.published ?? false, dto.startsAt ?? null, dto.endsAt ?? null, createdBy,
      ],
    );
    return this.mapAnnouncement(r.rows[0]);
  }

  async update(id: string, dto: Partial<CreateAnnouncementDto>): Promise<Announcement> {
    const set: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    const push = (col: string, v: unknown) => { set.push(`${col} = $${i++}`); vals.push(v); };
    if (dto.title !== undefined) push('title', dto.title.trim());
    if (dto.body !== undefined) push('body', dto.body.trim());
    if (dto.severity !== undefined) { if (!SEVERITIES.includes(dto.severity)) throw new BadRequestException('Invalid severity'); push('severity', dto.severity); }
    if (dto.audience !== undefined) { if (!AUDIENCES.includes(dto.audience)) throw new BadRequestException('Invalid audience'); push('audience', dto.audience); }
    if (dto.target !== undefined) push('target', dto.target);
    if (dto.published !== undefined) push('published', dto.published);
    if (dto.startsAt !== undefined) push('starts_at', dto.startsAt);
    if (dto.endsAt !== undefined) push('ends_at', dto.endsAt);
    if (set.length === 0) throw new BadRequestException('Nothing to update');
    set.push('updated_at = NOW()');
    vals.push(id);
    const r = await this.pool.query(`UPDATE platform_announcements SET ${set.join(', ')} WHERE id = $${i} RETURNING *`, vals);
    if (r.rows.length === 0) throw new NotFoundException('Announcement not found');
    return this.mapAnnouncement(r.rows[0]);
  }

  async remove(id: string): Promise<void> {
    const r = await this.pool.query(`DELETE FROM platform_announcements WHERE id = $1`, [id]);
    if (r.rowCount === 0) throw new NotFoundException('Announcement not found');
  }

  /**
   * Published announcements relevant to one tenant, for the tenant-facing feed:
   * audience 'all', or 'tenant' matching this id, or 'plan' matching the tenant's
   * current plan. Respects the optional start/end window. Ordered by severity then
   * recency so criticals surface first.
   */
  async listForTenant(tenantId: string): Promise<Announcement[]> {
    if (!tenantId) return [];
    try {
      // `$1` is used once (as a uuid in the CTE) to avoid param-type ambiguity;
      // a missing tenant yields an empty CTE → no rows (safe).
      const r = await this.pool.query(
        `WITH me AS (SELECT id, plan FROM tenants WHERE id = $1)
         SELECT a.* FROM platform_announcements a, me
           WHERE a.published = true
             AND (a.starts_at IS NULL OR a.starts_at <= NOW())
             AND (a.ends_at IS NULL OR a.ends_at >= NOW())
             AND (
               a.audience = 'all'
               OR (a.audience = 'tenant' AND a.target = me.id::text)
               OR (a.audience = 'plan' AND a.target = me.plan)
             )
           ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, a.created_at DESC`,
        [tenantId],
      );
      return r.rows.map((x: any) => this.mapAnnouncement(x));
    } catch {
      // The dashboard feed must never fail the page (e.g. migration not yet applied).
      return [];
    }
  }

  // ── Support notes ───────────────────────────────────────────────────────────

  async listNotes(tenantId: string): Promise<SupportNote[]> {
    const r = await this.pool.query(
      `SELECT n.*, u.name AS author_name
         FROM platform_support_notes n LEFT JOIN users u ON u.id = n.author_id
         WHERE n.tenant_id = $1 ORDER BY n.pinned DESC, n.created_at DESC`,
      [tenantId],
    );
    return r.rows.map((x: any) => this.mapNote(x));
  }

  async addNote(tenantId: string, body: string, authorId: string, pinned = false): Promise<SupportNote> {
    if (!body || !body.trim()) throw new BadRequestException('Note body is required');
    const r = await this.pool.query(
      `INSERT INTO platform_support_notes (tenant_id, body, pinned, author_id)
         VALUES ($1,$2,$3,$4) RETURNING *, (SELECT name FROM users WHERE id = $4) AS author_name`,
      [tenantId, body.trim(), pinned, authorId],
    );
    return this.mapNote(r.rows[0]);
  }

  async removeNote(id: string): Promise<void> {
    const r = await this.pool.query(`DELETE FROM platform_support_notes WHERE id = $1`, [id]);
    if (r.rowCount === 0) throw new NotFoundException('Note not found');
  }

  private validate(dto: CreateAnnouncementDto): void {
    if (!dto.title || !dto.title.trim()) throw new BadRequestException('Title is required');
    if (!dto.body || !dto.body.trim()) throw new BadRequestException('Body is required');
    if (dto.severity && !SEVERITIES.includes(dto.severity)) throw new BadRequestException('Invalid severity');
    if (dto.audience && !AUDIENCES.includes(dto.audience)) throw new BadRequestException('Invalid audience');
    if (dto.audience && dto.audience !== 'all' && !dto.target) throw new BadRequestException('A target is required for plan/tenant audiences');
  }

  private mapAnnouncement(x: any): Announcement {
    return {
      id: x.id, title: x.title, body: x.body, severity: x.severity, audience: x.audience,
      target: x.target, published: x.published, startsAt: x.starts_at, endsAt: x.ends_at,
      createdAt: x.created_at, updatedAt: x.updated_at,
    };
  }

  private mapNote(x: any): SupportNote {
    return { id: x.id, tenantId: x.tenant_id, body: x.body, pinned: x.pinned, authorId: x.author_id, authorName: x.author_name, createdAt: x.created_at };
  }
}
