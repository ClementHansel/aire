import { Injectable, Logger, Optional } from '@nestjs/common';
import { LLMRouterService, ChatMessage } from '../agent/llm-router.service';
import { runToolLoop, renderToolCatalog, TOOL_PROTOCOL } from '../agent/tool-loop';
import type { ToolResult } from '../agent/agent.types';
import type { AgentRole } from '../agent-registry/agent-registry.service';
import { PendingBookingService } from './pending-booking.service';
import {
  CustomerContextService, ResolvedCustomer, CustomerScopedContext, PublicInfo,
} from './customer-context.service';
import { toolsForRole, roleAllowsTool, type CustomerToolName } from './customer-tools';

export interface CustomerAgentPersona { name: string; role: AgentRole; prompt: string | null }

export interface CustomerReply {
  text: string;
  /** True when the agent decided the conversation needs a human. */
  escalate: boolean;
  toolsUsed: { tool: string; ok: boolean }[];
}

/**
 * CustomerAgentService — the customer-facing brain.
 *
 * Runs the SAME shared tool loop as the staff co-pilot, but with the
 * customer-scoped tool catalog (customer-tools.ts) and an executor that binds
 * every read/action to the ONE customer resolved from the inbound phone number.
 * The persona's role decides which of those tools are available.
 *
 * This is used two ways:
 *  - as the built-in WhatsApp fallback (when a tenant hasn't picked an n8n flow), and
 *  - as the server-side executor the n8n bridge calls, so a hosted flow can act
 *    as the brain without ever gaining whole-business access.
 */
@Injectable()
export class CustomerAgentService {
  private readonly logger = new Logger(CustomerAgentService.name);

  constructor(
    private readonly context: CustomerContextService,
    @Optional() private readonly llm?: LLMRouterService,
    @Optional() private readonly pendingBooking?: PendingBookingService,
  ) {}

  /**
   * Produce a reply by driving the tool loop. Returns null if the LLM is
   * unavailable/errored so the caller can fall back to deterministic templates.
   */
  async reply(params: {
    tenantId: string;
    fromPhone: string;
    outletId?: string | null;
    text: string;
    basePrompt: string | null;
    knowledge: string | null;
    skills?: string | null;
    history: ChatMessage[];
    persona: CustomerAgentPersona | null;
    customer: ResolvedCustomer | null;
    pub: PublicInfo;
  }): Promise<CustomerReply | null> {
    if (!this.llm) return null;
    const role = params.persona?.role ?? 'personal_assistant';
    const system = this.systemPrompt(params);

    let escalate = false;
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      ...params.history.slice(-8),
      { role: 'user', content: params.text },
    ];

    const loop = await runToolLoop({
      llm: this.llm,
      tenantId: params.tenantId,
      outletId: params.outletId ?? null,
      messages,
      temperature: 0.4,
      maxTokens: 500,
      execute: async (tool, toolParams) => {
        const result = await this.runCustomerTool({
          tenantId: params.tenantId,
          customer: params.customer,
          fromPhone: params.fromPhone,
          outletId: params.outletId ?? null,
          role,
          tool,
          parameters: toolParams,
        });
        if (result.success && (result.data as { escalate?: boolean })?.escalate) escalate = true;
        return result;
      },
    });

