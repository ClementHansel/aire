'use client';

import { api } from './api';
import { getUser } from './auth';

/**
 * Per-tenant automation settings — client-safe shape returned by
 * GET /api/settings/:tenantId. Secrets are never sent as plaintext; the backend
 * returns `*_set` booleans instead. Writes go through PATCH with the real field
 * names (`whatsapp_token_encrypted` / `llm_api_key_encrypted` carry plaintext
 * that the backend encrypts on save).
 */

export type ScheduleInterval = 'hourly' | 'daily' | null;
export type LlmProvider = 'openrouter' | 'hermes_ai';
export type ApprovalMode = 'approval_required' | 'autonomous';

export interface AutomationToggles {
  campaigns: boolean;
  retention_offers: boolean;
  pricing_suggestions: boolean;
  anomaly_alerts: boolean;
  queue_optimization: boolean;
  membership_recommendations: boolean;
  inventory?: boolean;
  finance?: boolean;
  sales?: boolean;
  hr?: boolean;
  procurement?: boolean;
}

export type ApprovalModes = Record<keyof AutomationToggles, ApprovalMode>;

export type DiscoveredDeviceType =
  | 'camera' | 'nvr' | 'printer' | 'barcode_scanner' | 'iot_controller'
  | 'router' | 'pos_terminal' | 'kiosk' | 'tablet' | 'unknown';

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

export interface PublicTenantSettings {
  whatsapp_phone: string | null;
  whatsapp_token_set: boolean;
  llm_provider: LlmProvider;
  llm_api_key_set: boolean;
  ai_enabled: boolean;
  automation_toggles: AutomationToggles;
  approval_modes: ApprovalModes;
  schedule_interval: ScheduleInterval;
  discovered_devices: DiscoveredDevice[];
}

/** Partial write payload. Uses the raw (`*_encrypted`) field names the API expects. */
export interface SettingsPatch {
  whatsapp_phone?: string | null;
  whatsapp_token_encrypted?: string;
  llm_provider?: LlmProvider;
  llm_api_key_encrypted?: string;
  ai_enabled?: boolean;
  automation_toggles?: Partial<AutomationToggles>;
  approval_modes?: Partial<ApprovalModes>;
  schedule_interval?: ScheduleInterval;
}

/** Resolve the current tenant id from the stored session. */
export function currentTenantId(): string {
  const id = getUser()?.tenantId;
  if (!id) throw new Error('No tenant in session');
  return id;
}

export function fetchSettings(): Promise<PublicTenantSettings> {
  return api.get<PublicTenantSettings>(`/settings/${currentTenantId()}`);
}

export function patchSettings(patch: SettingsPatch): Promise<PublicTenantSettings> {
  return api.patch<PublicTenantSettings>(`/settings/${currentTenantId()}`, patch);
}
