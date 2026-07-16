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
/**
 * Device kinds a branch-bridge scan can report. Must stay in sync with the
 * bridge wire type (apps/branch-bridge/src/types.ts DeviceType) and the
 * registry mapping (device-registry.service.ts DEVICE_TYPE_TO_CATEGORY).
 */
export type DiscoveredDeviceType =
  | 'camera'
  | 'nvr'
  | 'printer'
  | 'barcode_scanner'
  | 'iot_controller'
  | 'router'
  | 'pos_terminal'
  | 'kiosk'
  | 'tablet'
  | 'unknown';

export interface DiscoveredDevice {
  device_id: string;
  ip_address: string;
  device_type: DiscoveredDeviceType;
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
 * Client-safe view of tenant settings. Sensitive secrets are never sent to the
 * browser as plaintext — they are replaced by boolean "is set" flags. Returned
 * by GET /api/settings/:tenantId.
 */
export type PublicTenantSettings = Omit<
  TenantAutomationSettings,
  'whatsapp_token_encrypted' | 'llm_api_key_encrypted'
> & {
  whatsapp_token_set: boolean;
  llm_api_key_set: boolean;
};

/**
 * Default automation settings applied to newly created tenants.
 *
 * The master AI switch (`ai_enabled`) defaults ON so the assistant + fluid
 * WhatsApp replies work out-of-the-box. This is safe because it only turns the
 * *brain* on: with no LLM key set the brain gracefully falls back to templates
 * (and the UI surfaces an "add your key" notice). Every ACTION automation toggle
 * still defaults OFF with approval_required, so nothing acts autonomously until
 * the owner opts in per capability.
 */
export const DEFAULT_AUTOMATION_SETTINGS: TenantAutomationSettings = {
  whatsapp_phone: null,
  whatsapp_token_encrypted: null,
  // Default to OpenRouter so a fresh tenant's misconfiguration is an explicit
  // "add your API key" (surfaced in the UI) rather than a silent attempt to
  // reach a local Ollama that doesn't exist in production.
  llm_provider: 'openrouter',
  llm_api_key_encrypted: null,
  ai_enabled: true,
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
