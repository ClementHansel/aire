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
export class MidtransProvider implements BackendPaymentProvider {
  readonly providerName = 'midtrans';
  private readonly logger = new Logger(MidtransProvider.name);

  constructor(serverKey: string, private readonly webhookSecret: string) {
    // serverKey will be used for actual Midtrans API calls in production
    void serverKey;
  }

  async createPayment(params: CreatePaymentParams): Promise<PaymentResult> {
    this.logger.log(`Creating Midtrans payment for order ${params.orderId}`);
    // Stub: would call Midtrans Snap/Core API
    return {
      success: true,
      transactionId: `mid_${params.orderId}_${Date.now()}`,
      status: 'pending',
    };
  }

  async checkStatus(transactionId: string): Promise<PaymentStatus> {
    this.logger.log(`Checking Midtrans payment status: ${transactionId}`);
    // Stub: would call Midtrans status API
    return {
      transactionId,
      status: 'pending',
      amount: 0,
    };
  }

  async handleWebhook(payload: unknown, signature: string): Promise<WebhookResult> {
    if (!this.validateSignature(payload, signature)) {
      return { valid: false, errorMessage: 'Invalid Midtrans webhook signature' };
    }

    const data = payload as Record<string, unknown>;
    const status = data.transaction_status as string;
    return {
      valid: true,
      transactionId: data.transaction_id as string,
      status: status === 'settlement' || status === 'capture' ? 'completed' : 'failed',
    };
  }

  async generateQRCode(amount: number, orderId: string): Promise<QRCodeData> {
    this.logger.log(`Generating Midtrans QR code for order ${orderId}, amount ${amount}`);
    // Stub: would call Midtrans QRIS API
    return {
      qrString: `midtrans_qr_${orderId}_${amount}`,
      imageUrl: `https://api.midtrans.com/qr/${orderId}`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  validateSignature(payload: unknown, signature: string): boolean {
    if (!signature || !this.webhookSecret) {
      return false;
    }
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const expectedSignature = createHmac('sha512', this.webhookSecret)
      .update(body)
      .digest('hex');
    return signature === expectedSignature;
  }
}
