import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProposalService } from './proposal.service';
import { NotFoundException, ConflictException } from '@nestjs/common';

/**
 * Unit tests for ProposalService.
 *
 * Tests the action proposal lifecycle: create, approve, reject, expire.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

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

function createService() {
  const pool = createMockPool();
  const auditService = createMockAuditService();
  const notificationService = createMockNotificationService();

  const service = new ProposalService(
    pool as any,
    auditService as any,
    notificationService as any,
  );

  return { service, pool, auditService, notificationService };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ProposalService', () => {
  describe('proposeAction', () => {
    it('should create a proposal with status pending and return it', async () => {
      const { service, pool } = createService();

      const proposalRow = {
        id: 'proposal-1',
        tenant_id: 'tenant-1',
        action_type: 'create_campaign',
        parameters: { campaign_name: 'Test' },
        ai_reasoning: 'High engagement predicted',
        confidence_score: '0.85',
        status: 'pending',
        created_at: new Date('2024-01-01T00:00:00Z'),
        resolved_at: null,
        resolved_by: null,
      };

      // INSERT query returns the new proposal
      pool.query.mockResolvedValueOnce({ rows: [proposalRow] });
      // Owner lookup for notification
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'owner-1', phone: '+628123456789' }] });

      const result = await service.proposeAction(
        'tenant-1',
        'create_campaign',
        { campaign_name: 'Test' },
        'High engagement predicted',
        0.85,
      );

      expect(result.id).toBe('proposal-1');
      expect(result.status).toBe('pending');
      expect(result.action_type).toBe('create_campaign');
      expect(result.confidence_score).toBe(0.85);
      expect(result.tenant_id).toBe('tenant-1');
      expect(result.ai_reasoning).toBe('High engagement predicted');
    });

    it('should call notification service for tenant owner', async () => {
      const { service, pool, notificationService } = createService();

      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 'p-1',
          tenant_id: 't-1',
          action_type: 'flag_anomaly',
          parameters: {},
          ai_reasoning: 'Revenue dip detected',
          confidence_score: '0.92',
          status: 'pending',
          created_at: new Date(),
          resolved_at: null,
          resolved_by: null,
        }],
      });
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'owner-1', phone: '+628111111111' }] });

      await service.proposeAction('t-1', 'flag_anomaly', {}, 'Revenue dip detected', 0.92);

      expect(notificationService.sendWhatsApp).toHaveBeenCalledWith(
        expect.objectContaining({
          to: '+628111111111',
          templateName: 'action_proposal_pending',
        }),
      );
    });

    it('should handle missing tenant owner gracefully (no notification)', async () => {
      const { service, pool, notificationService } = createService();

      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 'p-2',
          tenant_id: 't-2',
          action_type: 'create_campaign',
          parameters: {},
          ai_reasoning: 'Test',
          confidence_score: '0.50',
          status: 'pending',
          created_at: new Date(),
          resolved_at: null,
          resolved_by: null,
        }],
      });
      // No owner found
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.proposeAction('t-2', 'create_campaign', {}, 'Test', 0.5);

      expect(result.id).toBe('p-2');
      expect(notificationService.sendWhatsApp).not.toHaveBeenCalled();
    });
  });

  describe('approveProposal', () => {
    it('should approve a pending proposal, update status, and execute tool', async () => {
      const { service, pool, auditService } = createService();

      const mockToolExecutor = vi.fn().mockResolvedValue({ success: true, data: { campaign_id: 'c-1' } });
      service.setToolExecutor(mockToolExecutor);

      // getProposal query
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 'p-1',
          tenant_id: 't-1',
          action_type: 'create_campaign',
          parameters: { campaign_name: 'Test', outlet_id: 'outlet-1' },
          ai_reasoning: 'Good idea',
          confidence_score: '0.88',
          status: 'pending',
          created_at: new Date(),
          resolved_at: null,
          resolved_by: null,
        }],
      });
      // UPDATE query
      pool.query.mockResolvedValueOnce({ rowCount: 1 });

      const result = await service.approveProposal('p-1', 'user-1');

      expect(result.success).toBe(true);
      expect(mockToolExecutor).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'create_campaign',
          tenantId: 't-1',
          outletId: 'outlet-1',
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'proposal_approved',
          entityId: 'p-1',
        }),
      );
    });

    it('should throw NotFoundException if proposal does not exist', async () => {
      const { service, pool } = createService();

      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.approveProposal('nonexistent', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException if proposal is not pending', async () => {
      const { service, pool } = createService();

      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 'p-1',
          tenant_id: 't-1',
          action_type: 'create_campaign',
          parameters: {},
          ai_reasoning: 'Test',
          confidence_score: '0.70',
          status: 'approved',
          created_at: new Date(),
          resolved_at: new Date(),
          resolved_by: 'user-2',
        }],
      });

      await expect(service.approveProposal('p-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('rejectProposal', () => {
    it('should reject a pending proposal and audit-log it', async () => {
      const { service, pool, auditService } = createService();

      // getProposal query
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 'p-1',
          tenant_id: 't-1',
          action_type: 'suggest_pricing',
          parameters: { service_id: 's-1' },
          ai_reasoning: 'Price optimization',
          confidence_score: '0.75',
          status: 'pending',
          created_at: new Date(),
          resolved_at: null,
          resolved_by: null,
        }],
      });
      // UPDATE query
      pool.query.mockResolvedValueOnce({ rowCount: 1 });

      await service.rejectProposal('p-1', 'user-1');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'rejected'"),
        ['user-1', 'p-1'],
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'proposal_rejected',
          entityId: 'p-1',
          userId: 'user-1',
        }),
      );
    });

    it('should throw NotFoundException if proposal does not exist', async () => {
      const { service, pool } = createService();

      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.rejectProposal('nonexistent', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException if proposal is already rejected', async () => {
      const { service, pool } = createService();

      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 'p-1',
          tenant_id: 't-1',
          action_type: 'create_campaign',
          parameters: {},
          ai_reasoning: 'Test',
          confidence_score: '0.60',
          status: 'rejected',
          created_at: new Date(),
          resolved_at: new Date(),
          resolved_by: 'user-2',
        }],
      });

      await expect(service.rejectProposal('p-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('expireStaleProposals', () => {
    it('should mark proposals pending > 24h as expired and return count', async () => {
      const { service, pool, auditService } = createService();

      pool.query.mockResolvedValueOnce({
        rows: [
          { id: 'p-1', tenant_id: 't-1' },
          { id: 'p-2', tenant_id: 't-2' },
        ],
        rowCount: 2,
      });

      const count = await service.expireStaleProposals();

      expect(count).toBe(2);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("INTERVAL '24 hours'"),
      );
      // Audit-log for each expired proposal
      expect(auditService.log).toHaveBeenCalledTimes(2);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'proposal_expired',
          entityId: 'p-1',
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'proposal_expired',
          entityId: 'p-2',
        }),
      );
    });

    it('should return 0 when no stale proposals exist', async () => {
      const { service, pool, auditService } = createService();

      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const count = await service.expireStaleProposals();

      expect(count).toBe(0);
      expect(auditService.log).not.toHaveBeenCalled();
    });
  });

  describe('getProposal', () => {
    it('should return a proposal by ID', async () => {
      const { service, pool } = createService();

      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 'p-1',
          tenant_id: 't-1',
          action_type: 'flag_anomaly',
          parameters: { anomaly_type: 'revenue_drop' },
          ai_reasoning: 'Unusual pattern',
          confidence_score: '0.95',
          status: 'pending',
          created_at: new Date('2024-06-01T12:00:00Z'),
          resolved_at: null,
          resolved_by: null,
        }],
      });

      const proposal = await service.getProposal('p-1');

      expect(proposal).not.toBeNull();
      expect(proposal!.id).toBe('p-1');
      expect(proposal!.confidence_score).toBe(0.95);
      expect(proposal!.created_at).toBe('2024-06-01T12:00:00.000Z');
    });

    it('should return null for non-existent proposal', async () => {
      const { service, pool } = createService();

      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.getProposal('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('listProposals', () => {
    it('should list proposals for a tenant', async () => {
      const { service, pool } = createService();

      pool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'p-1',
            tenant_id: 't-1',
            action_type: 'create_campaign',
            parameters: {},
            ai_reasoning: 'Reason 1',
            confidence_score: '0.80',
            status: 'pending',
            created_at: new Date(),
            resolved_at: null,
            resolved_by: null,
          },
          {
            id: 'p-2',
            tenant_id: 't-1',
            action_type: 'flag_anomaly',
            parameters: {},
            ai_reasoning: 'Reason 2',
            confidence_score: '0.90',
            status: 'approved',
            created_at: new Date(),
            resolved_at: new Date(),
            resolved_by: 'user-1',
          },
        ],
      });

      const proposals = await service.listProposals('t-1');
      expect(proposals).toHaveLength(2);
    });

    it('should filter proposals by status', async () => {
      const { service, pool } = createService();

      pool.query.mockResolvedValueOnce({ rows: [] });

      await service.listProposals('t-1', 'pending');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND status = $2'),
        ['t-1', 'pending'],
      );
    });
  });
});
