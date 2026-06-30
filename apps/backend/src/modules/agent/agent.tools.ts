import type { ToolDefinition } from './agent.types';

/**
 * Tool Registry for the AI Agent.
 *
 * Defines and registers the 6 discrete tools the AI Agent can invoke.
 * Each tool is mapped to its corresponding automation toggle key.
 *
 * Requirements: 5.1, 5.3
 */

/**
 * The in-memory tool registry. Maps tool name to its definition.
 */
const toolRegistry = new Map<string, ToolDefinition>();

/**
 * Register a tool definition in the agent's tool registry.
 * If a tool with the same name already exists, it will be overwritten.
 */
export function registerTool(definition: ToolDefinition): void {
  toolRegistry.set(definition.name, definition);
}

/**
 * Retrieve a tool definition by name.
 * Returns undefined if the tool is not registered.
 */
export function getTool(name: string): ToolDefinition | undefined {
  return toolRegistry.get(name);
}

/**
 * Retrieve all registered tool definitions.
 */
export function getAllTools(): ToolDefinition[] {
  return Array.from(toolRegistry.values());
}

/**
 * Check if a tool is registered.
 */
export function hasTool(name: string): boolean {
  return toolRegistry.has(name);
}

/**
 * Clear all registered tools. Useful for testing.
 */
export function clearToolRegistry(): void {
  toolRegistry.clear();
}

// ─── Default Tool Definitions ─────────────────────────────────────────────────

export const CREATE_CAMPAIGN_TOOL: ToolDefinition = {
  name: 'create_campaign',
  description:
    'Creates a marketing campaign targeting specific customer segments based on AI analysis of engagement patterns and revenue opportunities.',
  inputSchema: {
    type: 'object',
    properties: {
      campaign_name: { type: 'string', description: 'Name of the campaign' },
      target_segment: { type: 'string', description: 'Customer segment to target' },
      channel: { type: 'string', enum: ['whatsapp', 'email', 'sms'], description: 'Delivery channel' },
      message_template: { type: 'string', description: 'Message template content' },
      scheduled_at: { type: 'string', format: 'date-time', description: 'When to send the campaign' },
    },
    required: ['campaign_name', 'target_segment', 'channel', 'message_template'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      campaign_id: { type: 'string', description: 'ID of the created campaign' },
      recipients_count: { type: 'number', description: 'Number of recipients targeted' },
    },
    required: ['campaign_id', 'recipients_count'],
  },
  automationKey: 'campaigns',
};

export const SEND_RETENTION_OFFER_TOOL: ToolDefinition = {
  name: 'send_retention_offer',
  description:
    'Sends a personalized retention offer to a customer identified as at-risk of churning, based on visit frequency decline or membership lapse patterns.',
  inputSchema: {
    type: 'object',
    properties: {
      customer_id: { type: 'string', description: 'ID of the at-risk customer' },
      offer_type: { type: 'string', enum: ['discount', 'free_service', 'upgrade'], description: 'Type of retention offer' },
      offer_value: { type: 'string', description: 'Value or description of the offer' },
      expiry_days: { type: 'number', description: 'Days until offer expires', minimum: 1, maximum: 90 },
      channel: { type: 'string', enum: ['whatsapp', 'email', 'sms'], description: 'Delivery channel' },
    },
    required: ['customer_id', 'offer_type', 'offer_value', 'expiry_days'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      offer_id: { type: 'string', description: 'ID of the sent offer' },
      delivered: { type: 'boolean', description: 'Whether the offer was successfully delivered' },
    },
    required: ['offer_id', 'delivered'],
  },
  automationKey: 'retention_offers',
};

