import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { DATABASE_POOL } from '../auth/database.provider';

/**
 * A paired branch-bridge agent, as returned to the management UI.
 * The `pairingToken` is intentionally NOT part of this DTO — it is surfaced
 * exactly once at creation / rotation time and never echoed back on list.
 */
export interface BridgeDTO {
  id: string;
  tenantId: string;
  outletId: string;
  name: string | null;
  status: 'online' | 'offline';
  agentVersion: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Resolved bridge context from a pairing token — everything the socket layer
 * needs to scope an agent connection to exactly one tenant + outlet.
 */
export interface ResolvedBridge {
  bridgeId: string;
  tenantId: string;
  outletId: string;
}

/**
 * Number of random bytes for a pairing token. 24 bytes → 48 hex chars, which
 * fits the `pairing_token VARCHAR(64)` column with headroom.
 */
const PAIRING_TOKEN_BYTES = 24;

/**
 * BridgeService — pairing CRUD over `branch_bridges`.
 *
 * Mirrors the pos_devices / kiosk_devices opaque-token model: a Tenant_Owner
 * provisions one bridge per outlet, the row carries a unique random
 * `pairing_token`, and the agent authenticates its outbound socket with it.
 * Liveness (`status`, `last_seen_at`) is maintained by the {@link BridgeGateway}
 * as the agent connects / disconnects / heartbeats.
 *
 * All reads/writes are tenant-scoped from the caller's JWT — never from client
 * input — so an agent (or a compromised token) can never widen its scope.
 */
@Injectable()
export class BridgeService {
  private readonly logger = new Logger(BridgeService.name);

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * Provision a bridge for an outlet. Enforces "one bridge per outlet": if the
   * outlet already has a bridge, the call is rejected (the caller should rotate
   * the token or delete the existing one instead). Returns the created row plus
   * its freshly-generated pairing token (the only time it is exposed).
   */
  async createBridge(
    tenantId: string,
    outletId: string,
    name?: string | null,
  ): Promise<{ bridge: BridgeDTO; pairingToken: string }> {
    if (!outletId) throw new BadRequestException('outletId is required');

    // Verify the outlet belongs to this tenant before issuing a token for it.
    const outlet = await this.pool.query(
      `SELECT 1 FROM outlets WHERE id = $1 AND tenant_id = $2`,
      [outletId, tenantId],
    );
    if (outlet.rows.length === 0) throw new BadRequestException('Invalid outlet');

    const existing = await this.pool.query(
      `SELECT 1 FROM branch_bridges WHERE outlet_id = $1`,
      [outletId],
    );
    if (existing.rows.length > 0) {
      throw new ConflictException('A bridge already exists for this outlet');
    }

    const pairingToken = randomBytes(PAIRING_TOKEN_BYTES).toString('hex');
    const res = await this.pool.query(
      `INSERT INTO branch_bridges (tenant_id, outlet_id, name, pairing_token)
       VALUES ($1, $2, $3, $4)
       RETURNING ${BridgeService.COLUMNS}`,
      [tenantId, outletId, name ?? null, pairingToken],
    );

    this.logger.log(`Created bridge ${res.rows[0].id} for outlet ${outletId}`);
    return { bridge: this.map(res.rows[0]), pairingToken };
  }

