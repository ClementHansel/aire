import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role, JWTPayload } from '@aire/shared';
import { Roles, CurrentUser } from '../../common/decorators';
import { RolesGuard, RlsContextGuard } from '../../common/guards';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AgentService } from './agent.service';
import { ProposalService } from './proposal.service';
import { AgentGateway } from './agent.gateway';
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
  ) {}

  /**
   * List all registered tools.
   */
  @Get('tools')
  getTools(): ToolDefinition[] {
    return this.agentService.getAllTools();
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
