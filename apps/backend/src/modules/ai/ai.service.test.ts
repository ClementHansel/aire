import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { AIService } from './ai.service';

describe('AIService', () => {
  let aiService: AIService;
  let mockPool: { query: ReturnType<typeof vi.fn> };
  let mockConfigService: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = {
      query: vi.fn(),
    };
    mockConfigService = {
      get: vi.fn((key: string, defaultVal?: string) => {
        const config: Record<string, string> = {
          AI_PROVIDER: 'ollama',
          AI_BASE_URL: 'http://localhost:11434',
          AI_MODEL: 'llama3',
        };
        return config[key] ?? defaultVal;
      }),
    };
    aiService = new AIService(
      mockPool as any,
      mockConfigService as unknown as ConfigService,
    );
  });

  describe('queryInsights', () => {
    it('should return an AI response with required fields', async () => {
      // Mock business context query
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            total_orders: '120',
            total_revenue: '15000000.00',
            active_members: '25',
            avg_daily_orders: '4',
          },
        ],
      });

      const result = await aiService.queryInsights(
        'How is my revenue this month?',
        'tenant-123',
      );

      expect(result).toHaveProperty('answer');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('sources');
      expect(result).toHaveProperty('generatedAt');
      expect(typeof result.answer).toBe('string');
      expect(result.answer.length).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(Array.isArray(result.sources)).toBe(true);
      expect(result.generatedAt).toBeTruthy();
    });

    it('should query the database for business context', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            total_orders: '50',
            total_revenue: '8000000.00',
            active_members: '10',
            avg_daily_orders: '2',
          },
        ],
      });

      await aiService.queryInsights('Tell me about my members', 'tenant-456');

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const [query, params] = mockPool.query.mock.calls[0];
      expect(query).toContain('tenant_id');
      expect(params[0]).toBe('tenant-456');
    });

    it('should handle empty database results gracefully', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            total_orders: '0',
            total_revenue: '0',
            active_members: '0',
            avg_daily_orders: '0',
          },
        ],
      });

      const result = await aiService.queryInsights(
        'What is my revenue?',
        'empty-tenant',
      );

      expect(result.answer).toBeTruthy();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
    });
  });

  describe('detectAnomalies', () => {
    it('should return empty array when no anomalies detected', async () => {
      // Revenue check — no drop
      mockPool.query.mockResolvedValueOnce({
        rows: [{ current_revenue: '5000000', previous_revenue: '5100000' }],
      });
      // Void spike check — normal rate
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            total_orders: '100',
            void_count: '3',
            historical_void_rate: '0.04',
          },
        ],
      });
      // Traffic change check — normal
      mockPool.query.mockResolvedValueOnce({
        rows: [{ current_daily_avg: '10', historical_daily_avg: '9' }],
      });

      const result = await aiService.detectAnomalies('tenant-123', {
        from: '2024-01-01',
        to: '2024-01-07',
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should detect revenue drop anomaly when drop exceeds 30%', async () => {
      // Revenue check — significant drop
      mockPool.query.mockResolvedValueOnce({
        rows: [{ current_revenue: '3000000', previous_revenue: '5000000' }],
      });
      // Void spike check — normal
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            total_orders: '50',
            void_count: '2',
            historical_void_rate: '0.04',
          },
        ],
      });
      // Traffic check — normal
      mockPool.query.mockResolvedValueOnce({
        rows: [{ current_daily_avg: '8', historical_daily_avg: '9' }],
      });

      const result = await aiService.detectAnomalies('tenant-123', {
        from: '2024-01-08',
        to: '2024-01-14',
      });

      const revenueAnomaly = result.find((a) => a.type === 'revenue_drop');
      expect(revenueAnomaly).toBeDefined();
      expect(revenueAnomaly!.severity).toBe('high');
      expect(revenueAnomaly!.title).toBe('Significant Revenue Drop');
      expect(revenueAnomaly!.metadata).toHaveProperty('dropPct');
    });

    it('should detect void spike when rate exceeds 2x historical', async () => {
      // Revenue check — normal
      mockPool.query.mockResolvedValueOnce({
        rows: [{ current_revenue: '5000000', previous_revenue: '5200000' }],
      });
      // Void spike — high void rate
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            total_orders: '100',
            void_count: '15',
            historical_void_rate: '0.05',
          },
        ],
      });
      // Traffic check — normal
      mockPool.query.mockResolvedValueOnce({
        rows: [{ current_daily_avg: '10', historical_daily_avg: '10' }],
      });

      const result = await aiService.detectAnomalies('tenant-123', {
        from: '2024-01-08',
        to: '2024-01-14',
      });

      const voidAnomaly = result.find((a) => a.type === 'void_spike');
      expect(voidAnomaly).toBeDefined();
      expect(voidAnomaly!.title).toBe('Void Rate Spike');
      expect(voidAnomaly!.metadata).toHaveProperty('currentVoidRate');
      expect(voidAnomaly!.metadata).toHaveProperty('historicalVoidRate');
    });

    it('should detect traffic change when deviation exceeds 40%', async () => {
      // Revenue check — normal
      mockPool.query.mockResolvedValueOnce({
        rows: [{ current_revenue: '5000000', previous_revenue: '5100000' }],
      });
      // Void spike — normal
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            total_orders: '100',
            void_count: '3',
            historical_void_rate: '0.04',
          },
        ],
      });
      // Traffic — significant decrease
      mockPool.query.mockResolvedValueOnce({
        rows: [{ current_daily_avg: '4', historical_daily_avg: '10' }],
      });

      const result = await aiService.detectAnomalies('tenant-123', {
        from: '2024-01-08',
        to: '2024-01-14',
      });

      const trafficAnomaly = result.find((a) => a.type === 'traffic_change');
      expect(trafficAnomaly).toBeDefined();
      expect(trafficAnomaly!.title).toContain('Traffic');
      expect(trafficAnomaly!.metadata).toHaveProperty('deviationPct');
    });

    it('should return multiple anomalies when several are detected', async () => {
      // Revenue — big drop
      mockPool.query.mockResolvedValueOnce({
        rows: [{ current_revenue: '1000000', previous_revenue: '5000000' }],
      });
      // Void spike
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            total_orders: '50',
            void_count: '15',
            historical_void_rate: '0.05',
          },
        ],
      });
      // Traffic — big drop
      mockPool.query.mockResolvedValueOnce({
        rows: [{ current_daily_avg: '3', historical_daily_avg: '10' }],
      });

      const result = await aiService.detectAnomalies('tenant-123', {
        from: '2024-01-08',
        to: '2024-01-14',
      });

      expect(result.length).toBe(3);
      const types = result.map((a) => a.type);
      expect(types).toContain('revenue_drop');
      expect(types).toContain('void_spike');
      expect(types).toContain('traffic_change');
    });

    it('should handle zero historical values without crashing', async () => {
      // Revenue check — zero previous
      mockPool.query.mockResolvedValueOnce({
        rows: [{ current_revenue: '5000000', previous_revenue: '0' }],
      });
      // Void spike — zero historical rate
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            total_orders: '0',
            void_count: '0',
            historical_void_rate: '0',
          },
        ],
      });
      // Traffic — zero historical
      mockPool.query.mockResolvedValueOnce({
        rows: [{ current_daily_avg: '10', historical_daily_avg: '0' }],
      });

      const result = await aiService.detectAnomalies('tenant-123', {
        from: '2024-01-01',
        to: '2024-01-07',
      });

      // No anomalies since can't compare to zero baseline
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });

  describe('getProviderConfig', () => {
    it('should return provider config without API key', () => {
      const config = aiService.getProviderConfig();

      expect(config).toHaveProperty('provider');
      expect(config).toHaveProperty('baseUrl');
      expect(config).toHaveProperty('model');
      expect(config).not.toHaveProperty('apiKey');
      expect(config.provider).toBe('ollama');
      expect(config.baseUrl).toBe('http://localhost:11434');
      expect(config.model).toBe('llama3');
    });
  });
});
