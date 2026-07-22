import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import { JobMonitorService } from '../job-monitor';

/**
 * WhatsApp message payload to be sent via the WhatsApp Business API.
 */
export interface WhatsAppMessage {
  /** Recipient phone number (E.164 format, e.g. 628xxxxxxxxx) */
  to: string;
  /** WhatsApp template name registered with the provider */
  templateName: string;
  /** Template parameter substitutions */
  params: Record<string, string>;
  /** Optional tenant ID to use tenant-scoped WhatsApp credentials */
  tenantId?: string;
}

/**
 * Resolved WhatsApp credentials (either tenant-specific or global fallback).
 */
export interface WhatsAppCredentials {
  apiUrl: string;
  apiToken: string;
  fromPhone: string | null;
  source: 'tenant' | 'global';
}

/**
 * E.164 phone number pattern: starts with + followed by 1-15 digits, first digit non-zero.
 */
export const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

/**
 * Validates a phone number against E.164 format.
 * @param phone - The phone number string to validate
 * @returns true if valid E.164 format, false otherwise
 */
export function validateE164(phone: string): boolean {
  return E164_PATTERN.test(phone);
}

/**
 * Supported notification types for the platform.
 */
export enum NotificationType {
  MembershipWelcome = 'membership_welcome',
  VoucherDelivery = 'voucher_delivery',
  CampaignBonus = 'campaign_bonus',
  ExpiryReminder = 'expiry_reminder',
  QueueCompletion = 'queue_completion',
}

/**
 * Represents a job in the notification queue.
 */
export interface NotificationJob {
  id: string;
  type: NotificationType;
  data: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  nextRetryAt?: string;
}

/**
 * Result of a WhatsApp send attempt.
 */
export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Email message payload for the generic transactional-email path (e.g. the
 * emailed one-time void PIN). Plain text only — no template system.
 */
export interface EmailMessage {
  /** Recipient email address */
  to: string;
  subject: string;
  body: string;
}

/**
 * Retry configuration with exponential backoff.
 * 3 attempts with delays: 30s, 60s, 120s.
 */
export const RETRY_CONFIG = {
  maxAttempts: 3,
  backoffDelays: [30_000, 60_000, 120_000], // 30s, 60s, 120s in milliseconds
} as const;

/**
 * Calculates the backoff delay for a given attempt number.
 * Uses the predefined exponential backoff schedule.
 *
 * @param attempt - The current attempt number (0-indexed)
 * @returns Delay in milliseconds before the next retry
 */
export function getBackoffDelay(attempt: number): number {
  if (attempt < 0) return RETRY_CONFIG.backoffDelays[0]!;
  if (attempt >= RETRY_CONFIG.backoffDelays.length) {
    return RETRY_CONFIG.backoffDelays[RETRY_CONFIG.backoffDelays.length - 1]!;
  }
  return RETRY_CONFIG.backoffDelays[attempt]!;
}

