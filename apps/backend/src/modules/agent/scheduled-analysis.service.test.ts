import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScheduledAnalysisService } from './scheduled-analysis.service';
import type { SettingsService } from '../settings/settings.service';
import type { LLMRouterService } from './llm-router.service';
import type { AgentService } from './agent.service';
import type { AuditService } from '../audit/audit.service';
import type { TenantAutomationSettings } from '../settings/settings.interfaces';
import { DEFAULT_AUTOMATION_SETTINGS } from '../settings/settings.interfaces';

/**
 * Unit tests for ScheduledAnalysisService.runScheduledAnalysis
 *
 * Requirements: 8.2, 8.3, 8.4, 8.5
 */

function createMockPool() {
  return {
    query: vi.fn(),
  };
}

function createMockSettingsService(
  overrides: Partial<TenantAutomationSettings> = {},
): SettingsService {
  const settings: TenantAutomationSettings = {
    ...DEFAULT_AUTOMATION_SETTINGS,
    ...overrides,
  };
  return {
    getSettings: vi.fn().mockResolvedValue(settings),
  } as unknown as SettingsService;
}

function createMockLLMRouterService(content: string = '[]'): LLMRouterService {
  return {
    chat: vi.fn().mockResolvedValue({ content, model: 'test-model' }),
  } as unknown as LLMRouterService;
}

function createMockAgentService(): AgentService {
  return {
    executeTool: vi.fn().mockResolvedValue({ success: true, data: {} }),
    proposeAction: vi.fn().mockResolvedValue({
      id: 'proposal-1',
      tenant_id: 'tenant-123',
      action_type: 'campaigns',
      parameters: {},
      ai_reasoning: 'Test reasoning',
      confidence_score: 0.8,
      status: 'pending',
      created_at: new Date().toISOString(),
      resolved_at: null,
      resolved_by: null,
    }),
    getTool: vi.fn().mockReturnValue({
      name: 'create_campaign',
      description: 'Create a campaign',
      automationKey: 'campaigns',
    }),
  } as unknown as AgentService;
}

