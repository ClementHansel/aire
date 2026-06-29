import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
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

  constructor(apiKey: string, private readonly webhookSecret: string) {
    // apiKey will be used for actual Xendit API calls in production
    void apiKey;
  }

  async createPayment(params: CreatePaymentParams): Promise<PaymentResult> {
    this.logger.log(`Creating Xendit payment for order ${params.orderId}`);
    // Stub: would call Xendit API
    return {
      success: true,
      transactionId: `xnd_${params.orderId}_${Date.now()}`,
      status: 'pending',
    };
  }

  async checkStatus(transactionId: string): Promise<PaymentStatus> {
    this.logger.log(`Checking Xendit payment status: ${transactionId}`);
    // Stub: would call Xendit API
    return {
      transactionId,
      status: 'pending',
      amount: 0,
    };
  }

  async handleWebhook(payload: unknown, signature: string): Promise<WebhookResult> {
    if (!this.validateSignature(payload, signature)) {
      return { valid: false, errorMessage: 'Invalid Xendit webhook signature' };
    }

    const data = payload as Record<string, unknown>;
    return {
      valid: true,
      transactionId: data.id as string,
      status: data.status === 'PAID' ? 'completed' : 'failed',
    };
  }

  async generateQRCode(amount: number, orderId: string): Promise<QRCodeData> {
    this.logger.log(`Generating Xendit QR code for order ${orderId}, amount ${amount}`);
    // Stub: would call Xendit QR API
    return {
      qrString: `xendit_qr_${orderId}_${amount}`,
      imageUrl: `https://api.xendit.co/qr/${orderId}`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  validateSignature(payload: unknown, signature: string): boolean {
    if (!signature || !this.webhookSecret) {
      return false;
    }
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const expectedSignature = createHmac('sha256', this.webhookSecret)
      .update(body)
      .digest('hex');
    return signature === expectedSignature;
  }
}
