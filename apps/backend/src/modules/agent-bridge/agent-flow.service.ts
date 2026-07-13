import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { randomBytes } from 'crypto';
import { DATABASE_POOL } from '../auth/database.provider';

export type FlowKind = 'whatsapp' | 'automation';
export type RoutingMode = 'builtin' | 'n8n';

export interface AgentFlow {
  id: string;
  label: string;
  description: string | null;
  kind: FlowKind;
  webhookUrl: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentFlowDto {
  label: string;
  description?: string | null;
  kind?: FlowKind;
  webhookUrl: string;
  enabled?: boolean;
}

export interface UpdateAgentFlowDto {
  label?: string;
  description?: string | null;
  kind?: FlowKind;
  webhookUrl?: string;
  enabled?: boolean;
}

/** What a tenant sees/sets about their own flow routing (no secrets leaked raw). */
export interface TenantFlowSelection {
  routingMode: RoutingMode;
  whatsappFlowId: string | null;
  automationFlowId: string | null;
  bridgeConfigured: boolean;
}

export interface UpdateTenantFlowSelectionDto {
  routingMode?: RoutingMode;
  whatsappFlowId?: string | null;
  automationFlowId?: string | null;
}

/** Persona + knowledge snapshot injected into an n8n flow so ONE template
 *  workflow behaves per-tenant. This is the tenant's customization layer. */
export interface PersonaSnapshot {
  agents: { name: string; role: string; prompt: string | null }[];
  basePrompt: string | null;
  productKnowledge: string | null;
  skills: string | null;
  escalationNumber: string | null;
}

const rowToFlow = (r: Record<string, any>): AgentFlow => ({
  id: r.id,
  label: r.label,
  description: r.description ?? null,
  kind: r.kind,
  webhookUrl: r.webhook_url,
  enabled: r.enabled,
  createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
});

/**
 * AgentFlowService — owns the n8n flow CATALOG (platform admin) and each
 * tenant's SELECTION of a flow + their bridge token.
 */
@Injectable()
export class AgentFlowService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  // ── Catalog (platform super-admin) ─────────────────────────────────────────
  async listFlows(kind?: FlowKind): Promise<AgentFlow[]> {
    const res = kind
      ? await this.pool.query(`SELECT * FROM agent_flows WHERE kind = $1 ORDER BY created_at DESC`, [kind])
      : await this.pool.query(`SELECT * FROM agent_flows ORDER BY created_at DESC`);
    return res.rows.map(rowToFlow);
  }

  async createFlow(dto: CreateAgentFlowDto): Promise<AgentFlow> {
    if (!dto.label?.trim() || !dto.webhookUrl?.trim()) {
      throw new BadRequestException('label and webhookUrl are required');
    }
    const res = await this.pool.query(
      `INSERT INTO agent_flows (label, description, kind, webhook_url, enabled)
       VALUES ($1, $2, COALESCE($3,'whatsapp'), $4, COALESCE($5, true)) RETURNING *`,
      [dto.label.trim(), dto.description ?? null, dto.kind ?? null, dto.webhookUrl.trim(), dto.enabled ?? null],
    );
    return rowToFlow(res.rows[0]);
  }

  async updateFlow(id: string, dto: UpdateAgentFlowDto): Promise<AgentFlow> {
    const res = await this.pool.query(
      `UPDATE agent_flows SET
         label = COALESCE($2, label),
         description = COALESCE($3, description),
         kind = COALESCE($4, kind),
         webhook_url = COALESCE($5, webhook_url),
         enabled = COALESCE($6, enabled),
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, dto.label ?? null, dto.description ?? null, dto.kind ?? null, dto.webhookUrl ?? null, dto.enabled ?? null],
    );
    if (!res.rows[0]) throw new NotFoundException('Flow not found');
    return rowToFlow(res.rows[0]);
  }

  async deleteFlow(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM agent_flows WHERE id = $1`, [id]);
  }

  /** Enabled flows a tenant may choose from (no internal fields hidden — webhook
   *  URL is not secret, the bridge token is what authorizes callbacks). */
  async availableFlows(kind?: FlowKind): Promise<AgentFlow[]> {
    const res = kind
      ? await this.pool.query(`SELECT * FROM agent_flows WHERE enabled = true AND kind = $1 ORDER BY label`, [kind])
      : await this.pool.query(`SELECT * FROM agent_flows WHERE enabled = true ORDER BY kind, label`);
    return res.rows.map(rowToFlow);
  }

  async getFlow(id: string): Promise<AgentFlow | null> {
    const res = await this.pool.query(`SELECT * FROM agent_flows WHERE id = $1`, [id]);
    return res.rows[0] ? rowToFlow(res.rows[0]) : null;
  }

  // ── Tenant selection ───────────────────────────────────────────────────────
  async getSelection(tenantId: string): Promise<TenantFlowSelection> {
    const res = await this.pool.query(
      `SELECT routing_mode, n8n_flow_id, n8n_automation_flow_id, bridge_token
         FROM agent_configs WHERE tenant_id = $1`,
      [tenantId],
    );
    const r = res.rows[0];
    return {
      routingMode: (r?.routing_mode as RoutingMode) ?? 'builtin',
      whatsappFlowId: r?.n8n_flow_id ?? null,
      automationFlowId: r?.n8n_automation_flow_id ?? null,
      bridgeConfigured: !!r?.bridge_token,
    };
  }

  async updateSelection(tenantId: string, dto: UpdateTenantFlowSelectionDto): Promise<TenantFlowSelection> {
    // Ensure a config row exists (tenant may not have opened Agentic AI yet).
    await this.pool.query(
      `INSERT INTO agent_configs (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId],
    );
    await this.pool.query(
      `UPDATE agent_configs SET
         routing_mode = COALESCE($2, routing_mode),
         n8n_flow_id = $3,
         n8n_automation_flow_id = $4,
         updated_at = NOW()
       WHERE tenant_id = $1`,
      [tenantId, dto.routingMode ?? null, dto.whatsappFlowId ?? null, dto.automationFlowId ?? null],
    );
    return this.getSelection(tenantId);
  }

  /** Generate (or rotate) the tenant's bridge token. Returned ONCE in plaintext
   *  so the admin can paste it into the n8n credential. */
  async regenerateBridgeToken(tenantId: string): Promise<{ token: string }> {
    const token = randomBytes(24).toString('hex');
    await this.pool.query(
      `INSERT INTO agent_configs (tenant_id, bridge_token) VALUES ($1, $2)
       ON CONFLICT (tenant_id) DO UPDATE SET bridge_token = $2, updated_at = NOW()`,
      [tenantId, token],
    );
    return { token };
  }

  /** Persona snapshot for n8n: the tenant's named agents + prompt/knowledge. */
  async getPersona(tenantId: string): Promise<PersonaSnapshot> {
    const [cfg, agents] = await Promise.all([
      this.pool.query(
        `SELECT base_prompt, product_knowledge, skills, escalation_number
           FROM agent_configs WHERE tenant_id = $1`,
        [tenantId],
      ),
      this.pool.query(
        `SELECT name, role, prompt FROM agents
           WHERE tenant_id = $1 AND is_active = true ORDER BY position, created_at`,
        [tenantId],
      ),
    ]);
    const c = cfg.rows[0] ?? {};
    return {
      agents: agents.rows.map((a: any) => ({ name: a.name, role: a.role, prompt: a.prompt ?? null })),
      basePrompt: c.base_prompt ?? null,
      productKnowledge: c.product_knowledge ?? null,
      skills: c.skills ?? null,
      escalationNumber: c.escalation_number ?? null,
    };
  }
}
