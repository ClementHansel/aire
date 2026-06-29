import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { ToolDefinition, ToolInvocation, ToolResult, ActionProposal } from './agent.types';
import {
  registerTool,
  getTool,
  getAllTools,
  hasTool,
  registerDefaultTools,
} from './agent.tools';
import { SettingsService } from '../settings/settings.service';
import { ProposalService } from './proposal.service';
import { SchedulerService } from './scheduler.service';
import { ScheduledAnalysisService } from './scheduled-analysis.service';
import { AuditService } from '../audit/audit.service';

/**
 * Agent Service.
 *
 * Manages the AI Agent tool registry, tool execution with toggle gate,
 * input validation, retry logic, and action proposal delegation.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.4
 */
@Injectable()
export class AgentService implements OnModuleInit {
  private readonly logger = new Logger(AgentService.name);
  private readonly ajv: Ajv;
  private readonly validatorCache = new Map<string, ValidateFunction>();

  constructor(
    private readonly settingsService: SettingsService,
    private readonly proposalService: ProposalService,
    private readonly schedulerService: SchedulerService,
    private readonly scheduledAnalysisService: ScheduledAnalysisService,
    private readonly auditService: AuditService,
  ) {
    this.ajv = new Ajv({ allErrors: true });
    addFormats(this.ajv);
  }

  /**
   * On module initialization, register all default tools and wire the
   * proposal service's tool executor callback and the scheduler's analysis service.
   */
  onModuleInit(): void {
    registerDefaultTools();
    // Wire the tool executor so proposals can trigger execution on approval
    this.proposalService.setToolExecutor((invocation) => this.executeToolDirect(invocation));
    // Wire the scheduled analysis service into the scheduler
    this.schedulerService.setScheduledAnalysisService(this.scheduledAnalysisService);
  }

  /**
   * Register a tool in the agent's tool registry.
   * If a tool with the same name already exists, it will be overwritten.
   *
   * Requirement: 5.1
   */
  registerTool(definition: ToolDefinition): void {
    registerTool(definition);
    // Invalidate cached validator for this tool
    this.validatorCache.delete(definition.name);
  }

  /**
   * Retrieve a tool definition by name.
   * Returns undefined if the tool is not registered.
   */
  getTool(name: string): ToolDefinition | undefined {
    return getTool(name);
  }

  /**
   * Retrieve all registered tool definitions.
   *
   * Requirement: 5.3
   */
  getAllTools(): ToolDefinition[] {
    return getAllTools();
  }

  /**
   * Check if a tool is registered.
   */
  hasTool(name: string): boolean {
    return hasTool(name);
  }

  /**
   * Execute a tool invocation with full gate logic:
   * 1. Verify tool exists in registry
   * 2. Validate tenant_id and outlet_id are present
   * 3. Validate input parameters against tool's inputSchema
   * 4. Check automation toggle is enabled for the tenant
   * 5. Check approval_mode: if "autonomous" execute directly and audit-log;
   *    if "approval_required" create a proposal instead
   *
   * Requirements: 5.2, 5.4, 5.5, 5.6, 7.2, 7.3, 7.5
   */
  async executeTool(invocation: ToolInvocation): Promise<ToolResult> {
    const { toolName, tenantId, outletId, parameters, reasoning, confidence } = invocation;

    // 1. Verify tool exists
    const tool = this.getTool(toolName);
    if (!tool) {
      return { success: false, error: `Tool "${toolName}" not found in registry` };
    }

    // 2. Ensure tenant_id and outlet_id are present (Req 5.4)
    if (!tenantId || tenantId.trim() === '') {
      return { success: false, error: 'tenant_id is required' };
    }
    if (!outletId || outletId.trim() === '') {
      return { success: false, error: 'outlet_id is required' };
    }

    // 3. Validate input parameters against tool's inputSchema (Req 5.6)
    const validationError = this.validateToolInput(tool, parameters);
    if (validationError) {
      return { success: false, error: validationError };
    }

    // 4. Check automation toggle is enabled (Req 5.2)
    // Settings are re-loaded on each call, so mode changes apply immediately (Req 7.5)
    const settings = await this.loadSettingsForToggleCheck(tenantId, tool);
    if (!settings) {
      return { success: false, error: 'Automation not enabled' };
    }

    // 5. Check approval_mode for this tool's automation key (Req 7.2)
    const approvalMode = settings.approval_modes[tool.automationKey];

    if (approvalMode === 'autonomous') {
      // Execute immediately and audit-log (Req 7.2, 7.3)
      const result = await this.executeWithRetry(invocation, tool);

      // Audit-log autonomous execution with action_type, parameters, reasoning, and result (Req 7.3)
      await this.auditService.log({
        tenantId,
        userId: 'system',
        operation: 'autonomous_tool_execution',
        entityType: 'tool_execution',
        entityId: toolName,
        afterValue: {
          action_type: toolName,
          parameters,
          reasoning: reasoning ?? 'Autonomous execution — no reasoning provided',
          result: result.success
            ? { success: true, data: result.data }
            : { success: false, error: result.error },
        },
      });

      return result;
    } else {
      // approval_required: create a proposal instead of executing (Req 6.1, 7.2)
      const proposal = await this.proposalService.proposeAction(
        tenantId,
        toolName,
        parameters,
        reasoning ?? 'AI-determined action awaiting approval',
        confidence ?? 0.5,
      );

      return {
        success: true,
        data: {
          proposal_id: proposal.id,
          status: 'proposal_created',
          message: `Action proposed for approval (proposal ${proposal.id})`,
        },
      };
    }
  }

