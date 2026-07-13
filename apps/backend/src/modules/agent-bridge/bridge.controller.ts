import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { BridgeTokenGuard, type BridgeContext } from './bridge-token.guard';
import { BridgeCtx } from './bridge.decorator';
import { AgentFlowService } from './agent-flow.service';
import { CustomerContextService } from '../whatsapp/customer-context.service';
import { CustomerAgentService } from '../whatsapp/customer-agent.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { AgentService } from '../agent/agent.service';
import { LLMRouterService, type ChatMessage } from '../agent/llm-router.service';
import type { AgentRole } from '../agent-registry/agent-registry.service';

interface ContextDto { fromPhone: string; outletId?: string | null }
interface LlmDto { messages: ChatMessage[]; temperature?: number; maxTokens?: number; model?: string; outletId?: string | null }
interface ToolDto { toolName: string; outletId?: string | null; parameters?: Record<string, unknown>; reasoning?: string; confidence?: number }
interface CustomerToolDto { fromPhone: string; tool: string; role?: AgentRole; outletId?: string | null; parameters?: Record<string, unknown> }
interface SendDto { to: string; text: string; persona?: string | null }
interface EscalateDto { fromPhone: string; reason?: string }

/**
 * Bridge Controller — the API surface the hosted n8n instance calls back into.
 *
 * Auth is by per-tenant bridge token (BridgeTokenGuard), NOT user JWT. Every
 * handler operates strictly within the resolved tenant, so all the guardrails
 * that live server-side (customer scoping, tool toggle/approval gating, tenant
 * LLM keys + monitoring) still apply — the visual flow only ORCHESTRATES.
 */
@Controller('api/bridge')
@UseGuards(BridgeTokenGuard)
export class BridgeController {
  constructor(
    private readonly flows: AgentFlowService,
    private readonly context: CustomerContextService,
    private readonly customerAgent: CustomerAgentService,
    private readonly whatsapp: WhatsappService,
    private readonly agent: AgentService,
    private readonly llm: LLMRouterService,
  ) {}

  /** Scoped customer data + public info + tenant persona for prompt assembly. */
  @Post('context')
  @HttpCode(HttpStatus.OK)
  async getContext(@BridgeCtx() ctx: BridgeContext, @Body() body: ContextDto) {
    if (!body?.fromPhone) throw new BadRequestException('fromPhone is required');
    const customer = await this.context.resolveCustomer(ctx.tenantId, body.fromPhone);
    const [scoped, publicInfo, persona] = await Promise.all([
      customer ? this.context.getCustomerContext(ctx.tenantId, customer) : Promise.resolve(null),
      this.context.getPublicInfo(ctx.tenantId, body.outletId ?? null),
      this.flows.getPersona(ctx.tenantId),
    ]);
    return { customer, context: scoped, publicInfo, persona };
  }

  /** Chat completion via the tenant's configured provider + their own key. */
  @Post('llm')
  @HttpCode(HttpStatus.OK)
  async chat(@BridgeCtx() ctx: BridgeContext, @Body() body: LlmDto) {
    if (!Array.isArray(body?.messages) || body.messages.length === 0) {
      throw new BadRequestException('messages[] is required');
    }
    return this.llm.chat(ctx.tenantId, body.messages, {
      temperature: body.temperature,
      max_tokens: body.maxTokens,
      model: body.model,
      outletId: body.outletId ?? null,
    });
  }

  /**
   * Execute a FULL-BUSINESS agent tool (finance, all orders, HR…). Toggle +
   * approval gating is enforced in AgentService. This is for back-office
   * AUTOMATION flows only — NEVER call it from a customer conversation flow, as
   * it exposes whole-business data. Customer flows must use /whatsapp/tool.
   */
  @Post('tool')
  @HttpCode(HttpStatus.OK)
  async runTool(@BridgeCtx() ctx: BridgeContext, @Body() body: ToolDto) {
    if (!body?.toolName) throw new BadRequestException('toolName is required');
    return this.agent.executeTool({
      toolName: body.toolName,
      tenantId: ctx.tenantId,
      outletId: body.outletId ?? '',
      parameters: body.parameters ?? {},
      reasoning: body.reasoning ?? 'Requested by n8n flow',
      confidence: body.confidence ?? 0.7,
    });
  }

  /**
   * Execute a CUSTOMER-SCOPED tool for a conversation flow. The customer is
   * resolved server-side from `fromPhone` and is the only identity used, so a
   * flow can only ever read/act for the person chatting. `role` picks the
   * persona's allowed toolset. If the tool asks to escalate, the server also
   * runs the real escalation (mark, ack, notify) so behaviour matches built-in.
   */
  @Post('whatsapp/tool')
  @HttpCode(HttpStatus.OK)
  async runCustomerTool(@BridgeCtx() ctx: BridgeContext, @Body() body: CustomerToolDto) {
    if (!body?.fromPhone || !body?.tool) throw new BadRequestException('fromPhone and tool are required');
    const customer = await this.context.resolveCustomer(ctx.tenantId, body.fromPhone);
    const result = await this.customerAgent.runCustomerTool({
      tenantId: ctx.tenantId,
      customer,
      fromPhone: body.fromPhone,
      outletId: body.outletId ?? null,
      role: body.role ?? 'personal_assistant',
      tool: body.tool,
      parameters: body.parameters ?? {},
    });
    const data = result.data as { escalate?: boolean; reason?: string } | undefined;
    if (result.success && data?.escalate) {
      await this.whatsapp.escalateByPhone(ctx.tenantId, body.fromPhone, data.reason ?? 'Escalated by agent flow');
    }
    return result;
  }

  /** Send a WhatsApp reply and record it in the Conversation Log. */
  @Post('whatsapp/send')
  @HttpCode(HttpStatus.OK)
  async send(@BridgeCtx() ctx: BridgeContext, @Body() body: SendDto) {
    if (!body?.to || !body?.text) throw new BadRequestException('to and text are required');
    const ok = await this.whatsapp.agentSend(ctx.tenantId, body.to, body.text, body.persona ?? null);
    return { ok };
  }

  /**
   * Escalate a conversation to a human. Lets an n8n flow match the built-in
   * runtime's escalation path (mark escalated, ack the customer, notify the
   * tenant's escalation number). Gating stays server-side.
   */
  @Post('escalate')
  @HttpCode(HttpStatus.OK)
  async escalate(@BridgeCtx() ctx: BridgeContext, @Body() body: EscalateDto) {
    if (!body?.fromPhone) throw new BadRequestException('fromPhone is required');
    return this.whatsapp.escalateByPhone(ctx.tenantId, body.fromPhone, body.reason);
  }
}
