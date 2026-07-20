import type { ToolCatalogEntry } from '../agent/tool-loop';
import type { AgentRole } from '../agent-registry/agent-registry.service';

/**
 * Customer-facing tool catalog — the SECURITY BOUNDARY for the WhatsApp agent.
 *
 * Unlike the staff co-pilot's registry (which exposes whole-business data:
 * finance, all orders, payroll…), every tool here is either:
 *   - scoped to the ONE customer resolved from the inbound phone number, or
 *   - strictly public info (service prices, plans, promotions).
 *
 * The customer is bound server-side (never from model output), so a tool can
 * only ever read/act for the person actually chatting. This catalog is what a
 * customer-facing n8n flow may call through the bridge, and what the built-in
 * fallback runtime advertises.
 */
export type CustomerToolName =
  | 'get_my_summary'
  | 'get_service_prices'
  | 'get_membership_plans'
  | 'get_promotions'
  | 'get_branch_info'
  | 'get_my_vouchers'
  | 'create_booking'
  | 'escalate_to_human';

export const CUSTOMER_TOOLS: Record<CustomerToolName, ToolCatalogEntry> = {
  get_my_summary: {
    name: 'get_my_summary',
    description:
      "The chatting customer's own data: memberships (status/expiry/uses left), recent orders, current queue position, voucher packs, and upcoming bookings. Returns registered:false for unknown numbers.",
    params: [],
    readOnly: true,
  },
  get_service_prices: {
    name: 'get_service_prices',
    description: 'Public list of active services with their unit and price.',
    params: [],
    readOnly: true,
  },
  get_membership_plans: {
    name: 'get_membership_plans',
    description: 'Public list of membership plans with price and duration.',
    params: [],
    readOnly: true,
  },
  get_promotions: {
    name: 'get_promotions',
    description: 'Public list of currently active promotions.',
    params: [],
    readOnly: true,
  },
  get_branch_info: {
    name: 'get_branch_info',
    description: 'Lokasi/alamat dan jam buka cabang yang melayani chat ini.',
    params: [],
    readOnly: true,
  },
  get_my_vouchers: {
    name: 'get_my_vouchers',
    description: 'Sisa voucher milik pelanggan ini beserta kode voucher aktifnya.',
    params: [],
    readOnly: true,
  },
  create_booking: {
    name: 'create_booking',
    description:
      'PROPOSE an appointment for THIS customer (it is NOT booked until they confirm). Provide serviceName and scheduledAt (ISO 8601 date-time). Optional: licensePlate, notes. After calling, read the details back and ask the customer to reply YA to confirm — the booking is only saved once they do.',
    params: ['serviceName', 'scheduledAt', 'licensePlate', 'notes'],
  },
  escalate_to_human: {
    name: 'escalate_to_human',
    description:
      'Hand the conversation to a human agent when the customer is upset, asks for a person, or the request is outside your knowledge. Provide a short reason.',
    params: ['reason'],
  },
};

/**
 * Which customer tools each persona role may use. Personas GATE tools — this is
 * how a persona becomes "a set of capabilities the brain runs with" rather than
 * just a prompt. A conversation runs with exactly one persona's toolset.
 */
const READ_ALL: CustomerToolName[] = ['get_my_summary', 'get_service_prices', 'get_membership_plans', 'get_promotions', 'get_branch_info', 'get_my_vouchers'];

export const PERSONA_TOOLS: Record<AgentRole, CustomerToolName[]> = {
  // Full front-desk assistant: everything a customer-safe agent can do.
  personal_assistant: [...READ_ALL, 'create_booking', 'escalate_to_human'],
  // Support: read + escalate, but does not create bookings.
  customer_service: [...READ_ALL, 'escalate_to_human'],
  // Sales: pricing/plans/promos + can book, to convert interest into a visit.
  sales: [...READ_ALL, 'create_booking', 'escalate_to_human'],
  // Supervisor: full toolset.
  supervisor: [...READ_ALL, 'create_booking', 'escalate_to_human'],
};

/** Resolve the catalog entries a given persona role is allowed to call. */
export function toolsForRole(role: AgentRole | null | undefined): ToolCatalogEntry[] {
  const names = PERSONA_TOOLS[role ?? 'personal_assistant'] ?? PERSONA_TOOLS.personal_assistant;
  return names.map((n) => CUSTOMER_TOOLS[n]);
}

/** Whether a tool name is allowed for a given persona role (defence in depth). */
export function roleAllowsTool(role: AgentRole | null | undefined, tool: string): boolean {
  const names = PERSONA_TOOLS[role ?? 'personal_assistant'] ?? PERSONA_TOOLS.personal_assistant;
  return (names as string[]).includes(tool);
}