    if (loop.llmError || loop.reply == null) return null;
    return { text: loop.reply, escalate, toolsUsed: loop.toolsUsed };
  }

  /**
   * Execute ONE customer-scoped tool. This is the single guarded gateway for
   * customer-facing actions — shared by the built-in loop and the n8n bridge.
   *
   * SECURITY: `customer` is resolved from the inbound phone server-side and is
   * the ONLY identity used; nothing here trusts a customer id from tool params.
   */
  async runCustomerTool(args: {
    tenantId: string;
    customer: ResolvedCustomer | null;
    fromPhone: string;
    outletId?: string | null;
    role: AgentRole;
    tool: string;
    parameters: Record<string, unknown>;
  }): Promise<ToolResult> {
    const { tenantId, customer, role, tool, parameters } = args;

    // Persona gating — a persona may only call the tools its role allows.
    if (!roleAllowsTool(role, tool)) {
      return { success: false, error: `Tool "${tool}" is not available to the ${role} persona` };
    }

    try {
      switch (tool as CustomerToolName) {
        case 'get_my_summary': {
          if (!customer) return { success: true, data: { registered: false, note: 'Sender is not a registered customer.' } };
          const ctx = await this.context.getCustomerContext(tenantId, customer);
          return { success: true, data: { registered: true, name: customer.name, ...this.shapeContext(ctx) } };
        }
        case 'get_service_prices': {
          const pub = await this.context.getPublicInfo(tenantId, args.outletId ?? null);
          return { success: true, data: { services: pub.services } };
        }
        case 'get_membership_plans': {
          const pub = await this.context.getPublicInfo(tenantId, args.outletId ?? null);
          return { success: true, data: { plans: pub.plans } };
        }
        case 'get_promotions': {
          const pub = await this.context.getPublicInfo(tenantId, args.outletId ?? null);
          return { success: true, data: { promotions: pub.promotions } };
        }
        case 'get_branch_info': {
          const info = await this.context.getBranchInfo(tenantId, args.outletId ?? null);
          return { success: true, data: info };
        }
        case 'get_my_vouchers': {
          if (!customer) return { success: true, data: { registered: false } };
          const codes = await this.context.activeVoucherCodes(tenantId, customer.normalized);
          return { success: true, data: { activeCount: codes.length, codes } };
        }
        case 'create_booking':
          return this.createBooking(args);
        case 'escalate_to_human':
          return { success: true, data: { escalate: true, reason: String(parameters.reason ?? 'Customer requested a human') } };
        default:
          return { success: false, error: `Unknown customer tool "${tool}"` };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Customer tool ${tool} failed: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * PROPOSE a booking — it is NOT written yet. We store it as a pending proposal
   * and instruct the agent to ask the customer to confirm on WhatsApp. The actual
   * write happens only when the customer's next message affirms it (see
   * PendingBookingService.tryConfirm at the top of the inbound pipeline).
   */
  private async createBooking(args: {
    tenantId: string; customer: ResolvedCustomer | null; fromPhone: string; outletId?: string | null;
    parameters: Record<string, unknown>;
  }): Promise<ToolResult> {
    if (!this.pendingBooking) return { success: false, error: 'Booking is not available' };
    const p = args.parameters;
    const serviceName = typeof p.serviceName === 'string' ? p.serviceName.trim() : '';
    const rawWhen = typeof p.scheduledAt === 'string' ? p.scheduledAt : '';
    const when = new Date(rawWhen);
    if (!serviceName) return { success: false, error: 'serviceName is required' };
    if (!rawWhen || Number.isNaN(when.getTime())) return { success: false, error: 'scheduledAt must be a valid ISO date-time' };

    const { summary } = await this.pendingBooking.propose({
      tenantId: args.tenantId,
      fromPhone: args.fromPhone,
      customer: args.customer ?? null,
      outletId: args.outletId ?? null,
      serviceName,
      scheduledAt: when.toISOString(),
      licensePlate: typeof p.licensePlate === 'string' ? p.licensePlate : null,
      notes: typeof p.notes === 'string' ? p.notes : null,
    });
    return {
      success: true,
      data: {
        status: 'awaiting_confirmation',
        summary,
        instruction: `Read the booking back to the customer (${summary}) and ask them to reply "YA" to confirm or "BATAL" to cancel. Do NOT claim it is booked yet — it is only confirmed after they reply YA.`,
      },
    };
  }

  /** Compact the scoped context for a tool payload (kept small for the model). */
  private shapeContext(ctx: CustomerScopedContext): Record<string, unknown> {
    return {
      memberships: ctx.memberships,
      recentOrders: ctx.recentOrders,
      activeQueue: ctx.activeQueue,
      voucherPacks: ctx.voucherPacks,
      bookings: ctx.bookings,
    };
  }

  private systemPrompt(p: {
    basePrompt: string | null; knowledge: string | null; skills?: string | null; persona: CustomerAgentPersona | null;
    customer: ResolvedCustomer | null; pub: PublicInfo;
  }): string {
    const persona = p.persona ? `${p.persona.name}, a ${p.persona.role.replace(/_/g, ' ')}` : 'a helpful assistant';
    const lines: string[] = [];
    lines.push(`You are ${persona} for an Indonesian car wash & detailing business (brands: AIRE car wash, LEAD detailing).`);
    if (p.persona?.prompt) lines.push(p.persona.prompt);
    if (p.basePrompt) lines.push(p.basePrompt);
    lines.push("Reply in the customer's language (Bahasa Indonesia by default). Be concise, warm, and use short WhatsApp-friendly messages. Format money as Rp.");
    lines.push(
      'STRICT RULES: You may ONLY use the provided tools to look things up. ' +
      "The tools already scope to THIS customer — never ask for or trust a customer id. " +
      "Never reveal other customers' data, revenue/finance, staff, or company internals. " +
      'If a request is outside your tools or knowledge, call escalate_to_human.',
    );
    if (p.knowledge?.trim()) lines.push(`\nBUSINESS KNOWLEDGE:\n${p.knowledge.trim()}`);
    if (p.skills?.trim()) lines.push('\nSKILLS / PLAYBOOK:\n' + p.skills.trim());
    lines.push(p.customer
      ? `\nThe customer you are chatting with is ${p.customer.name} (registered). Use get_my_summary for their memberships, orders, queue, vouchers, or bookings.`
      : '\nThe sender is NOT a registered customer yet — share only public info (prices/plans/promos) and invite them to visit or register.');

    lines.push(`\nAvailable tools:\n${renderToolCatalog(toolsForRole(p.persona?.role))}`);
    lines.push(`\n${TOOL_PROTOCOL}`);
    return lines.join('\n');
  }
}