  /** List all bridges for a tenant (newest first). Token is never included. */
  async listBridges(tenantId: string): Promise<BridgeDTO[]> {
    const res = await this.pool.query(
      `SELECT ${BridgeService.COLUMNS} FROM branch_bridges
       WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return res.rows.map((r) => this.map(r));
  }

  /** Fetch the bridge paired to a given outlet, or null if none exists. */
  async getByOutlet(tenantId: string, outletId: string): Promise<BridgeDTO | null> {
    const res = await this.pool.query(
      `SELECT ${BridgeService.COLUMNS} FROM branch_bridges
       WHERE tenant_id = $1 AND outlet_id = $2 LIMIT 1`,
      [tenantId, outletId],
    );
    return res.rows[0] ? this.map(res.rows[0]) : null;
  }

  /**
   * Resolve a pairing token to its bridge context. Called on every socket
   * handshake, so it is a single indexed lookup. Returns null when the token is
   * unknown (the gateway then disconnects the socket).
   */
  async resolveByToken(token: string): Promise<ResolvedBridge | null> {
    if (!token || typeof token !== 'string' || token.trim() === '') return null;
    const res = await this.pool.query<{
      id: string;
      tenant_id: string;
      outlet_id: string;
    }>(
      `SELECT id, tenant_id, outlet_id FROM branch_bridges
       WHERE pairing_token = $1 LIMIT 1`,
      [token.trim()],
    );
    const row = res.rows[0];
    if (!row) return null;
    return { bridgeId: row.id, tenantId: row.tenant_id, outletId: row.outlet_id };
  }

  /**
   * Update liveness for a bridge: set status, bump `last_seen_at`, and record
   * the reported agent version when provided. Best-effort — never throws on a
   * missing row (the socket may have out-raced a delete).
   */
  async setStatus(
    bridgeId: string,
    status: 'online' | 'offline',
    agentVersion?: string | null,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE branch_bridges
       SET status = $2,
           last_seen_at = NOW(),
           agent_version = COALESCE($3, agent_version),
           updated_at = NOW()
       WHERE id = $1`,
      [bridgeId, status, agentVersion ?? null],
    );
  }

  /** Bump `last_seen_at` (heartbeat) without changing status. */
  async touch(bridgeId: string, agentVersion?: string | null): Promise<void> {
    await this.pool.query(
      `UPDATE branch_bridges
       SET last_seen_at = NOW(),
           agent_version = COALESCE($2, agent_version),
           updated_at = NOW()
       WHERE id = $1`,
      [bridgeId, agentVersion ?? null],
    );
  }

  /**
   * Fetch a tenant-scoped bridge's install context (its current pairing token),
   * or null when the bridge does not belong to the tenant. Used by the installer
   * download endpoint to build the copy-paste fallback command — the owner can
   * already reveal this token via rotate, so exposing it here is not a widening.
   */
  async getInstallContext(
    tenantId: string,
    id: string,
  ): Promise<{ bridge: BridgeDTO; pairingToken: string } | null> {
    const res = await this.pool.query<any>(
      `SELECT ${BridgeService.COLUMNS}, pairing_token FROM branch_bridges
       WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return { bridge: this.map(row), pairingToken: row.pairing_token };
  }

  /** Rotate the pairing token, invalidating the old one. Returns the new token. */
  async rotateToken(tenantId: string, id: string): Promise<{ bridge: BridgeDTO; pairingToken: string }> {
    const pairingToken = randomBytes(PAIRING_TOKEN_BYTES).toString('hex');
    const res = await this.pool.query(
      `UPDATE branch_bridges
       SET pairing_token = $3, status = 'offline', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING ${BridgeService.COLUMNS}`,
      [id, tenantId, pairingToken],
    );
    if (res.rows.length === 0) throw new NotFoundException('Bridge not found');
    return { bridge: this.map(res.rows[0]), pairingToken };
  }

  /** Delete a bridge. Cameras keep their rows (bridge_id → NULL via FK). */
  async deleteBridge(tenantId: string, id: string): Promise<void> {
    const res = await this.pool.query(
      `DELETE FROM branch_bridges WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (res.rowCount === 0) throw new NotFoundException('Bridge not found');
  }

  // Column list shared across queries (token deliberately excluded from reads).
  private static readonly COLUMNS =
    'id, tenant_id, outlet_id, name, status, agent_version, last_seen_at, created_at, updated_at';

  private map = (r: any): BridgeDTO => ({
    id: r.id,
    tenantId: r.tenant_id,
    outletId: r.outlet_id,
    name: r.name ?? null,
    status: r.status,
    agentVersion: r.agent_version ?? null,
    lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : r.created_at,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : r.updated_at,
  });
}
