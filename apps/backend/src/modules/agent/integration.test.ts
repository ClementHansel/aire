import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentService } from './agent.service';
import { ProposalService } from './proposal.service';
import { SchedulerService } from './scheduler.service';
import { ScheduledAnalysisService } from './scheduled-analysis.service';
import { LLMRouterService } from './llm-router.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notification/notification.service';
import { clearToolRegistry } from './agent.tools';
import type { TenantAutomationSettings } from '../settings/settings.interfaces';
import { DEFAULT_AUTOMATION_SETTINGS } from '../settings/settings.interfaces';
import type { ToolDefinition } from './agent.types';

/**
 * Integration tests for end-to-end AI Agent flows.
 *
 * These tests wire real service instances together with mocked infrastructure
 * (database pool, network) to verify cross-module communication and state transitions.
 *
 * Requirements: 4.6, 7.2, 8.3, 10.1
 */

// ─── Shared Test Fixtures ─────────────────────────────────────────────

const TENANT_ID = 'tenant-integration-001';
const OUTLET_ID = 'outlet-integration-001';
const USER_ID = 'user-owner-001';

const CAMPAIGNS_TOOL: ToolDefinition = {
  name: 'create_campaign',
  description: 'Creates a marketing campaign for the tenant',
  inputSchema: {
    type: 'object',
    properties: {
      campaign_name: { type: 'string' },
      target_audience: { type: 'string' },
      budget: { type: 'number', minimum: 0 },
    },
    required: ['campaign_name', 'target_audience'],
  },
  outputSchema: {
    type: 'object',
    properties: { campaign_id: { type: 'string' } },
  },
  automationKey: 'campaigns',
};

function createMockPool() {
  const queryResults: Record<string, any> = {};

  const mockPool = {
    query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
      // INSERT into action_proposals
      if (sql.includes('INSERT INTO action_proposals')) {
        return {
          rows: [
            {
              id: 'proposal-int-001',
              tenant_id: params?.[0] ?? TENANT_ID,
              action_type: params?.[1] ?? 'create_campaign',
              parameters: JSON.parse(params?.[2] ?? '{}'),
              ai_reasoning: params?.[3] ?? 'AI reasoning',
              confidence_score: String(params?.[4] ?? 0.8),
              status: 'pending',
              created_at: new Date(),
              resolved_at: null,
              resolved_by: null,
            },
          ],
          rowCount: 1,
        };
      }

      // SELECT from action_proposals (getProposal)
      if (sql.includes('SELECT') && sql.includes('action_proposals') && sql.includes('WHERE id')) {
        return {
          rows: [
            {
              id: params?.[0] ?? 'proposal-int-001',
              tenant_id: TENANT_ID,
              action_type: 'create_campaign',
              parameters: { campaign_name: 'Summer Promo', target_audience: 'new_customers' },
              ai_reasoning: 'Revenue analysis suggests campaign opportunity',
              confidence_score: '0.85',
              status: 'pending',
              created_at: new Date(),
              resolved_at: null,
              resolved_by: null,
            },
          ],
          rowCount: 1,
        };
      }

      // UPDATE action_proposals SET status = 'approved'
      if (sql.includes('UPDATE action_proposals') && sql.includes('approved')) {
        return { rows: [], rowCount: 1 };
      }

      // UPDATE action_proposals SET status = 'expired' (cancel pending)
      if (sql.includes('UPDATE action_proposals') && sql.includes('expired')) {
        return {
          rows: [{ id: 'proposal-int-001', tenant_id: TENANT_ID }],
          rowCount: 1,
        };
      }

      // SELECT users for notification
      if (sql.includes('SELECT') && sql.includes('users') && sql.includes('tenant_owner')) {
        return {
          rows: [{ id: USER_ID, phone: '+628123456789' }],
          rowCount: 1,
        };
      }

      // INSERT INTO scheduled_analysis_runs
      if (sql.includes('INSERT INTO scheduled_analysis_runs')) {
        return { rows: [{ id: 'run-001' }], rowCount: 1 };
      }

      // UPDATE scheduled_analysis_runs
      if (sql.includes('UPDATE scheduled_analysis_runs')) {
        return {
          rows: [
            {
              id: 'run-001',
              tenant_id: TENANT_ID,
              start_time: new Date(),
              end_time: new Date(),
              metrics_reviewed: ['revenue', 'customer_retention'],
              insights_found: 1,
              actions_proposed: 1,
              actions_executed: 0,
              status: 'completed',
            },
          ],
          rowCount: 1,
        };
      }

      // INSERT INTO audit_logs
      if (sql.includes('INSERT INTO audit_logs')) {
        return { rows: [], rowCount: 1 };
      }

      // SELECT settings FROM tenants
      if (sql.includes('SELECT settings FROM tenants')) {
        return {
          rows: [{ settings: queryResults.settings ?? {} }],
          rowCount: 1,
        };
      }

      // UPDATE tenants SET settings (cancelPendingProposals trigger from SettingsService)
      if (sql.includes('UPDATE tenants SET settings')) {
        return {
          rows: [{ settings: queryResults.settings ?? {} }],
          rowCount: 1,
        };
      }

      // Default fallback
      return { rows: [], rowCount: 0 };
    }),
    _setSettings: (settings: Record<string, unknown>) => {
      queryResults.settings = settings;
    },
  };

  return mockPool;
}

