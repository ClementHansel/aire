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

/**
 * Tenant-writable fields. The AI "brain" (base prompt, product knowledge,
 * skills, daily message cap, LLM provider/model/key, AI on/off) is now owned
 * exclusively by the super-admin — see {@link AdminBrainUpdateDto} and
 * `AdminController`'s `/tenants/:id/ai-config` endpoints. Tenants keep only the
 * WhatsApp connection and the AI auto-reply pause switch.
 */
export interface UpdateAgentConfigDto {
  escalationNumber?: string | null;
  waProvider?: 'waha' | 'kapso';
  waNumber?: string | null;
  wahaSession?: string | null;
  kapsoApiKey?: string | null; // plaintext; stored and masked on read
  aiReplyEnabled?: boolean;
  perBranchWaEnabled?: boolean;
  wahaMockEnabled?: boolean;
}

/** Super-admin-only write of the AI "brain" fields into agent_configs. */
export interface AdminBrainUpdateDto {
  basePrompt?: string | null;
  productKnowledge?: string | null;
  skills?: string | null;
  maxMessagesPerDay?: number;
}

// ── Tenant-managed AI knowledge (product knowledge + what the customer AI shares) ──
export const CUSTOMER_KNOWLEDGE_CATEGORIES = [
  'service_prices', 'promotions', 'membership_plans', 'vouchers', 'branches', 'opening_hours', 'branch_contact',
] as const;
export type CustomerKnowledgeCategory = typeof CUSTOMER_KNOWLEDGE_CATEGORIES[number];

export interface KnowledgeItem { id: string; name: string; customerVisible: boolean; }
export interface KnowledgeOutlet { id: string; name: string; phone: string | null; mapsUrl: string | null; customerVisible: boolean; }
export interface KnowledgeResponse {
  productKnowledge: string | null;
  skills: string | null;
  /** Per-category visibility flags for the customer AI (see CUSTOMER_KNOWLEDGE_CATEGORIES). */
  categories: Record<string, boolean>;
  /** Per-item visibility (overrides within an enabled category). */
  items: { services: KnowledgeItem[]; promotions: KnowledgeItem[]; plans: KnowledgeItem[]; outlets: KnowledgeOutlet[] };
}
export interface KnowledgeUpdateDto {
  productKnowledge?: string | null;
  skills?: string | null;
  categories?: Record<string, boolean>;
  itemVisibility?: { type: 'service' | 'promotion' | 'plan' | 'outlet'; id: string; visible: boolean }[];
  outletContacts?: { id: string; phone?: string | null; mapsUrl?: string | null }[];
}

// Bahasa Indonesia defaults — kept identical to migration 074_agent_default_prompts.sql
// (column DEFAULTs + backfill) so a tenant with no agent_configs row still shows/serves
// the same working, grounded assistant the DB defaults to.
const DEFAULT_BASE_PROMPT =
  'Kamu adalah Irene, customer service (CS) dari Aire — usaha cuci mobil & detailing (AIRE car wash, LEAD detailing). '
  + 'Kamu seorang cewek yang ramah, hangat, dan asik diajak ngobrol. '
  + 'Di awal percakapan, sapa dan perkenalkan dirimu dengan hangat, misalnya: "Halo kak! 😊 Aku Irene, CS-nya Aire. Ada yang bisa Irene bantu?". '
  + 'Balas pakai gaya chat WhatsApp yang santai, ramah, dan natural — boleh panggil pelanggan "kak", pakai emoji secukupnya, dan jangan kaku atau terlalu formal. '
  + 'Tetap singkat dan jelas, dalam Bahasa Indonesia. Format uang sebagai Rp. '
  + 'Kamu bisa membantu: memberi lokasi & jam buka cabang, daftar harga layanan, info & paket membership, sisa voucher beserta kodenya, '
  + 'tanggal berakhir membership, serta membantu membuat janji/booking. '
  + 'PENTING: JANGAN pernah mengarang harga, promo, jam buka, atau data pelanggan — ambil semua informasi HANYA dari tools yang tersedia. '
  + 'Kalau kamu tidak yakin, tidak punya tool yang sesuai, pelanggan kesal, atau minta ngobrol sama orang/CS manusia, gunakan tool escalate_to_human.';

