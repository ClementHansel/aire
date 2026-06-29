import type { AutomationToggles } from '../settings/settings.interfaces';

/**
 * Core interfaces for the AI Agent Module.
 *
 * Defines the tool registry types, invocation contracts, action proposals,
 * and scheduled analysis run tracking.
 *
 * Requirements: 5.1, 5.3
 */

/**
 * Definition of a discrete tool exposed to the AI Agent.
 * Each tool maps to a specific backend capability and is gated
 * by a corresponding automation toggle.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  outputSchema: Record<string, unknown>; // JSON Schema
  automationKey: keyof AutomationToggles;
}

/**
 * A request to invoke a specific tool for a given tenant and outlet.
 */
export interface ToolInvocation {
  toolName: string;
  tenantId: string;
  outletId: string;
  parameters: Record<string, unknown>;
  /** Optional AI reasoning for audit logging in autonomous mode */
  reasoning?: string;
  /** Optional confidence score for audit logging */
  confidence?: number;
}

/**
 * The result returned after a tool execution attempt.
 */
export interface ToolResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * An AI-proposed action awaiting tenant owner approval or recording
 * of autonomous execution.
 */
export interface ActionProposal {
  id: string;
  tenant_id: string;
  action_type: string;
  parameters: Record<string, unknown>;
  ai_reasoning: string;
  confidence_score: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

/**
 * A record of a scheduled AI analysis run for a tenant.
 */
export interface ScheduledAnalysisRun {
  id: string;
  tenant_id: string;
  start_time: string;
  end_time: string | null;
  metrics_reviewed: string[];
  insights_found: number;
  actions_proposed: number;
  actions_executed: number;
  status: 'running' | 'completed' | 'failed';
}
