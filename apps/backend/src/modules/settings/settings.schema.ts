/**
 * JSON Schema for validating TenantAutomationSettings payloads.
 *
 * Used by the Settings Service to validate settings before persistence.
 * Matches the schema defined in the design document's "Tenant Settings Schema (JSONB)" section.
 *
 * Requirements: 1.3, 12.1, 12.2
 */
export const TENANT_AUTOMATION_SETTINGS_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    whatsapp_phone: {
      type: ['string', 'null'],
      pattern: '^\\+[1-9]\\d{1,14}$',
    },
    whatsapp_token_encrypted: {
      type: ['string', 'null'],
    },
    llm_provider: {
      type: 'string',
      enum: ['openrouter', 'hermes_ai'],
    },
    llm_api_key_encrypted: {
      type: ['string', 'null'],
    },
    ai_enabled: {
      type: 'boolean',
      default: false,
    },
    automation_toggles: {
      type: 'object',
      properties: {
        campaigns: { type: 'boolean', default: false },
        retention_offers: { type: 'boolean', default: false },
        pricing_suggestions: { type: 'boolean', default: false },
        anomaly_alerts: { type: 'boolean', default: false },
        queue_optimization: { type: 'boolean', default: false },
        membership_recommendations: { type: 'boolean', default: false },
        inventory: { type: 'boolean', default: false },
        finance: { type: 'boolean', default: false },
        sales: { type: 'boolean', default: false },
        hr: { type: 'boolean', default: false },
        procurement: { type: 'boolean', default: false },
      },
      additionalProperties: false,
    },
    approval_modes: {
      type: 'object',
      properties: {
        campaigns: {
          type: 'string',
          enum: ['approval_required', 'autonomous'],
        },
        retention_offers: {
          type: 'string',
          enum: ['approval_required', 'autonomous'],
        },
        pricing_suggestions: {
          type: 'string',
          enum: ['approval_required', 'autonomous'],
        },
        anomaly_alerts: {
          type: 'string',
          enum: ['approval_required', 'autonomous'],
        },
        queue_optimization: {
          type: 'string',
          enum: ['approval_required', 'autonomous'],
        },
        membership_recommendations: {
          type: 'string',
          enum: ['approval_required', 'autonomous'],
        },
        inventory: { type: 'string', enum: ['approval_required', 'autonomous'] },
        finance: { type: 'string', enum: ['approval_required', 'autonomous'] },
        sales: { type: 'string', enum: ['approval_required', 'autonomous'] },
        hr: { type: 'string', enum: ['approval_required', 'autonomous'] },
        procurement: { type: 'string', enum: ['approval_required', 'autonomous'] },
      },
      additionalProperties: false,
    },
    schedule_interval: {
      type: ['string', 'null'],
      enum: ['hourly', 'daily', null],
    },
    discovered_devices: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          device_id: { type: 'string', format: 'uuid' },
          ip_address: { type: 'string', format: 'ipv4' },
          device_type: {
            type: 'string',
            enum: ['camera', 'iot_controller', 'router'],
          },
          manufacturer: { type: ['string', 'null'] },
          model: { type: ['string', 'null'] },
          suggested_label: { type: 'string' },
          status: {
            type: 'string',
            enum: ['online', 'offline', 'unconfigured'],
          },
          confirmed: { type: 'boolean' },
          assigned_bay_id: { type: ['string', 'null'] },
          assigned_outlet_id: { type: ['string', 'null'] },
          connection_params: { type: 'object' },
          discovered_at: { type: 'string', format: 'date-time' },
          confirmed_at: { type: ['string', 'null'], format: 'date-time' },
        },
        required: [
          'device_id',
          'ip_address',
          'device_type',
          'suggested_label',
          'status',
          'confirmed',
          'discovered_at',
        ],
      },
    },
  },
  required: ['ai_enabled', 'automation_toggles', 'approval_modes'],
  additionalProperties: true,
} as const;