export const ADJUST_QUEUE_PRIORITY_TOOL: ToolDefinition = {
  name: 'adjust_queue_priority',
  description:
    'Adjusts service queue priorities to optimize wait times and throughput based on current demand patterns, staff availability, and service duration estimates.',
  inputSchema: {
    type: 'object',
    properties: {
      bay_id: { type: 'string', description: 'ID of the service bay to adjust' },
      priority_adjustments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            service_type: { type: 'string', description: 'Type of service' },
            priority_delta: { type: 'number', description: 'Priority change (-10 to +10)', minimum: -10, maximum: 10 },
          },
          required: ['service_type', 'priority_delta'],
        },
        description: 'List of priority adjustments per service type',
      },
      reason: { type: 'string', description: 'AI reasoning for the adjustment' },
    },
    required: ['bay_id', 'priority_adjustments', 'reason'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      applied: { type: 'boolean', description: 'Whether the adjustments were applied' },
      affected_entries: { type: 'number', description: 'Number of queue entries affected' },
    },
    required: ['applied', 'affected_entries'],
  },
  automationKey: 'queue_optimization',
};

export const FLAG_ANOMALY_TOOL: ToolDefinition = {
  name: 'flag_anomaly',
  description:
    'Flags a detected anomaly in business metrics (revenue drops, unusual traffic patterns, equipment issues) for operator attention.',
  inputSchema: {
    type: 'object',
    properties: {
      anomaly_type: {
        type: 'string',
        enum: ['revenue_drop', 'traffic_spike', 'equipment_issue', 'churn_spike', 'other'],
        description: 'Category of the anomaly',
      },
      severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Severity level' },
      description: { type: 'string', description: 'Human-readable description of the anomaly' },
      metric_name: { type: 'string', description: 'Name of the affected metric' },
      expected_value: { type: 'number', description: 'Expected metric value' },
      actual_value: { type: 'number', description: 'Actual metric value observed' },
    },
    required: ['anomaly_type', 'severity', 'description', 'metric_name'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      anomaly_id: { type: 'string', description: 'ID of the flagged anomaly' },
      notified: { type: 'boolean', description: 'Whether the operator was notified' },
    },
    required: ['anomaly_id', 'notified'],
  },
  automationKey: 'anomaly_alerts',
};

export const SUGGEST_PRICING_TOOL: ToolDefinition = {
  name: 'suggest_pricing',
  description:
    'Suggests pricing adjustments for services based on demand patterns, competitor analysis, time-of-day utilization, and revenue optimization goals.',
  inputSchema: {
    type: 'object',
    properties: {
      service_id: { type: 'string', description: 'ID of the service to reprice' },
      current_price: { type: 'number', description: 'Current price of the service', minimum: 0 },
      suggested_price: { type: 'number', description: 'AI-suggested new price', minimum: 0 },
      reasoning: { type: 'string', description: 'Explanation of why this price is recommended' },
      effective_from: { type: 'string', format: 'date-time', description: 'When the new price should take effect' },
    },
    required: ['service_id', 'current_price', 'suggested_price', 'reasoning'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      suggestion_id: { type: 'string', description: 'ID of the pricing suggestion' },
      applied: { type: 'boolean', description: 'Whether the pricing was applied immediately' },
    },
    required: ['suggestion_id', 'applied'],
  },
  automationKey: 'pricing_suggestions',
};

export const SEND_MEMBERSHIP_RECOMMENDATION_TOOL: ToolDefinition = {
  name: 'send_membership_recommendation',
  description:
    'Sends a personalized membership plan recommendation to a customer based on their visit history, spending patterns, and service preferences.',
  inputSchema: {
    type: 'object',
    properties: {
      customer_id: { type: 'string', description: 'ID of the customer to recommend to' },
      recommended_plan_id: { type: 'string', description: 'ID of the recommended membership plan' },
      reasoning: { type: 'string', description: 'AI reasoning for the recommendation' },
      estimated_savings: { type: 'number', description: 'Estimated monthly savings for the customer', minimum: 0 },
      channel: { type: 'string', enum: ['whatsapp', 'email', 'sms'], description: 'Delivery channel' },
    },
    required: ['customer_id', 'recommended_plan_id', 'reasoning'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      recommendation_id: { type: 'string', description: 'ID of the sent recommendation' },
      delivered: { type: 'boolean', description: 'Whether the recommendation was delivered' },
    },
    required: ['recommendation_id', 'delivered'],
  },
  automationKey: 'membership_recommendations',
};

// ─── Read-Only Tools (the agent's "eyes") ─────────────────────────────────────

