import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

export interface WaGateway {
  id: string;
  name: string;
  baseUrl: string;
  /** Never the key itself — only whether one is stored. */
  apiKeyConfigured: boolean;
  isActive: boolean;
  notes: string | null;
  /** Lines currently pointed at this gateway (tenant lines + branch lines). */
  linesAssigned: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWaGatewayDto {
  name: string;
  baseUrl: string;
  apiKey?: string | null;
  isActive?: boolean;
  notes?: string | null;
}

export type UpdateWaGatewayDto = Partial<CreateWaGatewayDto>;

/** One tenant's WhatsApp transport, as the super-admin needs to see it. */
export interface TenantWaTransport {
  tenantId: string;
  tenantName: string;
  gatewayId: string | null;
  gatewayName: string | null;
  wahaSession: string | null;
  waNumber: string | null;
  /** The URL this tenant's gateway must be configured to POST inbound to. */
  webhookPath: string | null;
}

interface GatewayRow {
  id: string;
  name: string;
  base_url: string;
  has_key: boolean;
  is_active: boolean;
  notes: string | null;
  lines_assigned: string;
  created_at: string;
  updated_at: string;
}

/**
 * Registry of WAHA gateways (migration 103) — PLATFORM-owned, super-admin only.
 *
 * Why a registry at all: the deployed WAHA image is tier CORE, which serves
 * exactly ONE session and it must be named 'default'. A session name therefore
 * cannot address a second tenant's line; that line lives on its own container,
 * so the backend has to know which container to talk to.
 *
 * Why it is not tenant-editable: `base_url` is a URL the backend fetches. Let a
 * tenant owner set it and they can point the backend at internal addresses
 * (other containers, cloud metadata) — server-side request forgery. Gateways
 * are infrastructure, so they are provisioned by whoever runs the infrastructure.
 */
@Injectable()
export class WaGatewayService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  private map(r: GatewayRow): WaGateway {
    return {
      id: r.id,
      name: r.name,
      baseUrl: r.base_url,
      apiKeyConfigured: r.has_key,
      isActive: r.is_active,
      notes: r.notes,
      linesAssigned: Number(r.lines_assigned ?? 0),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  /** Every registered gateway. The platform default (env WAHA_URL) is not a row. */
  async list(): Promise<WaGateway[]> {
    const r = await this.pool.query<GatewayRow>(
      `SELECT g.id, g.name, g.base_url, (g.api_key IS NOT NULL AND g.api_key <> '') AS has_key,
              g.is_active, g.notes, g.created_at, g.updated_at,
              (SELECT COUNT(*) FROM agent_configs a WHERE a.wa_gateway_id = g.id)
            + (SELECT COUNT(*) FROM outlet_agent_configs o WHERE o.wa_gateway_id = g.id) AS lines_assigned
         FROM wa_gateways g
        ORDER BY g.name ASC`,
    );
    return r.rows.map((row) => this.map(row));
  }

  /**
   * A base_url must be an absolute http(s) URL. Validated even though only a
   * super-admin can write it: a typo here silently takes a tenant's line down.
   */
  private normalizeUrl(raw: string | undefined | null): string {
    const url = (raw ?? '').trim().replace(/\/+$/, '');
    if (!url) throw new BadRequestException('baseUrl is required');
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('baseUrl must be an absolute URL, e.g. http://waha-acme:3000');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('baseUrl must be http or https');
    }
    return url;
  }

  async create(dto: CreateWaGatewayDto): Promise<WaGateway> {
    const name = (dto.name ?? '').trim();
    if (!name) throw new BadRequestException('name is required');
    const baseUrl = this.normalizeUrl(dto.baseUrl);
    const dup = await this.pool.query('SELECT 1 FROM wa_gateways WHERE name = $1', [name]);
    if ((dup.rowCount ?? 0) > 0) throw new ConflictException(`A gateway named "${name}" already exists`);

    const r = await this.pool.query<{ id: string }>(
      `INSERT INTO wa_gateways (name, base_url, api_key, is_active, notes)
       VALUES ($1,$2,$3,COALESCE($4,true),$5) RETURNING id`,
      [name, baseUrl, dto.apiKey?.trim() || null, dto.isActive ?? null, dto.notes ?? null],
    );
    const created = r.rows[0];
    if (!created) throw new BadRequestException('Gateway could not be created');
    return this.getOne(created.id);
  }

