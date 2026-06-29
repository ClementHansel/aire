import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NotificationService,
  NotificationType,
  RETRY_CONFIG,
  getBackoffDelay,
  validateE164,
  E164_PATTERN,
  WhatsAppMessage,
  NotificationJob,
} from './notification.service';

describe('NotificationService', () => {
  let service: NotificationService;
  let mockConfigService: { get: ReturnType<typeof vi.fn> };
  let mockHttpClient: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigService = {
      get: vi.fn((key: string) => {
        if (key === 'WHATSAPP_API_URL') return 'https://api.whatsapp.test/v1';
        if (key === 'WHATSAPP_API_TOKEN') return 'test-token-123';
        return undefined;
      }),
    };
    service = new NotificationService(mockConfigService as any);

    mockHttpClient = vi.fn();
    service.setHttpClient(mockHttpClient);
  });

  describe('sendWhatsApp', () => {
    it('should send a WhatsApp message via HTTP POST to the API endpoint', async () => {
      mockHttpClient.mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: 'msg-001' }] }), { status: 200 }),
      );

      const message: WhatsAppMessage = {
        to: '628123456789',
        templateName: 'membership_welcome',
        params: { customerName: 'John', planName: 'Gold', endDate: '2025-01-01' },
      };

      const result = await service.sendWhatsApp(message);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-001');
      expect(mockHttpClient).toHaveBeenCalledTimes(1);

      const [url, options] = mockHttpClient.mock.calls[0];
      expect(url).toBe('https://api.whatsapp.test/v1/messages');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers['Authorization']).toBe('Bearer test-token-123');

      const body = JSON.parse(options.body);
      expect(body.to).toBe('628123456789');
      expect(body.type).toBe('template');
      expect(body.template.name).toBe('membership_welcome');
    });

    it('should return failure when API responds with non-OK status', async () => {
      mockHttpClient.mockResolvedValueOnce(
        new Response('Rate limit exceeded', { status: 429 }),
      );

      const message: WhatsAppMessage = {
        to: '628999888777',
        templateName: 'voucher_delivery',
        params: { customerName: 'Jane', codes: 'AIRE-V-1234', expiryDate: '2025-06-30' },
      };

      const result = await service.sendWhatsApp(message);

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 429');
      expect(result.error).toContain('Rate limit exceeded');
    });

    it('should return failure when HTTP call throws an error', async () => {
      mockHttpClient.mockRejectedValueOnce(new Error('Network timeout'));

      const message: WhatsAppMessage = {
        to: '628111222333',
        templateName: 'queue_completion',
        params: { customerName: 'Bob', orderNumber: 'ORD-001', bayName: 'Bay 1' },
      };

      const result = await service.sendWhatsApp(message);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network timeout');
    });

    it('should include template parameters in the request body', async () => {
      mockHttpClient.mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: 'msg-002' }] }), { status: 200 }),
      );

      const message: WhatsAppMessage = {
        to: '628444555666',
        templateName: 'expiry_reminder',
        params: {
          customerName: 'Alice',
          planName: 'Silver',
          daysRemaining: '7',
          endDate: '2025-03-15',
        },
      };

      await service.sendWhatsApp(message);

      const body = JSON.parse(mockHttpClient.mock.calls[0][1].body);
      const params = body.template.components[0].parameters;
      expect(params).toHaveLength(4);
      expect(params[0]).toEqual({ type: 'text', text: 'Alice' });
      expect(params[1]).toEqual({ type: 'text', text: 'Silver' });
      expect(params[2]).toEqual({ type: 'text', text: '7' });
      expect(params[3]).toEqual({ type: 'text', text: '2025-03-15' });
    });
  });

  describe('queueNotification', () => {
    it('should add a job to the queue and return a job ID', async () => {
      const jobId = await service.queueNotification(NotificationType.MembershipWelcome, {
        phone: '628123456789',
        customerName: 'John',
        planName: 'Gold',
        endDate: '2025-01-01',
      });

      expect(jobId).toMatch(/^notif_/);
      const jobs = service.getQueuedJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].type).toBe(NotificationType.MembershipWelcome);
      expect(jobs[0].data.phone).toBe('628123456789');
      expect(jobs[0].attempts).toBe(0);
      expect(jobs[0].maxAttempts).toBe(RETRY_CONFIG.maxAttempts);
    });

    it('should queue multiple notifications independently', async () => {
      await service.queueNotification(NotificationType.VoucherDelivery, {
        phone: '628111111111',
        customerName: 'User A',
        codes: 'CODE-1',
      });
      await service.queueNotification(NotificationType.CampaignBonus, {
        phone: '628222222222',
        customerName: 'User B',
        campaignName: 'Summer Promo',
        codes: 'BONUS-1',
      });

      const jobs = service.getQueuedJobs();
      expect(jobs).toHaveLength(2);
      expect(jobs[0].type).toBe(NotificationType.VoucherDelivery);
      expect(jobs[1].type).toBe(NotificationType.CampaignBonus);
    });

    it('should create job with correct initial state', async () => {
      const beforeTime = new Date().toISOString();
      await service.queueNotification(NotificationType.ExpiryReminder, {
        phone: '628333444555',
        customerName: 'Charlie',
        planName: 'Platinum',
        daysRemaining: '30',
        endDate: '2025-07-01',
      });

      const job = service.getQueuedJobs()[0];
      expect(job.attempts).toBe(0);
      expect(job.maxAttempts).toBe(3);
      expect(job.createdAt >= beforeTime).toBe(true);
      expect(job.nextRetryAt).toBeUndefined();
    });

    it('should queue QueueCompletion notification type', async () => {
      await service.queueNotification(NotificationType.QueueCompletion, {
        phone: '628777888999',
        customerName: 'Dave',
        orderNumber: 'ORD-100',
        bayName: 'Bay 3',
      });

      const job = service.getQueuedJobs()[0];
      expect(job.type).toBe(NotificationType.QueueCompletion);
      expect(job.data.orderNumber).toBe('ORD-100');
      expect(job.data.bayName).toBe('Bay 3');
    });
  });

  describe('processJob', () => {
    it('should send WhatsApp message for a valid job', async () => {
      mockHttpClient.mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: 'msg-100' }] }), { status: 200 }),
      );

      const job: NotificationJob = {
        id: 'notif_test_001',
        type: NotificationType.MembershipWelcome,
        data: {
          phone: '628123456789',
          customerName: 'John',
          planName: 'Gold',
          endDate: '2025-01-01',
        },
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date().toISOString(),
      };

      const result = await service.processJob(job);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-100');
    });

    it('should increment attempts and set nextRetryAt on failure with retries remaining', async () => {
      mockHttpClient.mockResolvedValueOnce(
        new Response('Server error', { status: 500 }),
      );

      const job: NotificationJob = {
        id: 'notif_test_002',
        type: NotificationType.VoucherDelivery,
        data: {
          phone: '628999888777',
          customerName: 'Jane',
          codes: 'AIRE-V-5678',
          expiryDate: '2025-12-31',
        },
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date().toISOString(),
      };

      const result = await service.processJob(job);

      expect(result.success).toBe(false);
      expect(job.attempts).toBe(1);
      expect(job.nextRetryAt).toBeDefined();
    });

    it('should not increment attempts when max attempts is exhausted', async () => {
      mockHttpClient.mockResolvedValueOnce(
        new Response('Server error', { status: 500 }),
      );

      const job: NotificationJob = {
        id: 'notif_test_003',
        type: NotificationType.CampaignBonus,
        data: {
          phone: '628111222333',
          customerName: 'Bob',
          campaignName: 'Winter',
          codes: 'BONUS-X',
          expiryDate: '2025-03-01',
        },
        attempts: 2, // already at maxAttempts - 1 (last attempt)
        maxAttempts: 3,
        createdAt: new Date().toISOString(),
      };

      const result = await service.processJob(job);

      expect(result.success).toBe(false);
      // Should not increment beyond max
      expect(job.attempts).toBe(2);
    });

    it('should return failure when job data is missing phone', async () => {
      const job: NotificationJob = {
        id: 'notif_test_004',
        type: NotificationType.MembershipWelcome,
        data: { customerName: 'NoPhone' },
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date().toISOString(),
      };

      const result = await service.processJob(job);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unable to build message');
      expect(mockHttpClient).not.toHaveBeenCalled();
    });
  });

  describe('getBackoffDelay', () => {
    it('should return 30s for first retry (attempt 0)', () => {
      expect(getBackoffDelay(0)).toBe(30_000);
    });

    it('should return 60s for second retry (attempt 1)', () => {
      expect(getBackoffDelay(1)).toBe(60_000);
    });

    it('should return 120s for third retry (attempt 2)', () => {
      expect(getBackoffDelay(2)).toBe(120_000);
    });

    it('should return last delay for attempts beyond the schedule', () => {
      expect(getBackoffDelay(5)).toBe(120_000);
      expect(getBackoffDelay(100)).toBe(120_000);
    });

    it('should return first delay for negative attempts', () => {
      expect(getBackoffDelay(-1)).toBe(30_000);
    });
  });

  describe('RETRY_CONFIG', () => {
    it('should have 3 max attempts', () => {
      expect(RETRY_CONFIG.maxAttempts).toBe(3);
    });

    it('should have exponential backoff delays of 30s, 60s, 120s', () => {
      expect(RETRY_CONFIG.backoffDelays).toEqual([30_000, 60_000, 120_000]);
    });
  });

  describe('buildMessage (via processJob)', () => {
    it('should build membership welcome message correctly', async () => {
      mockHttpClient.mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: 'msg-w' }] }), { status: 200 }),
      );

      const job: NotificationJob = {
        id: 'job-welcome',
        type: NotificationType.MembershipWelcome,
        data: {
          phone: '628100200300',
          customerName: 'Welcome User',
          planName: 'Premium',
          endDate: '2026-01-01',
        },
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date().toISOString(),
      };

      await service.processJob(job);

      const body = JSON.parse(mockHttpClient.mock.calls[0][1].body);
      expect(body.to).toBe('628100200300');
      expect(body.template.name).toBe('membership_welcome');
    });

    it('should build voucher delivery message correctly', async () => {
      mockHttpClient.mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: 'msg-v' }] }), { status: 200 }),
      );

      const job: NotificationJob = {
        id: 'job-voucher',
        type: NotificationType.VoucherDelivery,
        data: {
          phone: '628400500600',
          customerName: 'Voucher User',
          codes: 'AIRE-V-001, AIRE-V-002, AIRE-V-003',
          expiryDate: '2025-12-31',
        },
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date().toISOString(),
      };

      await service.processJob(job);

      const body = JSON.parse(mockHttpClient.mock.calls[0][1].body);
      expect(body.template.name).toBe('voucher_delivery');
    });

    it('should build campaign bonus message correctly', async () => {
      mockHttpClient.mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: 'msg-c' }] }), { status: 200 }),
      );

      const job: NotificationJob = {
        id: 'job-campaign',
        type: NotificationType.CampaignBonus,
        data: {
          phone: '628700800900',
          customerName: 'Campaign User',
          campaignName: 'Summer Blast',
          codes: 'BONUS-X1',
          expiryDate: '2025-08-31',
        },
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date().toISOString(),
      };

      await service.processJob(job);

      const body = JSON.parse(mockHttpClient.mock.calls[0][1].body);
      expect(body.template.name).toBe('campaign_bonus');
    });

    it('should build expiry reminder message correctly', async () => {
      mockHttpClient.mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: 'msg-e' }] }), { status: 200 }),
      );

      const job: NotificationJob = {
        id: 'job-expiry',
        type: NotificationType.ExpiryReminder,
        data: {
          phone: '628111333555',
          customerName: 'Expiry User',
          planName: 'Gold',
          daysRemaining: '7',
          endDate: '2025-04-15',
        },
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date().toISOString(),
      };

      await service.processJob(job);

      const body = JSON.parse(mockHttpClient.mock.calls[0][1].body);
      expect(body.template.name).toBe('expiry_reminder');
    });

    it('should build queue completion message correctly', async () => {
      mockHttpClient.mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: 'msg-q' }] }), { status: 200 }),
      );

      const job: NotificationJob = {
        id: 'job-queue',
        type: NotificationType.QueueCompletion,
        data: {
          phone: '628222444666',
          customerName: 'Queue User',
          orderNumber: 'ORD-050',
          bayName: 'Bay 2',
        },
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date().toISOString(),
      };

      await service.processJob(job);

      const body = JSON.parse(mockHttpClient.mock.calls[0][1].body);
      expect(body.template.name).toBe('queue_completion');
    });
  });
});

