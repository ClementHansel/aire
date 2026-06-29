import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { ProposalService } from './proposal.service';
import { AgentGateway } from './agent.gateway';
import type { ActionProposal, ToolDefinition, ToolResult } from './agent.types';
import type { JWTPayload } from '@aire/shared';

/**
 * Unit tests for AgentController.
 *
 * Tests the REST endpoints for tools listing and action proposal
 * management (list, approve, reject) plus WebSocket event emission.
 *
 * Requirements: 5.1, 5.3, 6.3, 6.4, 6.5
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

function createMockAgentService() {
  return {
    getAllTools: vi.fn(),
  };
}

function createMockProposalService() {
  return {
    listProposals: vi.fn(),
    approveProposal: vi.fn(),
    rejectProposal: vi.fn(),
  };
}

function createMockAgentGateway() {
  return {
    emitProposalCreated: vi.fn(),
    emitProposalResolved: vi.fn(),
  };
}

function createController() {
  const agentService = createMockAgentService();
  const proposalService = createMockProposalService();
  const agentGateway = createMockAgentGateway();

  const controller = new AgentController(
    agentService as unknown as AgentService,
    proposalService as unknown as ProposalService,
    agentGateway as unknown as AgentGateway,
  );

  return { controller, agentService, proposalService, agentGateway };
}

// ─── Test Data ────────────────────────────────────────────────────────────────

const mockUser: JWTPayload = {
  sub: 'user-1',
  tenant_id: 'tenant-1',
  outlet_id: null,
  role: 'tenant_owner',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const mockProposal: ActionProposal = {
  id: 'proposal-1',
  tenant_id: 'tenant-1',
  action_type: 'create_campaign',
  parameters: { campaign_name: 'Summer Promo' },
  ai_reasoning: 'High engagement predicted based on historical data',
  confidence_score: 0.87,
  status: 'pending',
  created_at: '2024-06-01T12:00:00.000Z',
  resolved_at: null,
  resolved_by: null,
};

const mockToolDefinition: ToolDefinition = {
  name: 'create_campaign',
  description: 'Create a marketing campaign',
  inputSchema: { type: 'object', properties: { campaign_name: { type: 'string' } } },
  outputSchema: { type: 'object', properties: { campaign_id: { type: 'string' } } },
  automationKey: 'campaigns',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AgentController', () => {
  let controller: ReturnType<typeof createController>['controller'];
  let agentService: ReturnType<typeof createMockAgentService>;
  let proposalService: ReturnType<typeof createMockProposalService>;
  let agentGateway: ReturnType<typeof createMockAgentGateway>;

  beforeEach(() => {
    vi.clearAllMocks();
    const mocks = createController();
    controller = mocks.controller;
    agentService = mocks.agentService;
    proposalService = mocks.proposalService;
    agentGateway = mocks.agentGateway;
  });

  describe('getTools', () => {
    it('should return all registered tools', () => {
      agentService.getAllTools.mockReturnValue([mockToolDefinition]);

      const result = controller.getTools();

      expect(agentService.getAllTools).toHaveBeenCalled();
      expect(result).toEqual([mockToolDefinition]);
    });

    it('should return empty array when no tools registered', () => {
      agentService.getAllTools.mockReturnValue([]);

      const result = controller.getTools();

      expect(result).toEqual([]);
    });
  });

  describe('listProposals', () => {
    it('should return proposals for a tenant without filter', async () => {
      proposalService.listProposals.mockResolvedValue([mockProposal]);

      const result = await controller.listProposals('tenant-1', undefined);

      expect(proposalService.listProposals).toHaveBeenCalledWith('tenant-1', undefined);
      expect(result).toEqual([mockProposal]);
    });

    it('should filter proposals by status when provided', async () => {
      proposalService.listProposals.mockResolvedValue([mockProposal]);

      const result = await controller.listProposals('tenant-1', 'pending');

      expect(proposalService.listProposals).toHaveBeenCalledWith('tenant-1', 'pending');
      expect(result).toEqual([mockProposal]);
    });

    it('should return empty array when no proposals match', async () => {
      proposalService.listProposals.mockResolvedValue([]);

      const result = await controller.listProposals('tenant-1', 'approved');

      expect(result).toEqual([]);
    });
  });

  describe('approveProposal', () => {
    it('should approve proposal and return tool result', async () => {
      const toolResult: ToolResult = { success: true, data: { campaign_id: 'c-1' } };
      proposalService.approveProposal.mockResolvedValue(toolResult);

      const result = await controller.approveProposal('tenant-1', 'proposal-1', mockUser);

      expect(proposalService.approveProposal).toHaveBeenCalledWith('proposal-1', 'user-1');
      expect(result).toEqual(toolResult);
    });

    it('should emit proposal:resolved WebSocket event on approval', async () => {
      proposalService.approveProposal.mockResolvedValue({ success: true });

      await controller.approveProposal('tenant-1', 'proposal-1', mockUser);

      expect(agentGateway.emitProposalResolved).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({
          proposalId: 'proposal-1',
          status: 'approved',
          resolvedBy: 'user-1',
        }),
      );
    });

    it('should include resolvedAt timestamp in WebSocket payload', async () => {
      proposalService.approveProposal.mockResolvedValue({ success: true });

      await controller.approveProposal('tenant-1', 'proposal-1', mockUser);

      const emittedPayload = agentGateway.emitProposalResolved.mock.calls[0][1];
      expect(emittedPayload.resolvedAt).toBeDefined();
      // Should be a valid ISO date string
      expect(new Date(emittedPayload.resolvedAt).toISOString()).toBe(emittedPayload.resolvedAt);
    });

    it('should propagate errors from proposalService.approveProposal', async () => {
      const error = new Error('Proposal not found');
      proposalService.approveProposal.mockRejectedValue(error);

      await expect(
        controller.approveProposal('tenant-1', 'nonexistent', mockUser),
      ).rejects.toThrow('Proposal not found');

      // WebSocket should NOT be emitted on error
      expect(agentGateway.emitProposalResolved).not.toHaveBeenCalled();
    });
  });

  describe('rejectProposal', () => {
    it('should reject proposal and return success', async () => {
      proposalService.rejectProposal.mockResolvedValue(undefined);

      const result = await controller.rejectProposal('tenant-1', 'proposal-1', mockUser);

      expect(proposalService.rejectProposal).toHaveBeenCalledWith('proposal-1', 'user-1');
      expect(result).toEqual({ success: true });
    });

    it('should emit proposal:resolved WebSocket event on rejection', async () => {
      proposalService.rejectProposal.mockResolvedValue(undefined);

      await controller.rejectProposal('tenant-1', 'proposal-1', mockUser);

      expect(agentGateway.emitProposalResolved).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({
          proposalId: 'proposal-1',
          status: 'rejected',
          resolvedBy: 'user-1',
        }),
      );
    });

    it('should include resolvedAt timestamp in WebSocket payload', async () => {
      proposalService.rejectProposal.mockResolvedValue(undefined);

      await controller.rejectProposal('tenant-1', 'proposal-1', mockUser);

      const emittedPayload = agentGateway.emitProposalResolved.mock.calls[0][1];
      expect(emittedPayload.resolvedAt).toBeDefined();
      expect(new Date(emittedPayload.resolvedAt).toISOString()).toBe(emittedPayload.resolvedAt);
    });

    it('should propagate errors from proposalService.rejectProposal', async () => {
      const error = new Error('Proposal already resolved');
      proposalService.rejectProposal.mockRejectedValue(error);

      await expect(
        controller.rejectProposal('tenant-1', 'nonexistent', mockUser),
      ).rejects.toThrow('Proposal already resolved');

      // WebSocket should NOT be emitted on error
      expect(agentGateway.emitProposalResolved).not.toHaveBeenCalled();
    });
  });
});