  async getOne(id: string): Promise<WaGateway> {
    const all = await this.list();
    const found = all.find((g) => g.id === id);
    if (!found) throw new NotFoundException('Gateway not found');
    return found;
  }

  /** Partial update. An omitted apiKey keeps the stored key; '' clears it. */
  async update(id: string, dto: UpdateWaGatewayDto): Promise<WaGateway> {
    await this.getOne(id);
    const set: string[] = [];
    const v: unknown[] = [];
    let i = 1;
    if (dto.name !== undefined) {
      const name = (dto.name ?? '').trim();
      if (!name) throw new BadRequestException('name cannot be empty');
      const dup = await this.pool.query('SELECT 1 FROM wa_gateways WHERE name = $1 AND id <> $2', [name, id]);
      if ((dup.rowCount ?? 0) > 0) throw new ConflictException(`A gateway named "${name}" already exists`);
      set.push(`name = $${i++}`); v.push(name);
    }
    if (dto.baseUrl !== undefined) { set.push(`base_url = $${i++}`); v.push(this.normalizeUrl(dto.baseUrl)); }
    if (dto.apiKey !== undefined) { set.push(`api_key = $${i++}`); v.push(dto.apiKey?.trim() || null); }
    if (dto.isActive !== undefined) { set.push(`is_active = $${i++}`); v.push(dto.isActive); }
    if (dto.notes !== undefined) { set.push(`notes = $${i++}`); v.push(dto.notes); }
    if (set.length) {
      v.push(id);
      await this.pool.query(`UPDATE wa_gateways SET ${set.join(', ')}, updated_at = NOW() WHERE id = $${i}`, v);
    }
    return this.getOne(id);
  }

  /**
   * Delete a gateway. Refused while lines still point at it — the FK is
   * ON DELETE SET NULL, so deleting a gateway in use would silently move those
   * lines onto the platform default gateway, which is the exact
   * one-tenant-borrows-another's-line failure this whole change removes.
   */
  async remove(id: string): Promise<{ ok: true }> {
    const gw = await this.getOne(id);
    if (gw.linesAssigned > 0) {
      throw new ConflictException(
        `${gw.linesAssigned} WhatsApp line(s) still use "${gw.name}". Reassign them before deleting it.`,
      );
    }
    await this.pool.query('DELETE FROM wa_gateways WHERE id = $1', [id]);
    return { ok: true };
  }