  /**
   * Validate tool input parameters against the tool's inputSchema.
   * Returns an error message string if validation fails, or null if valid.
   *
   * Requirement: 5.6
   */
  private validateToolInput(tool: ToolDefinition, parameters: Record<string, unknown>): string | null {
    let validate = this.validatorCache.get(tool.name);
    if (!validate) {
      validate = this.ajv.compile(tool.inputSchema);
      this.validatorCache.set(tool.name, validate);
    }

    const valid = validate(parameters);
    if (!valid) {
      const errors = validate.errors ?? [];
      const messages = errors.map(e => {
        const path = e.instancePath || '/';
        return `${path}: ${e.message}`;
      });
      return `Input validation failed: ${messages.join('; ')}`;
    }

    return null;
  }

  /**
   * Load tenant settings and check whether the automation toggle for this tool
   * is enabled. Returns the settings object if enabled, or null if disabled.
   *
   * Requirements: 5.2, 7.5
   */
  private async loadSettingsForToggleCheck(
    tenantId: string,
    tool: ToolDefinition,
  ): Promise<import('../settings/settings.interfaces').TenantAutomationSettings | null> {
    try {
      const settings = await this.settingsService.getSettings(tenantId);
      const toggleKey = tool.automationKey;
      const isEnabled = settings.automation_toggles[toggleKey];

      if (!isEnabled) {
        return null;
      }

      return settings;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to check toggle for tenant ${tenantId}: ${message}`);
      return null;
    }
  }


  /**
   * Execute a tool with retry logic: up to 3 total attempts with
   * exponential backoff (1s, 2s, 4s), then cease and log.
   *
   * Requirement: 5.5
   */
  private async executeWithRetry(
    invocation: ToolInvocation,
    tool: ToolDefinition,
  ): Promise<ToolResult> {
    const maxAttempts = 3;
    const baseDelayMs = 1000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this.performToolExecution(invocation, tool);

        if (result.success) {
          return result;
        }

        // Tool returned a non-success result (logical failure)
        if (attempt < maxAttempts) {
          const delay = baseDelayMs * Math.pow(2, attempt - 1);
          this.logger.warn(
            `Tool "${invocation.toolName}" failed (attempt ${attempt}/${maxAttempts}): ${result.error}. Retrying in ${delay}ms...`,
          );
          await this.sleep(delay);
        } else {
          this.logger.error(
            `Tool "${invocation.toolName}" failed after ${maxAttempts} attempts. Last error: ${result.error}`,
          );
          return result;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        if (attempt < maxAttempts) {
          const delay = baseDelayMs * Math.pow(2, attempt - 1);
          this.logger.warn(
            `Tool "${invocation.toolName}" threw error (attempt ${attempt}/${maxAttempts}): ${errorMessage}. Retrying in ${delay}ms...`,
          );
          await this.sleep(delay);
        } else {
          this.logger.error(
            `Tool "${invocation.toolName}" failed after ${maxAttempts} attempts. Last error: ${errorMessage}`,
          );
          return { success: false, error: `Tool execution failed after ${maxAttempts} attempts: ${errorMessage}` };
        }
      }
    }

    // Should never reach here, but TypeScript needs a return
    return { success: false, error: 'Unexpected retry loop exit' };
  }

  /**
   * Perform the actual tool execution.
   * Currently a placeholder/stub that returns success.
   * Will be replaced with real tool handlers in future tasks.
   *
   * The invocation includes tenant_id and outlet_id for proper data scoping (Req 5.4).
   */
  private async performToolExecution(
    _invocation: ToolInvocation,
    _tool: ToolDefinition,
  ): Promise<ToolResult> {
    // Stub: real execution will be wired to actual tool handlers in integration tasks
    return { success: true, data: {} };
  }

  /**
   * Execute a tool directly, bypassing toggle checks.
   * Used by ProposalService when executing approved proposals —
   * the toggle was already checked at proposal creation time.
   *
   * Requirement: 6.4
   */
  async executeToolDirect(invocation: ToolInvocation): Promise<ToolResult> {
    const { toolName, tenantId, outletId, parameters } = invocation;

    // Verify tool exists
    const tool = this.getTool(toolName);
    if (!tool) {
      return { success: false, error: `Tool "${toolName}" not found in registry` };
    }

    // Ensure tenant_id and outlet_id are present
    if (!tenantId || tenantId.trim() === '') {
      return { success: false, error: 'tenant_id is required' };
    }
    if (!outletId || outletId.trim() === '') {
      return { success: false, error: 'outlet_id is required' };
    }

    // Validate input parameters
    const validationError = this.validateToolInput(tool, parameters);
    if (validationError) {
      return { success: false, error: validationError };
    }

    // Execute with retry logic
    const result = await this.executeWithRetry(invocation, tool);

    // Audit-log tool execution failure after retries exhausted (Req 5.5)
    if (!result.success) {
      await this.auditService.log({
        tenantId,
        userId: 'system',
        operation: 'tool_execution_failed',
        entityType: 'tool_execution',
        entityId: toolName,
        afterValue: {
          action_type: toolName,
          parameters,
          error: result.error,
        },
      });
    }

    return result;
  }

  /**
   * Propose an action for tenant-owner approval.
   * Delegates to ProposalService.
   *
   * Requirement: 6.1, 6.2
   */
  async proposeAction(
    tenantId: string,
    actionType: string,
    params: Record<string, unknown>,
    reasoning: string,
    confidence: number,
  ): Promise<ActionProposal> {
    return this.proposalService.proposeAction(tenantId, actionType, params, reasoning, confidence);
  }

  /**
   * Sleep utility for exponential backoff.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
