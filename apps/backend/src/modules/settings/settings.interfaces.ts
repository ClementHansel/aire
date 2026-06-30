/**
 * Core interfaces for the Settings Module.
 *
 * Defines the shape of per-tenant automation settings stored in the
 * tenants.settings JSONB column.
 *
 * Requirements: 1.1, 12.1
 */

/**
 * Approval mode for each automation capability.
 * - "approval_required": AI creates a proposal for human review before execution
 * - "autonomous": AI executes immediately without creating a proposal
 */
export type ApprovalMode = 'approval_required' | 'autonomous';

/**
 * Individual automation toggles controlling which AI capabilities are active.
 * Each defaults to false (OFF) for new tenants.
 */
export interface AutomationToggles {
  campaigns: boolean;
  retention_offers: boolean;
  pricing_suggestions: boolean;
  anomaly_alerts: boolean;
  queue_optimization: boolean;
  membership_recommendations: boolean;
  // Business module AI capabilities (optional; default OFF). Each gates the
  // corresponding module's AI action tools.
  inventory?: boolean;
  finance?: boolean;
  sales?: boolean;
  hr?: boolean;
  procurement?: boolean;
}

/**
 * Approval mode configuration per automation capability.
 * Determines whether actions require human approval or execute autonomously.
 */
export interface ApprovalModes {
  campaigns: ApprovalMode;
  retention_offers: ApprovalMode;
  pricing_suggestions: ApprovalMode;
  anomaly_alerts: ApprovalMode;
  queue_optimization: ApprovalMode;
  membership_recommendations: ApprovalMode;
  inventory?: ApprovalMode;
  finance?: ApprovalMode;
  sales?: ApprovalMode;
  hr?: ApprovalMode;
  procurement?: ApprovalMode;
}

/**
 * A network device found during discovery scanning.
 */
export interface DiscoveredDevice {
  device_id: string;
  ip_address: string;
  device_type: 'camera' | 'iot_controller' | 'router';
  manufacturer: string | null;
  model: string | null;
  suggested_label: string;
  status: 'online' | 'offline' | 'unconfigured';
  confirmed: boolean;
  assigned_bay_id: string | null;
  assigned_outlet_id: string | null;
  connection_params: Record<string, unknown>;
  discovered_at: string;
  confirmed_at: string | null;
}

/**
 * Per-tenant automation settings stored in the tenants.settings JSONB column.
 * Validated against a JSON Schema before persistence.
 */
export interface TenantAutomationSettings {
  whatsapp_phone: string | null;
  whatsapp_token_encrypted: string | null;
  llm_provider: 'openrouter' | 'hermes_ai';
  llm_api_key_encrypted: string | null;
  ai_enabled: boolean;
  automation_toggles: AutomationToggles;
  approval_modes: ApprovalModes;
  schedule_interval: 'hourly' | 'daily' | null;
  discovered_devices: DiscoveredDevice[];
}

/**
 * Default automation settings applied to newly created tenants.
 * All toggles OFF, all approval modes set to "approval_required".
 */
export const DEFAULT_AUTOMATION_SETTINGS: TenantAutomationSettings = {
  whatsapp_phone: null,
  whatsapp_token_encrypted: null,
  llm_provider: 'hermes_ai',
  llm_api_key_encrypted: null,
  ai_enabled: false,
  automation_toggles: {
    campaigns: false,
    retention_offers: false,
    pricing_suggestions: false,
    anomaly_alerts: false,
    queue_optimization: false,
    membership_recommendations: false,
    inventory: false,
    finance: false,
    sales: false,
    hr: false,
    procurement: false,
  },
  approval_modes: {
    campaigns: 'approval_required',
    retention_offers: 'approval_required',
    pricing_suggestions: 'approval_required',
    anomaly_alerts: 'approval_required',
    queue_optimization: 'approval_required',
    membership_recommendations: 'approval_required',
    inventory: 'approval_required',
    finance: 'approval_required',
    sales: 'approval_required',
    hr: 'approval_required',
    procurement: 'approval_required',
  },
  schedule_interval: null,
  discovered_devices: [],
};
