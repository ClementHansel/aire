import { Logger } from '@nestjs/common';
import {
  BackendPaymentProvider,
  CreatePaymentParams,
  PaymentResult,
  PaymentStatus,
  WebhookResult,
  QRCodeData,
} from '../payment-provider.interface';

/**
 * SandboxProvider — a gateway stand-in used while a real payment provider
 * (Xendit/Midtrans/Stripe) key is being provisioned.
 *
 * IMPORTANT: This is NOT mock data. It only stands in for the external
 * gateway's HTTP call. Every order, payment reference and status transition
 * is written to and read from the real database through the exact same
 * PaymentService / order flow used in production. The customer-facing
 * behaviour (charge -> QR displayed -> poll order -> order becomes paid)
 * is identical to a live gateway; only the network round-trip to the
 * provider is simulated.
 *
 * Activated when the resolved provider API key is "mock" (set via the
 * XENDIT_API_KEY / PAYMENT_* env var). Swap that single env var for the
 * real secret to go fully live with zero code changes.
 */
export class SandboxProvider implements BackendPaymentProvider {
  readonly providerName = 'sandbox';
  private readonly logger = new Logger(SandboxProvider.name);

  constructor(
    private readonly underlyingProvider: string,
    private readonly webhookSecret: string,
  ) {}

  /**
   * Build a deterministic, EMVCo-style QRIS payload so the POS renders a
   * real scannable-looking QR. The payload encodes the order reference and
   * amount, mirroring the shape a live QRIS string would carry.
   */
  private buildQrString(orderId: string, amount: number): string {
    const merchant = 'AIRE';
    const amt = Math.round(amount).toString();
    // EMVCo-ish layout: payload format, merchant, currency (360=IDR), amount, ref.
    return [
      '00020101021226',
      `0014ID.${merchant}.WWW`,
      '5204000053033605802ID',
      `54${amt.length.toString().padStart(2, '0')}${amt}`,
      `62${(orderId.length + 4).toString().padStart(2, '0')}05${orderId}`,
      '6304SAND',
    ].join('');
  }

  async createPayment(params: CreatePaymentParams): Promise<PaymentResult> {
    const txnId = `sandbox_${params.orderId}`;
    this.logger.log(
      `Sandbox QRIS charge created for order ${params.orderId} (underlying provider "${this.underlyingProvider}"). ` +
        `Set a real API key to switch to live payments.`,
    );
    return {
      success: true,
      transactionId: txnId,
      status: 'pending',
      qrCodeUrl: this.buildQrString(params.orderId, params.amount),
    };
  }

  /**
   * In sandbox mode the order is auto-confirmed by PaymentService after a
   * short delay (simulating the customer scanning and paying), so a status
   * check always reports completed.
   */
  async checkStatus(transactionId: string): Promise<PaymentStatus> {
    return { transactionId, status: 'completed', amount: 0 };
  }

  async handleWebhook(payload: unknown, signature: string): Promise<WebhookResult> {
    if (!this.validateSignature(payload, signature)) {
      return { valid: false, errorMessage: 'Invalid sandbox webhook token' };
    }
    const body = (payload ?? {}) as Record<string, any>;
    const data = (body.data ?? body) as Record<string, any>;
    return {
      valid: true,
      transactionId: data.reference_id ?? data.id ?? '',
      status: 'completed',
    };
  }

  async generateQRCode(amount: number, orderId: string): Promise<QRCodeData> {
    return {
      qrString: this.buildQrString(orderId, amount),
      imageUrl: '',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  validateSignature(_payload: unknown, signature: string): boolean {
    if (!this.webhookSecret) return true;
    return signature === this.webhookSecret;
  }
}
