import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { SettingsService } from '../settings/settings.service';

export interface AgentConfigResponse {
  basePrompt: string | null;
  productKnowledge: string | null;
  skills: string | null;
  escalationNumber: string | null;
  maxMessagesPerDay: number;
  waProvider: 'waha' | 'kapso';
  waNumber: string | null;
  wahaSession: string | null;
  kapsoConfigured: boolean;
  aiReplyEnabled: boolean;
  /** When true, each branch runs its own WhatsApp line (see BranchWaConfig). */
  perBranchWaEnabled: boolean;
  /** Per-tenant WhatsApp simulation mode (outbound captured, no real gateway). */
  wahaMockEnabled: boolean;
  // ── LLM model settings (mirrored from tenants.settings; the raw key is never
  //    returned, only whether one is configured) ──
  aiEnabled: boolean;
  llmProvider: 'openrouter' | 'hermes_ai';
  llmKeyConfigured: boolean;
}

export interface UpdateAgentConfigDto {
  basePrompt?: string | null;
  productKnowledge?: string | null;
  skills?: string | null;
  escalationNumber?: string | null;
  maxMessagesPerDay?: number;
  waProvider?: 'waha' | 'kapso';
  waNumber?: string | null;
  wahaSession?: string | null;
  kapsoApiKey?: string | null; // plaintext; stored and masked on read
  aiReplyEnabled?: boolean;
  perBranchWaEnabled?: boolean;
  wahaMockEnabled?: boolean;
  // ── LLM model settings (written through to tenants.settings) ──
  aiEnabled?: boolean;
  llmProvider?: 'openrouter' | 'hermes_ai';
  llmApiKey?: string; // plaintext; encrypted at rest, never returned. '' = keep existing.
}

const DEFAULTS: Omit<AgentConfigResponse, 'aiEnabled' | 'llmProvider' | 'llmKeyConfigured'> = {
  basePrompt: null, productKnowledge: null, skills: null, escalationNumber: null,
  maxMessagesPerDay: 50, waProvider: 'waha', waNumber: null, wahaSession: null,
  kapsoConfigured: false, aiReplyEnabled: true, perBranchWaEnabled: false, wahaMockEnabled: false,
};

/** A branch's own WhatsApp connection (never returns the raw Kapso key). */
export interface BranchWaConfig {
  outletId: string;
  name: string;
  waProvider: 'waha' | 'kapso';
  waNumber: string | null;
  wahaSession: string | null;
  kapsoConfigured: boolean;
  configured: boolean; // true once this branch has any connection set
}

export interface UpdateBranchWaConfigDto {
  waProvider?: 'waha' | 'kapso';
  waNumber?: string | null;
  wahaSession?: string | null;
  kapsoApiKey?: string | null; // '' or omitted = keep existing
}

/**
 * Per-tenant Agentic AI configuration. The Kapso API key is stored but never
 * returned (only a `kapsoConfigured` flag is exposed). LLM model settings live
 * in tenants.settings and are surfaced/updated here so the whole agent setup —
 * WhatsApp connection, persona, AND the model key — sits on one page.
 */
