import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentService } from './agent.service';
import { clearToolRegistry } from './agent.tools';
import type { ToolDefinition, ToolInvocation } from './agent.types';
import type { SettingsService } from '../settings/settings.service';
import type { ProposalService } from './proposal.service';
import type { SchedulerService } from './scheduler.service';
import type { ScheduledAnalysisService } from './scheduled-analysis.service';
import type { AuditService } from '../audit/audit.service';
import type { TenantAutomationSettings } from '../settings/settings.interfaces';
import { DEFAULT_AUTOMATION_SETTINGS } from '../settings/settings.interfaces';

/**
 * Unit tests for AgentService.executeTool
 *
 * Requirements: 5.2, 5.4, 5.5, 5.6, 7.2, 7.3, 7.5
 */

const TEST_TOOL: ToolDefinition = {
  name: 'test_tool',
  description: 'A test tool',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string' },
      count: { type: 'number', minimum: 1 },
    },
    required: ['message', 'count'],
  },
  outputSchema: {
    type: 'object',
    properties: { result: { type: 'string' } },
  },
  automationKey: 'campaigns',
};

function createMockSettingsService(
  overrides: Partial<TenantAutomationSettings> = {},
): SettingsService {
  const settings: TenantAutomationSettings = {
    ...DEFAULT_AUTOMATION_SETTINGS,
    ai_enabled: true,
    automation_toggles: {
      ...DEFAULT_AUTOMATION_SETTINGS.automation_toggles,
      campaigns: true,
    },
    approval_modes: {
      ...DEFAULT_AUTOMATION_SETTINGS.approval_modes,
      campaigns: 'autonomous',
    },
    ...overrides,
  };

  return {
    getSettings: vi.fn().mockResolvedValue(settings),
  } as unknown as SettingsService;
}

function createMockProposalService(): ProposalService {
  return {
    setToolExecutor: vi.fn(),
    proposeAction: vi.fn().mockResolvedValue({
      id: 'proposal-1',
      tenant_id: 'tenant-123',
      action_type: 'test_tool',
      parameters: {},
      ai_reasoning: 'Test',
      confidence_score: 0.8,
      status: 'pending',
      created_at: new Date().toISOString(),
      resolved_at: null,
      resolved_by: null,
    }),
  } as unknown as ProposalService;
}

function createMockSchedulerService(): SchedulerService {
  return {
    setScheduledAnalysisService: vi.fn(),
  } as unknown as SchedulerService;
}

function createMockScheduledAnalysisService(): ScheduledAnalysisService {
  return {} as unknown as ScheduledAnalysisService;
}