const emptyObjectSchema = { type: 'object', properties: {}, additionalProperties: true };

export const GET_BUSINESS_SUMMARY_TOOL: ToolDefinition = {
  name: 'get_business_summary',
  description:
    'Returns a snapshot of the business: revenue today / last 7 days / last 30 days, order counts by status, active memberships, memberships expiring soon, and bay status. Use this first to understand current performance.',
  inputSchema: emptyObjectSchema,
  outputSchema: emptyObjectSchema,
  readOnly: true,
};

export const LIST_ORDERS_TOOL: ToolDefinition = {
  name: 'list_orders',
  description:
    'Lists recent orders. Optional filters: status (ordered|paid|confirmed|completed|cancelled), limit (default 20, max 100).',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', description: 'Filter by order status' },
      limit: { type: 'number', description: 'Max rows (default 20, max 100)' },
    },
  },
  outputSchema: emptyObjectSchema,
  readOnly: true,
};

export const FIND_CUSTOMER_TOOL: ToolDefinition = {
  name: 'find_customer',
  description:
    'Looks up a customer by phone or name and returns their profile, active memberships, and recent orders.',
  inputSchema: {
    type: 'object',
    properties: {
      phone: { type: 'string', description: 'Customer phone (any format)' },
      name: { type: 'string', description: 'Full or partial customer name' },
    },
  },
  outputSchema: emptyObjectSchema,
  readOnly: true,
};

export const LIST_MEMBERSHIPS_TOOL: ToolDefinition = {
  name: 'list_memberships',
  description:
    'Summarizes memberships: active count and memberships expiring within 30 days (with customer name/phone).',
  inputSchema: emptyObjectSchema,
  outputSchema: emptyObjectSchema,
  readOnly: true,
};

export const LIST_SERVICES_TOOL: ToolDefinition = {
  name: 'list_services',
  description: 'Lists the tenant services with category, price, and active status.',
  inputSchema: emptyObjectSchema,
  outputSchema: emptyObjectSchema,
  readOnly: true,
};

export const GET_QUEUE_STATUS_TOOL: ToolDefinition = {
  name: 'get_queue_status',
  description: 'Returns current bay statuses and the number of orders waiting (paid/confirmed) today.',
  inputSchema: emptyObjectSchema,
  outputSchema: emptyObjectSchema,
  readOnly: true,
};

export const LIST_RECENT_EVENTS_TOOL: ToolDefinition = {
  name: 'list_recent_events',
  description:
    'Returns the most recent domain events (orders, payments, memberships, vouchers) so you can see what is happening in real time. Optional: type filter, limit (default 30).',
  inputSchema: {
    type: 'object',
    properties: {
      type: { type: 'string', description: 'Filter by event type, e.g. order.paid' },
      limit: { type: 'number', description: 'Max events (default 30, max 100)' },
    },
  },
  outputSchema: emptyObjectSchema,
  readOnly: true,
};

/** Read-only tools available to the conversational + analysis agent. */
export const READ_TOOLS: ToolDefinition[] = [
  GET_BUSINESS_SUMMARY_TOOL,
  LIST_ORDERS_TOOL,
  FIND_CUSTOMER_TOOL,
  LIST_MEMBERSHIPS_TOOL,
  LIST_SERVICES_TOOL,
  GET_QUEUE_STATUS_TOOL,
  LIST_RECENT_EVENTS_TOOL,
];

/**
 * All default tool definitions.
 */
export const DEFAULT_TOOLS: ToolDefinition[] = [
  CREATE_CAMPAIGN_TOOL,
  SEND_RETENTION_OFFER_TOOL,
  ADJUST_QUEUE_PRIORITY_TOOL,
  FLAG_ANOMALY_TOOL,
  SUGGEST_PRICING_TOOL,
  SEND_MEMBERSHIP_RECOMMENDATION_TOOL,
  ...READ_TOOLS,
];

/**
 * Register all default tools in the registry.
 * Called during module initialization.
 */
export function registerDefaultTools(): void {
  for (const tool of DEFAULT_TOOLS) {
    registerTool(tool);
  }
}
