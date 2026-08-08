import { Injectable, Inject, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { NOTIFICATION_CATALOG, getDefinition, type NotificationDefinition } from './notification-catalog';

/** A tenant's override for one catalogue entry. */
export interface TemplateOverride {
  templateKey: string;
  /** null = keep the code default body. */
  body: string | null;
  enabled: boolean;
  updatedAt: string | null;
}

/** What the settings UI renders for one row. */
export interface TemplateView extends NotificationDefinition {
  /** The body in effect right now (override if any, else the default). */
  body: string;
  enabled: boolean;
  /** True when this tenant has edited the wording. */
  customized: boolean;
  updatedAt: string | null;
  /** Default body rendered with the sample values — the preview bubble. */
  preview: string;
}

const CACHE_TTL_MS = 60_000;

/**
 * Renders a notification body for a tenant: their override if they have one,
 * otherwise the default from NOTIFICATION_CATALOG.
 *
 * This is the ONE place a customer-facing message body is produced. Every
 * sender calls `render()` with a catalogue key and its variables; nothing
 * composes message text inline anymore.
 */
@Injectable()
export class NotificationRendererService {
  private readonly logger = new Logger(NotificationRendererService.name);

  /**
   * Per-tenant override cache. These rows change when an owner saves in the
   * settings UI — rare — but are read on every outbound message, so a short TTL
   * plus explicit invalidation on save keeps the hot path off the database.
   */
  private cache = new Map<string, { at: number; rows: Map<string, TemplateOverride> }>();

  /**
   * Set once the notification_templates table is confirmed missing, so a
   * deployment whose migration hasn't run yet degrades to code defaults instead
   * of logging an error per message sent.
   */
  private tableMissing = false;

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  // ── Rendering ─────────────────────────────────────────────────────────────

  /**
   * Produce the text for `key`, or null when the tenant has switched this
   * notification off (callers skip sending) or the key is unknown.
   */
  async render(
    tenantId: string,
    key: string,
    vars: Record<string, string | number | null | undefined> = {},
  ): Promise<string | null> {
    const def = getDefinition(key);
    if (!def) {
      this.logger.warn(`Unknown notification key '${key}' — nothing sent`);
      return null;
    }

    const override = (await this.overrides(tenantId)).get(key);
    if (override && !override.enabled) return null;

    const body = override?.body?.trim() ? override.body : def.defaultBody;
    return fillTemplate(body, vars, optionalVars(def));
  }

  /** Whether a notification is switched on for a tenant, without rendering it. */
  async isEnabled(tenantId: string, key: string): Promise<boolean> {
    const override = (await this.overrides(tenantId)).get(key);
    return override ? override.enabled : true;
  }

  // ── Reads for the settings UI ─────────────────────────────────────────────

  /** Every catalogue entry, merged with this tenant's overrides. */
  async listForTenant(tenantId: string): Promise<TemplateView[]> {
    const overrides = await this.overrides(tenantId);
    return NOTIFICATION_CATALOG.map((def) => {
      const o = overrides.get(def.key);
      const body = o?.body?.trim() ? o.body : def.defaultBody;
      return {
        ...def,
        body,
        enabled: o ? o.enabled : true,
        customized: !!o?.body?.trim(),
        updatedAt: o?.updatedAt ?? null,
        preview: fillTemplate(body, sampleVars(def), optionalVars(def)),
      };
    });
  }

  // ── Writes ────────────────────────────────────────────────────────────────

  /** Upsert a tenant's override. `body: null` keeps the default wording. */
  async save(
    tenantId: string,
    key: string,
    patch: { body?: string | null; enabled?: boolean },
    updatedBy?: string | null,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO notification_templates (tenant_id, template_key, body, enabled, updated_by)
       VALUES ($1, $2, $3, COALESCE($4, true), $5)
       ON CONFLICT (tenant_id, template_key) DO UPDATE
         SET body       = COALESCE($3, notification_templates.body),
             enabled    = COALESCE($4, notification_templates.enabled),
             updated_by = $5,
             updated_at = NOW()`,
      [tenantId, key, patch.body ?? null, patch.enabled ?? null, updatedBy ?? null],
    );
    this.invalidate(tenantId);
  }

  /** Drop the override entirely — back to the stock wording, switched on. */
  async reset(tenantId: string, key: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM notification_templates WHERE tenant_id = $1 AND template_key = $2`,
      [tenantId, key],
    );
    this.invalidate(tenantId);
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async overrides(tenantId: string): Promise<Map<string, TemplateOverride>> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rows;
    if (this.tableMissing) return new Map();

    const rows = new Map<string, TemplateOverride>();
    try {
      const res = await this.pool.query<{
        template_key: string; body: string | null; enabled: boolean; updated_at: string;
      }>(
        `SELECT template_key, body, enabled, updated_at::text AS updated_at
           FROM notification_templates WHERE tenant_id = $1`,
        [tenantId],
      );
      for (const r of res.rows) {
        rows.set(r.template_key, {
          templateKey: r.template_key,
          body: r.body,
          enabled: r.enabled,
          updatedAt: r.updated_at,
        });
      }
    } catch (e) {
      // Migration 092 not applied on this deployment: fall back to code defaults
      // permanently rather than failing (or log-spamming) every send.
      const msg = e instanceof Error ? e.message : String(e);
      if (/notification_templates/.test(msg) && /does not exist/i.test(msg)) {
        this.tableMissing = true;
        this.logger.warn('notification_templates table missing — using built-in notification texts (run migration 092)');
        return rows;
      }
      this.logger.warn(`Failed to load notification overrides for tenant ${tenantId}: ${msg}`);
      return rows;
    }

    this.cache.set(tenantId, { at: Date.now(), rows });
    return rows;
  }
}

