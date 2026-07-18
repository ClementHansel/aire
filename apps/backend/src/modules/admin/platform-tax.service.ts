import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

export interface PlatformTaxConfig {
  /** When off, invoices carry zero tax and no Faktur Pajak is issued. */
  enabled: boolean;
  /** Seller (Airin) NPWP printed on the Faktur Pajak. */
  npwp: string;
  /** Seller legal name. */
  name: string;
  /** Seller address. */
  address: string;
  /** PPN rate as a fraction, e.g. 0.11 = 11%. */
  rate: number;
}

const DEFAULTS: PlatformTaxConfig = {
  enabled: false,
  npwp: '',
  name: '',
  address: '',
  rate: 0.11, // Indonesian PPN at time of writing
};

/**
 * Airin's own tax profile + PPN calculation for the subscription invoices it
 * issues to tenants (the platform is the seller here — distinct from the
 * tenant-side tax_invoices in migration 059 where the tenant is the seller).
 * Config lives in platform_config.config.platformTax; the official DJP Faktur
 * Pajak serial is entered by an operator (issueFaktur generates an internal
 * placeholder number that the admin can overwrite with the real NSFP).
 */
@Injectable()
export class PlatformTaxService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async getConfig(): Promise<PlatformTaxConfig> {
    try {
      const r = await this.pool.query<{ tax: PlatformTaxConfig | null }>(
        `SELECT config->'platformTax' AS tax FROM platform_config WHERE id = 'default' LIMIT 1`,
      );
      return { ...DEFAULTS, ...(r.rows[0]?.tax ?? {}) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  async setConfig(patch: Partial<PlatformTaxConfig>): Promise<PlatformTaxConfig> {
    const next = { ...(await this.getConfig()), ...patch };
    if (next.rate < 0 || next.rate > 1) next.rate = DEFAULTS.rate;
    await this.pool.query(
      `INSERT INTO platform_config (id, config, updated_at)
         VALUES ('default', jsonb_build_object('platformTax', $1::jsonb), NOW())
       ON CONFLICT (id) DO UPDATE SET
         config = platform_config.config || jsonb_build_object('platformTax', $1::jsonb),
         updated_at = NOW()`,
      [JSON.stringify(next)],
    );
    return next;
  }

  /** Tax for a base amount (DPP). Zero when tax is disabled. */
  async computeTax(amount: number): Promise<{ rate: number; taxAmount: number }> {
    const cfg = await this.getConfig();
    if (!cfg.enabled || cfg.rate <= 0) return { rate: 0, taxAmount: 0 };
    return { rate: cfg.rate, taxAmount: Math.round(amount * cfg.rate * 100) / 100 };
  }

  /**
   * Assign a Faktur Pajak number to an invoice if it doesn't have one. Generates an
   * internal placeholder `AIRIN/YYYYMM/NNNN`; an operator can overwrite it with the
   * official DJP serial via setFakturNumber. Returns the effective number, or null
   * when tax is disabled.
   */
  async issueFaktur(invoiceId: string): Promise<string | null> {
    const cfg = await this.getConfig();
    if (!cfg.enabled) return null;
    const existing = await this.pool.query<{ faktur_number: string | null; period: string }>(
      `SELECT faktur_number, period FROM platform_invoices WHERE id = $1`,
      [invoiceId],
    );
    if (existing.rows.length === 0) return null;
    if (existing.rows[0]!.faktur_number) return existing.rows[0]!.faktur_number;

    const period = existing.rows[0]!.period.replace('-', ''); // YYYYMM
    const seqRes = await this.pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM platform_invoices WHERE faktur_number LIKE $1`,
      [`AIRIN/${period}/%`],
    );
    const seq = parseInt(seqRes.rows[0]!.n, 10) + 1;
    const number = `AIRIN/${period}/${String(seq).padStart(4, '0')}`;
    await this.pool.query(
      `UPDATE platform_invoices SET faktur_number = $2, faktur_issued_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND faktur_number IS NULL`,
      [invoiceId, number],
    );
    return number;
  }

  /** Overwrite an invoice's Faktur number with the official DJP-issued serial. */
  async setFakturNumber(invoiceId: string, fakturNumber: string): Promise<void> {
    await this.pool.query(
      `UPDATE platform_invoices SET faktur_number = $2, faktur_issued_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [invoiceId, fakturNumber.trim()],
    );
  }
}
