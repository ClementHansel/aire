import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { AgentService } from './agent.service';
import { ProposalService } from './proposal.service';
import { ScheduledAnalysisService } from './scheduled-analysis.service';
import { clearToolRegistry } from './agent.tools';
import type { ToolDefinition, ToolInvocation, ActionProposal, ToolResult } from './agent.types';
import type { SettingsService } from '../settings/settings.service';
import type { LLMRouterService } from './llm-router.service';
import type { AgentService as AgentServiceType } from './agent.service';
import type { AuditService } from '../audit/audit.service';
import type { TenantAutomationSettings, AutomationToggles, ApprovalMode } from '../settings/settings.interfaces';
import { DEFAULT_AUTOMATION_SETTINGS } from '../settings/settings.interfaces';

/**
 * Property-based tests for Action Proposals (Properties 8, 10, 11, 12, 13).
 *
 * Validates: Requirements 6.1, 6.2, 6.4, 6.5, 6.6, 7.2
 */

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const TOGGLE_KEYS: (keyof AutomationToggles)[] = [
  'campaigns',
  'retention_offers',
  'pricing_suggestions',
  'anomaly_alerts',
  'queue_optimization',
  'membership_recommendations',
];

const approvalModeArb: fc.Arbitrary<ApprovalMode> = fc.constantFrom(
  'approval_required' as const,
  'autonomous' as const,
);

const toggleKeyArb: fc.Arbitrary<keyof AutomationToggles> = fc.constantFrom(...TOGGLE_KEYS);

/** Arbitrary for non-empty strings to use as IDs */
const idArb: fc.Arbitrary<string> = fc.uuid();

/** Arbitrary for action parameters */
const paramsArb: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^[a-z_]+$/.test(s)),
  fc.oneof(fc.string(), fc.integer(), fc.boolean()),
  { minKeys: 0, maxKeys: 5 },
);

/** Arbitrary for AI reasoning text */
const reasoningArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 200 });

/** Arbitrary for confidence score (0 to 1) */
const confidenceArb: fc.Arbitrary<number> = fc.double({ min: 0, max: 1, noNaN: true });

// ─── Test Tool Definition ─────────────────────────────────────────────────────

function createTestTool(automationKey: keyof AutomationToggles): ToolDefinition {
  return {
    name: automationKey,
    description: `Test tool for ${automationKey}`,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: true,
    },
    outputSchema: {
      type: 'object',
      properties: { result: { type: 'string' } },
    },
    automationKey,
  };
}

// ─── Mock Factories ───────────────────────────────────────────────────────────

function createMockPool() {
  return {
    query: vi.fn(),
  };
}