// ─── Test Suite 1: Toggle Enable → Scheduled Analysis → Proposal → Approval → Execution ───

describe('Integration: Toggle Enable → Scheduled Analysis → Proposal Creation → Approval → Tool Execution', () => {
  let agentService: AgentService;
  let proposalService: ProposalService;
  let scheduledAnalysisService: ScheduledAnalysisService;
  let settingsService: SettingsService;
  let auditService: AuditService;
  let notificationService: NotificationService;
  let llmRouterService: LLMRouterService;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    clearToolRegistry();
    mockPool = createMockPool();

    // Set up tenant settings with campaigns enabled, approval_required mode
    const tenantSettings: TenantAutomationSettings = {
      ...DEFAULT_AUTOMATION_SETTINGS,
      ai_enabled: true,
      llm_provider: 'hermes_ai',
      automation_toggles: {
        ...DEFAULT_AUTOMATION_SETTINGS.automation_toggles,
        campaigns: true,
      },
      approval_modes: {
        ...DEFAULT_AUTOMATION_SETTINGS.approval_modes,
        campaigns: 'approval_required',
      },
    };
    mockPool._setSettings(tenantSettings);

    // Create real service instances with mocked pool
    auditService = new AuditService(mockPool as any);
    notificationService = {
      sendWhatsApp: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-001' }),
    } as unknown as NotificationService;

    settingsService = new SettingsService(mockPool as any, auditService);
    proposalService = new ProposalService(mockPool as any, auditService, notificationService);
    llmRouterService = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify([
          {
            actionType: 'create_campaign',
            parameters: { campaign_name: 'Summer Promo', target_audience: 'new_customers' },
            reasoning: 'Revenue analysis suggests campaign opportunity',
            confidence: 0.85,
          },
        ]),
        model: 'hermes3:latest',
      }),
    } as unknown as LLMRouterService;

    const schedulerService = { setScheduledAnalysisService: vi.fn() } as unknown as SchedulerService;

    agentService = new AgentService(
      settingsService,
      proposalService,
      schedulerService,
      {} as ScheduledAnalysisService, // placeholder, will be replaced
      auditService,
    );

    scheduledAnalysisService = new ScheduledAnalysisService(
      mockPool as any,
      settingsService,
      llmRouterService,
      agentService,
      auditService,
    );

    // Wire services together (mimics onModuleInit)
    agentService.registerTool(CAMPAIGNS_TOOL);
    proposalService.setToolExecutor((invocation) => agentService.executeToolDirect(invocation));
  });

  it('should create a proposal when scheduled analysis finds an insight with approval_required mode', async () => {
    // Run scheduled analysis — LLM returns an insight for create_campaign
    const run = await scheduledAnalysisService.runScheduledAnalysis(TENANT_ID);

    // Verify the analysis run completed
    expect(run).not.toBeNull();
    expect(run!.status).toBe('completed');
    expect(run!.insights_found).toBe(1);
    expect(run!.actions_proposed).toBe(1);
    expect(run!.actions_executed).toBe(0);

    // Verify a proposal was created (INSERT INTO action_proposals was called)
    const insertCalls = mockPool.query.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO action_proposals'),
    );
    expect(insertCalls.length).toBe(1);
    expect(insertCalls[0]![1]![1]).toBe('create_campaign'); // action_type
  });

  it('should execute the tool when an approved proposal triggers execution', async () => {
    // Approve the proposal — this should trigger tool execution via the wired executor
    const result = await proposalService.approveProposal('proposal-int-001', USER_ID);

    // Verify tool executed successfully
    expect(result.success).toBe(true);

    // Verify the proposal status was updated to 'approved'
    const approveCalls = mockPool.query.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('approved'),
    );
    expect(approveCalls.length).toBeGreaterThan(0);

    // Verify audit log was written for the approval
    const auditCalls = mockPool.query.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO audit_logs'),
    );
    expect(auditCalls.length).toBeGreaterThan(0);
  });

  it('should complete the full flow: analysis → proposal → approval → execution', async () => {
    // Step 1: Run scheduled analysis (creates proposal)
    const run = await scheduledAnalysisService.runScheduledAnalysis(TENANT_ID);
    expect(run).not.toBeNull();
    expect(run!.actions_proposed).toBe(1);

    // Step 2: Approve the proposal (triggers execution)
    const executionResult = await proposalService.approveProposal('proposal-int-001', USER_ID);
    expect(executionResult.success).toBe(true);

    // Step 3: Verify audit trail exists
    const auditCalls = mockPool.query.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO audit_logs'),
    );
    // At least: analysis completed + proposal approved + proposal executed
    expect(auditCalls.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── Test Suite 2: Toggle Enable → Autonomous Mode → Immediate Execution + Audit ───

describe('Integration: Toggle Enable → Autonomous Mode → Immediate Tool Execution with Audit Log', () => {
  let agentService: AgentService;
  let proposalService: ProposalService;
  let settingsService: SettingsService;
  let auditService: AuditService;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    clearToolRegistry();
    mockPool = createMockPool();

    // Set up tenant with campaigns enabled + autonomous mode
    const tenantSettings: TenantAutomationSettings = {
      ...DEFAULT_AUTOMATION_SETTINGS,
      ai_enabled: true,
      llm_provider: 'hermes_ai',
      automation_toggles: {
        ...DEFAULT_AUTOMATION_SETTINGS.automation_toggles,
        campaigns: true,
      },
      approval_modes: {
        ...DEFAULT_AUTOMATION_SETTINGS.approval_modes,
        campaigns: 'autonomous',
      },
    };
    mockPool._setSettings(tenantSettings);

    auditService = new AuditService(mockPool as any);
    settingsService = new SettingsService(mockPool as any, auditService);
    proposalService = {
      setToolExecutor: vi.fn(),
      proposeAction: vi.fn(),
    } as unknown as ProposalService;

    const schedulerService = { setScheduledAnalysisService: vi.fn() } as unknown as SchedulerService;

    agentService = new AgentService(
      settingsService,
      proposalService,
      schedulerService,
      {} as ScheduledAnalysisService,
      auditService,
    );
    agentService.onModuleInit();
    agentService.registerTool(CAMPAIGNS_TOOL);
  });

  it('should execute tool immediately without creating a proposal in autonomous mode', async () => {
    const result = await agentService.executeTool({
      toolName: 'create_campaign',
      tenantId: TENANT_ID,
      outletId: OUTLET_ID,
      parameters: { campaign_name: 'Flash Sale', target_audience: 'vip_members' },
      reasoning: 'Detected high engagement window',
      confidence: 0.92,
    });

    // Tool executes directly
    expect(result.success).toBe(true);

    // No proposal was created
    expect(proposalService.proposeAction).not.toHaveBeenCalled();
  });

  it('should write an audit log entry with action_type, parameters, reasoning, and result', async () => {
    await agentService.executeTool({
      toolName: 'create_campaign',
      tenantId: TENANT_ID,
      outletId: OUTLET_ID,
      parameters: { campaign_name: 'Flash Sale', target_audience: 'vip_members', budget: 500 },
      reasoning: 'Detected high engagement window',
      confidence: 0.92,
    });

    // Verify audit log was called
    const auditCalls = mockPool.query.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO audit_logs'),
    );
    expect(auditCalls.length).toBe(1);

    // Verify audit log contains the correct fields
    const auditParams = auditCalls[0]![1]!;
    expect(auditParams[0]).toBe(TENANT_ID); // tenant_id
    expect(auditParams[3]).toBe('autonomous_tool_execution'); // operation
    expect(auditParams[4]).toBe('tool_execution'); // entity_type
    expect(auditParams[5]).toBe('create_campaign'); // entity_id (tool name)

    // Verify afterValue contains action_type, parameters, reasoning, result
    const afterValue = JSON.parse(auditParams[7]);
    expect(afterValue.action_type).toBe('create_campaign');
    expect(afterValue.parameters).toEqual({
      campaign_name: 'Flash Sale',
      target_audience: 'vip_members',
      budget: 500,
    });
    expect(afterValue.reasoning).toBe('Detected high engagement window');
    expect(afterValue.result).toEqual({ success: true, data: {} });
  });

  it('should use default reasoning text when none is provided', async () => {
    await agentService.executeTool({
      toolName: 'create_campaign',
      tenantId: TENANT_ID,
      outletId: OUTLET_ID,
      parameters: { campaign_name: 'Auto Campaign', target_audience: 'all' },
    });

    const auditCalls = mockPool.query.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO audit_logs'),
    );
    const afterValue = JSON.parse(auditCalls[0]![1]![7]);
    expect(afterValue.reasoning).toContain('no reasoning provided');
  });
});