const DEFAULT_SKILLS =
  'Playbook (ikuti sesuai kebutuhan pelanggan):\n'
  + '- Sapa pelanggan lalu pahami maksudnya.\n'
  + '- Lokasi / jam buka cabang -> panggil get_branch_info.\n'
  + '- Harga layanan -> panggil get_service_prices.\n'
  + '- Status/paket/tanggal berakhir membership & ringkasan akun -> panggil get_my_summary.\n'
  + '- Sisa voucher atau kode voucher pelanggan -> panggil get_my_vouchers.\n'
  + '- Info paket membership yang dijual -> panggil get_membership_plans.\n'
  + '- Promo aktif -> panggil get_promotions.\n'
  + '- Mau booking/janji -> panggil create_booking, lalu bacakan detail dan minta pelanggan balas "YA" untuk konfirmasi.\n'
  + '- Di luar kemampuan, data tidak ada, atau pelanggan minta orang -> escalate_to_human.\n'
  + '- Jangan pernah menebak; kalau ragu, escalate.';

const DEFAULT_PRODUCT_KNOWLEDGE =
  'AIRE adalah layanan cuci mobil; LEAD adalah layanan detailing. '
  + 'Detail layanan, harga, paket membership, dan skema voucher diambil dari sistem melalui tools. '
  + 'Silakan sesuaikan bagian ini per klien dengan info spesifik (daftar layanan unggulan, tingkatan membership, ketentuan voucher).';