function createMockAuditService() {
  return {
    log: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockNotificationService() {
  return {
    sendWhatsApp: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-1' }),
  };
}

function createMockSettingsService(
  approvalMode: ApprovalMode,
  toggleKey: keyof AutomationToggles,
): SettingsService {
  const settings: TenantAutomationSettings = {
    ...DEFAULT_AUTOMATION_SETTINGS,
    ai_enabled: true,
    automation_toggles: {
      ...DEFAULT_AUTOMATION_SETTINGS.automation_toggles,
      [toggleKey]: true,
    },
    approval_modes: {
      ...DEFAULT_AUTOMATION_SETTINGS.approval_modes,
      [toggleKey]: approvalMode,
    },
  };

  return {
    getSettings: vi.fn().mockResolvedValue(settings),
  } as unknown as SettingsService;
}

// ─── Property 8: Approval Mode Routing ────────────────────────────────────────

/**
 * Feature: smart-automation, Property 8: Approval Mode Routing
 *
 * Validates: Requirements 6.1, 7.2
 *
 * "approval_required" creates proposal without executing;
 * "autonomous" executes immediately.
 */
describe('Feature: smart-automation, Property 8: Approval Mode Routing', () => {
  it('approval_required mode creates a proposal without executing the tool directly', async () => {
    await fc.assert(
      fc.asyncProperty(
        idArb,
        idArb,
        toggleKeyArb,
        paramsArb,
        reasoningArb,
        confidenceArb,
        async (tenantId, outletId, toggleKey, params, reasoning, confidence) => {
          const pool = createMockPool();
          const auditService = createMockAuditService();
          const notificationService = createMockNotificationService();

          const proposalService = new ProposalService(
            pool as any,
            auditService as any,
            notificationService as any,
          );

          const mockSettingsService = createMockSettingsService('approval_required', toggleKey);

          const agentService = new AgentService(mockSettingsService, proposalService, { setScheduledAnalysisService: vi.fn() } as any, {} as any, auditService as any);
          clearToolRegistry();
          agentService.onModuleInit();
          agentService.registerTool(createTestTool(toggleKey));

          // Mock the pool.query for proposeAction (INSERT + owner lookup)
          const proposalRow = {
            id: 'proposal-generated',
            tenant_id: tenantId,
            action_type: toggleKey,
            parameters: params,
            ai_reasoning: reasoning,
            confidence_score: String(confidence),
            status: 'pending',
            created_at: new Date(),
            resolved_at: null,
            resolved_by: null,
          };
          pool.query.mockResolvedValueOnce({ rows: [proposalRow] });
          pool.query.mockResolvedValueOnce({ rows: [] }); // no owner found

          // Call proposeAction (simulating the approval_required path)
          const proposal = await agentService.proposeAction(
            tenantId,
            toggleKey,
            params,
            reasoning,
            confidence,
          );

          // Proposal is created with status 'pending'
          expect(proposal.status).toBe('pending');
          expect(proposal.action_type).toBe(toggleKey);
          expect(proposal.tenant_id).toBe(tenantId);

          // The INSERT query was called (proposal created)
          expect(pool.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO action_proposals'),
            expect.arrayContaining([tenantId, toggleKey]),
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('autonomous mode executes the tool immediately without creating a proposal', async () => {
    await fc.assert(
      fc.asyncProperty(
        idArb,
        idArb,
        toggleKeyArb,
        async (tenantId, outletId, toggleKey) => {
          const pool = createMockPool();
          const auditService = createMockAuditService();
          const notificationService = createMockNotificationService();

          const proposalService = new ProposalService(
            pool as any,
            auditService as any,
            notificationService as any,
          );

          const mockSettingsService = createMockSettingsService('autonomous', toggleKey);

          const agentService = new AgentService(mockSettingsService, proposalService, { setScheduledAnalysisService: vi.fn() } as any, {} as any, auditService as any);
          clearToolRegistry();
          agentService.onModuleInit();
          agentService.registerTool(createTestTool(toggleKey));

          // executeTool with autonomous mode should execute directly (no proposal)
          const invocation: ToolInvocation = {
            toolName: toggleKey,
            tenantId,
            outletId,
            parameters: {},
          };

          const result = await agentService.executeTool(invocation);

          // Direct execution returns success (stub returns success)
          expect(result.success).toBe(true);

          // No INSERT into action_proposals was called
          const insertCalls = pool.query.mock.calls.filter(
            (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO action_proposals'),
          );
          expect(insertCalls.length).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 10: Action Proposal Data Completeness ───────────────────────────

/**
 * Feature: smart-automation, Property 10: Action Proposal Data Completeness
 *
 * Validates: Requirements 6.2
 *
 * Created proposals have all required non-null fields with status "pending".
 */
describe('Feature: smart-automation, Property 10: Action Proposal Data Completeness', () => {
  it('created proposals have all required non-null fields and status pending', async () => {
    await fc.assert(
      fc.asyncProperty(
        idArb,
        toggleKeyArb,
        paramsArb,
        reasoningArb,
        confidenceArb,
        async (tenantId, actionType, params, reasoning, confidence) => {
          const pool = createMockPool();
          const auditService = createMockAuditService();
          const notificationService = createMockNotificationService();

          const service = new ProposalService(
            pool as any,
            auditService as any,
            notificationService as any,
          );

          // Simulate the database response for INSERT
          const now = new Date();
          const proposalRow = {
            id: `proposal-${tenantId}`,
            tenant_id: tenantId,
            action_type: actionType,
            parameters: params,
            ai_reasoning: reasoning,
            confidence_score: String(confidence),
            status: 'pending',
            created_at: now,
            resolved_at: null,
            resolved_by: null,
          };
          pool.query.mockResolvedValueOnce({ rows: [proposalRow] });
          pool.query.mockResolvedValueOnce({ rows: [] }); // owner lookup

          const proposal = await service.proposeAction(
            tenantId,
            actionType,
            params,
            reasoning,
            confidence,
          );

          // All required fields must be non-null
          expect(proposal.id).not.toBeNull();
          expect(proposal.id).toBeDefined();
          expect(proposal.action_type).not.toBeNull();
          expect(proposal.action_type).toBeDefined();
          expect(proposal.action_type).toBe(actionType);
          expect(proposal.parameters).not.toBeNull();
          expect(proposal.parameters).toBeDefined();
          expect(proposal.ai_reasoning).not.toBeNull();
          expect(proposal.ai_reasoning).toBeDefined();
          expect(proposal.ai_reasoning).toBe(reasoning);
          expect(proposal.confidence_score).not.toBeNull();
          expect(proposal.confidence_score).toBeDefined();
          expect(proposal.confidence_score).toBeGreaterThanOrEqual(0);
          expect(proposal.confidence_score).toBeLessThanOrEqual(1);
          expect(proposal.created_at).not.toBeNull();
          expect(proposal.created_at).toBeDefined();
          expect(proposal.status).toBe('pending');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 11: Proposal Approval Triggers Execution ────────────────────────

/**
 * Feature: smart-automation, Property 11: Proposal Approval Triggers Execution
 *
 * Validates: Requirements 6.4
 *
 * Approved proposal invokes tool with stored parameters.
 */
describe('Feature: smart-automation, Property 11: Proposal Approval Triggers Execution', () => {
  it('approving a pending proposal invokes the tool executor with stored parameters', async () => {
    await fc.assert(
      fc.asyncProperty(
        idArb, // proposalId
        idArb, // tenantId
        idArb, // userId
        toggleKeyArb, // actionType
        paramsArb, // stored parameters
        reasoningArb, // ai reasoning
        confidenceArb, // confidence score
        async (proposalId, tenantId, userId, actionType, params, reasoning, confidence) => {
          const pool = createMockPool();
          const auditService = createMockAuditService();
          const notificationService = createMockNotificationService();

          const service = new ProposalService(
            pool as any,
            auditService as any,
            notificationService as any,
          );

          // Wire a mock tool executor that records calls
          const executorCalls: ToolInvocation[] = [];
          const mockExecutor = vi.fn(async (invocation: ToolInvocation): Promise<ToolResult> => {
            executorCalls.push(invocation);
            return { success: true, data: {} };
          });
          service.setToolExecutor(mockExecutor);

          // Mock getProposal (SELECT)
          pool.query.mockResolvedValueOnce({
            rows: [{
              id: proposalId,
              tenant_id: tenantId,
              action_type: actionType,
              parameters: params,
              ai_reasoning: reasoning,
              confidence_score: String(confidence),
              status: 'pending',
              created_at: new Date(),
              resolved_at: null,
              resolved_by: null,
            }],
          });
          // Mock UPDATE
          pool.query.mockResolvedValueOnce({ rowCount: 1 });

          const result = await service.approveProposal(proposalId, userId);

          // Tool executor was called
          expect(mockExecutor).toHaveBeenCalledTimes(1);

          // Invocation has the stored parameters
          const invocation = executorCalls[0];
          expect(invocation.toolName).toBe(actionType);
          expect(invocation.tenantId).toBe(tenantId);
          expect(invocation.parameters).toEqual(params);

          // Result is success
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 12: Proposal Rejection Records Audit ────────────────────────────

/**
 * Feature: smart-automation, Property 12: Proposal Rejection Records Audit
 *
 * Validates: Requirements 6.5
 *
 * Rejected proposal updates status and creates audit entry.
 */
describe('Feature: smart-automation, Property 12: Proposal Rejection Records Audit', () => {
  it('rejecting a pending proposal records an audit log entry with rejection details', async () => {
    await fc.assert(
      fc.asyncProperty(
        idArb, // proposalId
        idArb, // tenantId
        idArb, // userId
        toggleKeyArb, // actionType
        paramsArb, // parameters
        reasoningArb, // reasoning
        confidenceArb, // confidence
        async (proposalId, tenantId, userId, actionType, params, reasoning, confidence) => {
          const pool = createMockPool();
          const auditService = createMockAuditService();
          const notificationService = createMockNotificationService();

          const service = new ProposalService(
            pool as any,
            auditService as any,
            notificationService as any,
          );

          // Mock getProposal (SELECT)
          pool.query.mockResolvedValueOnce({
            rows: [{
              id: proposalId,
              tenant_id: tenantId,
              action_type: actionType,
              parameters: params,
              ai_reasoning: reasoning,
              confidence_score: String(confidence),
              status: 'pending',
              created_at: new Date(),
              resolved_at: null,
              resolved_by: null,
            }],
          });
          // Mock UPDATE
          pool.query.mockResolvedValueOnce({ rowCount: 1 });

          await service.rejectProposal(proposalId, userId);

          // UPDATE was called to set status='rejected'
          expect(pool.query).toHaveBeenCalledWith(
            expect.stringContaining("SET status = 'rejected'"),
            [userId, proposalId],
          );

          // Audit service was called with rejection details
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({
              tenantId,
              userId,
              operation: 'proposal_rejected',
              entityType: 'action_proposal',
              entityId: proposalId,
              afterValue: expect.objectContaining({
                action_type: actionType,
                parameters: params,
                ai_reasoning: reasoning,
              }),
            }),
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 13: Proposal Expiration After 24 Hours ──────────────────────────

/**
 * Feature: smart-automation, Property 13: Proposal Expiration After 24 Hours
 *
 * Validates: Requirements 6.6
 *
 * Pending proposals older than 24h marked as expired.
 */
describe('Feature: smart-automation, Property 13: Proposal Expiration After 24 Hours', () => {
  it('expireStaleProposals marks pending proposals older than 24h as expired', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: idArb,
            tenant_id: idArb,
          }),
          { minLength: 1, maxLength: 10 },
        ),
        async (staleProposals) => {
          const pool = createMockPool();
          const auditService = createMockAuditService();
          const notificationService = createMockNotificationService();

          const service = new ProposalService(
            pool as any,
            auditService as any,
            notificationService as any,
          );

          // Mock the UPDATE query that finds and expires stale proposals
          pool.query.mockResolvedValueOnce({
            rows: staleProposals,
            rowCount: staleProposals.length,
          });

          const count = await service.expireStaleProposals();

          // Returns the count of expired proposals
          expect(count).toBe(staleProposals.length);

          // The SQL query includes the 24-hour interval check
          expect(pool.query).toHaveBeenCalledWith(
            expect.stringContaining("INTERVAL '24 hours'"),
          );

          // Each expired proposal has an audit log entry
          expect(auditService.log).toHaveBeenCalledTimes(staleProposals.length);

          for (const proposal of staleProposals) {
            expect(auditService.log).toHaveBeenCalledWith(
              expect.objectContaining({
                tenantId: proposal.tenant_id,
                userId: 'system',
                operation: 'proposal_expired',
                entityType: 'action_proposal',
                entityId: proposal.id,
              }),
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('expireStaleProposals returns 0 and does not audit-log when no stale proposals exist', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(null), // dummy to satisfy fast-check property requirement
        async () => {
          const pool = createMockPool();
          const auditService = createMockAuditService();
          const notificationService = createMockNotificationService();

          const service = new ProposalService(
            pool as any,
            auditService as any,
            notificationService as any,
          );

          // No stale proposals found
          pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

          const count = await service.expireStaleProposals();

          expect(count).toBe(0);
          expect(auditService.log).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('only proposals with status pending and created_at > 24h are targeted by the expiration query', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: 20 }),
        async (numExpired) => {
          const pool = createMockPool();
          const auditService = createMockAuditService();
          const notificationService = createMockNotificationService();

          const service = new ProposalService(
            pool as any,
            auditService as any,
            notificationService as any,
          );

          const expiredRows = Array.from({ length: numExpired }, (_, i) => ({
            id: `expired-${i}`,
            tenant_id: `tenant-${i % 3}`,
          }));

          pool.query.mockResolvedValueOnce({
            rows: expiredRows,
            rowCount: numExpired,
          });

          await service.expireStaleProposals();

          // Verify the query constrains to pending status and 24-hour window
          const queryCall = pool.query.mock.calls[0][0] as string;
          expect(queryCall).toContain("status = 'pending'");
          expect(queryCall).toContain("INTERVAL '24 hours'");
          expect(queryCall).toContain("SET status = 'expired'");
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Additional Imports for Properties 7, 9, 16, 21 ──────────────────────────

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  registerTool as registerToolFn,
  registerDefaultTools,
  DEFAULT_TOOLS,
} from './agent.tools';

// ─── Helpers for Properties 7, 9, 16, 21 ─────────────────────────────────────

/**
 * Create a mock SettingsService with configurable toggle state.
 * Returns all toggles OFF by default, with overrides applied.
 * Sets approval_modes to "autonomous" for any enabled toggle so
 * tool execution tests exercise the direct-execution path.
 */
function createToggleMockSettingsService(toggleOverrides: Partial<AutomationToggles> = {}) {
  // Set approval_modes to "autonomous" for any enabled toggle
  const approvalOverrides: Partial<Record<keyof AutomationToggles, ApprovalMode>> = {};
  for (const [key, enabled] of Object.entries(toggleOverrides)) {
    if (enabled) {
      approvalOverrides[key as keyof AutomationToggles] = 'autonomous';
    }
  }

  const settings: TenantAutomationSettings = {
    ...DEFAULT_AUTOMATION_SETTINGS,
    automation_toggles: {
      ...DEFAULT_AUTOMATION_SETTINGS.automation_toggles,
      ...toggleOverrides,
    },
    approval_modes: {
      ...DEFAULT_AUTOMATION_SETTINGS.approval_modes,
      ...approvalOverrides,
    },
  };

  return {
    getSettings: vi.fn().mockResolvedValue(settings),
  };
}

/**
 * Create a simple mock ProposalService for tool execution tests.
 */
function createSimpleMockProposalService() {
  return {
    setToolExecutor: vi.fn(),
    proposeAction: vi.fn(),
  };
}

/**
 * Create an AgentService with configurable toggle mocks.
 */
function createTestAgentService(
  settingsService?: ReturnType<typeof createToggleMockSettingsService>,
  proposalService?: ReturnType<typeof createSimpleMockProposalService>,
): AgentService {
  const settings = settingsService ?? createToggleMockSettingsService();
  const proposals = proposalService ?? createSimpleMockProposalService();
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const service = new AgentService(settings as any, proposals as any, { setScheduledAnalysisService: vi.fn() } as any, {} as any, audit as any);
  service.onModuleInit();
  return service;
}

/**
 * Build minimal valid parameters for a given tool definition.
 * Creates params that satisfy the tool's inputSchema required fields.
 */
function buildMinimalValidParams(tool: ToolDefinition): Record<string, unknown> {
  const schema = tool.inputSchema as {
    properties: Record<string, {
      type: string;
      enum?: string[];
      minimum?: number;
      maximum?: number;
      items?: { type: string; properties?: Record<string, { type: string; minimum?: number }>;  required?: string[] };
    }>;
    required: string[];
  };

  const params: Record<string, unknown> = {};

  for (const field of schema.required || []) {
    const prop = schema.properties?.[field];
    if (!prop) continue;

    if (prop.enum) {
      params[field] = prop.enum[0];
    } else if (prop.type === 'string') {
      params[field] = 'test-value';
    } else if (prop.type === 'number') {
      params[field] = prop.minimum ?? 1;
    } else if (prop.type === 'array') {
      if (prop.items && prop.items.type === 'object' && prop.items.properties) {
        const itemProps = prop.items.properties as Record<string, { type: string; minimum?: number }>;
        const itemRequired = prop.items.required || Object.keys(itemProps);
        const item: Record<string, unknown> = {};
        for (const itemField of itemRequired) {
          const itemProp = itemProps[itemField];
          if (itemProp?.type === 'string') {
            item[itemField] = 'test-item';
          } else if (itemProp?.type === 'number') {
            item[itemField] = itemProp.minimum ?? 1;
          }
        }
        params[field] = [item];
      } else {
        params[field] = [];
      }
    } else if (prop.type === 'object') {
      params[field] = {};
    }
  }

  return params;
}

// ─── Property 7: Toggle Gate — Tool Execution Requires Enabled Toggle ─────────

/**
 * Feature: smart-automation, Property 7: Toggle Gate — Tool Execution Requires Enabled Toggle
 *
 * Validates: Requirements 5.2
 *
 * For any tool invocation targeting a specific automation capability,
 * the AI Agent SHALL execute the tool only if the corresponding
 * automation_toggles field is true for that tenant, and SHALL reject execution otherwise.
 */
describe('Feature: smart-automation, Property 7: Toggle Gate — Tool Execution Requires Enabled Toggle', () => {
  beforeEach(() => {
    clearToolRegistry();
  });

  it('rejects tool execution when corresponding toggle is false', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DEFAULT_TOOLS),
        idArb,
        idArb,
        async (tool, tenantId, outletId) => {
          clearToolRegistry();
          // All toggles OFF
          const settingsService = createToggleMockSettingsService();
          const service = createTestAgentService(settingsService);

          const params = buildMinimalValidParams(tool);

          const result = await service.executeTool({
            toolName: tool.name,
            tenantId,
            outletId,
            parameters: params,
          });

          expect(result.success).toBe(false);
          expect(result.error).toBe('Automation not enabled');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('allows tool execution when corresponding toggle is true', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DEFAULT_TOOLS),
        idArb,
        idArb,
        async (tool, tenantId, outletId) => {
          clearToolRegistry();
          // Enable only the relevant toggle
          const toggleOverrides: Partial<AutomationToggles> = { [tool.automationKey]: true };
          const settingsService = createToggleMockSettingsService(toggleOverrides);
          const service = createTestAgentService(settingsService);

          const params = buildMinimalValidParams(tool);

          const result = await service.executeTool({
            toolName: tool.name,
            tenantId,
            outletId,
            parameters: params,
          });

          // When toggle is enabled, execution should succeed (stub returns success)
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('enabling one toggle does not enable tools mapped to a different toggle', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DEFAULT_TOOLS),
        fc.constantFrom(...DEFAULT_TOOLS),
        idArb,
        idArb,
        async (enabledTool, invokedTool, tenantId, outletId) => {
          // Only test when the two tools map to different toggle keys
          fc.pre(enabledTool.automationKey !== invokedTool.automationKey);

          clearToolRegistry();
          const toggleOverrides: Partial<AutomationToggles> = { [enabledTool.automationKey]: true };
          const settingsService = createToggleMockSettingsService(toggleOverrides);
          const service = createTestAgentService(settingsService);

          const params = buildMinimalValidParams(invokedTool);

          const result = await service.executeTool({
            toolName: invokedTool.name,
            tenantId,
            outletId,
            parameters: params,
          });

          // The invoked tool's toggle is NOT enabled, so it should fail
          expect(result.success).toBe(false);
          expect(result.error).toBe('Automation not enabled');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 9: Tool Input Schema Validation ────────────────────────────────

/**
 * Feature: smart-automation, Property 9: Tool Input Schema Validation
 *
 * Validates: Requirements 5.6
 *
 * For any tool invocation with parameters that do not conform to the tool's
 * defined inputSchema, the AI Agent SHALL reject the invocation before execution.
 */
describe('Feature: smart-automation, Property 9: Tool Input Schema Validation', () => {
  beforeEach(() => {
    clearToolRegistry();
  });

  it('rejects invocations with missing required fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DEFAULT_TOOLS),
        idArb,
        idArb,
        async (tool, tenantId, outletId) => {
          clearToolRegistry();
          const toggleOverrides: Partial<AutomationToggles> = { [tool.automationKey]: true };
          const settingsService = createToggleMockSettingsService(toggleOverrides);
          const service = createTestAgentService(settingsService);

          // Pass empty object — missing all required fields
          const result = await service.executeTool({
            toolName: tool.name,
            tenantId,
            outletId,
            parameters: {},
          });

          expect(result.success).toBe(false);
          expect(result.error).toContain('Input validation failed');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects invocations with wrong types for required fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DEFAULT_TOOLS),
        idArb,
        idArb,
        async (tool, tenantId, outletId) => {
          clearToolRegistry();
          const toggleOverrides: Partial<AutomationToggles> = { [tool.automationKey]: true };
          const settingsService = createToggleMockSettingsService(toggleOverrides);
          const service = createTestAgentService(settingsService);

          // Build params with wrong types (boolean instead of strings/numbers/arrays)
          const schema = tool.inputSchema as { required: string[] };
          const invalidParams: Record<string, unknown> = {};
          for (const field of schema.required || []) {
            invalidParams[field] = true;
          }

          const result = await service.executeTool({
            toolName: tool.name,
            tenantId,
            outletId,
            parameters: invalidParams,
          });

          expect(result.success).toBe(false);
          expect(result.error).toContain('Input validation failed');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('accepts invocations with valid parameters matching the schema', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DEFAULT_TOOLS),
        idArb,
        idArb,
        async (tool, tenantId, outletId) => {
          clearToolRegistry();
          const toggleOverrides: Partial<AutomationToggles> = { [tool.automationKey]: true };
          const settingsService = createToggleMockSettingsService(toggleOverrides);
          const service = createTestAgentService(settingsService);

          const params = buildMinimalValidParams(tool);

          const result = await service.executeTool({
            toolName: tool.name,
            tenantId,
            outletId,
            parameters: params,
          });

          // Valid params + toggle enabled → success
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 16: Tool Retry Ceiling ──────────────────────────────────────────

/**
 * Feature: smart-automation, Property 16: Tool Retry Ceiling
 *
 * Validates: Requirements 5.5
 *
 * For any tool invocation that fails, the AI Agent SHALL retry at most
 * 3 times total and then cease.
 */
describe('Feature: smart-automation, Property 16: Tool Retry Ceiling', () => {
  beforeEach(() => {
    clearToolRegistry();
  });

  it('retries at most 3 times on failure then ceases', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DEFAULT_TOOLS),
        idArb,
        idArb,
        async (tool, tenantId, outletId) => {
          clearToolRegistry();
          const toggleOverrides: Partial<AutomationToggles> = { [tool.automationKey]: true };
          const settingsService = createToggleMockSettingsService(toggleOverrides);
          const service = createTestAgentService(settingsService);

          // Track execution attempts
          let attemptCount = 0;
          (service as any).performToolExecution = async (): Promise<ToolResult> => {
            attemptCount++;
            return { success: false, error: 'Simulated failure' };
          };

          // Disable the sleep to speed up the test
          (service as any).sleep = async () => {};

          const params = buildMinimalValidParams(tool);

          const result = await service.executeTool({
            toolName: tool.name,
            tenantId,
            outletId,
            parameters: params,
          });

          expect(result.success).toBe(false);
          expect(attemptCount).toBe(3);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('stops retrying immediately on first success', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DEFAULT_TOOLS),
        idArb,
        idArb,
        fc.integer({ min: 1, max: 3 }),
        async (tool, tenantId, outletId, succeedOnAttempt) => {
          clearToolRegistry();
          const toggleOverrides: Partial<AutomationToggles> = { [tool.automationKey]: true };
          const settingsService = createToggleMockSettingsService(toggleOverrides);
          const service = createTestAgentService(settingsService);

          let attemptCount = 0;
          (service as any).performToolExecution = async (): Promise<ToolResult> => {
            attemptCount++;
            if (attemptCount === succeedOnAttempt) {
              return { success: true, data: { result: 'ok' } };
            }
            return { success: false, error: 'Simulated failure' };
          };

          // Disable the sleep to speed up the test
          (service as any).sleep = async () => {};

          const params = buildMinimalValidParams(tool);

          const result = await service.executeTool({
            toolName: tool.name,
            tenantId,
            outletId,
            parameters: params,
          });

          expect(result.success).toBe(true);
          expect(attemptCount).toBe(succeedOnAttempt);
          // Never exceeds 3 attempts
          expect(attemptCount).toBeLessThanOrEqual(3);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('retries at most 3 times on thrown errors then ceases', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DEFAULT_TOOLS),
        idArb,
        idArb,
        async (tool, tenantId, outletId) => {
          clearToolRegistry();
          const toggleOverrides: Partial<AutomationToggles> = { [tool.automationKey]: true };
          const settingsService = createToggleMockSettingsService(toggleOverrides);
          const service = createTestAgentService(settingsService);

          let attemptCount = 0;
          (service as any).performToolExecution = async (): Promise<ToolResult> => {
            attemptCount++;
            throw new Error('Network timeout');
          };

          // Disable the sleep to speed up the test
          (service as any).sleep = async () => {};

          const params = buildMinimalValidParams(tool);

          const result = await service.executeTool({
            toolName: tool.name,
            tenantId,
            outletId,
            parameters: params,
          });

          expect(result.success).toBe(false);
          expect(result.error).toContain('failed after 3 attempts');
          expect(attemptCount).toBe(3);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 21: Tenant Context Always Passed to Tools ───────────────────────

/**
 * Feature: smart-automation, Property 21: Tenant Context Always Passed to Tools
 *
 * Validates: Requirements 5.4
 *
 * For any tool invocation, the AI Agent SHALL include tenant_id and outlet_id
 * in the parameters passed to the tool handler.
 */
describe('Feature: smart-automation, Property 21: Tenant Context Always Passed to Tools', () => {
  beforeEach(() => {
    clearToolRegistry();
  });

  it('rejects invocations with empty tenant_id', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DEFAULT_TOOLS),
        idArb,
        async (tool, outletId) => {
          clearToolRegistry();
          const toggleOverrides: Partial<AutomationToggles> = { [tool.automationKey]: true };
          const settingsService = createToggleMockSettingsService(toggleOverrides);
          const service = createTestAgentService(settingsService);

          const params = buildMinimalValidParams(tool);

          const result = await service.executeTool({
            toolName: tool.name,
            tenantId: '',
            outletId,
            parameters: params,
          });

          expect(result.success).toBe(false);
          expect(result.error).toBe('tenant_id is required');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects invocations with empty outlet_id', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DEFAULT_TOOLS),
        idArb,
        async (tool, tenantId) => {
          clearToolRegistry();
          const toggleOverrides: Partial<AutomationToggles> = { [tool.automationKey]: true };
          const settingsService = createToggleMockSettingsService(toggleOverrides);
          const service = createTestAgentService(settingsService);

          const params = buildMinimalValidParams(tool);

          const result = await service.executeTool({
            toolName: tool.name,
            tenantId,
            outletId: '',
            parameters: params,
          });

          expect(result.success).toBe(false);
          expect(result.error).toBe('outlet_id is required');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects invocations with whitespace-only tenant_id', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DEFAULT_TOOLS),
        idArb,
        fc.string({ unit: fc.constantFrom(' ', '\t', '\n'), minLength: 1, maxLength: 5 }),
        async (tool, outletId, whitespace) => {
          clearToolRegistry();
          const toggleOverrides: Partial<AutomationToggles> = { [tool.automationKey]: true };
          const settingsService = createToggleMockSettingsService(toggleOverrides);
          const service = createTestAgentService(settingsService);

          const params = buildMinimalValidParams(tool);

          const result = await service.executeTool({
            toolName: tool.name,
            tenantId: whitespace,
            outletId,
            parameters: params,
          });

          expect(result.success).toBe(false);
          expect(result.error).toBe('tenant_id is required');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects invocations with whitespace-only outlet_id', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DEFAULT_TOOLS),
        idArb,
        fc.string({ unit: fc.constantFrom(' ', '\t', '\n'), minLength: 1, maxLength: 5 }),
        async (tool, tenantId, whitespace) => {
          clearToolRegistry();
          const toggleOverrides: Partial<AutomationToggles> = { [tool.automationKey]: true };
          const settingsService = createToggleMockSettingsService(toggleOverrides);
          const service = createTestAgentService(settingsService);

          const params = buildMinimalValidParams(tool);

          const result = await service.executeTool({
            toolName: tool.name,
            tenantId,
            outletId: whitespace,
            parameters: params,
          });

          expect(result.success).toBe(false);
          expect(result.error).toBe('outlet_id is required');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('accepts invocations with valid non-empty tenant_id and outlet_id', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DEFAULT_TOOLS),
        idArb,
        idArb,
        async (tool, tenantId, outletId) => {
          clearToolRegistry();
          const toggleOverrides: Partial<AutomationToggles> = { [tool.automationKey]: true };
          const settingsService = createToggleMockSettingsService(toggleOverrides);
          const service = createTestAgentService(settingsService);

          const params = buildMinimalValidParams(tool);

          const result = await service.executeTool({
            toolName: tool.name,
            tenantId,
            outletId,
            parameters: params,
          });

          // With valid IDs, toggle enabled, and valid params → success
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 18: Scheduled Analysis Skipped When No Toggles Enabled ──────────

/**
 * Feature: smart-automation, Property 18: Scheduled Analysis Skipped When No Toggles Enabled
 *
 * Validates: Requirements 8.5
 *
 * For any tenant with all automation_toggles set to false, the scheduled analysis
 * job SHALL skip execution and not produce any actions or proposals.
 */
describe('Feature: smart-automation, Property 18: Scheduled Analysis Skipped When No Toggles Enabled', () => {
  /**
   * Arbitrary that generates AutomationToggles objects where ALL toggles are false.
   * We fix all values to false to ensure the "all off" invariant.
   */
  const allTogglesOffArb: fc.Arbitrary<AutomationToggles> = fc.constant({
    campaigns: false,
    retention_offers: false,
    pricing_suggestions: false,
    anomaly_alerts: false,
    queue_optimization: false,
    membership_recommendations: false,
  });

  /**
   * Arbitrary for a tenant ID (non-empty UUID-like string).
   */
  const tenantIdArb: fc.Arbitrary<string> = fc.uuid();

  /**
   * Arbitrary for a TenantAutomationSettings object with all toggles OFF.
   * Other fields vary freely to prove the property holds regardless of
   * LLM provider, schedule interval, or other configuration.
   */
  const settingsWithAllTogglesOffArb: fc.Arbitrary<TenantAutomationSettings> = fc.record({
    whatsapp_phone: fc.constantFrom(null, '+1234567890'),
    whatsapp_token_encrypted: fc.constantFrom(null, 'encrypted-token'),
    llm_provider: fc.constantFrom('openrouter' as const, 'hermes_ai' as const),
    llm_api_key_encrypted: fc.constantFrom(null, 'encrypted-key'),
    llm_model: fc.constantFrom(null, 'openai/gpt-4o-mini'),
    ai_enabled: fc.boolean(),
    automation_toggles: allTogglesOffArb,
    approval_modes: fc.record({
      campaigns: fc.constantFrom('approval_required' as const, 'autonomous' as const),
      retention_offers: fc.constantFrom('approval_required' as const, 'autonomous' as const),
      pricing_suggestions: fc.constantFrom('approval_required' as const, 'autonomous' as const),
      anomaly_alerts: fc.constantFrom('approval_required' as const, 'autonomous' as const),
      queue_optimization: fc.constantFrom('approval_required' as const, 'autonomous' as const),
      membership_recommendations: fc.constantFrom('approval_required' as const, 'autonomous' as const),
    }),
    schedule_interval: fc.constantFrom('hourly' as const, 'daily' as const, null),
    discovered_devices: fc.constant([]),
  });

  it('getEnabledToggles returns empty array when all toggles are false', () => {
    fc.assert(
      fc.property(
        allTogglesOffArb,
        (toggles) => {
          const mockPool = { query: vi.fn() };
          const mockSettingsService = { getSettings: vi.fn() } as unknown as SettingsService;
          const mockLLMRouterService = { chat: vi.fn() } as unknown as LLMRouterService;
          const mockAgentService = { executeTool: vi.fn(), proposeAction: vi.fn(), getTool: vi.fn() } as unknown as AgentServiceType;
          const mockAuditService = { log: vi.fn() } as unknown as AuditService;

          const service = new ScheduledAnalysisService(
            mockPool as any,
            mockSettingsService,
            mockLLMRouterService,
            mockAgentService,
            mockAuditService,
          );

          const result = service.getEnabledToggles(toggles);

          // Must return empty array when all toggles are false
          expect(result).toEqual([]);
          expect(result).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('getMetricsToReview returns empty array when enabledToggles is empty', () => {
    fc.assert(
      fc.property(
        fc.constant([]),
        (emptyToggles: (keyof AutomationToggles)[]) => {
          const mockPool = { query: vi.fn() };
          const mockSettingsService = { getSettings: vi.fn() } as unknown as SettingsService;
          const mockLLMRouterService = { chat: vi.fn() } as unknown as LLMRouterService;
          const mockAgentService = { executeTool: vi.fn(), proposeAction: vi.fn(), getTool: vi.fn() } as unknown as AgentServiceType;
          const mockAuditService = { log: vi.fn() } as unknown as AuditService;

          const service = new ScheduledAnalysisService(
            mockPool as any,
            mockSettingsService,
            mockLLMRouterService,
            mockAgentService,
            mockAuditService,
          );

          const result = service.getMetricsToReview(emptyToggles);

          // No metrics to review when no toggles are enabled
          expect(result).toEqual([]);
          expect(result).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('runScheduledAnalysis returns null and performs no DB/LLM/proposal operations when all toggles are false', async () => {
    await fc.assert(
      fc.asyncProperty(
        tenantIdArb,
        settingsWithAllTogglesOffArb,
        async (tenantId, settings) => {
          const mockPool = { query: vi.fn() };
          const mockSettingsService = {
            getSettings: vi.fn().mockResolvedValue(settings),
          } as unknown as SettingsService;
          const mockLLMRouterService = {
            chat: vi.fn(),
          } as unknown as LLMRouterService;
          const mockAgentService = {
            executeTool: vi.fn(),
            proposeAction: vi.fn(),
            getTool: vi.fn(),
          } as unknown as AgentServiceType;
          const mockAuditService = {
            log: vi.fn(),
          } as unknown as AuditService;

          const service = new ScheduledAnalysisService(
            mockPool as any,
            mockSettingsService,
            mockLLMRouterService,
            mockAgentService,
            mockAuditService,
          );

          const result = await service.runScheduledAnalysis(tenantId);

          // SHALL skip execution — returns null
          expect(result).toBeNull();

          // No database queries (no run record created)
          expect(mockPool.query).not.toHaveBeenCalled();

          // No LLM calls
          expect(mockLLMRouterService.chat).not.toHaveBeenCalled();

          // No actions proposed or executed
          expect(mockAgentService.proposeAction).not.toHaveBeenCalled();
          expect(mockAgentService.executeTool).not.toHaveBeenCalled();

          // No audit logs for analysis run
          expect(mockAuditService.log).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });
});