/**
 * Render a notification from a service that holds the renderer OPTIONALLY.
 *
 * Most senders inject `NotificationRendererService` with `@Optional()` so their
 * unit tests can construct them with a bare pool. This helper keeps those two
 * paths honest: with a renderer the tenant's own wording wins (and a disabled
 * notification returns null so the caller skips the send); without one, the
 * catalogue default is used — never a body inlined at the call site.
 */
export async function renderNotification(
  renderer: NotificationRendererService | undefined,
  tenantId: string,
  key: string,
  vars: Record<string, string | number | null | undefined>,
): Promise<string | null> {
  if (renderer) return renderer.render(tenantId, key, vars);
  const def = getDefinition(key);
  return def ? fillTemplate(def.defaultBody, vars, optionalVars(def)) : null;
}

/** The definition's sample values, keyed by variable name. */
export function sampleVars(def: NotificationDefinition): Record<string, string> {
  return Object.fromEntries(def.variables.map((v) => [v.name, v.sample]));
}

/** Which of a definition's variables may make their line disappear. */
export function optionalVars(def: NotificationDefinition): Set<string> {
  return new Set(def.variables.filter((v) => v.optional).map((v) => v.name));
}

/**
 * Fill a body for a known catalogue key, honouring that entry's declared
 * optional variables. This — not bare `fillTemplate` — is what every render path
 * should use, so the preview in the UI and the message on the customer's phone
 * drop exactly the same lines.
 */
export function fillForKey(
  key: string,
  body: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  const def = getDefinition(key);
  return fillTemplate(body, vars, def ? optionalVars(def) : new Set());
}

/**
 * Substitute `{placeholders}` and drop lines that ended up carrying nothing.
 *
 * The drop rule: a line that contains at least one placeholder, and whose
 * placeholders ALL resolve to empty, is removed. That reproduces the
 * `.filter(Boolean)` conditionals the hardcoded messages used ("Berlaku sampai
 * {expiryDate}." disappears when there is no expiry) without asking an owner to
 * write logic in a text box. Text-only lines are always kept.
 *
 * Exported for the UI preview and for tests.
 */
export function fillTemplate(
  body: string,
  vars: Record<string, string | number | null | undefined>,
  optionalVars: ReadonlySet<string> = new Set(),
): string {
  const value = (name: string): string => {
    const v = vars[name];
    return v === null || v === undefined ? '' : String(v);
  };

  const lines = body.split('\n').flatMap((line) => {
    const placeholders = [...line.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]!);
    const allEmpty = placeholders.length > 0 && placeholders.every((p) => value(p).trim() === '');
    if (allEmpty && placeholders.some((p) => optionalVars.has(p))) {
      // The line exists only to carry a variable that isn't there this time
      // ("Berlaku sampai {expiryDate}."). Drop it whole.
      return [];
    }
    const hadEmpty = placeholders.some((p) => value(p).trim() === '');
    let filled = line.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_, name: string) => value(name));
    if (hadEmpty) {
      // A variable that came back empty leaves a hole: "Halo kak {customerName}!"
      // for an unnamed walk-in would read "Halo kak !". Tidy the seam, but only
      // on lines that actually lost a variable, so deliberate spacing elsewhere
      // in the owner's wording is left alone.
      filled = filled.replace(/ {2,}/g, ' ').replace(/ +([!?,.:;])/g, '$1').trimEnd();
    }
    // A multi-line variable (a code list) expands into several lines.
    return filled.split('\n');
  });

  return lines
    .join('\n')
    // Dropped lines can leave a run of blanks behind; collapse to at most one.
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}
