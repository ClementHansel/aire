/**
 * Fallback renderer for the legacy `templateName` values that
 * NotificationService accepts (`membership_welcome`, `expiry_reminder`,
 * `voucher_delivery`, …).
 *
 * This file used to hold its own copy of every message body — a parallel set of
 * string literals maintained beside NOTIFICATION_CATALOG. The two drifted, as
 * duplicated copy does: the catalogue had been de-branded to say "kami" while
 * this file still said "Mau *Irene* bantu perpanjang sekarang?", so any tenant
 * reaching this path had the demo car wash's persona introduce itself to their
 * customers. It is a narrow path — NotificationService prefers the renderer and
 * only falls back here when no tenant id reached it (which has happened; see the
 * tenantId-drop bug) or in unit tests — but "narrow" is not "never".
 *
 * So there are no bodies here any more. This resolves the legacy name to its
 * catalogue key and fills that entry's default, leaving NOTIFICATION_CATALOG the
 * single source of truth. What this path cannot do is apply a tenant's own
 * override or its vertical's wording, because it has no tenant id — callers that
 * want either must pass `tenantId` so the renderer handles it.
 */

import { CATALOG_KEY_ALIASES, getDefinition } from './notification-catalog';
import { fillTemplate, optionalVars } from './notification-renderer.service';

export type TemplateParams = Record<string, string>;

/**
 * Render a legacy template name into WhatsApp-ready text. Returns null for an
 * unknown name so the caller can log it rather than send an empty bubble.
 */
export function renderNotificationText(templateName: string, params: TemplateParams): string | null {
  const key = CATALOG_KEY_ALIASES[templateName] ?? templateName;
  const def = getDefinition(key);
  if (!def) return null;
  return fillTemplate(def.defaultBody, params ?? {}, optionalVars(def));
}