describe('WhatsApp Credential Routing', () => {
  let service: NotificationService;
  let mockConfigService: { get: ReturnType<typeof vi.fn> };
  let mockSettingsService: { getSettings: ReturnType<typeof vi.fn> };
  let mockHttpClient: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigService = {
      get: vi.fn((key: string) => {
        if (key === 'WHATSAPP_API_URL') return 'https://api.whatsapp.test/v1';
        if (key === 'WHATSAPP_API_TOKEN') return 'global-token-abc';
        return undefined;
      }),
    };
    mockSettingsService = {
      getSettings: vi.fn(),
    };
    service = new NotificationService(mockConfigService as any, mockSettingsService as any);
    mockHttpClient = vi.fn();
    service.setHttpClient(mockHttpClient);
  });

  describe('resolveCredentials', () => {
    it('should return tenant credentials when tenant has valid whatsapp_phone and whatsapp_token_encrypted', async () => {
      mockSettingsService.getSettings.mockResolvedValueOnce({
        whatsapp_phone: '+628123456789',
        whatsapp_token_encrypted: 'tenant-token-xyz',
        ai_enabled: false,
        automation_toggles: {},
        approval_modes: {},
      });

      const creds = await service.resolveCredentials('tenant-1');

      expect(creds.source).toBe('tenant');
      expect(creds.apiToken).toBe('tenant-token-xyz');
      expect(creds.fromPhone).toBe('+628123456789');
      expect(creds.apiUrl).toBe('https://api.whatsapp.test/v1');
    });

    it('should fall back to global credentials when tenant has no WhatsApp credentials', async () => {
      mockSettingsService.getSettings.mockResolvedValueOnce({
        whatsapp_phone: null,
        whatsapp_token_encrypted: null,
        ai_enabled: false,
        automation_toggles: {},
        approval_modes: {},
      });

      const creds = await service.resolveCredentials('tenant-2');

      expect(creds.source).toBe('global');
      expect(creds.apiToken).toBe('global-token-abc');
      expect(creds.fromPhone).toBeNull();
    });

    it('should fall back to global credentials when tenant phone is invalid E.164', async () => {
      mockSettingsService.getSettings.mockResolvedValueOnce({
        whatsapp_phone: '08123456789', // no + prefix, invalid E.164
        whatsapp_token_encrypted: 'tenant-token-xyz',
        ai_enabled: false,
        automation_toggles: {},
        approval_modes: {},
      });

      const creds = await service.resolveCredentials('tenant-3');

      expect(creds.source).toBe('global');
      expect(creds.apiToken).toBe('global-token-abc');
      expect(creds.fromPhone).toBeNull();
    });

    it('should fall back to global credentials when settingsService is not injected (null)', async () => {
      // Create service without settingsService (simulating @Optional() injection)
      const serviceNoSettings = new NotificationService(mockConfigService as any, undefined);

      const creds = await serviceNoSettings.resolveCredentials('tenant-4');

      expect(creds.source).toBe('global');
      expect(creds.apiToken).toBe('global-token-abc');
      expect(creds.fromPhone).toBeNull();
    });

    it('should fall back to global credentials when getSettings throws an error', async () => {
      mockSettingsService.getSettings.mockRejectedValueOnce(new Error('Tenant not found'));

      const creds = await service.resolveCredentials('tenant-5');

      expect(creds.source).toBe('global');
      expect(creds.apiToken).toBe('global-token-abc');
      expect(creds.fromPhone).toBeNull();
    });

    it('should return global credentials when no tenantId is provided', async () => {
      const creds = await service.resolveCredentials(undefined);

      expect(creds.source).toBe('global');
      expect(creds.apiToken).toBe('global-token-abc');
      expect(creds.fromPhone).toBeNull();
      expect(mockSettingsService.getSettings).not.toHaveBeenCalled();
    });
  });

  describe('validateE164', () => {
    it('should accept valid E.164 number: +1234567890', () => {
      expect(validateE164('+1234567890')).toBe(true);
    });

    it('should accept valid E.164 number: +628123456789', () => {
      expect(validateE164('+628123456789')).toBe(true);
    });

    it('should accept valid E.164 number: +44207123456', () => {
      expect(validateE164('+44207123456')).toBe(true);
    });

    it('should accept valid E.164 number with minimum length: +1 (2 digits)', () => {
      // E.164 pattern: +[1-9]\d{1,14} means at least 2 digits total
      expect(validateE164('+12')).toBe(true);
    });

    it('should accept valid E.164 number with maximum 15 digits', () => {
      expect(validateE164('+123456789012345')).toBe(true);
    });

    it('should reject number without + prefix: "1234567890"', () => {
      expect(validateE164('1234567890')).toBe(false);
    });

    it('should reject number with zero after +: "+0123456789"', () => {
      expect(validateE164('+0123456789')).toBe(false);
    });

    it('should reject alphabetic string: "abc"', () => {
      expect(validateE164('abc')).toBe(false);
    });

    it('should reject empty string: ""', () => {
      expect(validateE164('')).toBe(false);
    });

    it('should reject number that is too short: "+1" (only 1 digit after +)', () => {
      // Pattern requires \d{1,14} after first non-zero digit = minimum 2 total digits
      expect(validateE164('+1')).toBe(false);
    });

    it('should reject number that is too long: "+12345678901234567" (16 digits)', () => {
      expect(validateE164('+1234567890123456')).toBe(false);
    });
  });

  describe('sendWhatsApp with tenantId uses tenant credentials', () => {
    it('should use tenant credentials in the API call when tenantId is provided', async () => {
      mockSettingsService.getSettings.mockResolvedValueOnce({
        whatsapp_phone: '+628999000111',
        whatsapp_token_encrypted: 'my-tenant-secret-token',
        ai_enabled: false,
        automation_toggles: {},
        approval_modes: {},
      });

      mockHttpClient.mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: 'msg-tenant' }] }), { status: 200 }),
      );

      const message: WhatsAppMessage = {
        to: '+628555666777',
        templateName: 'membership_welcome',
        params: { customerName: 'Tenant User', planName: 'Gold', endDate: '2025-12-31' },
        tenantId: 'tenant-abc',
      };

      const result = await service.sendWhatsApp(message);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-tenant');

      // Verify the HTTP call used tenant credentials
      const [, options] = mockHttpClient.mock.calls[0];
      expect(options.headers['Authorization']).toBe('Bearer my-tenant-secret-token');
    });

    it('should fall back to global credentials in the API call when tenant has no credentials', async () => {
      mockSettingsService.getSettings.mockResolvedValueOnce({
        whatsapp_phone: null,
        whatsapp_token_encrypted: null,
        ai_enabled: false,
        automation_toggles: {},
        approval_modes: {},
      });

      mockHttpClient.mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: 'msg-global' }] }), { status: 200 }),
      );

      const message: WhatsAppMessage = {
        to: '+628555666777',
        templateName: 'voucher_delivery',
        params: { customerName: 'Global User', codes: 'CODE-1', expiryDate: '2025-12-31' },
        tenantId: 'tenant-xyz',
      };

      const result = await service.sendWhatsApp(message);

      expect(result.success).toBe(true);

      // Verify the HTTP call used global credentials
      const [, options] = mockHttpClient.mock.calls[0];
      expect(options.headers['Authorization']).toBe('Bearer global-token-abc');
    });
  });
});