const DEFAULTS: Omit<AgentConfigResponse, 'aiEnabled' | 'llmProvider' | 'llmKeyConfigured'> = {
  basePrompt: DEFAULT_BASE_PROMPT, productKnowledge: DEFAULT_PRODUCT_KNOWLEDGE, skills: DEFAULT_SKILLS, escalationNumber: null,
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
      // ai_enabled is per-tenant; provider + key are PLATFORM-WIDE.
      const [s, platform] = await Promise.all([
        this.settings.getSettings(tenantId),
        this.settings.getPlatformLlmPublic(),
      ]);
      return {
        aiEnabled: s.ai_enabled,
        llmProvider: platform.provider,
        llmKeyConfigured: platform.keyConfigured,
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
   * Update the tenant-writable agent config (WhatsApp connection + AI
   * auto-reply pause only). The AI brain — base prompt, product knowledge,
   * skills, daily cap, LLM provider/model/key, AI on/off — is super-admin-only;
   * see {@link adminUpdateBrain}.
   */
  async update(tenantId: string, dto: UpdateAgentConfigDto): Promise<AgentConfigResponse> {
    await this.upsertAgentRow(tenantId, {
      escalationNumber: dto.escalationNumber,
      waProvider: dto.waProvider,
      waNumber: dto.waNumber,
      wahaSession: dto.wahaSession,
      kapsoApiKey: dto.kapsoApiKey,
      aiReplyEnabled: dto.aiReplyEnabled,
      perBranchWaEnabled: dto.perBranchWaEnabled,
      wahaMockEnabled: dto.wahaMockEnabled,
    });
    return this.get(tenantId);
  }

  /**
   * Super-admin-only write of the AI brain fields (base prompt, product
   * knowledge, skills, daily message cap) into agent_configs. Called from
   * AdminController's `PUT /tenants/:id/ai-config`.
   */
  async adminUpdateBrain(tenantId: string, dto: AdminBrainUpdateDto): Promise<AgentConfigResponse> {
    await this.upsertAgentRow(tenantId, {
      basePrompt: dto.basePrompt,
      productKnowledge: dto.productKnowledge,
      skills: dto.skills,
      maxMessagesPerDay: dto.maxMessagesPerDay,
    });
    return this.get(tenantId);
  }

  /**
   * Shared upsert into agent_configs. Every field is optional — omitted
   * fields keep their existing stored value (COALESCE against the existing
   * row). Kept private and shared by both the tenant path ({@link update})
   * and the admin brain path ({@link adminUpdateBrain}) so the SQL lives in
   * exactly one place.
   */
  // ── Tenant-managed AI knowledge ─────────────────────────────────────────────

  /** Read the product knowledge, skills, category flags, and per-item visibility. */
  async getKnowledge(tenantId: string): Promise<KnowledgeResponse> {
    const [cfg, svc, promo, plan, out] = await Promise.all([
      this.pool.query('SELECT product_knowledge, skills, customer_knowledge FROM agent_configs WHERE tenant_id = $1', [tenantId]),
      this.pool.query('SELECT id, name, customer_visible FROM services WHERE tenant_id = $1 AND is_active = true ORDER BY business_unit, sort_order, name', [tenantId]),
      this.pool.query('SELECT id, name, customer_visible FROM promotions WHERE tenant_id = $1 ORDER BY created_at DESC', [tenantId]),
      this.pool.query('SELECT id, name, customer_visible FROM membership_plans WHERE tenant_id = $1 AND is_active = true ORDER BY price', [tenantId]),
      this.pool.query('SELECT id, name, phone, maps_url, customer_visible FROM outlets WHERE tenant_id = $1 AND is_active = true ORDER BY name', [tenantId]),
    ]);
    const r = cfg.rows[0] ?? {};
    const flags: Record<string, boolean> = r.customer_knowledge ?? {};
    const categories: Record<string, boolean> = {};
    for (const k of CUSTOMER_KNOWLEDGE_CATEGORIES) categories[k] = flags[k] !== false; // missing = visible
    const item = (x: any): KnowledgeItem => ({ id: x.id, name: x.name, customerVisible: x.customer_visible !== false });
    return {
      productKnowledge: r.product_knowledge ?? null,
      skills: r.skills ?? null,
      categories,
      items: {
        services: svc.rows.map(item),
        promotions: promo.rows.map(item),
        plans: plan.rows.map(item),
        outlets: out.rows.map((x: any) => ({ id: x.id, name: x.name, phone: x.phone ?? null, mapsUrl: x.maps_url ?? null, customerVisible: x.customer_visible !== false })),
      },
    };
  }

  /** Update product knowledge, skills, category flags, per-item visibility, and branch contacts. */
  async setKnowledge(tenantId: string, dto: KnowledgeUpdateDto): Promise<KnowledgeResponse> {
    if (dto.productKnowledge !== undefined || dto.skills !== undefined || dto.categories !== undefined) {
      // Ensure a config row exists (defaults from migration 074/080), then update.
      await this.pool.query('INSERT INTO agent_configs (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING', [tenantId]).catch(() => undefined);
      const set: string[] = []; const v: unknown[] = [tenantId]; let i = 2;
      if (dto.productKnowledge !== undefined) { set.push(`product_knowledge = $${i++}`); v.push(dto.productKnowledge); }
      if (dto.skills !== undefined) { set.push(`skills = $${i++}`); v.push(dto.skills); }
      if (dto.categories !== undefined) {
        // Only persist known category keys, coerced to booleans; merged into existing flags.
        const clean: Record<string, boolean> = {};
        for (const k of CUSTOMER_KNOWLEDGE_CATEGORIES) if (k in dto.categories) clean[k] = !!dto.categories[k];
        set.push(`customer_knowledge = COALESCE(customer_knowledge, '{}'::jsonb) || $${i++}::jsonb`); v.push(JSON.stringify(clean));
      }
      if (set.length) { set.push('updated_at = NOW()'); await this.pool.query(`UPDATE agent_configs SET ${set.join(', ')} WHERE tenant_id = $1`, v); }
    }
    // Per-item visibility overrides.
    const TABLE: Record<string, string> = { service: 'services', promotion: 'promotions', plan: 'membership_plans', outlet: 'outlets' };
    for (const it of dto.itemVisibility ?? []) {
      const t = TABLE[it.type];
      if (!t) continue;
      await this.pool.query(`UPDATE ${t} SET customer_visible = $1 WHERE id = $2 AND tenant_id = $3`, [!!it.visible, it.id, tenantId]);
    }
    // Branch contacts (phone / maps link).
    for (const c of dto.outletContacts ?? []) {
      const set: string[] = []; const v: unknown[] = []; let i = 1;
      if (c.phone !== undefined) { set.push(`phone = $${i++}`); v.push(c.phone); }
      if (c.mapsUrl !== undefined) { set.push(`maps_url = $${i++}`); v.push(c.mapsUrl); }
      if (!set.length) continue;
      v.push(c.id, tenantId);
      await this.pool.query(`UPDATE outlets SET ${set.join(', ')}, updated_at = NOW() WHERE id = $${i} AND tenant_id = $${i + 1}`, v);
    }
    return this.getKnowledge(tenantId);
  }

  private async upsertAgentRow(tenantId: string, fields: {
    basePrompt?: string | null;
    productKnowledge?: string | null;
    skills?: string | null;
    escalationNumber?: string | null;
    maxMessagesPerDay?: number;
    waProvider?: 'waha' | 'kapso';
    waNumber?: string | null;
    wahaSession?: string | null;
    kapsoApiKey?: string | null;
    aiReplyEnabled?: boolean;
    perBranchWaEnabled?: boolean;
    wahaMockEnabled?: boolean;
  }): Promise<void> {
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
        tenantId, fields.basePrompt ?? null, fields.productKnowledge ?? null, fields.skills ?? null, fields.escalationNumber ?? null,
        fields.maxMessagesPerDay ?? null, fields.waProvider ?? null, fields.waNumber ?? null, fields.wahaSession ?? null,
        fields.kapsoApiKey ?? null, fields.aiReplyEnabled ?? null, fields.perBranchWaEnabled ?? null, fields.wahaMockEnabled ?? null,
      ],
    );
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
