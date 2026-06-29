export { SettingsModule } from './settings.module';
export { SettingsService } from './settings.service';
export { SettingsController } from './settings.controller';
export type {
  TenantAutomationSettings,
  AutomationToggles,
  ApprovalModes,
  ApprovalMode,
  DiscoveredDevice,
} from './settings.interfaces';
export { DEFAULT_AUTOMATION_SETTINGS } from './settings.interfaces';
export { TENANT_AUTOMATION_SETTINGS_SCHEMA } from './settings.schema';
export type {
  UpdateSettingsDto,
  SettingsResponseDto,
  SettingsValidationError,
} from './settings.dto';
