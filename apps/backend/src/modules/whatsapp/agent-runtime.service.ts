import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { SettingsService } from '../settings/settings.service';
import { ChatMessage } from '../agent/llm-router.service';
import type { AgentRole } from '../agent-registry/agent-registry.service';
import { CustomerAgentService } from './customer-agent.service';
import {
  CustomerContextService, ResolvedCustomer, CustomerScopedContext, PublicInfo,
} from './customer-context.service';

export type Intent = 'human' | 'status' | 'membership' | 'price' | 'booking' | 'voucher' | 'hours' | 'greeting' | 'unknown';

interface AgentRow { name: string; role: string; prompt: string | null }

export interface ReplyResult {
  text: string;
  escalate: boolean;
  mode: 'rigid' | 'fluid';
  agentName: string;
  /** True when the agent just proposed a booking (caller may offer YA/BATAL buttons). */
  proposedBooking?: boolean;
}

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

/**
 * AgentRuntimeService turns an inbound WhatsApp message into a reply.
 *
 * Two modes share ONE scoped data source (CustomerContextService):
 *  - RIGID (AI off): deterministic, templated answers filled with the customer's
 *    own data. Predictable, no LLM.
 *  - FLUID (AI on): the tenant's configured LLM (OpenRouter w/ their key, or local)
 *    generates a natural reply, grounded in the same scoped data + knowledge base,
 *    behind hard guardrails. On any LLM error it falls back to RIGID.
 */