function createMockAuditService(): AuditService {
  return {
    log: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
}

describe('AgentService.executeTool', () => {
  let service: AgentService;
  let mockSettingsService: SettingsService;
  let mockProposalService: ProposalService;
  let mockSchedulerService: SchedulerService;
  let mockScheduledAnalysisService: ScheduledAnalysisService;
  let mockAuditService: AuditService;

  beforeEach(() => {
    clearToolRegistry();
    mockSettingsService = createMockSettingsService();
    mockProposalService = createMockProposalService();
    mockSchedulerService = createMockSchedulerService();
    mockScheduledAnalysisService = createMockScheduledAnalysisService();
    mockAuditService = createMockAuditService();
    service = new AgentService(mockSettingsService, mockProposalService, mockSchedulerService, mockScheduledAnalysisService, mockAuditService);
    service.onModuleInit();
    service.registerTool(TEST_TOOL);
  });

  it('should execute successfully with valid invocation and enabled toggle in autonomous mode', async () => {
    const invocation: ToolInvocation = {
      toolName: 'test_tool',
      tenantId: 'tenant-123',
      outletId: 'outlet-456',
      parameters: { message: 'hello', count: 5 },
    };

    const result = await service.executeTool(invocation);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({});
  });

  it('should reject when tool is not found in registry', async () => {
    const invocation: ToolInvocation = {
      toolName: 'nonexistent_tool',
      tenantId: 'tenant-123',
      outletId: 'outlet-456',
      parameters: { message: 'hello' },
    };

    const result = await service.executeTool(invocation);

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found in registry');
  });

  it('should reject when tenant_id is missing', async () => {
    const invocation: ToolInvocation = {
      toolName: 'test_tool',
      tenantId: '',
      outletId: 'outlet-456',
      parameters: { message: 'hello', count: 1 },
    };

    const result = await service.executeTool(invocation);

    expect(result.success).toBe(false);
    expect(result.error).toContain('tenant_id is required');
  });

  it('should reject when outlet_id is missing', async () => {
    const invocation: ToolInvocation = {
      toolName: 'test_tool',
      tenantId: 'tenant-123',
      outletId: '',
      parameters: { message: 'hello', count: 1 },
    };

    const result = await service.executeTool(invocation);

    expect(result.success).toBe(false);
    expect(result.error).toContain('outlet_id is required');
  });

  it('resolves the tenant default outlet when outlet_id is missing (owner path)', async () => {
    // A tenant_owner has outlet_id=null; the action tool should still run by
    // falling back to the tenant's first active outlet, not dead-end on the guard.
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'default-outlet-1' }] }) };
    service = new AgentService(
      mockSettingsService, mockProposalService, mockSchedulerService,
      mockScheduledAnalysisService, mockAuditService, undefined, undefined, pool as any,
    );
    service.onModuleInit();
    service.registerTool(TEST_TOOL);

    const result = await service.executeTool({
      toolName: 'test_tool', tenantId: 'tenant-123', outletId: '',
      parameters: { message: 'hello', count: 5 },
    });

    expect(result.success).toBe(true);
    // The default-outlet lookup was performed.
    expect(pool.query).toHaveBeenCalled();
  });

  it('should reject when input parameters fail schema validation (missing required field)', async () => {
    const invocation: ToolInvocation = {
      toolName: 'test_tool',
      tenantId: 'tenant-123',
      outletId: 'outlet-456',
      parameters: { message: 'hello' }, // missing 'count'
    };

    const result = await service.executeTool(invocation);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Input validation failed');
    expect(result.error).toContain('count');
  });

  it('should reject when input parameters fail schema validation (wrong type)', async () => {
    const invocation: ToolInvocation = {
      toolName: 'test_tool',
      tenantId: 'tenant-123',
      outletId: 'outlet-456',
      parameters: { message: 'hello', count: 'not-a-number' },
    };

    const result = await service.executeTool(invocation);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Input validation failed');
  });

  it('should reject when input parameters fail schema validation (below minimum)', async () => {
    const invocation: ToolInvocation = {
      toolName: 'test_tool',
      tenantId: 'tenant-123',
      outletId: 'outlet-456',
      parameters: { message: 'hello', count: 0 },
    };

    const result = await service.executeTool(invocation);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Input validation failed');
  });

  it('should reject when automation toggle is disabled', async () => {
    mockSettingsService = createMockSettingsService({
      automation_toggles: {
        ...DEFAULT_AUTOMATION_SETTINGS.automation_toggles,
        campaigns: false,
      },
    });
    service = new AgentService(mockSettingsService, mockProposalService, mockSchedulerService, mockScheduledAnalysisService, mockAuditService);
    service.onModuleInit();
    service.registerTool(TEST_TOOL);

    const invocation: ToolInvocation = {
      toolName: 'test_tool',
      tenantId: 'tenant-123',
      outletId: 'outlet-456',
      parameters: { message: 'hello', count: 5 },
    };

    const result = await service.executeTool(invocation);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Automation not enabled');
  });

  it('should pass tenant_id and outlet_id in invocation context', async () => {
    const invocation: ToolInvocation = {
      toolName: 'test_tool',
      tenantId: 'tenant-abc',
      outletId: 'outlet-xyz',
      parameters: { message: 'test', count: 1 },
    };

    // The fact that it succeeds means tenant_id and outlet_id were present
    // and passed through to execution
    const result = await service.executeTool(invocation);
    expect(result.success).toBe(true);

    // Verify getSettings was called with the correct tenantId
    expect(mockSettingsService.getSettings).toHaveBeenCalledWith('tenant-abc');
  });

  it('should call getSettings with the provided tenantId to check toggle', async () => {
    const invocation: ToolInvocation = {
      toolName: 'test_tool',
      tenantId: 'specific-tenant-id',
      outletId: 'outlet-456',
      parameters: { message: 'hello', count: 3 },
    };

    await service.executeTool(invocation);

    expect(mockSettingsService.getSettings).toHaveBeenCalledWith('specific-tenant-id');
  });

  it('should handle settings service throwing an error gracefully', async () => {
    mockSettingsService = {
      getSettings: vi.fn().mockRejectedValue(new Error('Database connection failed')),
    } as unknown as SettingsService;
    service = new AgentService(mockSettingsService, mockProposalService, mockSchedulerService, mockScheduledAnalysisService, mockAuditService);
    service.onModuleInit();
    service.registerTool(TEST_TOOL);

    const invocation: ToolInvocation = {
      toolName: 'test_tool',
      tenantId: 'tenant-123',
      outletId: 'outlet-456',
      parameters: { message: 'hello', count: 5 },
    };

    const result = await service.executeTool(invocation);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Automation not enabled');
  });

  // ─── Approval Mode Routing Tests (Req 7.2, 7.3, 7.5) ───────────────

  it('should execute directly when approval_mode is "autonomous" (Req 7.2)', async () => {
    // Default mock has autonomous mode for campaigns
    const invocation: ToolInvocation = {
      toolName: 'test_tool',
      tenantId: 'tenant-123',
      outletId: 'outlet-456',
      parameters: { message: 'autonomous exec', count: 3 },
      reasoning: 'AI determined this action is needed',
    };

    const result = await service.executeTool(invocation);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({});
    // Should NOT create a proposal
    expect(mockProposalService.proposeAction).not.toHaveBeenCalled();
  });

  it('should create a proposal when approval_mode is "approval_required" (Req 7.2)', async () => {
    mockSettingsService = createMockSettingsService({
      automation_toggles: {
        ...DEFAULT_AUTOMATION_SETTINGS.automation_toggles,
        campaigns: true,
      },
      approval_modes: {
        ...DEFAULT_AUTOMATION_SETTINGS.approval_modes,
        campaigns: 'approval_required',
      },
    });
    service = new AgentService(mockSettingsService, mockProposalService, mockSchedulerService, mockScheduledAnalysisService, mockAuditService);
    service.onModuleInit();
    service.registerTool(TEST_TOOL);

    const invocation: ToolInvocation = {
      toolName: 'test_tool',
      tenantId: 'tenant-123',
      outletId: 'outlet-456',
      parameters: { message: 'needs approval', count: 2 },
      reasoning: 'AI suggests this action',
      confidence: 0.85,
    };

    const result = await service.executeTool(invocation);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      proposal_id: 'proposal-1',
      status: 'proposal_created',
    });
    expect(mockProposalService.proposeAction).toHaveBeenCalledWith(
      'tenant-123',
      'test_tool',
      { message: 'needs approval', count: 2 },
      'AI suggests this action',
      0.85,
    );
  });

  it('should audit-log autonomous execution with action_type, parameters, reasoning, and result (Req 7.3)', async () => {
    const invocation: ToolInvocation = {
      toolName: 'test_tool',
      tenantId: 'tenant-123',
      outletId: 'outlet-456',
      parameters: { message: 'audit me', count: 7 },
      reasoning: 'Revenue analysis detected opportunity',
    };

    await service.executeTool(invocation);

    expect(mockAuditService.log).toHaveBeenCalledWith({
      tenantId: 'tenant-123',
      userId: 'system',
      operation: 'autonomous_tool_execution',
      entityType: 'tool_execution',
      entityId: 'test_tool',
      afterValue: {
        action_type: 'test_tool',
        parameters: { message: 'audit me', count: 7 },
        reasoning: 'Revenue analysis detected opportunity',
        result: { success: true, data: {} },
      },
    });
  });

  it('should provide default reasoning when none is supplied in autonomous mode', async () => {
    const invocation: ToolInvocation = {
      toolName: 'test_tool',
      tenantId: 'tenant-123',
      outletId: 'outlet-456',
      parameters: { message: 'no reasoning', count: 1 },
    };

    await service.executeTool(invocation);

    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        afterValue: expect.objectContaining({
          reasoning: 'Autonomous execution — no reasoning provided',
        }),
      }),
    );
  });

  it('should apply mode change immediately — settings re-loaded each call (Req 7.5)', async () => {
    // First call: autonomous mode
    const invocation: ToolInvocation = {
      toolName: 'test_tool',
      tenantId: 'tenant-123',
      outletId: 'outlet-456',
      parameters: { message: 'first call', count: 1 },
    };

    const result1 = await service.executeTool(invocation);
    expect(result1.success).toBe(true);
    expect(result1.data).toEqual({}); // direct execution
    expect(mockProposalService.proposeAction).not.toHaveBeenCalled();

    // Simulate mode switch: now return approval_required
    const newSettings: TenantAutomationSettings = {
      ...DEFAULT_AUTOMATION_SETTINGS,
      ai_enabled: true,
      automation_toggles: { ...DEFAULT_AUTOMATION_SETTINGS.automation_toggles, campaigns: true },
      approval_modes: { ...DEFAULT_AUTOMATION_SETTINGS.approval_modes, campaigns: 'approval_required' },
    };
    (mockSettingsService.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue(newSettings);

    // Second call: should now create a proposal
    const result2 = await service.executeTool({
      ...invocation,
      parameters: { message: 'second call', count: 2 },
      reasoning: 'Still needed',
      confidence: 0.7,
    });

    expect(result2.success).toBe(true);
    expect(result2.data).toMatchObject({ status: 'proposal_created' });
    expect(mockProposalService.proposeAction).toHaveBeenCalled();
  });

  it('should not audit-log when mode is approval_required (proposal is created instead)', async () => {
    mockSettingsService = createMockSettingsService({
      automation_toggles: { ...DEFAULT_AUTOMATION_SETTINGS.automation_toggles, campaigns: true },
      approval_modes: { ...DEFAULT_AUTOMATION_SETTINGS.approval_modes, campaigns: 'approval_required' },
    });
    service = new AgentService(mockSettingsService, mockProposalService, mockSchedulerService, mockScheduledAnalysisService, mockAuditService);
    service.onModuleInit();
    service.registerTool(TEST_TOOL);

    const invocation: ToolInvocation = {
      toolName: 'test_tool',
      tenantId: 'tenant-123',
      outletId: 'outlet-456',
      parameters: { message: 'proposal', count: 1 },
    };

    await service.executeTool(invocation);

    // Audit log should NOT be called for autonomous execution
    expect(mockAuditService.log).not.toHaveBeenCalled();
  });
});
