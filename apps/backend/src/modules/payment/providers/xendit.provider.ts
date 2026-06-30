import { Injectable, Logger } from '@nestjs/common';
import {
  BackendPaymentProvider,
  CreatePaymentParams,
  PaymentResult,
  PaymentStatus,
  WebhookResult,
  QRCodeData,
} from '../payment-provider.interface';

@Injectable()
export class XenditProvider implements BackendPaymentProvider {
  readonly providerName = 'xendit';
  private readonly logger = new Logger(XenditProvider.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.xendit.co';

  constructor(apiKey: string, private readonly webhookSecret: string) {
    this.apiKey = apiKey;
  }

  private authHeader(): string {
    // Xendit uses HTTP Basic auth with the secret API key as username and empty password.
    return 'Basic ' + Buffer.from(`${this.apiKey}:`).toString('base64');
  }

  /**
   * Create a dynamic QRIS charge via the Xendit QR Code API.
   * Returns the QR string for the customer to scan and the Xendit charge id.
   * Real API call — requires a valid Xendit secret key.
   */
  async createPayment(params: CreatePaymentParams): Promise<PaymentResult> {
    this.logger.log(`Creating Xendit QRIS charge for order ${params.orderId}`);

    if (!this.apiKey) {
      return {
        success: false,
        transactionId: '',
        status: 'failed',
        errorMessage: 'Xendit API key is not configured for this tenant',
      };
    }

    try {
      const res = await fetch(`${this.baseUrl}/qr_codes`, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader(),
          'Content-Type': 'application/json',
          'api-version': '2022-07-31',
        },
        body: JSON.stringify({
          reference_id: params.orderId,
          type: 'DYNAMIC',
          currency: 'IDR',
          amount: params.amount,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as Record<string, any>;

      if (!res.ok) {
        const msg = data?.message || `Xendit returned HTTP ${res.status}`;
        this.logger.error(`Xendit charge failed: ${msg}`);
        return { success: false, transactionId: '', status: 'failed', errorMessage: msg };
      }

      return {
        success: true,
        transactionId: data.id,
        status: 'pending',
        qrCodeUrl: data.qr_string,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Xendit charge error: ${msg}`);
      return { success: false, transactionId: '', status: 'failed', errorMessage: msg };
    }
  }

  async checkStatus(transactionId: string): Promise<PaymentStatus> {
    try {
      const res = await fetch(`${this.baseUrl}/qr_codes/${transactionId}`, {
        headers: { Authorization: this.authHeader(), 'api-version': '2022-07-31' },
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, any>;
      const paid = (data.status || '').toUpperCase() === 'PAID' || (data.status || '').toUpperCase() === 'COMPLETED';
      return {
        transactionId,
        status: paid ? 'completed' : 'pending',
        amount: data.amount ?? 0,
      };
    } catch {
      return { transactionId, status: 'pending', amount: 0 };
    }
  }

  async handleWebhook(payload: unknown, signature: string): Promise<WebhookResult> {
    if (!this.validateSignature(payload, signature)) {
      return { valid: false, errorMessage: 'Invalid Xendit webhook token' };
    }

    // Xendit QR payment webhook shape: { event, data: { qr_id, reference_id, status, amount } }
    const body = payload as Record<string, any>;
    const data = (body.data ?? body) as Record<string, any>;
    const status = (data.status || '').toUpperCase();
    return {
      valid: true,
      // reference_id is the order id we passed at charge time
      transactionId: data.reference_id ?? data.qr_id ?? data.id,
      status: status === 'PAID' || status === 'COMPLETED' || status === 'SUCCEEDED' ? 'completed' : 'failed',
    };
  }

  async generateQRCode(amount: number, orderId: string): Promise<QRCodeData> {
    const result = await this.createPayment({ orderId, amount, method: 'qris_dynamic' as never });
    return {
      qrString: result.qrCodeUrl ?? '',
      imageUrl: '',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  /**
   * Xendit verifies webhooks with a static callback token compared against
   * the x-callback-token header (not an HMAC signature).
   */
  validateSignature(_payload: unknown, signature: string): boolean {
    if (!signature || !this.webhookSecret) return false;
    return signature === this.webhookSecret;
  }
}
