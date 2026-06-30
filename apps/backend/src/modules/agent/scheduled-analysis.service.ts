import { Injectable, Inject, Logger, forwardRef, Optional } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { SettingsService } from '../settings/settings.service';
import { LLMRouterService, ChatMessage, LLMErrorResponse } from './llm-router.service';
import { AgentService } from './agent.service';
import { AgentToolsService } from './agent-tools.service';
import { AuditService } from '../audit/audit.service';
import type { AutomationToggles } from '../settings/settings.interfaces';
import type { ScheduledAnalysisRun, ToolDefinition } from './agent.types';

/**
 * Metrics categories the AI agent reviews during scheduled analysis.
 */
const METRIC_CATEGORIES = [
  'revenue',
  'customer_retention',
  'queue_wait_times',
  'service_utilization',
  'membership_conversions',
  'anomaly_detection',
] as const;

type MetricCategory = (typeof METRIC_CATEGORIES)[number];

/**
 * Maps automation toggle keys to the metric categories they analyze.
 */
const TOGGLE_METRIC_MAP: Partial<Record<keyof AutomationToggles, MetricCategory[]>> = {
  campaigns: ['revenue', 'customer_retention'],
  retention_offers: ['customer_retention', 'membership_conversions'],
  pricing_suggestions: ['revenue', 'service_utilization'],
  anomaly_alerts: ['anomaly_detection', 'revenue'],
  queue_optimization: ['queue_wait_times', 'service_utilization'],
  membership_recommendations: ['membership_conversions', 'customer_retention'],
};

/**
 * Internal result from LLM analysis of tenant metrics.
 */
interface AnalysisInsight {
  actionType: string;
  parameters: Record<string, unknown>;
  reasoning: string;
  confidence: number;
}

/**
 * Scheduled Analysis Service.
 *
 * Executes periodic AI analysis for a tenant: reviews metrics based on
 * enabled automation toggles, calls the LLM to produce insights, and
 * proposes/executes actions per the tenant's approval configuration.
 *
 * Skips analysis entirely if no automation toggles are enabled.
 *
 * Records each run with start time, end time, metrics reviewed,
 * insights found, and actions proposed/executed.
 *
 * Requirements: 8.2, 8.3, 8.4, 8.5
 */
