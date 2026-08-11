import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { normalizePhone } from '@aire/shared';
import { DATABASE_POOL } from '../auth/database.provider';

export type WhitelistAccessLevel = 'full' | 'read_only';

export interface WhitelistEntry {
  id: string;
  phone: string;
  label: string;
  accessLevel: WhitelistAccessLevel;
  notes: string | null;
  isActive: boolean;
  userId: string | null;
  /** Present only on the list query, which joins the linked user. */
  userName?: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WhitelistInput {
  phone?: string;
  label?: string;
  accessLevel?: WhitelistAccessLevel;
  notes?: string | null;
  isActive?: boolean;
  userId?: string | null;
}

/**
 * WaWhitelistService — the numbers that reach the FULL business agent on WhatsApp.
 *
 * By default an inbound WhatsApp message is handled by the customer-facing agent:
 * customer-scoped tools, a CS persona, no access to business-wide data. A number
 * on this list is treated as STAFF instead — the message runs the same tool-loop
 * the dashboard assistant runs, so an owner can ask "revenue today?" or "how many
 * cars in the queue?" from their phone and act on the answer.
 *
 * That makes each row a grant of real power, so:
 *  - `access_level` distinguishes 'full' (may call action tools, still subject to
 *    the tenant's approval mode) from 'read_only' (the eyes, not the hands);
 *  - `is_active` lets an owner revoke access without losing the record of who had it;
 *  - numbers are stored as BARE INTERNATIONAL DIGITS so the inbound lookup is an
 *    exact indexed match and '0812…', '+62812…' and '62812…@c.us' can't create
 *    three different identities for one phone.
 */
@Injectable()
export class WaWhitelistService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async list(tenantId: string): Promise<WhitelistEntry[]> {
    const res = await this.pool.query(
      `SELECT w.*, u.name AS user_name FROM wa_whitelist_numbers w
         LEFT JOIN users u ON u.id = w.user_id
        WHERE w.tenant_id = $1
        ORDER BY w.is_active DESC, w.label ASC`,
      [tenantId],
    );
    return res.rows.map(mapRow);
  }

