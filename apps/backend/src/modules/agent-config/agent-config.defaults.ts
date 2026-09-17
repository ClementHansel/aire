import { Pool } from 'pg';

/**
 * Give a brand-new tenant an `agent_configs` row.
 *
 * The row is the tenant's WhatsApp + AI record: it holds the WAHA session, the
 * AI toggle, the base prompt and the product knowledge. Nothing created it at
 * provisioning — it appeared only when someone first opened the AI Agent page
 * and saved. That is a silent trap for a tenant onboarding onto the CHATBOT
 * first (rather than the POS): `WhatsappService.config()` returns null without
 * it, and `resolveBySession` cannot attribute an inbound message to any tenant,
 * so the number connects but nothing ever replies.
 *
 * Deliberately does NOT invent a persona in `agents`. Naming a company's
 * customer-service bot is their branding decision, and an un-named agent now
 * degrades to "kami" rather than to a placeholder (see AgentRuntimeService).
 *
 * Idempotent, and safe to call on a tenant that already has a row.
 */
export async function seedDefaultAgentConfig(pool: Pool, tenantId: string): Promise<boolean> {
  const res = await pool.query(
    'INSERT INTO agent_configs (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING',
    [tenantId],
  );
  return (res.rowCount ?? 0) > 0;
}