@Injectable()
export class ScheduledAnalysisService {
  private readonly logger = new Logger(ScheduledAnalysisService.name);

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly settingsService: SettingsService,
    private readonly llmRouterService: LLMRouterService,
    @Inject(forwardRef(() => AgentService)) private readonly agentService: AgentService,
    private readonly auditService: AuditService,
    @Optional() private readonly agentToolsService?: AgentToolsService,
  ) {}

  /**
   * Run scheduled analysis for a tenant.
   *
   * Flow:
   * 1. Load tenant settings and check enabled toggles
   * 2. Skip if no toggles are enabled (Req 8.5)
   * 3. Create a run record with status "running"
   * 4. Determine which metrics to review based on enabled toggles
   * 5. Call LLM to analyze metrics and produce insights
   * 6. For each insight, propose or execute action per approval mode
   * 7. Update run record with results and status "completed" or "failed"
   *
   * Requirements: 8.2, 8.3, 8.4, 8.5
   */
  async runScheduledAnalysis(tenantId: string): Promise<ScheduledAnalysisRun | null> {
    // 1. Load tenant settings
    let settings;
    try {
      settings = await this.settingsService.getSettings(tenantId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to load settings for tenant ${tenantId}: ${message}`);
      return null;
    }

    // 2. Skip if AI is disabled (master switch) or no automation toggles enabled (Req 8.5)
    const enabledToggles = this.getEnabledToggles(settings.automation_toggles);
    if (!settings.ai_enabled || enabledToggles.length === 0) {
      this.logger.log(`Skipping analysis for tenant ${tenantId}: AI disabled or no automation toggles enabled`);
      return null;
    }

    // 3. Create a run record
    const runId = await this.createRunRecord(tenantId);

    // 4. Determine metrics to review
    const metricsToReview = this.getMetricsToReview(enabledToggles);

    let insightsFound = 0;
    let actionsProposed = 0;
    let actionsExecuted = 0;

    try {
      // 5. Call LLM to analyze metrics
      const insights = await this.analyzeMetrics(tenantId, enabledToggles, metricsToReview);
      insightsFound = insights.length;

      // 6. For each insight, route through the agent based on approval mode
      for (const insight of insights) {
        const toggleKey = this.getToggleKeyForToolName(insight.actionType);
        if (!toggleKey) continue;
        const approvalMode = settings.approval_modes[toggleKey];

        if (approvalMode === 'autonomous') {
          // Execute immediately via the agent
          const result = await this.agentService.executeTool({
            toolName: insight.actionType,
            tenantId,
            outletId: (insight.parameters.outlet_id as string) ?? tenantId,
            parameters: insight.parameters,
          });

          if (result.success) {
            actionsExecuted++;
          }
        } else {
          // Create a proposal for approval
          await this.agentService.proposeAction(
            tenantId,
            insight.actionType,
            insight.parameters,
            insight.reasoning,
            insight.confidence,
          );
          actionsProposed++;
        }
      }

      // 7. Complete the run record
      const run = await this.completeRunRecord(runId, {
        metricsReviewed: metricsToReview,
        insightsFound,
        actionsProposed,
        actionsExecuted,
        status: 'completed',
      });

      // Audit-log the completed analysis
      await this.auditService.log({
        tenantId,
        userId: 'system',
        operation: 'scheduled_analysis_completed',
        entityType: 'scheduled_analysis_run',
        entityId: runId,
        afterValue: {
          metrics_reviewed: metricsToReview,
          insights_found: insightsFound,
          actions_proposed: actionsProposed,
          actions_executed: actionsExecuted,
        },
      });

      this.logger.log(
        `Analysis completed for tenant ${tenantId}: ` +
        `${metricsToReview.length} metrics reviewed, ${insightsFound} insights, ` +
        `${actionsProposed} proposed, ${actionsExecuted} executed`,
      );

      return run;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Analysis failed for tenant ${tenantId}: ${errorMessage}`);

      // Mark run as failed
      const run = await this.completeRunRecord(runId, {
        metricsReviewed: metricsToReview,
        insightsFound,
        actionsProposed,
        actionsExecuted,
        status: 'failed',
        errorDetails: errorMessage,
      });

      return run;
    }
  }

  /**
   * Get the list of enabled toggle keys.
   */
  getEnabledToggles(toggles: AutomationToggles): (keyof AutomationToggles)[] {
    return (Object.entries(toggles) as [keyof AutomationToggles, boolean][])
      .filter(([, enabled]) => enabled)
      .map(([key]) => key);
  }

  /**
   * Determine which metric categories to review based on enabled toggles.
   * De-duplicates across multiple toggles that may share metric categories.
   */
  getMetricsToReview(enabledToggles: (keyof AutomationToggles)[]): string[] {
    const metricSet = new Set<string>();
    for (const toggle of enabledToggles) {
      const metrics = TOGGLE_METRIC_MAP[toggle];
      if (metrics) {
        for (const metric of metrics) {
          metricSet.add(metric);
        }
      }
    }
    return Array.from(metricSet).sort();
  }

  /**
   * Call the LLM to analyze tenant metrics and produce actionable insights.
   *
   * Sends a structured prompt to the tenant's configured LLM provider
   * with current metric categories and enabled tools. The LLM responds
   * with a JSON array of suggested actions.
   *
   * Requirement: 8.3
   */
  private async analyzeMetrics(
    tenantId: string,
    enabledToggles: (keyof AutomationToggles)[],
    metricsToReview: string[],
  ): Promise<AnalysisInsight[]> {
    const availableTools = enabledToggles
      .map((toggle) => {
        const tool = this.getToolForToggle(toggle);
        return tool ? `- ${tool.name}: ${tool.description}` : null;
      })
      .filter(Boolean)
      .join('\n');

    const systemPrompt = `You are an AI operations analyst for a car wash/service business. 
Analyze the provided metrics and suggest actionable automation steps.
You MUST respond with a valid JSON array of action objects.
Each action object must have: actionType (tool name), parameters (object), reasoning (string), confidence (number 0-1).
Only suggest actions for the available tools listed below.
If no actions are warranted, respond with an empty array [].

Available tools:
${availableTools}`;

    const userPrompt = `Analyze the following metric categories for this tenant and suggest actions:
Metrics being reviewed: ${metricsToReview.join(', ')}
Enabled automation capabilities: ${enabledToggles.join(', ')}

CURRENT BUSINESS DATA (live snapshot):
${await this.gatherMetricsSnapshot(tenantId)}

Based on this real data, what automated actions would you recommend?
Respond ONLY with a JSON array.`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.llmRouterService.chat(tenantId, messages, {
      temperature: 0.3,
      max_tokens: 2000,
    });

    // Check for error responses
    if ('error' in response && (response as LLMErrorResponse).error === true) {
      const errorResponse = response as LLMErrorResponse;
      this.logger.warn(
        `LLM analysis failed for tenant ${tenantId}: ${errorResponse.errorMessage}`,
      );
      return [];
    }

    // Parse the LLM response as JSON
    return this.parseInsightsFromLLM(response.content, enabledToggles);
  }

  /**
   * Gather a real, live data snapshot (revenue, orders, memberships, queue,
   * recent events) to ground the LLM's analysis in actual numbers.
   */
  private async gatherMetricsSnapshot(tenantId: string): Promise<string> {
    if (!this.agentToolsService) return '{}';
    try {
      const [summary, memberships, events] = await Promise.all([        this.agentToolsService.run({ toolName: 'get_business_summary', tenantId, outletId: '', parameters: {} }),
        this.agentToolsService.run({ toolName: 'list_memberships', tenantId, outletId: '', parameters: {} }),
        this.agentToolsService.run({ toolName: 'list_recent_events', tenantId, outletId: '', parameters: { limit: 20 } }),
      ]);
      return JSON.stringify(
        {
          businessSummary: summary.data ?? {},
          memberships: memberships.data ?? {},
          recentEvents: (events.data as { events?: unknown[] })?.events ?? [],
        },
        null,
        2,
      ).slice(0, 6000);
    } catch (err) {
      this.logger.warn(`Failed to gather metrics snapshot: ${err instanceof Error ? err.message : err}`);
      return '{}';
    }
  }

  /**
   * Parse insights from LLM response content.
   * Validates that each insight references a valid enabled tool.
   */
  private parseInsightsFromLLM(
    content: string,
    enabledToggles: (keyof AutomationToggles)[],
  ): AnalysisInsight[] {
    try {
      // Extract JSON from the response (handle markdown code blocks)
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.slice(7);
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.slice(3);
      }
      if (jsonStr.endsWith('```')) {
        jsonStr = jsonStr.slice(0, -3);
      }
      jsonStr = jsonStr.trim();

      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) {
        this.logger.warn('LLM response is not a JSON array');
        return [];
      }

      // Validate and filter insights
      const validTools = new Set(enabledToggles.map((t) => this.getToolNameForToggle(t)));

      return parsed
        .filter((item: any) => {
          if (!item.actionType || !item.parameters || !item.reasoning) return false;
          if (typeof item.confidence !== 'number') return false;
          if (!validTools.has(item.actionType)) return false;
          return true;
        })
        .map((item: any) => ({
          actionType: item.actionType,
          parameters: item.parameters ?? {},
          reasoning: item.reasoning,
          confidence: Math.max(0, Math.min(1, item.confidence)),
        }));
    } catch (error) {
      this.logger.warn(`Failed to parse LLM insights: ${error instanceof Error ? error.message : 'Unknown'}`);
      return [];
    }
  }

  /**
   * Get the tool definition associated with an automation toggle.
   */
  private getToolForToggle(toggle: keyof AutomationToggles): ToolDefinition | undefined {
    const toolName = this.getToolNameForToggle(toggle);
    return toolName ? this.agentService.getTool(toolName) : undefined;
  }

  /**
   * Map an automation toggle key to its corresponding tool name.
   */
  private getToolNameForToggle(toggle: keyof AutomationToggles): string | undefined {
    const mapping: Partial<Record<keyof AutomationToggles, string>> = {
      campaigns: 'create_campaign',
      retention_offers: 'send_retention_offer',
      pricing_suggestions: 'suggest_pricing',
      anomaly_alerts: 'flag_anomaly',
      queue_optimization: 'adjust_queue_priority',
      membership_recommendations: 'send_membership_recommendation',
    };
    return mapping[toggle];
  }

  /**
   * Reverse-map a tool name back to its automation toggle key.
   */
  private getToggleKeyForToolName(toolName: string): keyof AutomationToggles | null {
    const reverseMapping: Record<string, keyof AutomationToggles> = {
      create_campaign: 'campaigns',
      send_retention_offer: 'retention_offers',
      suggest_pricing: 'pricing_suggestions',
      flag_anomaly: 'anomaly_alerts',
      adjust_queue_priority: 'queue_optimization',
      send_membership_recommendation: 'membership_recommendations',
    };
    return reverseMapping[toolName] ?? null;
  }

  // ─── Database Operations ────────────────────────────────────────────

  /**
   * Create a new run record with status "running".
   */
  private async createRunRecord(tenantId: string): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO scheduled_analysis_runs (tenant_id, status)
       VALUES ($1, 'running')
       RETURNING id`,
      [tenantId],
    );
    return result.rows[0]!.id;
  }

  /**
   * Complete a run record with results.
   */
  private async completeRunRecord(
    runId: string,
    data: {
      metricsReviewed: string[];
      insightsFound: number;
      actionsProposed: number;
      actionsExecuted: number;
      status: 'completed' | 'failed';
      errorDetails?: string;
    },
  ): Promise<ScheduledAnalysisRun> {
    const result = await this.pool.query<{
      id: string;
      tenant_id: string;
      start_time: Date;
      end_time: Date;
      metrics_reviewed: string[];
      insights_found: number;
      actions_proposed: number;
      actions_executed: number;
      status: string;
    }>(
      `UPDATE scheduled_analysis_runs
       SET end_time = NOW(),
           metrics_reviewed = $1,
           insights_found = $2,
           actions_proposed = $3,
           actions_executed = $4,
           status = $5,
           error_details = $6
       WHERE id = $7
       RETURNING id, tenant_id, start_time, end_time, metrics_reviewed, insights_found, actions_proposed, actions_executed, status`,
      [
        data.metricsReviewed,
        data.insightsFound,
        data.actionsProposed,
        data.actionsExecuted,
        data.status,
        data.errorDetails ?? null,
        runId,
      ],
    );

    const row = result.rows[0]!;
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      start_time: row.start_time instanceof Date ? row.start_time.toISOString() : String(row.start_time),
      end_time: row.end_time instanceof Date ? row.end_time.toISOString() : String(row.end_time),
      metrics_reviewed: row.metrics_reviewed,
      insights_found: row.insights_found,
      actions_proposed: row.actions_proposed,
      actions_executed: row.actions_executed,
      status: row.status as ScheduledAnalysisRun['status'],
    };
  }

  /**
   * Get the last analysis run for a tenant.
   */
  async getLastRun(tenantId: string): Promise<ScheduledAnalysisRun | null> {
    const result = await this.pool.query<{
      id: string;
      tenant_id: string;
      start_time: Date;
      end_time: Date | null;
      metrics_reviewed: string[];
      insights_found: number;
      actions_proposed: number;
      actions_executed: number;
      status: string;
    }>(
      `SELECT id, tenant_id, start_time, end_time, metrics_reviewed, insights_found, actions_proposed, actions_executed, status
       FROM scheduled_analysis_runs
       WHERE tenant_id = $1
       ORDER BY start_time DESC
       LIMIT 1`,
      [tenantId],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      tenant_id: row.tenant_id,
      start_time: row.start_time instanceof Date ? row.start_time.toISOString() : String(row.start_time),
      end_time: row.end_time instanceof Date ? row.end_time.toISOString() : (row.end_time ?? null),
      metrics_reviewed: row.metrics_reviewed,
      insights_found: row.insights_found,
      actions_proposed: row.actions_proposed,
      actions_executed: row.actions_executed,
      status: row.status as ScheduledAnalysisRun['status'],
    };
  }
}
