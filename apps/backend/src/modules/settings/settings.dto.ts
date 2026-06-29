/**
 * Data Transfer Objects for the Settings Module.
 *
 * Requirements: 1.3, 1.5, 12.2
 */

import type { AutomationToggles, ApprovalModes } from './settings.interfaces';

/**
 * DTO for updating tenant automation settings (partial update).
 * All fields are optional since PATCH semantics apply.
 */
export interface UpdateSettingsDto {
  whatsapp_phone?: string | null;
  whatsapp_token?: string | null; // plaintext; encrypted before storage
  llm_provider?: 'openrouter' | 'hermes_ai';
  llm_api_key?: string | null; // plaintext; encrypted before storage
  ai_enabled?: boolean;
  automation_toggles?: Partial<AutomationToggles>;
  approval_modes?: Partial<ApprovalModes>;
  schedule_interval?: 'hourly' | 'daily' | null;
}

/**
 * Response DTO for settings retrieval.
 * Sensitive fields (tokens/keys) are omitted or masked.
 */
export interface SettingsResponseDto {
  whatsapp_phone: string | null;
  whatsapp_configured: boolean;
  llm_provider: 'openrouter' | 'hermes_ai';
  llm_key_configured: boolean;
  ai_enabled: boolean;
  automation_toggles: AutomationToggles;
  approval_modes: ApprovalModes;
  schedule_interval: 'hourly' | 'daily' | null;
  discovered_devices: Array<{
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
    discovered_at: string;
    confirmed_at: string | null;
  }>;
}

/**
 * Validation error detail returned when settings fail schema validation.
 */
export interface SettingsValidationError {
  field: string;
  message: string;
}
