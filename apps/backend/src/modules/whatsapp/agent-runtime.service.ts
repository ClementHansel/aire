import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { SettingsService } from '../settings/settings.service';
import { LLMRouterService, ChatMessage, LLMErrorResponse } from '../agent/llm-router.service';
import {
  CustomerContextService, ResolvedCustomer, CustomerScopedContext, PublicInfo,
} from './customer-context.service';

export type Intent = 'human' | 'status' | 'membership' | 'price' | 'booking' | 'voucher' | 'hours' | 'greeting' | 'unknown';

interface AgentRow { name: string; role: string; prompt: string | null }

export interface ReplyResult { text: string; escalate: boolean; mode: 'rigid' | 'fluid'; agentName: string }

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
    @Optional() private readonly llm?: LLMRouterService,
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
    if (/(halo|hai|^hi\b|pagi|siang|sore|malam|thanks|terima kasih|makasih)/i.test(t)) return 'greeting';
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
      if (!s.ai_enabled || !this.llm) return false;
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
    outletId?: string | null;
    text: string;
    basePrompt: string | null;
    knowledge: string | null;
    history: ChatMessage[];
  }): Promise<ReplyResult> {
    const intent = this.detectIntent(params.text);
    const agent = await this.selectAgent(params.tenantId, intent);
    const agentName = agent?.name ?? 'Assistant';

    // Explicit human request always escalates, regardless of mode.
    if (intent === 'human') return { text: '', escalate: true, mode: 'rigid', agentName };

    const customer = await this.context.resolveCustomer(params.tenantId, params.fromPhone);
    const [ctx, pub] = await Promise.all([
      customer ? this.context.getCustomerContext(params.tenantId, customer) : Promise.resolve(null),
      this.context.getPublicInfo(params.tenantId, params.outletId),
    ]);

    if (await this.fluidEnabled(params.tenantId)) {
      const fluid = await this.fluidReply({ ...params, intent, agent, customer, ctx, pub });
      if (fluid) return { text: fluid, escalate: false, mode: 'fluid', agentName };
      this.logger.warn(`Fluid reply failed for tenant ${params.tenantId}; falling back to rigid`);
    }

    const rigid = this.rigidReply(intent, customer, ctx, pub, params.basePrompt);
    return { text: rigid.text, escalate: rigid.escalate, mode: 'rigid', agentName };
  }

  // ── FLUID (LLM) ───────────────────────────────────────────────────────────
  private async fluidReply(p: {
    tenantId: string; text: string; basePrompt: string | null; knowledge: string | null;
    history: ChatMessage[]; intent: Intent; agent: AgentRow | null;
    customer: ResolvedCustomer | null; ctx: CustomerScopedContext | null; pub: PublicInfo;
  }): Promise<string | null> {
    if (!this.llm) return null;
    const system = this.buildSystemPrompt(p);
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      ...p.history.slice(-8),
      { role: 'user', content: p.text },
    ];
    const res = await this.llm.chat(p.tenantId, messages, { temperature: 0.4, max_tokens: 500 });
    if ('error' in res && (res as LLMErrorResponse).error === true) return null;
    const content = res.content?.trim();
    return content && content.length > 0 ? content : null;
  }

  private buildSystemPrompt(p: {
    basePrompt: string | null; knowledge: string | null; agent: AgentRow | null;
    customer: ResolvedCustomer | null; ctx: CustomerScopedContext | null; pub: PublicInfo;
  }): string {
    const lines: string[] = [];
    const persona = p.agent ? `${p.agent.name}, a ${p.agent.role.replace(/_/g, ' ')}` : 'a helpful assistant';
    lines.push(`You are ${persona} for an Indonesian car wash & detailing business (brands: AIRE car wash, LEAD detailing).`);
    if (p.agent?.prompt) lines.push(p.agent.prompt);
    if (p.basePrompt) lines.push(p.basePrompt);
    lines.push('Reply in the customer\'s language (Bahasa Indonesia by default). Be concise, warm, and helpful. Use WhatsApp-friendly short messages.');
    lines.push(
      'STRICT RULES: Only discuss THIS customer\'s own data and public service/price info. ' +
      'Never reveal or infer other customers\' data, internal revenue/finance, staff, or company secrets. ' +
      'If asked for anything outside your knowledge or another person\'s data, politely decline and offer to connect a human agent. ' +
      'Never invent prices, order numbers, or membership details — use only the data provided below.',
    );

    if (p.knowledge?.trim()) lines.push(`\nBUSINESS KNOWLEDGE:\n${p.knowledge.trim()}`);

    if (p.pub.services.length) {
      const svc = p.pub.services.slice(0, 40).map((s) => `- [${s.unit}] ${s.name}: ${fmt(s.price)}`).join('\n');
      lines.push(`\nSERVICES & PRICES:\n${svc}`);
    }
    if (p.pub.plans.length) {
      lines.push(`\nMEMBERSHIP PLANS:\n${p.pub.plans.map((m) => `- ${m.name}: ${fmt(m.price)} (${m.durationMonths} mo)`).join('\n')}`);
    }
    if (p.pub.promotions.length) lines.push(`\nACTIVE PROMOTIONS: ${p.pub.promotions.join('; ')}`);

    if (p.customer && p.ctx) {
      lines.push(`\nCUSTOMER (the person you are chatting with): ${p.customer.name}.`);
      if (p.ctx.memberships.length) {
        lines.push('Their memberships: ' + p.ctx.memberships.map((m) => `${m.plan} (${m.status}, ends ${m.endDate}, ${m.usesLeft ?? '—'} uses left${m.plates.length ? `, plates: ${m.plates.join('/')}` : ''})`).join('; '));
      }
      if (p.ctx.activeQueue) lines.push(`Current queue: order ${p.ctx.activeQueue.orderNumber}, position ${p.ctx.activeQueue.position}, status ${p.ctx.activeQueue.status}.`);
      if (p.ctx.recentOrders.length) {
        lines.push('Recent orders: ' + p.ctx.recentOrders.map((o) => `${o.orderNumber} (${o.status}, ${fmt(o.total)})`).join('; '));
      }
      if (p.ctx.bookings.length) {
        lines.push('Upcoming bookings: ' + p.ctx.bookings.map((b) => `${b.service ?? 'service'} @ ${b.scheduledAt} (${b.status})`).join('; '));
      }
      if (p.ctx.voucherPacks.length) {
        lines.push('Voucher packs: ' + p.ctx.voucherPacks.map((v) => `${v.benefit} x${v.quantity} (${v.redeemed} used)`).join('; '));
      }
    } else {
      lines.push('\nThe sender is not a registered customer yet — only share public info and invite them to visit or register.');
    }
    return lines.join('\n');
  }

  // ── RIGID (deterministic templates) ───────────────────────────────────────
  private rigidReply(
    intent: Intent,
    customer: ResolvedCustomer | null,
    ctx: CustomerScopedContext | null,
    pub: PublicInfo,
    basePrompt: string | null,
  ): { text: string; escalate: boolean } {
    const hi = customer ? `Halo ${customer.name}!` : 'Halo!';

    switch (intent) {
      case 'greeting':
        return { text: `${hi} Terima kasih sudah menghubungi kami. Ada yang bisa kami bantu? (cuci, harga, membership, status pesanan)`, escalate: false };

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
        // Unknown → hand to a human so nothing is guessed.
        return { text: '', escalate: true };
    }
  }
}
