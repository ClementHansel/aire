import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

/** Supported barcode symbologies for rendering/printing labels. */
export type BarcodeSymbology = 'CODE128' | 'EAN13' | 'QR';

/**
 * Per-tenant barcode configuration, stored in `tenants.settings.barcode`
 * (JSONB). The whole feature is opt-in: `enabled` is false by default, which
 * keeps the settings page collapsed, hides the label designer, and leaves POS
 * scan-to-cart off until a tenant owner turns it on.
 */
export interface BarcodeConfig {
  enabled: boolean;
  symbology: BarcodeSymbology;
  /** Auto-assign an EAN-13 in-store barcode when a product is created without one. */
  autoGenerate: boolean;
  /** POS adds the matched product to the cart when a barcode is scanned. */
  scanAddsToCart: boolean;
  /** Print a barcode label automatically when stock is received. */
  printLabelOnReceive: boolean;
}

const DEFAULT_CONFIG: BarcodeConfig = {
  enabled: false,
  symbology: 'CODE128',
  autoGenerate: false,
  scanAddsToCart: true,
  printLabelOnReceive: false,
};

/**
 * Barcode feature configuration service — modeled on MembershipCardService.
 * Reads/writes the `barcode` sub-tree of `tenants.settings` via jsonb_set so
 * other settings keys (branding, templates…) are preserved.
 */
@Injectable()
export class BarcodeService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async getConfig(tenantId: string): Promise<BarcodeConfig> {
    const r = await this.pool.query<{ cfg: Partial<BarcodeConfig> | null }>(
      `SELECT settings->'barcode' AS cfg FROM tenants WHERE id = $1`,
      [tenantId],
    );
    return this.normalize(r.rows[0]?.cfg);
  }

  async setConfig(tenantId: string, config: Partial<BarcodeConfig>): Promise<BarcodeConfig> {
    const next = this.normalize(config);
    await this.pool.query(
      `UPDATE tenants
       SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{barcode}', $2::jsonb, true),
           updated_at = NOW()
       WHERE id = $1`,
      [tenantId, JSON.stringify(next)],
    );
    return this.getConfig(tenantId);
  }

  /** Fill defaults for any missing/legacy keys. */
  private normalize(cfg: Partial<BarcodeConfig> | null | undefined): BarcodeConfig {
    return {
      enabled: cfg?.enabled ?? DEFAULT_CONFIG.enabled,
      symbology: cfg?.symbology ?? DEFAULT_CONFIG.symbology,
      autoGenerate: cfg?.autoGenerate ?? DEFAULT_CONFIG.autoGenerate,
      scanAddsToCart: cfg?.scanAddsToCart ?? DEFAULT_CONFIG.scanAddsToCart,
      printLabelOnReceive: cfg?.printLabelOnReceive ?? DEFAULT_CONFIG.printLabelOnReceive,
    };
  }
}
