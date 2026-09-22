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
  | 'check_scope'
  | 'check_availability'
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
    description:
      'Look up service prices. Parameter: query (optional) — SEARCH WORDS from what the customer asked, '
      + 'e.g. "digital multimeter", "timbangan 30kg", "thermometer". '
      + 'ALWAYS pass a query when the customer named a specific item: a full price list can be hundreds of rows and you will only be shown part of it. '
      + 'Omit query only when they genuinely asked for the whole menu. '
      + 'Returns each match with its exact name, a qualifier (measuring range / what is covered), and BOTH `price` (a number, for your reasoning only) and `priceText` (e.g. "Rp 1.250.000"). '
      + 'QUOTE `priceText` TO THE CUSTOMER CHARACTER FOR CHARACTER — never retype or reformat the number yourself. '
      + 'Also returns totalMatches and truncated — '
      + 'when truncated is true, say how many more there are and offer to narrow it down instead of implying you listed everything. '
      + 'An empty result means we do not list that item: do NOT invent a price, offer a similar one, or estimate.',
    params: ['query'],
    readOnly: true,
  },
  get_membership_plans: {
    name: 'get_membership_plans',
    description:
      'Public list of membership plans. Each carries `priceText` (e.g. "Rp 299.000") alongside the numeric price — '
      + 'quote `priceText` verbatim and never reformat the number yourself.',
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
  check_scope: {
    name: 'check_scope',
    description:
      'Cek apakah sebuah alat BISA dikalibrasi, berdasarkan ruang lingkup akreditasi KAN yang terdaftar. ' +
      'Parameter: instrument (nama alat dalam kata-kata pelanggan, wajib), value (angka rentang yang dibutuhkan, opsional), unit (satuan dari value, opsional, mis. "kg", "bar", "C", "V"). ' +
      'SELALU sertakan value + unit kalau pelanggan menyebut angka — rentang ukur yang menentukan bisa/tidaknya, bukan nama alatnya. ' +
      'Hasil: inScope true/false, daftar lab beserta rentang, ketidakpastian, dan nomor akreditasi. ' +
      'Kalau inScope false tapi ada "nearest", artinya alatnya kami layani TAPI di rentang lain — sebutkan rentang yang kami cakup. ' +
      'Jangan pernah menjawab pertanyaan "bisa kalibrasi X?" tanpa memanggil tool ini.',
    params: ['instrument', 'value', 'unit'],
    readOnly: true,
  },
  check_availability: {
    name: 'check_availability',
    description:
      'Cek ketersediaan/kesibukan cabang sebelum membuat janji. Parameter opsional: date (YYYY-MM-DD, default hari ini). Mengembalikan jam buka cabang, jam-jam yang sudah dibooking pada tanggal itu, dan panjang antrean saat ini. Panggil ini SEBELUM create_booking untuk memberi tahu pelanggan apakah waktu yang diminta memungkinkan.',
    params: ['date'],
    readOnly: true,
  },
  create_booking: {
    name: 'create_booking',
    description:
      'PROPOSE an appointment for THIS customer (it is NOT booked until they confirm). Provide serviceName and scheduledAt (ISO 8601 date-time). Optional: licensePlate, notes. Prefer calling check_availability first. After calling, read the details back and ask the customer to reply YA to confirm — the booking is only saved once they do.',
    params: ['serviceName', 'scheduledAt', 'licensePlate', 'notes'],
  },
  escalate_to_human: {
    name: 'escalate_to_human',
    description:
      'Hand the conversation to a human agent ONLY when the customer is upset/complaining, explicitly asks to talk to a person, or needs something only staff can do. ' +
      'Do NOT use this for off-topic questions (system prompt, coding, trivia) or when you simply lack data — decline warmly and redirect instead. Provide a short reason.',
    params: ['reason'],
  },
};

/**
 * Which customer tools each persona role may use. Personas GATE tools — this is
 * how a persona becomes "a set of capabilities the brain runs with" rather than
 * just a prompt. A conversation runs with exactly one persona's toolset.
 */
const READ_ALL: CustomerToolName[] = ['get_my_summary', 'get_service_prices', 'get_membership_plans', 'get_promotions', 'get_branch_info', 'get_my_vouchers', 'check_scope', 'check_availability'];

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
