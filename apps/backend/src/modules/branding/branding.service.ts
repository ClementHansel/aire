import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { StorageService, StoredObject } from '../storage';

/** Per-theme color set (hex). Mirrors the frontend BrandingConfig. */
export interface ThemeColorSet {
  primary: string;
  background: string;
  accent: string;
}

export interface FontThemeConfig {
  sans: string;
  display: string;
  mono: string;
}

export interface BrandingConfig {
  light: ThemeColorSet;
  dark: ThemeColorSet;
  fonts: FontThemeConfig;
  dark_mode_enabled: boolean;
  forced_theme: 'light' | 'dark';
  default_theme: 'light' | 'dark';
}

export interface PublicBranding {
  company_name: string;
  legal_name: string;
  logo_url: string | null;
  branding: BrandingConfig | null;
  /** 6-char tenant prefix of every membership number (read-only, shown in Settings). */
  tenant_code: string | null;
  /** Human-readable tenant slug — powers pretty public URLs (/menu/<slug>). */
  slug: string | null;
}

/** Minimal tenant identity for the public slug/uuid resolver. */
export interface PublicTenantRef {
  id: string;
  slug: string | null;
  name: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Default brand palette — ported from the tara design system (navy + gold). */
export const DEFAULT_BRANDING: BrandingConfig = {
  light: { primary: '#1a2332', background: '#faf9f7', accent: '#d4a037' },
  dark: { primary: '#ebe9e6', background: '#0f1117', accent: '#e0a845' },
  fonts: { sans: 'inter', display: 'plus-jakarta', mono: 'jetbrains' },
  dark_mode_enabled: true,
  forced_theme: 'light',
  default_theme: 'light',
};

interface TenantSettings {
  branding?: BrandingConfig;
  /** Legacy: base64 data URL (pre object-storage). Read for back-compat only. */
  logo_url?: string | null;
  /** Content hash of the current logo object; drives the cache-busting URL. */
  logo_version?: string | null;
  [key: string]: unknown;
}

/** Object-storage key for a tenant's logo. */
function logoKey(tenantId: string): string {
  return `tenants/${tenantId}/logo`;
}

/**
 * Per-tenant branding storage.
 *
 * Colors/fonts live in tenants.settings.branding (JSONB). The logo binary lives
 * in object storage (MinIO/S3) under `tenants/<id>/logo`; settings only keeps a
 * short `logo_version` hash for cache-busting. `logo_url` is derived at read
 * time as a versioned public streaming URL. company_name is the tenant name.
 */
@Injectable()
export class BrandingService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly storage: StorageService,
  ) {}

  private async loadSettings(tenantId: string): Promise<{ name: string; tenant_code: string | null; slug: string | null; settings: TenantSettings }> {
    const r = await this.pool.query<{ name: string; tenant_code: string | null; slug: string | null; settings: TenantSettings }>(
      `SELECT name, tenant_code, slug, settings FROM tenants WHERE id = $1`,
      [tenantId],
    );
    const row = r.rows[0];
    if (!row) throw new NotFoundException(`Tenant ${tenantId} not found`);
    return { name: row.name, tenant_code: row.tenant_code ?? null, slug: row.slug ?? null, settings: (row.settings ?? {}) as TenantSettings };
  }

  /**
   * Resolve a public tenant reference that may be either a UUID or a slug into
   * its canonical identity. Mirrors AdminService.resolveTenantId but is exposed
   * without auth so customer-facing pages can accept pretty slug URLs while
   * keeping old UUID links working. Throws NotFoundException when unknown.
   */
  async resolveTenantRef(ref: string): Promise<PublicTenantRef> {
    const where = UUID_RE.test(ref) ? 'id = $1' : 'slug = $1';
    const r = await this.pool.query<{ id: string; slug: string | null; name: string }>(
      `SELECT id, slug, name FROM tenants WHERE ${where}`,
      [ref],
    );
    const row = r.rows[0];
    if (!row) throw new NotFoundException('Tenant not found');
    return { id: row.id, slug: row.slug ?? null, name: row.name };
  }

  private async saveSettings(tenantId: string, settings: TenantSettings): Promise<void> {
    await this.pool.query(
      `UPDATE tenants SET settings = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(settings), tenantId],
    );
  }

  /** Versioned public URL for a tenant's logo, or null when there is none. */
  private logoUrl(tenantId: string, settings: TenantSettings): string | null {
    if (settings.logo_version) {
      return `/api/public/branding/logo?tenantId=${encodeURIComponent(tenantId)}&v=${settings.logo_version}`;
    }
    // Back-compat: serve a legacy inline data URL until the migration moves it.
    if (settings.logo_url) return settings.logo_url;
    return null;
  }

  /** Public-facing branding for a tenant (used by the app shell after login). */
  async getBranding(tenantId: string): Promise<PublicBranding> {
    const { name, tenant_code, slug, settings } = await this.loadSettings(tenantId);
    return {
      company_name: name,
      legal_name: (settings.legal_name as string) ?? '',
      logo_url: this.logoUrl(tenantId, settings),
      branding: settings.branding ?? DEFAULT_BRANDING,
      tenant_code,
      slug,
    };
  }

  /** Save the branding config (colors, fonts, dark-mode policy). */
  async setBranding(tenantId: string, branding: BrandingConfig): Promise<BrandingConfig> {
    const { settings } = await this.loadSettings(tenantId);
    const next: TenantSettings = { ...settings, branding };
    await this.saveSettings(tenantId, next);
    return branding;
  }

  /** Store the logo binary in object storage. Returns the versioned public URL. */
  async setLogo(tenantId: string, buffer: Buffer, contentType: string): Promise<string> {
    const { settings } = await this.loadSettings(tenantId);
    await this.storage.put(logoKey(tenantId), buffer, contentType);
    const version = createHash('sha256').update(buffer).digest('hex').slice(0, 12);
    const next: TenantSettings = { ...settings, logo_version: version };
    delete next.logo_url; // drop any legacy inline data URL
    await this.saveSettings(tenantId, next);
    return this.logoUrl(tenantId, next)!;
  }

  async removeLogo(tenantId: string): Promise<void> {
    const { settings } = await this.loadSettings(tenantId);
    await this.storage.delete(logoKey(tenantId)).catch(() => undefined);
    const next: TenantSettings = { ...settings, logo_version: null };
    delete next.logo_url;
    await this.saveSettings(tenantId, next);
  }

  /** Stream the stored logo for a tenant (or null if none / not stored). */
  async getLogo(tenantId: string): Promise<StoredObject | null> {
    return this.storage.get(logoKey(tenantId));
  }
}