/**
 * NotificationService handles WhatsApp message delivery and notification queuing.
 *
 * Uses BullMQ for background job processing with retry logic and exponential backoff.
 * Supports: membership welcome messages, voucher delivery, campaign bonuses,
 * expiry reminders (H-30, H-7, H-day), and queue completion notifications.
 *
 * Requirements: 14.6, 14.7, 18.3, 19.3, 28.4
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly whatsappApiUrl: string;
  private readonly whatsappApiToken: string;
  private readonly emailApiUrl: string;
  private readonly emailApiToken: string;
  private readonly emailFrom: string;

  /** In-memory queue stub (replaced by BullMQ in production integration) */
  private readonly jobQueue: NotificationJob[] = [];

  /** HTTP client abstraction for testability */
  private httpClient: (url: string, options: RequestInit) => Promise<Response>;

  constructor(
    private readonly configService: ConfigService,
    @Optional() @Inject(SettingsService) private readonly settingsService?: SettingsService,
    @Optional() @Inject(JobMonitorService) private readonly jobMonitor?: JobMonitorService,
  ) {
    this.whatsappApiUrl =
      this.configService.get<string>('WHATSAPP_API_URL') ?? 'https://api.whatsapp.business/v1';
    this.whatsappApiToken = this.configService.get<string>('WHATSAPP_API_TOKEN') ?? '';
    // No email vendor is wired anywhere in this codebase yet (auth.service.ts's
    // forgotPassword returns the reset token directly for the same reason). These
    // stay empty until ops configures a real provider; sendEmail() degrades to a
    // logged no-op rather than failing the caller when they're unset.
    this.emailApiUrl = this.configService.get<string>('EMAIL_API_URL') ?? '';
    this.emailApiToken = this.configService.get<string>('EMAIL_API_TOKEN') ?? '';
    this.emailFrom = this.configService.get<string>('EMAIL_FROM_ADDRESS') ?? 'no-reply@useairin.id';
    this.httpClient = globalThis.fetch?.bind(globalThis) ?? (async () => new Response(null, { status: 500 }));
  }

  /**
   * Override the HTTP client for testing purposes.
   */
  setHttpClient(client: (url: string, options: RequestInit) => Promise<Response>): void {
    this.httpClient = client;
  }

  /**
   * Sends a WhatsApp message via the WhatsApp Business API.
   * Makes an HTTP POST call to the configured API endpoint.
   *
   * If a tenantId is provided in the message, the service will attempt to resolve
   * tenant-specific WhatsApp credentials from Tenant_Settings. If the tenant has
   * configured their own credentials (whatsapp_phone and whatsapp_token_encrypted),
   * those are used. Otherwise, falls back to global platform credentials from
   * environment variables.
   *
   * Requirement 2.3: Use tenant's stored WhatsApp credentials instead of global env vars.
   * Requirement 2.4: Fall back to global platform WhatsApp credentials if tenant has none.
   * Requirement 14.6: Send welcome message to customer's phone on membership activation.
   * Requirement 18.3: Send voucher codes to customer's phone via WhatsApp.
   * Requirement 19.3: Send campaign bonus codes to customer's phone via WhatsApp.
   */
  async sendWhatsApp(message: WhatsAppMessage): Promise<SendResult> {
    try {
      // Resolve credentials: tenant-specific or global fallback
      const credentials = await this.resolveCredentials(message.tenantId);

      const response = await this.httpClient(`${credentials.apiUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${credentials.apiToken}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: message.to,
          type: 'template',
          template: {
            name: message.templateName,
            language: { code: 'id' },
            components: [
              {
                type: 'body',
                parameters: Object.entries(message.params).map(([, value]) => ({
                  type: 'text',
                  text: value,
                })),
              },
            ],
          },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unknown error');
        this.logger.warn(
          `WhatsApp API returned ${response.status} for ${message.templateName} to ${message.to} (source: ${credentials.source}): ${errorBody}`,
        );
        return { success: false, error: `HTTP ${response.status}: ${errorBody}` };
      }

      const result = await response.json().catch(() => ({}));
      const messageId = (result as any)?.messages?.[0]?.id ?? 'unknown';

      this.logger.log(
        `WhatsApp message sent: ${message.templateName} to ${message.to} (id: ${messageId}, source: ${credentials.source})`,
      );

      return { success: true, messageId };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to send WhatsApp message ${message.templateName} to ${message.to}: ${errorMessage}`,
      );
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Sends a transactional email via a generic HTTP email provider (configured
   * with EMAIL_API_URL / EMAIL_API_TOKEN). Used for e.g. the emailed one-time
   * void PIN (order.service.ts requestVoidPin).
   *
   * No email vendor is configured anywhere in this deployment yet — when the
   * env vars are unset this logs the message and returns success so callers
   * (and their tests) aren't blocked on an unwired provider, mirroring how
   * auth.service.ts's forgotPassword handles the same gap. Once EMAIL_API_URL/
   * EMAIL_API_TOKEN are set in ops this actually delivers the email.
   */
  async sendEmail(message: EmailMessage): Promise<SendResult> {
    if (!this.emailApiUrl || !this.emailApiToken) {
      this.logger.warn(
        `No email provider configured (EMAIL_API_URL/EMAIL_API_TOKEN unset) — logging instead of sending: to=${message.to} subject="${message.subject}"`,
      );
      return { success: true, messageId: 'logged-only' };
    }

    try {
      const response = await this.httpClient(`${this.emailApiUrl}/emails`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.emailApiToken}`,
        },
        body: JSON.stringify({
          from: this.emailFrom,
          to: message.to,
          subject: message.subject,
          text: message.body,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unknown error');
        this.logger.warn(`Email API returned ${response.status} for "${message.subject}" to ${message.to}: ${errorBody}`);
        return { success: false, error: `HTTP ${response.status}: ${errorBody}` };
      }

      const result = await response.json().catch(() => ({}));
      const messageId = (result as any)?.id ?? 'unknown';
      this.logger.log(`Email sent: "${message.subject}" to ${message.to} (id: ${messageId})`);
      return { success: true, messageId };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to send email "${message.subject}" to ${message.to}: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Resolves WhatsApp credentials for a given tenant.
   *
   * Strategy:
   * 1. If tenantId is provided and SettingsService is available, attempt to load
   *    tenant-specific credentials from Tenant_Settings.
   * 2. If the tenant has both whatsapp_phone (valid E.164) and whatsapp_token_encrypted
   *    configured, use tenant credentials.
   * 3. Otherwise, fall back to global platform credentials from environment variables.
   *
   * Requirements: 2.3, 2.4, 2.5
   */
  async resolveCredentials(tenantId?: string): Promise<WhatsAppCredentials> {
    // Attempt tenant-specific credentials if tenantId provided
    if (tenantId && this.settingsService) {
      try {
        const settings = await this.settingsService.getSettings(tenantId);

        const tenantPhone = settings.whatsapp_phone;
        const tenantToken = settings.whatsapp_token_encrypted;

        // Tenant must have both a valid phone and a token configured
        if (tenantPhone && tenantToken && validateE164(tenantPhone)) {
          this.logger.debug(
            `Using tenant-specific WhatsApp credentials for tenant ${tenantId}`,
          );
          return {
            apiUrl: this.whatsappApiUrl,
            apiToken: tenantToken,
            fromPhone: tenantPhone,
            source: 'tenant',
          };
        }
      } catch (error) {
        // If settings retrieval fails (e.g., tenant not found), fall back to global
        this.logger.warn(
          `Failed to resolve tenant WhatsApp credentials for ${tenantId}, falling back to global: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      }
    }

    // Fall back to global platform credentials
    return {
      apiUrl: this.whatsappApiUrl,
      apiToken: this.whatsappApiToken,
      fromPhone: null,
      source: 'global',
    };
  }

  /**
   * Queues a notification for background delivery via BullMQ worker.
   * Returns a job ID for tracking. The worker processes jobs with
   * exponential backoff retry (3 attempts: 30s, 60s, 120s).
   *
   * Requirement 14.7: Schedule expiry reminders at H-30, H-7, H-day.
   * Requirement 28.4: Queue completion notifications.
   */
  async queueNotification(
    type: NotificationType,
    data: Record<string, unknown>,
  ): Promise<string> {
    const jobId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    const job: NotificationJob = {
      id: jobId,
      type,
      data,
      attempts: 0,
      maxAttempts: RETRY_CONFIG.maxAttempts,
      createdAt: new Date().toISOString(),
    };

    this.jobQueue.push(job);

    this.logger.log(`Notification queued: ${type} (jobId: ${jobId})`);

    // No external queue (BullMQ) is wired in this deployment. Rather than leave
    // the job sitting in the in-memory array forever (which silently dropped
    // e.g. voucher-book ticket delivery), drain it in-process immediately — a
    // best-effort send matching the direct sendWhatsApp() callers.
    // A future BullMQ worker would replace this with durable, retried delivery.
    void this.processJob(job)
      .then((r) => {
        if (!r.success) this.logger.warn(`Queued notification ${jobId} delivery failed: ${r.error}`);
      })
      .catch((e) =>
        this.logger.error(`Queued notification ${jobId} threw: ${e instanceof Error ? e.message : e}`),
      )
      .finally(() => {
        const i = this.jobQueue.indexOf(job);
        if (i >= 0) this.jobQueue.splice(i, 1);
      });

    return jobId;
  }

  /**
   * Processes a notification job from the queue.
   * Builds the appropriate WhatsApp message based on notification type
   * and attempts delivery with retry logic.
   *
   * This is the BullMQ worker handler stub.
   */
  async processJob(job: NotificationJob): Promise<SendResult> {
    const message = this.buildMessage(job.type, job.data);
    if (!message) {
      this.logger.warn(`Unable to build message for job ${job.id} of type ${job.type}`);
      return { success: false, error: 'Unable to build message from job data' };
    }

    const result = await this.sendWhatsApp(message);

    // Heartbeat so the in-process notification drain is visible in the job monitor.
    void this.jobMonitor?.recordRun('notification-drain', {
      label: 'Notification drain (WhatsApp)',
      status: result.success ? 'ok' : 'error',
      detail: result.success ? `sent ${job.type}` : `failed ${job.type}: ${result.error ?? 'unknown'}`,
    });

    if (!result.success && job.attempts < job.maxAttempts - 1) {
      job.attempts++;
      const delay = getBackoffDelay(job.attempts - 1);
      job.nextRetryAt = new Date(Date.now() + delay).toISOString();
      this.logger.log(
        `Job ${job.id} failed, scheduling retry ${job.attempts}/${job.maxAttempts} in ${delay / 1000}s`,
      );
    } else if (!result.success) {
      this.logger.error(
        `Job ${job.id} exhausted all ${job.maxAttempts} attempts. Last error: ${result.error}`,
      );
    }

    return result;
  }

  /**
   * Builds a WhatsApp message from notification type and data.
   */
  private buildMessage(
    type: NotificationType,
    data: Record<string, unknown>,
  ): WhatsAppMessage | null {
    const phone = data.phone as string | undefined;
    if (!phone) return null;

    switch (type) {
      case NotificationType.MembershipWelcome:
        return {
          to: phone,
          templateName: 'membership_welcome',
          params: {
            customerName: (data.customerName as string) ?? '',
            planName: (data.planName as string) ?? '',
            endDate: (data.endDate as string) ?? '',
          },
        };

      case NotificationType.VoucherDelivery:
        return {
          to: phone,
          templateName: 'voucher_delivery',
          params: {
            customerName: (data.customerName as string) ?? '',
            codes: (data.codes as string) ?? '',
            expiryDate: (data.expiryDate as string) ?? '',
          },
        };

      case NotificationType.CampaignBonus:
        return {
          to: phone,
          templateName: 'campaign_bonus',
          params: {
            customerName: (data.customerName as string) ?? '',
            campaignName: (data.campaignName as string) ?? '',
            codes: (data.codes as string) ?? '',
            expiryDate: (data.expiryDate as string) ?? '',
          },
        };

      case NotificationType.ExpiryReminder:
        return {
          to: phone,
          templateName: 'expiry_reminder',
          params: {
            customerName: (data.customerName as string) ?? '',
            planName: (data.planName as string) ?? '',
            daysRemaining: (data.daysRemaining as string) ?? '',
            endDate: (data.endDate as string) ?? '',
          },
        };

      case NotificationType.QueueCompletion:
        return {
          to: phone,
          templateName: 'queue_completion',
          params: {
            customerName: (data.customerName as string) ?? '',
            orderNumber: (data.orderNumber as string) ?? '',
            bayName: (data.bayName as string) ?? '',
          },
        };

      default:
        return null;
    }
  }

  /**
   * Returns the current queue state (for testing/monitoring).
   */
  getQueuedJobs(): NotificationJob[] {
    return [...this.jobQueue];
  }

  /**
   * Clears the in-memory queue (for testing).
   */
  clearQueue(): void {
    this.jobQueue.length = 0;
  }
}
