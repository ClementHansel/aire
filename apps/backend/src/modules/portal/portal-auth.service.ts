import { Inject, Injectable, Logger, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Pool } from 'pg';
import { createHash, randomInt } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { normalizePhone } from '@aire/shared';
import { DATABASE_POOL } from '../auth/database.provider';
import { WhatsappService } from '../whatsapp';

const OTP_TTL_MS = 5 * 60 * 1000; // code valid 5 minutes
const RESEND_COOLDOWN_MS = 30 * 1000; // min gap between sends
const MAX_ATTEMPTS = 5;
const CUSTOMER_TOKEN_TTL = '2h';

interface CustomerRow {
  id: string;
  name: string;
  phone: string;
}

/**
 * Customer-portal auth via WhatsApp OTP. Codes are 6 digits, hashed at rest,
 * expire in 5 minutes, rate-limited per (tenant, phone), and delivered over the
 * tenant's WhatsApp. A successful verify mints a short-lived customer JWT
 * (`typ: 'customer'`) consumed by PortalGuard.
 */
@Injectable()
export class PortalAuthService {
  private readonly logger = new Logger(PortalAuthService.name);

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly whatsapp: WhatsappService,
    private readonly jwt: JwtService,
  ) {}

  private hash(tenantId: string, phone: string, code: string): string {
    return createHash('sha256').update(`${tenantId}:${phone}:${code}`).digest('hex');
  }

  private normalize(phone: string): string {
    const { normalized } = normalizePhone(phone);
    return normalized || phone.replace(/\D/g, '');
  }

  /**
   * Send an OTP to the customer's WhatsApp. Always resolves ok (never reveals
   * whether the phone belongs to a customer). Throws only on rate-limit.
   */
  async requestOtp(tenantId: string, phoneRaw: string): Promise<{ ok: true }> {
    const phone = this.normalize(phoneRaw);
    if (!phone) throw new BadRequestException('A phone number is required');

    const customer = await this.pool.query<CustomerRow>(
      `SELECT id, name, phone FROM customers WHERE tenant_id = $1 AND phone_normalized = $2 LIMIT 1`,
      [tenantId, phone],
    );
    // No such customer → pretend success (don't leak membership).
    if (customer.rows.length === 0) {
      this.logger.log(`OTP requested for unknown phone in tenant ${tenantId} — no-op`);
      return { ok: true };
    }

    // Cooldown: block rapid re-requests.
    const existing = await this.pool.query<{ last_sent_at: string }>(
      `SELECT last_sent_at FROM customer_otps WHERE tenant_id = $1 AND phone_normalized = $2`,
      [tenantId, phone],
    );
    if (existing.rows[0]) {
      const since = Date.now() - new Date(existing.rows[0].last_sent_at).getTime();
      if (since < RESEND_COOLDOWN_MS) {
        throw new BadRequestException('Please wait a moment before requesting another code.');
      }
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = this.hash(tenantId, phone, code);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
    await this.pool.query(
      `INSERT INTO customer_otps (tenant_id, phone_normalized, code_hash, expires_at, attempts, last_sent_at)
       VALUES ($1, $2, $3, $4, 0, NOW())
       ON CONFLICT (tenant_id, phone_normalized)
       DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0, last_sent_at = NOW()`,
      [tenantId, phone, codeHash, expiresAt],
    );

    const sent = await this.whatsapp.sendText(
      tenantId,
      customer.rows[0]!.phone,
      `Kode masuk akun Anda: *${code}*\nBerlaku 5 menit. Jangan bagikan kode ini kepada siapa pun.`,
    );
    if (!sent) this.logger.warn(`WhatsApp OTP send failed for tenant ${tenantId} (WhatsApp may be disconnected)`);
    return { ok: true };
  }

  /** Verify an OTP and mint a customer JWT + basic profile. */
  async verifyOtp(tenantId: string, phoneRaw: string, code: string): Promise<{ token: string; customer: { id: string; name: string } }> {
    const phone = this.normalize(phoneRaw);
    const row = await this.pool.query<{ code_hash: string; expires_at: string; attempts: number }>(
      `SELECT code_hash, expires_at, attempts FROM customer_otps WHERE tenant_id = $1 AND phone_normalized = $2`,
      [tenantId, phone],
    );
    const otp = row.rows[0];
    if (!otp) throw new UnauthorizedException('No code requested. Please request a new code.');
    if (new Date(otp.expires_at).getTime() < Date.now()) throw new UnauthorizedException('Code expired. Please request a new code.');
    if (otp.attempts >= MAX_ATTEMPTS) throw new UnauthorizedException('Too many attempts. Please request a new code.');

    if (this.hash(tenantId, phone, (code ?? '').trim()) !== otp.code_hash) {
      await this.pool.query(
        `UPDATE customer_otps SET attempts = attempts + 1 WHERE tenant_id = $1 AND phone_normalized = $2`,
        [tenantId, phone],
      );
      throw new UnauthorizedException('Incorrect code.');
    }

    const customer = await this.pool.query<CustomerRow>(
      `SELECT id, name, phone FROM customers WHERE tenant_id = $1 AND phone_normalized = $2 LIMIT 1`,
      [tenantId, phone],
    );
    if (customer.rows.length === 0) throw new UnauthorizedException('Account not found.');

    // Consume the code.
    await this.pool.query(`DELETE FROM customer_otps WHERE tenant_id = $1 AND phone_normalized = $2`, [tenantId, phone]);

    const c = customer.rows[0]!;
    const token = this.jwt.sign({ sub: c.id, tenant_id: tenantId, typ: 'customer' }, { expiresIn: CUSTOMER_TOKEN_TTL });
    return { token, customer: { id: c.id, name: c.name } };
  }
}
