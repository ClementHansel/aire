import {
  Injectable,
  Inject,
  Optional,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notification/notification.service';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';
import { AgentGateway } from './agent.gateway';
import type { ActionProposal, ToolInvocation, ToolResult } from './agent.types';

/**
 * Proposal Service.
 *
 * Manages the lifecycle of AI Action Proposals: creation, approval,
 * rejection, and expiration. Integrates with audit logging and
 * notification delivery.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */
@Injectable()
export class ProposalService {
  private readonly logger = new Logger(ProposalService.name);

  /** Tool executor callback — wired by AgentService to avoid circular dep */
  private toolExecutor:
    | ((invocation: ToolInvocation) => Promise<ToolResult>)
    | null = null;

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly auditService: AuditService,
    private readonly notificationService: NotificationService,
    @Optional() private readonly gateway?: AgentGateway,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  /**
   * Set the tool executor callback. Called by AgentService during module init
   * to wire execution without circular dependency.
   */
  setToolExecutor(executor: (invocation: ToolInvocation) => Promise<ToolResult>): void {
    this.toolExecutor = executor;
  }

  /**
   * Create an Action Proposal with status "pending".
   *
   * Stores action_type, parameters, ai_reasoning, confidence_score,
   * created_at, and status. Notifies tenant owner on creation.
   *
   * Requirements: 6.1, 6.2, 6.3
   */
  async proposeAction(
    tenantId: string,
    actionType: string,
    params: Record<string, unknown>,
    reasoning: string,
    confidence: number,
  ): Promise<ActionProposal> {
    const result = await this.pool.query<{
      id: string;
      tenant_id: string;
      action_type: string;
      parameters: Record<string, unknown>;
      ai_reasoning: string;
      confidence_score: string;
      status: string;
      created_at: Date;
      resolved_at: Date | null;
      resolved_by: string | null;
    }>(
      `INSERT INTO action_proposals (tenant_id, action_type, parameters, ai_reasoning, confidence_score)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, tenant_id, action_type, parameters, ai_reasoning, confidence_score, status, created_at, resolved_at, resolved_by`,
      [tenantId, actionType, JSON.stringify(params), reasoning, confidence],
    );

    const row = result.rows[0]!;
    const proposal = this.mapRowToProposal(row);

    // Live-update the proposal board: the /agent gateway already exposes this
    // channel; it just was never called on creation (only on resolve).
    this.gateway?.emitProposalCreated(tenantId, { proposal });

    // Domain event for the AI feed + monitoring throughput (parity with resolve).
    void this.eventBus?.emit({
      type: DomainEventType.AgentProposalCreated,
      tenantId,
      actor: 'agent',
      payload: { proposalId: proposal.id, actionType, confidence },
    });

    // Notify tenant owner (Req 6.3)
    await this.notifyTenantOwner(tenantId, proposal);

    this.logger.log(
      `Proposal created: ${proposal.id} (type=${actionType}, confidence=${confidence}) for tenant ${tenantId}`,
    );

    return proposal;
  }

  /**
   * Approve a pending proposal. Marks it as approved, sets resolved_at
   * and resolved_by, then executes the tool with stored parameters.
   *
   * Requirement: 6.4
   */
  async approveProposal(proposalId: string, userId: string): Promise<ToolResult> {
    // 1. Load and validate the proposal
    const proposal = await this.getProposal(proposalId);
    if (!proposal) {
      throw new NotFoundException(`Proposal ${proposalId} not found`);
    }
    if (proposal.status !== 'pending') {
      throw new ConflictException(
        `Proposal ${proposalId} is already ${proposal.status} and cannot be approved`,
      );
    }

    // 2. Update status to approved
    await this.pool.query(
      `UPDATE action_proposals
       SET status = 'approved', resolved_at = NOW(), resolved_by = $1
       WHERE id = $2`,
      [userId, proposalId],
    );

    // 3. Audit-log the approval
    await this.auditService.log({
      tenantId: proposal.tenant_id,
      userId,
      operation: 'proposal_approved',
      entityType: 'action_proposal',
      entityId: proposalId,
      afterValue: { action_type: proposal.action_type, parameters: proposal.parameters },
    });

    this.logger.log(`Proposal ${proposalId} approved by user ${userId}`);

    // 4. Execute the tool with stored parameters
    if (!this.toolExecutor) {
      this.logger.error('Tool executor not wired — cannot execute approved proposal');
      return { success: false, error: 'Tool executor not available' };
    }

    const invocation: ToolInvocation = {
      toolName: proposal.action_type,
      tenantId: proposal.tenant_id,
      outletId: (proposal.parameters.outlet_id as string) ?? proposal.tenant_id,
      parameters: proposal.parameters,
    };

    const toolResult = await this.toolExecutor(invocation);

    // 5. Audit-log the execution result
    await this.auditService.log({
      tenantId: proposal.tenant_id,
      userId,
      operation: 'proposal_executed',
      entityType: 'action_proposal',
      entityId: proposalId,
      afterValue: { result: toolResult },
    });

    return toolResult;
  }

  /**
   * Reject a pending proposal. Marks it as rejected, sets resolved_at
   * and resolved_by, and records the rejection in the audit log.
   *
   * Requirement: 6.5
   */
  async rejectProposal(proposalId: string, userId: string): Promise<void> {
    // 1. Load and validate the proposal
    const proposal = await this.getProposal(proposalId);
    if (!proposal) {
      throw new NotFoundException(`Proposal ${proposalId} not found`);
    }
    if (proposal.status !== 'pending') {
      throw new ConflictException(
        `Proposal ${proposalId} is already ${proposal.status} and cannot be rejected`,
      );
    }

    // 2. Update status to rejected
    await this.pool.query(
      `UPDATE action_proposals
       SET status = 'rejected', resolved_at = NOW(), resolved_by = $1
       WHERE id = $2`,
      [userId, proposalId],
    );

    // 3. Audit-log the rejection
    await this.auditService.log({
      tenantId: proposal.tenant_id,
      userId,
      operation: 'proposal_rejected',
      entityType: 'action_proposal',
      entityId: proposalId,
      afterValue: {
        action_type: proposal.action_type,
        parameters: proposal.parameters,
        ai_reasoning: proposal.ai_reasoning,
      },
    });

    this.logger.log(`Proposal ${proposalId} rejected by user ${userId}`);
  }

  /**
   * Expire all stale proposals that have been pending for more than 24 hours.
   * Returns the number of proposals expired.
   *
   * Requirement: 6.6
   */
  async expireStaleProposals(): Promise<number> {
    const result = await this.pool.query<{ id: string; tenant_id: string }>(
      `UPDATE action_proposals
       SET status = 'expired', resolved_at = NOW()
       WHERE status = 'pending'
         AND created_at < NOW() - INTERVAL '24 hours'
       RETURNING id, tenant_id`,
    );

    const expiredCount = result.rowCount ?? 0;

    if (expiredCount > 0) {
      this.logger.log(`Expired ${expiredCount} stale proposals`);

      // Audit-log each expiration
      for (const row of result.rows) {
        await this.auditService.log({
          tenantId: row.tenant_id,
          userId: 'system',
          operation: 'proposal_expired',
          entityType: 'action_proposal',
          entityId: row.id,
        });
      }
    }

    return expiredCount;
  }

  /**
   * Get a single proposal by ID.
   */
  async getProposal(proposalId: string): Promise<ActionProposal | null> {
    const result = await this.pool.query(
      `SELECT id, tenant_id, action_type, parameters, ai_reasoning, confidence_score, status, created_at, resolved_at, resolved_by
       FROM action_proposals
       WHERE id = $1`,
      [proposalId],
    );

    const row = result.rows[0];
    if (!row) return null;

    return this.mapRowToProposal(row);
  }

  /**
   * List proposals for a tenant, optionally filtered by status.
   */
  async listProposals(
    tenantId: string,
    status?: ActionProposal['status'],
  ): Promise<ActionProposal[]> {
    let query = `SELECT id, tenant_id, action_type, parameters, ai_reasoning, confidence_score, status, created_at, resolved_at, resolved_by
       FROM action_proposals
       WHERE tenant_id = $1`;
    const params: unknown[] = [tenantId];

    if (status) {
      query += ` AND status = $2`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC`;

    const result = await this.pool.query(query, params);
    return result.rows.map((row: any) => this.mapRowToProposal(row));
  }

  // ─── Private Helpers ────────────────────────────────────────────────

  /**
   * Map a database row to an ActionProposal interface.
   */
  private mapRowToProposal(row: any): ActionProposal {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      action_type: row.action_type,
      parameters: row.parameters,
      ai_reasoning: row.ai_reasoning,
      confidence_score: parseFloat(row.confidence_score),
      status: row.status,
      created_at:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : row.created_at,
      resolved_at:
        row.resolved_at instanceof Date
          ? row.resolved_at.toISOString()
          : row.resolved_at ?? null,
      resolved_by: row.resolved_by ?? null,
    };
  }

  /**
   * Notify the tenant owner about a new action proposal.
   * Sends an in-app notification and optionally WhatsApp if configured.
   *
   * Requirement: 6.3
   */
  private async notifyTenantOwner(
    tenantId: string,
    proposal: ActionProposal,
  ): Promise<void> {
    try {
      // Look up tenant owner phone for WhatsApp notification
      const ownerResult = await this.pool.query<{ id: string; phone: string | null }>(
        `SELECT id, phone FROM users WHERE tenant_id = $1 AND role = 'tenant_owner' LIMIT 1`,
        [tenantId],
      );

      const owner = ownerResult.rows[0];
      if (!owner) {
        this.logger.warn(`No tenant owner found for tenant ${tenantId} — skipping notification`);
        return;
      }

      // Queue WhatsApp notification if owner has phone
      if (owner.phone) {
        await this.notificationService.sendWhatsApp({
          to: owner.phone,
          // Without this the message cannot be routed to the tenant's WhatsApp
          // line and falls through to the unconfigured Meta branch.
          tenantId,
          templateName: 'action_proposal_pending',
          params: {
            actionType: proposal.action_type,
            reasoning: proposal.ai_reasoning.slice(0, 200),
            confidence: `${Math.round(proposal.confidence_score * 100)}%`,
          },
        });
      }
    } catch (error) {
      // Non-critical: log and continue — proposal is still valid
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to notify tenant owner for proposal ${proposal.id}: ${message}`);
    }
  }
}
