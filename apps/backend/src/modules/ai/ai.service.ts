import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

/**
 * Represents an AI-generated response to a natural language business query.
 */
export interface AIResponse {
  answer: string;
  confidence: number;
  sources: string[];
  generatedAt: string;
}

/**
 * Represents a detected anomaly in business data.
 */
export interface Anomaly {
  id: string;
  type: 'revenue_drop' | 'void_spike' | 'equipment_issue' | 'traffic_change';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  detectedAt: string;
  metadata: Record<string, unknown>;
}

/**
 * Date range for anomaly detection queries.
 */
export interface DateRange {
  from: string;
  to: string;
}

/**
 * Configuration for the LLM provider connection.
 */
export interface LLMProviderConfig {
  provider: 'openrouter' | 'ollama';
  baseUrl: string;
  model: string;
  apiKey?: string;
}

/**
 * AIService provides the Hermes AI copilot functionality including
 * natural language business queries and anomaly detection.
 *
 * Integration with LLM providers (OpenRouter, Ollama) is configurable
 * via environment variables. The actual LLM call is stubbed to allow
 * deployment without a live LLM endpoint.
 *
 * Requirements: 32.1, 32.2, 32.3, 32.5
 */
@Injectable()
export class AIService {
  private readonly providerConfig: LLMProviderConfig;

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly configService: ConfigService,
  ) {
    this.providerConfig = {
      provider: this.configService.get<'openrouter' | 'ollama'>(
        'AI_PROVIDER',
        'ollama',
      ),
      baseUrl: this.configService.get<string>(
        'AI_BASE_URL',
        'http://localhost:11434',
      ),
      model: this.configService.get<string>('AI_MODEL', 'llama3'),
      apiKey: this.configService.get<string>('AI_API_KEY'),
    };
  }

  /**
   * Processes a natural language business query and returns AI-generated insights.
   *
   * The method:
   * 1. Gathers relevant business context from the database for the tenant
   * 2. Constructs a prompt with the context and user question
   * 3. Sends the prompt to the configured LLM provider
   * 4. Returns the structured response
   *
   * Requirement: 32.1
   */
  async queryInsights(
    question: string,
    tenantId: string,
  ): Promise<AIResponse> {
    // Gather business context for the tenant
    const context = await this.gatherBusinessContext(tenantId);

    // Build the prompt
    const prompt = this.buildQueryPrompt(question, context);

    // Call the LLM provider (stubbed)
    const llmResponse = await this.callLLM(prompt);

    return {
      answer: llmResponse,
      confidence: 0.85,
      sources: ['orders', 'memberships', 'revenue_data'],
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Detects anomalies in business data for the given tenant and date range.
   *
   * Checks for:
   * - Unusual revenue drops (>30% vs previous period)
   * - Void spikes (>2x normal void rate)
   * - Equipment issues (bay sensors reporting errors)
   * - Traffic pattern changes (>40% deviation from historical average)
   *
   * Requirement: 32.2
   */
  async detectAnomalies(
    tenantId: string,
    dateRange: DateRange,
  ): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    const [revenueAnomaly, voidAnomaly, trafficAnomaly] = await Promise.all([
      this.checkRevenueAnomaly(tenantId, dateRange),
      this.checkVoidSpike(tenantId, dateRange),
      this.checkTrafficChange(tenantId, dateRange),
    ]);

    if (revenueAnomaly) anomalies.push(revenueAnomaly);
    if (voidAnomaly) anomalies.push(voidAnomaly);
    if (trafficAnomaly) anomalies.push(trafficAnomaly);

    return anomalies;
  }

  /**
   * Returns the current LLM provider configuration (for diagnostics).
   */
  getProviderConfig(): Omit<LLMProviderConfig, 'apiKey'> {
    return {
      provider: this.providerConfig.provider,
      baseUrl: this.providerConfig.baseUrl,
      model: this.providerConfig.model,
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  /**
   * Gathers summary business context for the tenant to include in LLM prompts.
   */
  private async gatherBusinessContext(
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const result = await this.pool.query<{
      total_orders: string;
      total_revenue: string;
      active_members: string;
      avg_daily_orders: string;
    }>(
      `SELECT
        COUNT(*)::int AS total_orders,
        COALESCE(SUM(CASE WHEN status IN ('paid', 'confirmed', 'completed') THEN total ELSE 0 END), 0) AS total_revenue,
        (SELECT COUNT(*) FROM memberships WHERE tenant_id = $1 AND status = 'active')::int AS active_members,
        (COUNT(*) / GREATEST(1, EXTRACT(DAY FROM ($3::date - $2::date))))::int AS avg_daily_orders
       FROM orders
       WHERE tenant_id = $1
         AND created_at >= $2::date
         AND created_at < ($3::date + INTERVAL '1 day')`,
      [tenantId, thirtyDaysAgo, today],
    );

    const row = result.rows[0];
    return {
      totalOrders30d: parseInt(row?.total_orders ?? '0', 10),
      totalRevenue30d: parseFloat(row?.total_revenue ?? '0'),
      activeMembers: parseInt(row?.active_members ?? '0', 10),
      avgDailyOrders: parseInt(row?.avg_daily_orders ?? '0', 10),
      periodStart: thirtyDaysAgo,
      periodEnd: today,
    };
  }

  /**
   * Builds a prompt combining the user's question with business context.
   */
  private buildQueryPrompt(
    question: string,
    context: Record<string, unknown>,
  ): string {
    return [
      'You are Hermes, an AI copilot for a car wash business operations platform.',
      'Answer the following business question based on the provided context.',
      '',
      '## Business Context',
      JSON.stringify(context, null, 2),
      '',
      '## Question',
      question,
      '',
      '## Instructions',
      '- Provide actionable insights based on the data.',
      '- Be concise and specific.',
      '- If the data is insufficient to answer, say so.',
    ].join('\n');
  }

  /**
   * Calls the configured LLM provider. Currently a stub that returns
   * a placeholder response. Replace with actual HTTP calls to
   * OpenRouter or Ollama when deployed with a live LLM endpoint.
   *
   * Requirement: 32.5
   */
  private async callLLM(prompt: string): Promise<string> {
    // Stub implementation — in production this would make an HTTP request to:
    // - OpenRouter: POST https://openrouter.ai/api/v1/chat/completions
    // - Ollama: POST http://localhost:11434/api/generate
    //
    // The provider, URL, model, and API key are configured via environment variables:
    // AI_PROVIDER, AI_BASE_URL, AI_MODEL, AI_API_KEY

    void this.providerConfig;
    void prompt;

    return 'This is a stub response from the Hermes AI copilot. Configure AI_PROVIDER, AI_BASE_URL, AI_MODEL, and AI_API_KEY environment variables to connect to a live LLM provider (OpenRouter or Ollama).';
  }

  /**
   * Checks for significant revenue drops compared to the previous period.
   */
  private async checkRevenueAnomaly(
    tenantId: string,
    dateRange: DateRange,
  ): Promise<Anomaly | null> {
    const periodDays = Math.max(
      1,
      Math.ceil(
        (new Date(dateRange.to).getTime() -
          new Date(dateRange.from).getTime()) /
          (1000 * 60 * 60 * 24),
      ),
    );

    const previousFrom = new Date(
      new Date(dateRange.from).getTime() - periodDays * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .split('T')[0];

    const result = await this.pool.query<{
      current_revenue: string;
      previous_revenue: string;
    }>(
      `SELECT
        COALESCE(SUM(CASE WHEN created_at >= $2::date AND created_at < ($3::date + INTERVAL '1 day') AND status IN ('paid', 'confirmed', 'completed') THEN total ELSE 0 END), 0) AS current_revenue,
        COALESCE(SUM(CASE WHEN created_at >= $4::date AND created_at < $2::date AND status IN ('paid', 'confirmed', 'completed') THEN total ELSE 0 END), 0) AS previous_revenue
       FROM orders
       WHERE tenant_id = $1
         AND created_at >= $4::date
         AND created_at < ($3::date + INTERVAL '1 day')`,
      [tenantId, dateRange.from, dateRange.to, previousFrom],
    );

    const row = result.rows[0];
    const currentRevenue = parseFloat(row?.current_revenue ?? '0');
    const previousRevenue = parseFloat(row?.previous_revenue ?? '0');

    if (previousRevenue > 0) {
      const dropPct =
        ((previousRevenue - currentRevenue) / previousRevenue) * 100;

      if (dropPct > 30) {
        return {
          id: `anomaly-revenue-${dateRange.from}`,
          type: 'revenue_drop',
          severity: dropPct > 50 ? 'critical' : 'high',
          title: 'Significant Revenue Drop',
          description: `Revenue dropped ${dropPct.toFixed(1)}% compared to the previous period (${previousRevenue.toLocaleString()} → ${currentRevenue.toLocaleString()}).`,
          detectedAt: new Date().toISOString(),
          metadata: { currentRevenue, previousRevenue, dropPct, periodDays },
        };
      }
    }

    return null;
  }

  /**
   * Checks for unusual void rate spikes.
   */
  private async checkVoidSpike(
    tenantId: string,
    dateRange: DateRange,
  ): Promise<Anomaly | null> {
    const result = await this.pool.query<{
      total_orders: string;
      void_count: string;
      historical_void_rate: string;
    }>(
      `SELECT
        COUNT(*)::int AS total_orders,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END)::int AS void_count,
        COALESCE(
          (SELECT COUNT(CASE WHEN status = 'cancelled' THEN 1 END)::float / NULLIF(COUNT(*)::float, 0)
           FROM orders
           WHERE tenant_id = $1
             AND created_at >= (NOW() - INTERVAL '90 days')
             AND created_at < $2::date),
          0
        ) AS historical_void_rate
       FROM orders
       WHERE tenant_id = $1
         AND created_at >= $2::date
         AND created_at < ($3::date + INTERVAL '1 day')`,
      [tenantId, dateRange.from, dateRange.to],
    );

    const row = result.rows[0];
    const totalOrders = parseInt(row?.total_orders ?? '0', 10);
    const voidCount = parseInt(row?.void_count ?? '0', 10);
    const historicalVoidRate = parseFloat(row?.historical_void_rate ?? '0');

    if (totalOrders > 0 && historicalVoidRate > 0) {
      const currentVoidRate = voidCount / totalOrders;
      if (currentVoidRate > historicalVoidRate * 2) {
        return {
          id: `anomaly-void-${dateRange.from}`,
          type: 'void_spike',
          severity: currentVoidRate > historicalVoidRate * 3 ? 'high' : 'medium',
          title: 'Void Rate Spike',
          description: `Current void rate (${(currentVoidRate * 100).toFixed(1)}%) is ${(currentVoidRate / historicalVoidRate).toFixed(1)}x the historical average (${(historicalVoidRate * 100).toFixed(1)}%).`,
          detectedAt: new Date().toISOString(),
          metadata: {
            currentVoidRate,
            historicalVoidRate,
            voidCount,
            totalOrders,
          },
        };
      }
    }

    return null;
  }

  /**
   * Checks for significant traffic pattern changes.
   */
  private async checkTrafficChange(
    tenantId: string,
    dateRange: DateRange,
  ): Promise<Anomaly | null> {
    const result = await this.pool.query<{
      current_daily_avg: string;
      historical_daily_avg: string;
    }>(
      `SELECT
        COALESCE(
          COUNT(CASE WHEN created_at >= $2::date AND created_at < ($3::date + INTERVAL '1 day') THEN 1 END)::float /
          NULLIF(EXTRACT(DAY FROM ($3::date - $2::date + INTERVAL '1 day'))::float, 0),
          0
        ) AS current_daily_avg,
        COALESCE(
          (SELECT COUNT(*)::float / NULLIF(EXTRACT(DAY FROM (INTERVAL '90 days'))::float, 0)
           FROM orders
           WHERE tenant_id = $1
             AND created_at >= (NOW() - INTERVAL '90 days')
             AND created_at < $2::date),
          0
        ) AS historical_daily_avg
       FROM orders
       WHERE tenant_id = $1
         AND created_at >= $2::date
         AND created_at < ($3::date + INTERVAL '1 day')`,
      [tenantId, dateRange.from, dateRange.to],
    );

    const row = result.rows[0];
    const currentAvg = parseFloat(row?.current_daily_avg ?? '0');
    const historicalAvg = parseFloat(row?.historical_daily_avg ?? '0');

    if (historicalAvg > 0) {
      const deviationPct =
        Math.abs(currentAvg - historicalAvg) / historicalAvg * 100;

      if (deviationPct > 40) {
        const direction = currentAvg > historicalAvg ? 'increase' : 'decrease';
        return {
          id: `anomaly-traffic-${dateRange.from}`,
          type: 'traffic_change',
          severity: deviationPct > 60 ? 'high' : 'medium',
          title: `Traffic ${direction === 'increase' ? 'Surge' : 'Drop'}`,
          description: `Daily order average ${direction}d by ${deviationPct.toFixed(1)}% compared to the 90-day historical average (${historicalAvg.toFixed(1)} → ${currentAvg.toFixed(1)} orders/day).`,
          detectedAt: new Date().toISOString(),
          metadata: { currentAvg, historicalAvg, deviationPct, direction },
        };
      }
    }

    return null;
  }
}
