import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Role, JWTPayload } from '@aire/shared';
import { Roles, CurrentUser } from '../../common/decorators';
import { RolesGuard, RlsContextGuard } from '../../common/guards';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AgentService } from './agent.service';
import { ProposalService } from './proposal.service';
import { AgentGateway } from './agent.gateway';
import { AgentChatService } from './agent-chat.service';
import { LLMRouterService } from './llm-router.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { EventBusService } from '../events/event-bus.service';
import type { ToolDefinition, ActionProposal, ToolResult } from './agent.types';

/**
 * Agent Controller.
 *
 * Exposes REST endpoints for the AI Agent module including tool listing
 * and action proposal management (list, approve, reject).
 *
 * Requirements: 5.1, 5.3, 6.3, 6.4, 6.5
 */
@Controller('api/agent')
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly proposalService: ProposalService,
    private readonly agentGateway: AgentGateway,
    private readonly chatService: AgentChatService,
    private readonly llmRouter: LLMRouterService,
    private readonly monitoring: MonitoringService,
    private readonly eventBus: EventBusService,
  ) {}

  /**
   * List all registered tools.
   */
  @Get('tools')
  getTools(): ToolDefinition[] {
    return this.agentService.getAllTools();
  }

  // ─── Conversational assistant ─────────────────────────────────────────────

  /** POST /api/agent/chat — send a message to the AI assistant. */
  @Post('chat')
  @UseGuards(JwtAuthGuard)
  async chat(
    @CurrentUser() user: JWTPayload,
    @Body() body: { message: string; sessionId?: string },
  ) {
    if (!body?.message?.trim()) throw new BadRequestException('message is required');
    return this.chatService.chat(
      user.tenant_id,
      user.sub,
      user.outlet_id ?? null,
      body.sessionId ?? null,
      body.message.trim(),
    );
  }

  /** GET /api/agent/chat/sessions — the user's chat threads (newest first, pinned on top). */
  @Get('chat/sessions')
  @UseGuards(JwtAuthGuard)
  async chatSessions(@CurrentUser() user: JWTPayload) {
    return this.chatService.listSessions(user.tenant_id, user.sub);
  }

  /** POST /api/agent/chat/sessions — start an empty thread (the "New chat" button). */
  @Post('chat/sessions')
  @UseGuards(JwtAuthGuard)
  async createChatSession(@CurrentUser() user: JWTPayload) {
    const id = await this.chatService.createSession(user.tenant_id, user.sub);
    return { id, title: 'New chat' };
  }

  /** GET /api/agent/chat/sessions/:id — messages in a session. */
  @Get('chat/sessions/:id')
  @UseGuards(JwtAuthGuard)
  async chatMessages(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.chatService.getMessages(user.tenant_id, id, user.sub);
  }

  /** PATCH /api/agent/chat/sessions/:id — rename and/or pin a thread. */
  @Patch('chat/sessions/:id')
  @UseGuards(JwtAuthGuard)
  async updateChatSession(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Body() body: { title?: string; pinned?: boolean },
  ) {
    if (body?.pinned !== undefined) {
      const ok = await this.chatService.setPinned(user.tenant_id, user.sub, id, !!body.pinned);
      if (!ok) throw new NotFoundException('Chat session not found');
    }
    if (body?.title !== undefined) {
      if (!body.title.trim()) throw new BadRequestException('title cannot be empty');
      const renamed = await this.chatService.renameSession(user.tenant_id, user.sub, id, body.title);
      if (!renamed) throw new NotFoundException('Chat session not found');
      return renamed;
    }
    return { id };
  }

  /**
   * DELETE /api/agent/chat/sessions/:id — remove a thread from the history.
   *
   * Archives rather than hard-deletes: these transcripts record actions the agent
   * actually took on the business, which is an audit trail worth keeping even
   * after the user is done with the conversation.
   */
  @Delete('chat/sessions/:id')
  @UseGuards(JwtAuthGuard)
  async deleteChatSession(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    const ok = await this.chatService.archiveSession(user.tenant_id, user.sub, id);
    if (!ok) throw new NotFoundException('Chat session not found');
    return { deleted: true };
  }

  /** POST /api/agent/validate-connection — test the configured LLM. */
  @Post('validate-connection')
  @UseGuards(JwtAuthGuard)
  async validateConnection(@CurrentUser() user: JWTPayload) {
    return this.llmRouter.validateConnection(user.tenant_id);
  }

  // ─── Monitoring ───────────────────────────────────────────────────────────

  /** GET /api/agent/monitoring/summary — aggregate agent usage. */
  @Get('monitoring/summary')
  @UseGuards(JwtAuthGuard)
  async monitoringSummary(@CurrentUser() user: JWTPayload, @Query('hours') hours?: string) {
    return this.monitoring.summary(user.tenant_id, hours ? parseInt(hours, 10) : 24);
  }

  /** GET /api/agent/monitoring/recent — recent invocations (live feed). */
  @Get('monitoring/recent')
  @UseGuards(JwtAuthGuard)
  async monitoringRecent(@CurrentUser() user: JWTPayload, @Query('limit') limit?: string) {
    return this.monitoring.recent(user.tenant_id, limit ? parseInt(limit, 10) : 50);
  }

  /** GET /api/agent/monitoring/events — recent domain events + throughput. */
  @Get('monitoring/events')
  @UseGuards(JwtAuthGuard)
  async monitoringEvents(@CurrentUser() user: JWTPayload, @Query('limit') limit?: string) {
    const [events, throughput] = await Promise.all([
      this.eventBus.recent(user.tenant_id, { limit: limit ? parseInt(limit, 10) : 50 }),
      this.eventBus.throughput(user.tenant_id, 60),
    ]);
    return { events, throughput };
  }

  /**
   * GET /api/agent/:tenantId/proposals
   *
   * List action proposals for a tenant, optionally filtered by status.
   * Requires Tenant_Owner role minimum.
   *
   * Requirement: 6.3
   */
  @Get(':tenantId/proposals')
  @UseGuards(JwtAuthGuard, RlsContextGuard, RolesGuard)
  @Roles(Role.TenantOwner)
  async listProposals(
    @Param('tenantId') tenantId: string,
    @Query('status') status?: ActionProposal['status'],
  ): Promise<ActionProposal[]> {
    return this.proposalService.listProposals(tenantId, status);
  }

  /**
   * POST /api/agent/:tenantId/proposals/:id/approve
   *
   * Approve a pending action proposal and execute the proposed tool.
   * Requires Tenant_Owner role minimum.
   *
   * Requirement: 6.4
   */
  @Post(':tenantId/proposals/:id/approve')
  @UseGuards(JwtAuthGuard, RlsContextGuard, RolesGuard)
  @Roles(Role.TenantOwner)
  async approveProposal(
    @Param('tenantId') tenantId: string,
    @Param('id') proposalId: string,
    @CurrentUser() user: JWTPayload,
  ): Promise<ToolResult> {
    const result = await this.proposalService.approveProposal(proposalId, user.sub);

    // Emit real-time notification to tenant room
    this.agentGateway.emitProposalResolved(tenantId, {
      proposalId,
      status: 'approved',
      resolvedBy: user.sub,
      resolvedAt: new Date().toISOString(),
    });

    return result;
  }

  /**
   * POST /api/agent/:tenantId/proposals/:id/reject
   *
   * Reject a pending action proposal.
   * Requires Tenant_Owner role minimum.
   *
   * Requirement: 6.5
   */
  @Post(':tenantId/proposals/:id/reject')
  @UseGuards(JwtAuthGuard, RlsContextGuard, RolesGuard)
  @Roles(Role.TenantOwner)
  async rejectProposal(
    @Param('tenantId') tenantId: string,
    @Param('id') proposalId: string,
    @CurrentUser() user: JWTPayload,
  ): Promise<{ success: true }> {
    await this.proposalService.rejectProposal(proposalId, user.sub);

    // Emit real-time notification to tenant room
    this.agentGateway.emitProposalResolved(tenantId, {
      proposalId,
      status: 'rejected',
      resolvedBy: user.sub,
      resolvedAt: new Date().toISOString(),
    });

    return { success: true };
  }
}