@Injectable()
export class AgentRuntimeService {
  private readonly logger = new Logger(AgentRuntimeService.name);

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly context: CustomerContextService,
    private readonly settings: SettingsService,
    @Optional() private readonly customerAgent?: CustomerAgentService,
  ) {}

  detectIntent(text: string): Intent {
    const t = text.toLowerCase();
    if (/(komplain|complaint|manusia|human|bicara dengan|lapor|marah|kecewa|refund|salah)/i.test(t)) return 'human';
    if (/(status|antri|antre|queue|pesanan|order|selesai|ready|sudah jadi|progress)/i.test(t)) return 'status';
    if (/(member|membership|langganan|paket bulanan|unlimited)/i.test(t)) return 'membership';
    if (/(voucher|kode|kupon)/i.test(t)) return 'voucher';
    if (/(booking|jadwal|reservasi|appointment|daftar cuci|mau cuci)/i.test(t)) return 'booking';
    if (/(harga|price|biaya|menu|layanan|service|berapa|coating|cuci|detailing|wax|polish)/i.test(t)) return 'price';
    if (/(jam|buka|tutup|open|alamat|lokasi|dimana|di mana)/i.test(t)) return 'hours';
    // Greetings — Indonesian AND English (so a plain "hello"/"hi" is not treated as unknown).
    if (/(\bhalo\b|\bhallo\b|\bhai\b|\bhi\b|\bhello\b|\bhelo\b|\bhey\b|selamat (pagi|siang|sore|malam)|\bpagi\b|\bsiang\b|\bsore\b|\bmalam\b|good (morning|afternoon|evening|day)|thank you|thanks|terima kasih|makasih|assalamu|perkenalkan|nama saya|\bi'?m\b|\bi am\b)/i.test(t)) return 'greeting';
    return 'unknown';
  }

  private async selectAgent(tenantId: string, intent: Intent): Promise<AgentRow | null> {
    const r = await this.pool.query<AgentRow & { role: string }>(
      `SELECT name, role, prompt FROM agents WHERE tenant_id = $1 AND is_active = true ORDER BY position, created_at`,
      [tenantId],
    );
    const agents = r.rows;
    if (agents.length === 0) return null;
    const byRole = (role: string) => agents.find((a) => a.role === role);
    if (intent === 'human') return byRole('customer_service') ?? byRole('supervisor') ?? agents[0]!;
    if (intent === 'price' || intent === 'membership' || intent === 'voucher' || intent === 'booking') {
      return byRole('sales') ?? byRole('personal_assistant') ?? agents[0]!;
    }
    return byRole('personal_assistant') ?? agents[0]!;
  }

  private async fluidEnabled(tenantId: string): Promise<boolean> {
    try {
      const s = await this.settings.getSettings(tenantId);
      if (!s.ai_enabled || !this.customerAgent) return false;
      if (s.llm_provider === 'openrouter') {
        return !!(s.llm_api_key_encrypted && s.llm_api_key_encrypted.trim() !== '');
      }
      return true; // local provider (Ollama/Hermes)
    } catch {
      return false;
    }
  }

  /** Main entry: produce a reply for one inbound message. */
  async generate(params: {
    tenantId: string;
    fromPhone: string;
    /** Phone to resolve the customer by, when it differs from the chat address
     *  (e.g. a privacy @lid chat bound to a real number). Defaults to fromPhone. */
    resolvePhone?: string | null;
    /** Name to address the sender by when they aren't a resolved member (e.g. a
     *  name they typed like "I'm Hansel"). Used only for the greeting. */
    displayName?: string | null;
    outletId?: string | null;
    text: string;
    basePrompt: string | null;
    knowledge: string | null;
    skills?: string | null;
    history: ChatMessage[];
  }): Promise<ReplyResult> {
    const intent = this.detectIntent(params.text);
    const agent = await this.selectAgent(params.tenantId, intent);
    const agentName = agent?.name ?? 'Assistant';

    // Explicit human request always escalates, regardless of mode.
    if (intent === 'human') return { text: '', escalate: true, mode: 'rigid', agentName };

    const customer = await this.context.resolveCustomer(params.tenantId, params.resolvePhone ?? params.fromPhone);
    const [ctx, pub] = await Promise.all([
      customer ? this.context.getCustomerContext(params.tenantId, customer) : Promise.resolve(null),
      this.context.getPublicInfo(params.tenantId, params.outletId),
    ]);

    // FLUID: hand off to the shared customer brain (tool-calling loop, scoped to
    // this customer, with the persona's allowed tools). Falls back to rigid on
    // any LLM error so a reply always goes out.
    if (this.customerAgent && (await this.fluidEnabled(params.tenantId))) {
      const persona = agent ? { name: agent.name, role: agent.role as AgentRole, prompt: agent.prompt } : null;
      const fluid = await this.customerAgent.reply({
        tenantId: params.tenantId,
        fromPhone: params.fromPhone,
        outletId: params.outletId ?? null,
        text: params.text,
        basePrompt: params.basePrompt,
        knowledge: params.knowledge,
        skills: params.skills ?? null,
        history: params.history,
        persona,
        customer,
        pub,
      });
      if (fluid) {
        const proposedBooking = fluid.toolsUsed.some((t) => t.tool === 'create_booking' && t.ok);
        return { text: fluid.text, escalate: fluid.escalate, mode: 'fluid', agentName, proposedBooking };
      }
      this.logger.warn(`Fluid reply failed for tenant ${params.tenantId}; falling back to rigid`);
    }

    const rigid = this.rigidReply(intent, customer, ctx, pub, params.basePrompt, params.displayName ?? null);
    return { text: rigid.text, escalate: rigid.escalate, mode: 'rigid', agentName };
  }

  // ── RIGID (deterministic templates) ───────────────────────────────────────
  private rigidReply(
    intent: Intent,
    customer: ResolvedCustomer | null,
    ctx: CustomerScopedContext | null,
    pub: PublicInfo,
    basePrompt: string | null,
    displayName: string | null = null,
  ): { text: string; escalate: boolean } {
    const who = customer?.name ?? displayName;
    const hi = who ? `Halo kak ${who}!` : 'Halo kak!';

    switch (intent) {
      case 'greeting':
        return { text: `${hi} 😊 Aku Irene, CS-nya Aire. Ada yang bisa Irene bantu? (info cuci, harga, membership, status pesanan, atau booking)`, escalate: false };

      case 'status': {
        if (ctx?.activeQueue) return { text: `${hi} Pesanan ${ctx.activeQueue.orderNumber} Anda saat ini ${ctx.activeQueue.status === 'in_progress' ? 'sedang dikerjakan' : `mengantri di posisi ${ctx.activeQueue.position}`}.`, escalate: false };
        if (ctx?.recentOrders.length) { const o = ctx.recentOrders[0]!; return { text: `${hi} Pesanan terakhir Anda ${o.orderNumber} berstatus "${o.status}" (${fmt(o.total)}).`, escalate: false }; }
        return { text: `${hi} Kami belum menemukan pesanan aktif atas nomor ini. Jika baru saja transaksi, mohon tunggu sebentar.`, escalate: false };
      }

      case 'membership': {
        if (ctx?.memberships.length) {
          const m = ctx.memberships[0]!;
          return { text: `${hi} Membership Anda: ${m.plan} — status ${m.status}, berlaku s/d ${m.endDate}${m.usesLeft != null ? `, sisa ${m.usesLeft} cuci` : ''}.`, escalate: false };
        }
        if (pub.plans.length) return { text: `${hi} Paket membership kami:\n${pub.plans.map((m) => `• ${m.name}: ${fmt(m.price)} (${m.durationMonths} bln)`).join('\n')}`, escalate: false };
        return { text: `${hi} Saat ini belum ada paket membership aktif.`, escalate: false };
      }

      case 'price': {
        if (pub.services.length) {
          const top = pub.services.slice(0, 12).map((s) => `• [${s.unit}] ${s.name}: ${fmt(s.price)}`).join('\n');
          return { text: `${hi} Berikut sebagian daftar layanan & harga kami:\n${top}\n\nUntuk daftar lengkap, silakan tanyakan layanan tertentu.`, escalate: false };
        }
        return { text: `${hi} Daftar harga sedang kami siapkan. Mohon hubungi kami kembali.`, escalate: false };
      }

      case 'voucher': {
        if (ctx?.voucherPacks.length) return { text: `${hi} Anda memiliki ${ctx.voucherPacks.length} paket voucher. Tunjukkan kode voucher Anda di kasir untuk digunakan.`, escalate: false };
        return { text: `${hi} Anda belum memiliki voucher. Kami menjual paket voucher cuci hemat — silakan tanyakan ke kami.`, escalate: false };
      }

      case 'booking': {
        if (ctx?.bookings.length) { const b = ctx.bookings[0]!; return { text: `${hi} Booking Anda berikutnya: ${b.service ?? 'layanan'} pada ${b.scheduledAt} (${b.status}).`, escalate: false }; }
        return { text: `${hi} Untuk membuat janji/booking, mohon informasikan tanggal, jam, dan layanan yang diinginkan. Tim kami akan membantu menjadwalkan.`, escalate: false };
      }

      case 'hours':
        return { text: basePrompt?.trim() ? basePrompt.split('\n')[0]! : `${hi} Kami buka setiap hari. Untuk jam & lokasi cabang terdekat, mohon sebutkan area Anda.`, escalate: false };

      default:
        // Unknown (but not an explicit human/complaint request) → a friendly Irene
        // prompt that steers to what she can do, rather than dumping to a human on
        // a first "hello". Genuine human requests are caught earlier as intent 'human'.
        return {
          text: `${hi} 😊 Aku Irene, CS-nya Aire. Aku bisa bantu info harga & layanan, membership, voucher, status pesanan, atau booking. Ada yang bisa Irene bantu?`,
          escalate: false,
        };
    }
  }
}