  /** Live reachability + session list, straight from the gateway. */
  async probe(id: string): Promise<{ reachable: boolean; tier?: string; version?: string; sessions?: { name: string; status: string }[]; error?: string }> {
    const r = await this.pool.query<{ base_url: string; api_key: string | null }>(
      'SELECT base_url, api_key FROM wa_gateways WHERE id = $1',
      [id],
    );
    const row = r.rows[0];
    if (!row) throw new NotFoundException('Gateway not found');
    const headers: Record<string, string> = {};
    if (row.api_key) headers['X-Api-Key'] = row.api_key;
    try {
      const [vRes, sRes] = await Promise.all([
        fetch(`${row.base_url}/api/server/version`, { headers }),
        fetch(`${row.base_url}/api/sessions`, { headers }),
      ]);
      if (!vRes.ok) return { reachable: false, error: `HTTP ${vRes.status} from /api/server/version` };
      const v = (await vRes.json()) as { version?: string; tier?: string };
      const sessions = sRes.ok
        ? ((await sRes.json()) as { name: string; status: string }[]).map((x) => ({ name: x.name, status: x.status }))
        : [];
      return { reachable: true, tier: v.tier, version: v.version, sessions };
    } catch (e) {
      return { reachable: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ── Per-tenant transport assignment ────────────────────────────────────────

  /** Which gateway each tenant's central line uses, plus its inbound webhook path. */
  async listTenantTransports(): Promise<TenantWaTransport[]> {
    const r = await this.pool.query<{
      tenant_id: string; tenant_name: string; gateway_id: string | null; gateway_name: string | null;
      waha_session: string | null; wa_number: string | null; wa_webhook_token: string | null;
    }>(
      `SELECT t.id AS tenant_id, t.name AS tenant_name,
              a.wa_gateway_id AS gateway_id, g.name AS gateway_name,
              a.waha_session, a.wa_number, a.wa_webhook_token
         FROM tenants t
         LEFT JOIN agent_configs a ON a.tenant_id = t.id
         LEFT JOIN wa_gateways g ON g.id = a.wa_gateway_id
        ORDER BY t.name ASC`,
    );
    return r.rows.map((row) => ({
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      gatewayId: row.gateway_id,
      gatewayName: row.gateway_name,
      wahaSession: row.waha_session,
      waNumber: row.wa_number,
      webhookPath: row.wa_webhook_token ? `/api/whatsapp/webhook/${row.wa_webhook_token}` : null,
    }));
  }

  /**
   * Point a tenant's central line at a gateway (null = the platform default).
   *
   * Moving a line to another gateway can collide: the session name it carries
   * may already be taken there. Checked here rather than left to the unique
   * index so the super-admin gets a real message instead of a 500.
   */
  async assignTenantGateway(tenantId: string, gatewayId: string | null): Promise<TenantWaTransport> {
    if (gatewayId) await this.getOne(gatewayId);
    const cur = await this.pool.query<{ waha_session: string | null }>(
      'SELECT waha_session FROM agent_configs WHERE tenant_id = $1',
      [tenantId],
    );
    const curRow = cur.rows[0];
    if (!curRow) throw new NotFoundException('This tenant has no agent config yet');
    const session = curRow.waha_session;
    if (session) {
      const SENTINEL = '00000000-0000-0000-0000-000000000000';
      const clash = await this.pool.query(
        `SELECT 1 FROM agent_configs
          WHERE waha_session = $1 AND COALESCE(wa_gateway_id, $2::uuid) = $3::uuid AND tenant_id <> $4
          UNION ALL
         SELECT 1 FROM outlet_agent_configs
          WHERE waha_session = $1 AND COALESCE(wa_gateway_id, $2::uuid) = $3::uuid`,
        [session, SENTINEL, gatewayId ?? SENTINEL, tenantId],
      );
      if ((clash.rowCount ?? 0) > 0) {
        throw new ConflictException(
          `Session "${session}" is already in use on that gateway. Rename this tenant's session first.`,
        );
      }
    }
    await this.pool.query(
      'UPDATE agent_configs SET wa_gateway_id = $2, updated_at = NOW() WHERE tenant_id = $1',
      [tenantId, gatewayId],
    );
    const all = await this.listTenantTransports();
    const found = all.find((x) => x.tenantId === tenantId);
    if (!found) throw new NotFoundException('Tenant not found');
    return found;
  }

  /**
   * Issue a fresh webhook token for a tenant's line. Also used to provision one
   * for a line created before migration 103 backfilled tokens. Rotating
   * INVALIDATES the old URL, so the gateway's WHATSAPP_HOOK_URL must be updated
   * to match or its inbound stops resolving.
   */
  async rotateTenantWebhookToken(tenantId: string): Promise<{ webhookPath: string }> {
    const token = randomBytes(24).toString('hex');
    const r = await this.pool.query(
      'UPDATE agent_configs SET wa_webhook_token = $2, updated_at = NOW() WHERE tenant_id = $1',
      [tenantId, token],
    );
    if (r.rowCount === 0) throw new NotFoundException('This tenant has no agent config yet');
    return { webhookPath: `/api/whatsapp/webhook/${token}` };
  }
}