// ─── Test Suite 3: Toggle Disable → Pending Proposals Cancelled ───

describe('Integration: Toggle Disable → Pending Proposals Cancelled', () => {
  let settingsService: SettingsService;
  let auditService: AuditService;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    mockPool = createMockPool();

    // Start with campaigns enabled
    const tenantSettings: TenantAutomationSettings = {
      ...DEFAULT_AUTOMATION_SETTINGS,
      ai_enabled: true,
      llm_provider: 'hermes_ai',
      automation_toggles: {
        ...DEFAULT_AUTOMATION_SETTINGS.automation_toggles,
        campaigns: true,
      },
      approval_modes: {
        ...DEFAULT_AUTOMATION_SETTINGS.approval_modes,
        campaigns: 'approval_required',
      },
    };
    mockPool._setSettings(tenantSettings);

    auditService = new AuditService(mockPool as any);
    settingsService = new SettingsService(mockPool as any, auditService);
  });

  it('should cancel pending proposals when a toggle is disabled', async () => {
    // Disable the campaigns toggle
    await settingsService.updateSettings(TENANT_ID, USER_ID, {
      automation_toggles: { campaigns: false } as any,
    });

    // Verify that the UPDATE to expire pending proposals was issued
    const expireCalls = mockPool.query.mock.calls.filter(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('UPDATE action_proposals') &&
        call[0].includes('expired'),
    );
    expect(expireCalls.length).toBe(1);

    // Verify it targeted the correct tenant and action_type
    const expireParams = expireCalls[0]![1]!;
    expect(expireParams[0]).toBe(TENANT_ID);
    expect(expireParams[1]).toBe('campaigns');
  });

  it('should not cancel proposals when a toggle remains enabled', async () => {
    // Update something else, keep campaigns enabled
    await settingsService.updateSettings(TENANT_ID, USER_ID, {
      schedule_interval: 'daily',
    });

    // Verify no proposal cancellation was issued
    const expireCalls = mockPool.query.mock.calls.filter(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('UPDATE action_proposals') &&
        call[0].includes('expired'),
    );
    expect(expireCalls.length).toBe(0);
  });

  it('should cancel proposals for the specific toggle that was disabled, not others', async () => {
    // Enable retention_offers first in settings
    const updatedSettings: TenantAutomationSettings = {
      ...DEFAULT_AUTOMATION_SETTINGS,
      ai_enabled: true,
      llm_provider: 'hermes_ai',
      automation_toggles: {
        ...DEFAULT_AUTOMATION_SETTINGS.automation_toggles,
        campaigns: true,
        retention_offers: true,
      },
      approval_modes: {
        ...DEFAULT_AUTOMATION_SETTINGS.approval_modes,
        campaigns: 'approval_required',
        retention_offers: 'approval_required',
      },
    };
    mockPool._setSettings(updatedSettings);

    // Disable only campaigns
    await settingsService.updateSettings(TENANT_ID, USER_ID, {
      automation_toggles: { campaigns: false } as any,
    });

    // Only campaigns proposals should be expired
    const expireCalls = mockPool.query.mock.calls.filter(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('UPDATE action_proposals') &&
        call[0].includes('expired'),
    );
    expect(expireCalls.length).toBe(1);
    expect(expireCalls[0]![1]![1]).toBe('campaigns');
  });
});