function createMockAuditService(): AuditService {
  return {
    log: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
}

describe('ScheduledAnalysisService', () => {
  let service: ScheduledAnalysisService;
  let mockPool: ReturnType<typeof createMockPool>;
  let mockSettingsService: SettingsService;
  let mockLLMRouterService: LLMRouterService;
  let mockAgentService: AgentService;
  let mockAuditService: AuditService;

  beforeEach(() => {
    mockPool = createMockPool();
    mockSettingsService = createMockSettingsService();
    mockLLMRouterService = createMockLLMRouterService();
    mockAgentService = createMockAgentService();
    mockAuditService = createMockAuditService();
    service = new ScheduledAnalysisService(
      mockPool as any,
      mockSettingsService,
      mockLLMRouterService,
      mockAgentService,
      mockAuditService,
    );
  });

  describe('runScheduledAnalysis', () => {
    it('should skip analysis when no automation toggles are enabled (Req 8.5)', async () => {
      // All toggles are false by default via DEFAULT_AUTOMATION_SETTINGS
      const result = await service.runScheduledAnalysis('tenant-123');

      expect(result).toBeNull();
      // No DB queries should be made for the run record
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should create a run record and complete analysis when toggles are enabled', async () => {
      mockSettingsService = createMockSettingsService({
        ai_enabled: true,
        automation_toggles: {
          ...DEFAULT_AUTOMATION_SETTINGS.automation_toggles,
          campaigns: true,
        },
      });
      service = new ScheduledAnalysisService(
        mockPool as any,
        mockSettingsService,
        mockLLMRouterService,
        mockAgentService,
        mockAuditService,
      );

      // Mock createRunRecord
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'run-1' }] });
      // Mock completeRunRecord
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'run-1',
          tenant_id: 'tenant-123',
          start_time: new Date(),
          end_time: new Date(),
          metrics_reviewed: ['revenue', 'customer_retention'],
          insights_found: 0,
          actions_proposed: 0,
          actions_executed: 0,
          status: 'completed',
        }],
      });

      const result = await service.runScheduledAnalysis('tenant-123');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('completed');
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it('should return null when settings service throws', async () => {
      mockSettingsService = {
        getSettings: vi.fn().mockRejectedValue(new Error('DB error')),
      } as unknown as SettingsService;
      service = new ScheduledAnalysisService(
        mockPool as any,
        mockSettingsService,
        mockLLMRouterService,
        mockAgentService,
        mockAuditService,
      );

      const result = await service.runScheduledAnalysis('tenant-123');

      expect(result).toBeNull();
    });

    it('should propose actions when approval mode is approval_required', async () => {
      const llmResponse = JSON.stringify([
        {
          actionType: 'create_campaign',
          parameters: { campaign_name: 'Test', target_segment: 'all', channel: 'email', message_template: 'Hi' },
          reasoning: 'Revenue opportunity detected',
          confidence: 0.85,
        },
      ]);
      mockLLMRouterService = createMockLLMRouterService(llmResponse);
      mockSettingsService = createMockSettingsService({
        ai_enabled: true,
        automation_toggles: {
          ...DEFAULT_AUTOMATION_SETTINGS.automation_toggles,
          campaigns: true,
        },
        approval_modes: {
          ...DEFAULT_AUTOMATION_SETTINGS.approval_modes,
          campaigns: 'approval_required',
        },
      });
      service = new ScheduledAnalysisService(
        mockPool as any,
        mockSettingsService,
        mockLLMRouterService,
        mockAgentService,
        mockAuditService,
      );

      // Mock createRunRecord
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'run-2' }] });
      // Mock completeRunRecord
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'run-2',
          tenant_id: 'tenant-123',
          start_time: new Date(),
          end_time: new Date(),
          metrics_reviewed: ['revenue', 'customer_retention'],
          insights_found: 1,
          actions_proposed: 1,
          actions_executed: 0,
          status: 'completed',
        }],
      });

      const result = await service.runScheduledAnalysis('tenant-123');

      expect(result).not.toBeNull();
      expect(result!.actions_proposed).toBe(1);
      expect(result!.actions_executed).toBe(0);
      expect(mockAgentService.proposeAction).toHaveBeenCalledWith(
        'tenant-123',
        'create_campaign',
        expect.any(Object),
        'Revenue opportunity detected',
        0.85,
      );
    });

    it('should execute actions immediately when approval mode is autonomous', async () => {
      const llmResponse = JSON.stringify([
        {
          actionType: 'create_campaign',
          parameters: { campaign_name: 'Auto', target_segment: 'vip', channel: 'whatsapp', message_template: 'Hello' },
          reasoning: 'High confidence action',
          confidence: 0.95,
        },
      ]);
      mockLLMRouterService = createMockLLMRouterService(llmResponse);
      mockSettingsService = createMockSettingsService({
        ai_enabled: true,
        automation_toggles: {
          ...DEFAULT_AUTOMATION_SETTINGS.automation_toggles,
          campaigns: true,
        },
        approval_modes: {
          ...DEFAULT_AUTOMATION_SETTINGS.approval_modes,
          campaigns: 'autonomous',
        },
      });
      service = new ScheduledAnalysisService(
        mockPool as any,
        mockSettingsService,
        mockLLMRouterService,
        mockAgentService,
        mockAuditService,
      );

      // Mock createRunRecord
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'run-3' }] });
      // Mock completeRunRecord
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'run-3',
          tenant_id: 'tenant-123',
          start_time: new Date(),
          end_time: new Date(),
          metrics_reviewed: ['revenue', 'customer_retention'],
          insights_found: 1,
          actions_proposed: 0,
          actions_executed: 1,
          status: 'completed',
        }],
      });

      const result = await service.runScheduledAnalysis('tenant-123');

      expect(result).not.toBeNull();
      expect(result!.actions_executed).toBe(1);
      expect(result!.actions_proposed).toBe(0);
      expect(mockAgentService.executeTool).toHaveBeenCalled();
    });

    it('should mark run as failed when LLM call throws', async () => {
      mockLLMRouterService = {
        chat: vi.fn().mockRejectedValue(new Error('LLM unreachable')),
      } as unknown as LLMRouterService;
      mockSettingsService = createMockSettingsService({
        ai_enabled: true,
        automation_toggles: {
          ...DEFAULT_AUTOMATION_SETTINGS.automation_toggles,
          campaigns: true,
        },
      });
      service = new ScheduledAnalysisService(
        mockPool as any,
        mockSettingsService,
        mockLLMRouterService,
        mockAgentService,
        mockAuditService,
      );

      // Mock createRunRecord
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'run-4' }] });
      // Mock completeRunRecord (status = 'failed')
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'run-4',
          tenant_id: 'tenant-123',
          start_time: new Date(),
          end_time: new Date(),
          metrics_reviewed: ['revenue', 'customer_retention'],
          insights_found: 0,
          actions_proposed: 0,
          actions_executed: 0,
          status: 'failed',
        }],
      });

      const result = await service.runScheduledAnalysis('tenant-123');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('failed');
    });

    it('should record metrics reviewed based on enabled toggles', async () => {
      mockSettingsService = createMockSettingsService({
        ai_enabled: true,
        automation_toggles: {
          campaigns: true,
          retention_offers: true,
          pricing_suggestions: false,
          anomaly_alerts: false,
          queue_optimization: true,
          membership_recommendations: false,
        },
      });
      service = new ScheduledAnalysisService(
        mockPool as any,
        mockSettingsService,
        mockLLMRouterService,
        mockAgentService,
        mockAuditService,
      );

      // Mock createRunRecord
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'run-5' }] });
      // Mock completeRunRecord
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'run-5',
          tenant_id: 'tenant-123',
          start_time: new Date(),
          end_time: new Date(),
          metrics_reviewed: ['customer_retention', 'membership_conversions', 'queue_wait_times', 'revenue', 'service_utilization'],
          insights_found: 0,
          actions_proposed: 0,
          actions_executed: 0,
          status: 'completed',
        }],
      });

      await service.runScheduledAnalysis('tenant-123');

      // The completeRunRecord call should include proper metrics
      const updateCall = mockPool.query.mock.calls[1];
      const metricsArg = updateCall[1][0] as string[];
      expect(metricsArg).toContain('revenue');
      expect(metricsArg).toContain('customer_retention');
      expect(metricsArg).toContain('queue_wait_times');
      expect(metricsArg).toContain('service_utilization');
      expect(metricsArg).toContain('membership_conversions');
    });
  });

  describe('getEnabledToggles', () => {
    it('should return empty array when all toggles are false', () => {
      const result = service.getEnabledToggles(DEFAULT_AUTOMATION_SETTINGS.automation_toggles);
      expect(result).toEqual([]);
    });

    it('should return only enabled toggle keys', () => {
      const toggles = {
        ...DEFAULT_AUTOMATION_SETTINGS.automation_toggles,
        campaigns: true,
        anomaly_alerts: true,
      };
      const result = service.getEnabledToggles(toggles);
      expect(result).toContain('campaigns');
      expect(result).toContain('anomaly_alerts');
      expect(result).toHaveLength(2);
    });
  });

  describe('getMetricsToReview', () => {
    it('should return de-duplicated metrics for enabled toggles', () => {
      const result = service.getMetricsToReview(['campaigns', 'retention_offers']);
      // campaigns: revenue, customer_retention
      // retention_offers: customer_retention, membership_conversions
      // De-duplicated and sorted
      expect(result).toEqual(['customer_retention', 'membership_conversions', 'revenue']);
    });

    it('should return empty for empty toggles', () => {
      const result = service.getMetricsToReview([]);
      expect(result).toEqual([]);
    });
  });
});