  async create(tenantId: string, input: WhitelistInput, createdBy: string | null): Promise<WhitelistEntry> {
    const phone = this.normalize(input.phone);
    const label = (input.label ?? '').trim();
    if (!label) throw new BadRequestException('label is required (who this number belongs to)');
    const accessLevel = this.accessLevel(input.accessLevel);

    const dupe = await this.pool.query(`SELECT 1 FROM wa_whitelist_numbers WHERE tenant_id = $1 AND phone = $2`, [
      tenantId,
      phone,
    ]);
    if ((dupe.rowCount ?? 0) > 0) {
      throw new BadRequestException('That number is already on the whitelist');
    }

    const res = await this.pool.query(
      `INSERT INTO wa_whitelist_numbers
         (tenant_id, phone, label, access_level, notes, is_active, user_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        tenantId,
        phone,
        label,
        accessLevel,
        input.notes?.trim() || null,
        input.isActive ?? true,
        input.userId || null,
        createdBy,
      ],
    );
    return mapRow(res.rows[0]);
  }

  /** Partial update — only the fields present in `input` are written. */
  async update(tenantId: string, id: string, input: WhitelistInput): Promise<WhitelistEntry> {
    const sets: string[] = [];
    const vals: unknown[] = [id, tenantId];
    const push = (col: string, val: unknown) => {
      vals.push(val);
      sets.push(`${col} = $${vals.length}`);
    };

    if (input.phone !== undefined) {
      const phone = this.normalize(input.phone);
      const dupe = await this.pool.query(
        `SELECT 1 FROM wa_whitelist_numbers WHERE tenant_id = $1 AND phone = $2 AND id <> $3`,
        [tenantId, phone, id],
      );
      if ((dupe.rowCount ?? 0) > 0) throw new BadRequestException('That number is already on the whitelist');
      push('phone', phone);
    }
    if (input.label !== undefined) {
      const label = input.label.trim();
      if (!label) throw new BadRequestException('label cannot be empty');
      push('label', label);
    }
    if (input.accessLevel !== undefined) push('access_level', this.accessLevel(input.accessLevel));
    if (input.notes !== undefined) push('notes', input.notes?.trim() || null);
    if (input.isActive !== undefined) push('is_active', !!input.isActive);
    if (input.userId !== undefined) push('user_id', input.userId || null);

    if (sets.length === 0) {
      const cur = await this.pool.query(`SELECT * FROM wa_whitelist_numbers WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
      if (cur.rowCount === 0) throw new NotFoundException('Whitelist entry not found');
      return mapRow(cur.rows[0]);
    }

    const res = await this.pool.query(
      `UPDATE wa_whitelist_numbers SET ${sets.join(', ')} WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      vals,
    );
    if (res.rowCount === 0) throw new NotFoundException('Whitelist entry not found');
    return mapRow(res.rows[0]);
  }

  async remove(tenantId: string, id: string): Promise<{ deleted: true }> {
    const res = await this.pool.query(`DELETE FROM wa_whitelist_numbers WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (res.rowCount === 0) throw new NotFoundException('Whitelist entry not found');
    return { deleted: true };
  }

  // ─── Inbound lookup ───────────────────────────────────────────────────────

  /**
   * Resolve an inbound WhatsApp address to an ACTIVE whitelist entry, or null.
   *
   * Accepts anything the gateways hand us ('628…@c.us', '+62 812…', '0812…') and
   * matches on the normalized digits.
   */
  async match(tenantId: string, address: string): Promise<WhitelistEntry | null> {
    const phone = this.tryNormalize(address);
    if (!phone) return null;
    const res = await this.pool.query(
      `SELECT * FROM wa_whitelist_numbers
        WHERE tenant_id = $1 AND phone = $2 AND is_active = true LIMIT 1`,
      [tenantId, phone],
    );
    return res.rowCount === 0 ? null : mapRow(res.rows[0]);
  }

  /** Stamp usage so an owner can see which granted numbers are actually in use. */
  async markUsed(id: string): Promise<void> {
    await this.pool.query(`UPDATE wa_whitelist_numbers SET last_used_at = NOW() WHERE id = $1`, [id]);
  }

  // ─── Normalization ────────────────────────────────────────────────────────

  /** Strict: throws a clear 400 when the input isn't a usable phone number. */
  private normalize(input?: string): string {
    const phone = this.tryNormalize(input ?? '');
    if (!phone) throw new BadRequestException('Enter a valid WhatsApp number, e.g. 0812xxxxxxx or +62812xxxxxxx');
    return phone;
  }

  /**
   * Lenient: bare international digits, or null.
   *
   * `normalizePhone` is Indonesia-shaped (it only accepts a leading 0 or 62), which
   * is right for customer data but would lock a foreign staff number out of its own
   * whitelist. So we fall back to plain digits when the number is long enough to be
   * a real international one.
   */
  private tryNormalize(input: string): string | null {
    const bare = (input ?? '').replace(/@.*$/, '');
    const { normalized, valid } = normalizePhone(bare);
    if (valid) return normalized;
    const digits = bare.replace(/\D/g, '');
    return digits.length >= 8 ? digits : null;
  }

  private accessLevel(v?: WhitelistAccessLevel): WhitelistAccessLevel {
    if (v === undefined) return 'full';
    if (v !== 'full' && v !== 'read_only') throw new BadRequestException("accessLevel must be 'full' or 'read_only'");
    return v;
  }
}

function mapRow(r: Record<string, any>): WhitelistEntry {
  return {
    id: r.id,
    phone: r.phone,
    label: r.label,
    accessLevel: r.access_level,
    notes: r.notes ?? null,
    isActive: r.is_active,
    userId: r.user_id ?? null,
    ...(r.user_name !== undefined ? { userName: r.user_name ?? null } : {}),
    lastUsedAt: r.last_used_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