@Injectable()
export class AgentConfigService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly settings: SettingsService,
  ) {}

  /** Read the LLM model fields from tenants.settings (never returns the raw key). */
  private async llmView(tenantId: string): Promise<Pick<AgentConfigResponse, 'aiEnabled' | 'llmProvider' | 'llmKeyConfigured'>> {
    try {
      const s = await this.settings.getSettings(tenantId);
      return {
        aiEnabled: s.ai_enabled,
        llmProvider: s.llm_provider,
        llmKeyConfigured: !!(s.llm_api_key_encrypted && s.llm_api_key_encrypted.trim() !== ''),
      };
    } catch {
      return { aiEnabled: false, llmProvider: 'openrouter', llmKeyConfigured: false };
    }
  }

  async get(tenantId: string): Promise<AgentConfigResponse> {
    const [res, llm] = await Promise.all([
      this.pool.query('SELECT * FROM agent_configs WHERE tenant_id = $1', [tenantId]),
      this.llmView(tenantId),
    ]);
    const r = res.rows[0];
    if (!r) return { ...DEFAULTS, ...llm };
    return {
      basePrompt: r.base_prompt ?? null,
      productKnowledge: r.product_knowledge ?? null,
      skills: r.skills ?? null,
      escalationNumber: r.escalation_number ?? null,
      maxMessagesPerDay: r.max_messages_per_day ?? 50,
      waProvider: r.wa_provider ?? 'waha',
      waNumber: r.wa_number ?? null,
      wahaSession: r.waha_session ?? null,
      kapsoConfigured: !!r.kapso_api_key,
      aiReplyEnabled: r.ai_reply_enabled ?? true,
      perBranchWaEnabled: r.per_branch_wa_enabled ?? false,
      wahaMockEnabled: r.waha_mock ?? false,
      ...llm,
    };
  }

  /**
   * Update the agent config. `userId` is required so LLM-settings changes can be
   * written through SettingsService (which audit-logs them). LLM fields are only
   * touched when at least one is present in the DTO.
   */
  async update(tenantId: string, dto: UpdateAgentConfigDto, userId: string): Promise<AgentConfigResponse> {
    if (dto.aiEnabled !== undefined || dto.llmProvider !== undefined || (dto.llmApiKey !== undefined && dto.llmApiKey !== '')) {
      const patch: Record<string, unknown> = {};
      if (dto.aiEnabled !== undefined) patch.ai_enabled = dto.aiEnabled;
      if (dto.llmProvider !== undefined) patch.llm_provider = dto.llmProvider;
      // Only overwrite the key when a non-empty value is supplied ('' = keep existing).
      if (dto.llmApiKey) patch.llm_api_key_encrypted = dto.llmApiKey;
      await this.settings.updateSettings(tenantId, userId, patch);
    }
    return this.updateAgentRow(tenantId, dto);
  }

  private async updateAgentRow(tenantId: string, dto: UpdateAgentConfigDto): Promise<AgentConfigResponse> {
    // Upsert. Kapso key only overwritten when a non-empty value is supplied.
    await this.pool.query(
      `INSERT INTO agent_configs (tenant_id, base_prompt, product_knowledge, skills, escalation_number,
         max_messages_per_day, wa_provider, wa_number, waha_session, kapso_api_key, ai_reply_enabled, per_branch_wa_enabled, waha_mock, updated_at)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,50),COALESCE($7,'waha'),$8,$9,$10,COALESCE($11,true),COALESCE($12,false),COALESCE($13,false),NOW())
       ON CONFLICT (tenant_id) DO UPDATE SET
         base_prompt = COALESCE($2, agent_configs.base_prompt),
         product_knowledge = COALESCE($3, agent_configs.product_knowledge),
         skills = COALESCE($4, agent_configs.skills),
         escalation_number = COALESCE($5, agent_configs.escalation_number),
         max_messages_per_day = COALESCE($6, agent_configs.max_messages_per_day),
         wa_provider = COALESCE($7, agent_configs.wa_provider),
         wa_number = COALESCE($8, agent_configs.wa_number),
         waha_session = COALESCE($9, agent_configs.waha_session),
         kapso_api_key = COALESCE(NULLIF($10, ''), agent_configs.kapso_api_key),
         ai_reply_enabled = COALESCE($11, agent_configs.ai_reply_enabled),
         per_branch_wa_enabled = COALESCE($12, agent_configs.per_branch_wa_enabled),
         waha_mock = COALESCE($13, agent_configs.waha_mock),
         updated_at = NOW()`,
      [
        tenantId, dto.basePrompt ?? null, dto.productKnowledge ?? null, dto.skills ?? null, dto.escalationNumber ?? null,
        dto.maxMessagesPerDay ?? null, dto.waProvider ?? null, dto.waNumber ?? null, dto.wahaSession ?? null,
        dto.kapsoApiKey ?? null, dto.aiReplyEnabled ?? null, dto.perBranchWaEnabled ?? null, dto.wahaMockEnabled ?? null,
      ],
    );
    return this.get(tenantId);
  }

  // ── Per-branch WhatsApp lines (outlet_agent_configs) ─────────────────────────

  /** List every active branch with its WhatsApp connection status (key masked). */
  async listBranchConfigs(tenantId: string): Promise<BranchWaConfig[]> {
    const r = await this.pool.query(
      `SELECT o.id AS outlet_id, o.name,
              b.wa_provider, b.wa_number, b.waha_session, b.kapso_api_key
       FROM outlets o
       LEFT JOIN outlet_agent_configs b ON b.outlet_id = o.id
       WHERE o.tenant_id = $1 AND o.is_active = true
       ORDER BY o.name ASC`,
      [tenantId],
    );
    return r.rows.map((row) => ({
      outletId: row.outlet_id,
      name: row.name,
      waProvider: (row.wa_provider ?? 'waha') as 'waha' | 'kapso',
      waNumber: row.wa_number ?? null,
      wahaSession: row.waha_session ?? null,
      kapsoConfigured: !!row.kapso_api_key,
      configured: !!(row.wa_number || row.waha_session || row.kapso_api_key),
    }));
  }

  /**
   * Upsert a branch's WhatsApp connection. Validates the outlet belongs to the
   * tenant and that the WAHA session isn't already claimed by the tenant line or
   * another branch (sessions are the inbound discriminator, so they must be
   * globally unique). Kapso key is only overwritten when a non-empty value is given.
   */
  async updateBranchConfig(tenantId: string, outletId: string, dto: UpdateBranchWaConfigDto): Promise<BranchWaConfig> {
    const own = await this.pool.query('SELECT id FROM outlets WHERE id = $1 AND tenant_id = $2', [outletId, tenantId]);
    if (own.rowCount === 0) throw new NotFoundException('Branch not found for this tenant');

    const session = dto.wahaSession?.trim() || null;
    if (session) {
      const clashTenant = await this.pool.query('SELECT 1 FROM agent_configs WHERE waha_session = $1', [session]);
      const clashBranch = await this.pool.query(
        'SELECT 1 FROM outlet_agent_configs WHERE waha_session = $1 AND outlet_id <> $2',
        [session, outletId],
      );
      if ((clashTenant.rowCount ?? 0) > 0 || (clashBranch.rowCount ?? 0) > 0) {
        throw new ConflictException(`WAHA session "${session}" is already in use`);
      }
    }

    await this.pool.query(
      `INSERT INTO outlet_agent_configs (outlet_id, tenant_id, wa_provider, wa_number, waha_session, kapso_api_key, updated_at)
       VALUES ($1,$2,COALESCE($3,'waha'),$4,$5,$6,NOW())
       ON CONFLICT (outlet_id) DO UPDATE SET
         wa_provider = COALESCE($3, outlet_agent_configs.wa_provider),
         wa_number = $4,
         waha_session = $5,
         kapso_api_key = COALESCE(NULLIF($6, ''), outlet_agent_configs.kapso_api_key),
         updated_at = NOW()`,
      [outletId, tenantId, dto.waProvider ?? null, dto.waNumber ?? null, session, dto.kapsoApiKey ?? null],
    );
    const list = await this.listBranchConfigs(tenantId);
    const found = list.find((b) => b.outletId === outletId);
    if (!found) throw new NotFoundException('Branch not found for this tenant');
    return found;
  }

  /** Remove a branch's WhatsApp line (falls back to "not connected" for that branch). */
  async deleteBranchConfig(tenantId: string, outletId: string): Promise<{ ok: true }> {
    await this.pool.query('DELETE FROM outlet_agent_configs WHERE outlet_id = $1 AND tenant_id = $2', [outletId, tenantId]);
    return { ok: true };
  }
}
