import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

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
}

const DEFAULTS: AgentConfigResponse = {
  basePrompt: null, productKnowledge: null, skills: null, escalationNumber: null,
  maxMessagesPerDay: 50, waProvider: 'waha', waNumber: null, wahaSession: null,
  kapsoConfigured: false, aiReplyEnabled: true,
};

/**
 * Per-tenant Agentic AI configuration. The Kapso API key is stored but never
 * returned (only a `kapsoConfigured` flag is exposed).
 */
@Injectable()
export class AgentConfigService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async get(tenantId: string): Promise<AgentConfigResponse> {
    const res = await this.pool.query('SELECT * FROM agent_configs WHERE tenant_id = $1', [tenantId]);
    const r = res.rows[0];
    if (!r) return DEFAULTS;
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
    };
  }

  async update(tenantId: string, dto: UpdateAgentConfigDto): Promise<AgentConfigResponse> {
    // Upsert. Kapso key only overwritten when a non-empty value is supplied.
    await this.pool.query(
      `INSERT INTO agent_configs (tenant_id, base_prompt, product_knowledge, skills, escalation_number,
         max_messages_per_day, wa_provider, wa_number, waha_session, kapso_api_key, ai_reply_enabled, updated_at)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,50),COALESCE($7,'waha'),$8,$9,$10,COALESCE($11,true),NOW())
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
         updated_at = NOW()`,
      [
        tenantId, dto.basePrompt ?? null, dto.productKnowledge ?? null, dto.skills ?? null, dto.escalationNumber ?? null,
        dto.maxMessagesPerDay ?? null, dto.waProvider ?? null, dto.waNumber ?? null, dto.wahaSession ?? null,
        dto.kapsoApiKey ?? null, dto.aiReplyEnabled ?? null,
      ],
    );
    return this.get(tenantId);
  }
}
