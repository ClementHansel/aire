import { Injectable, Logger } from '@nestjs/common';

/**
 * Supported chatbot intents recognized from incoming messages.
 */
export enum ChatbotIntent {
  MembershipCheck = 'membership_check',
  OrderStatus = 'order_status',
  BookAppointment = 'book_appointment',
  GeneralInfo = 'general_info',
}

/**
 * Response from the chatbot service after processing a message.
 */
export interface ChatbotResponse {
  /** The recognized intent from the incoming message */
  intent: ChatbotIntent;
  /** The reply message text to send back to the customer */
  reply: string;
  /** Whether this query was routed to a human operator */
  routedToHuman: boolean;
  /** Optional metadata for downstream processing */
  metadata?: Record<string, unknown>;
}

/**
 * Incoming webhook payload from WhatsApp Business API.
 */
export interface WhatsAppWebhookPayload {
  /** Sender phone number in E.164 format */
  from: string;
  /** Message text content */
  text: string;
  /** Unique message ID from WhatsApp */
  messageId?: string;
  /** Timestamp of the message */
  timestamp?: string;
}

/**
 * Tenant chatbot configuration.
 */
export interface ChatbotConfig {
  /** Whether the chatbot is enabled for this tenant */
  enabled: boolean;
  /** Custom greeting message */
  greeting?: string;
  /** Custom responses per intent */
  customResponses?: Partial<Record<ChatbotIntent, string>>;
}

/**
 * Keyword mapping for intent recognition.
 * Each intent has a list of keywords/phrases that trigger it.
 */
const INTENT_KEYWORDS: Record<ChatbotIntent, string[]> = {
  [ChatbotIntent.MembershipCheck]: [
    'member', 'membership', 'keanggotaan', 'status member',
    'quota', 'kuota', 'sisa cuci', 'remaining', 'sisa',
    'expired', 'expiry', 'berlaku', 'masa aktif',
  ],
  [ChatbotIntent.OrderStatus]: [
    'order', 'pesanan', 'status pesanan', 'track', 'tracking',
    'dimana', 'where', 'antrian', 'queue', 'nomor antrian',
  ],
  [ChatbotIntent.BookAppointment]: [
    'book', 'booking', 'appointment', 'jadwal', 'reservasi',
    'reserve', 'daftar', 'jam buka', 'schedule', 'slot',
  ],
  [ChatbotIntent.GeneralInfo]: [
    'harga', 'price', 'pricing', 'layanan', 'service',
    'info', 'information', 'jam operasional', 'alamat',
    'address', 'location', 'lokasi', 'contact', 'kontak',
  ],
};

/**
 * Default reply templates for each intent.
 */
const DEFAULT_REPLIES: Record<ChatbotIntent, string> = {
  [ChatbotIntent.MembershipCheck]:
    'Untuk mengecek status membership Anda, silakan kirim nomor HP yang terdaftar. Tim kami akan segera menginformasikan status keanggotaan, sisa kuota, dan masa berlaku Anda.',
  [ChatbotIntent.OrderStatus]:
    'Untuk mengecek status pesanan Anda, silakan kirim nomor pesanan atau nomor HP yang terdaftar. Kami akan segera memberikan informasi terkini.',
  [ChatbotIntent.BookAppointment]:
    'Untuk melakukan booking, silakan kirim tanggal dan waktu yang Anda inginkan. Kami akan mengecek ketersediaan dan mengkonfirmasi jadwal Anda.',
  [ChatbotIntent.GeneralInfo]:
    'Terima kasih telah menghubungi kami! Untuk informasi harga, layanan, dan jam operasional, silakan kunjungi outlet terdekat atau tanyakan detail spesifik yang Anda butuhkan.',
};

/**
 * Fallback reply when no intent is matched clearly
 * (routes to human operator).
 */
const FALLBACK_REPLY =
  'Terima kasih telah menghubungi kami. Pertanyaan Anda akan diteruskan ke operator kami. Mohon tunggu sebentar.';

/**
 * ChatbotService handles incoming WhatsApp messages, performs keyword-based
 * intent recognition, and generates appropriate responses.
 *
 * This is a stub implementation using keyword matching. In production,
 * this would integrate with an LLM provider (OpenRouter/Ollama) for
 * more sophisticated natural language understanding.
 *
 * Requirements: 33.1, 33.2, 33.3
 */
@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  /** Per-tenant chatbot configuration (stub — in production from DB) */
  private readonly tenantConfigs: Map<string, ChatbotConfig> = new Map();

  /**
   * Process an incoming WhatsApp message and return an appropriate response.
   *
   * Requirement 33.1: Respond to customer queries about membership status,
   * remaining quota, voucher balance, and service pricing.
   * Requirement 33.2: Route complex queries to a human operator.
   *
   * @param phone - Sender phone number
   * @param message - Message text content
   * @param tenantId - Optional tenant ID for tenant-specific configuration
   * @returns ChatbotResponse with recognized intent and reply
   */
  async handleMessage(
    phone: string,
    message: string,
    tenantId?: string,
  ): Promise<ChatbotResponse> {
    this.logger.log(`Processing message from ${phone}: "${message.substring(0, 50)}..."`);

    // Check if chatbot is enabled for the tenant
    if (tenantId) {
      const config = this.tenantConfigs.get(tenantId);
      if (config && !config.enabled) {
        return {
          intent: ChatbotIntent.GeneralInfo,
          reply: FALLBACK_REPLY,
          routedToHuman: true,
          metadata: { reason: 'chatbot_disabled' },
        };
      }
    }

    // Recognize intent from message
    const intent = this.recognizeIntent(message);

    // If no clear intent, route to human operator
    if (intent === null) {
      this.logger.log(`No intent recognized for "${message.substring(0, 50)}...", routing to human`);
      return {
        intent: ChatbotIntent.GeneralInfo,
        reply: FALLBACK_REPLY,
        routedToHuman: true,
        metadata: { phone, originalMessage: message },
      };
    }

    // Get reply (custom or default)
    const reply = this.getReply(intent, tenantId);

    this.logger.log(`Recognized intent: ${intent} for phone: ${phone}`);

    return {
      intent,
      reply,
      routedToHuman: false,
      metadata: { phone },
    };
  }

  /**
   * Recognize intent from message text using keyword matching.
   *
   * Uses a simple scoring system: the intent with the most keyword matches wins.
   * Returns null if no keywords match (triggers human routing).
   *
   * @param message - The raw message text
   * @returns Recognized intent or null if no match
   */
  recognizeIntent(message: string): ChatbotIntent | null {
    const normalizedMessage = message.toLowerCase().trim();

    if (!normalizedMessage) {
      return null;
    }

    const scores: Record<ChatbotIntent, number> = {
      [ChatbotIntent.MembershipCheck]: 0,
      [ChatbotIntent.OrderStatus]: 0,
      [ChatbotIntent.BookAppointment]: 0,
      [ChatbotIntent.GeneralInfo]: 0,
    };

    for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
      for (const keyword of keywords) {
        if (normalizedMessage.includes(keyword.toLowerCase())) {
          scores[intent as ChatbotIntent]++;
        }
      }
    }

    // Find the intent with the highest score
    let bestIntent: ChatbotIntent | null = null;
    let bestScore = 0;

    for (const [intent, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent as ChatbotIntent;
      }
    }

    return bestIntent;
  }

  /**
   * Get the reply text for a given intent, respecting tenant customization.
   *
   * Requirement 33.3: Allow Tenant_Owners to configure chatbot responses.
   *
   * @param intent - The recognized intent
   * @param tenantId - Optional tenant ID for custom responses
   * @returns Reply text string
   */
  getReply(intent: ChatbotIntent, tenantId?: string): string {
    if (tenantId) {
      const config = this.tenantConfigs.get(tenantId);
      if (config?.customResponses?.[intent]) {
        return config.customResponses[intent]!;
      }
    }
    return DEFAULT_REPLIES[intent];
  }

  /**
   * Set chatbot configuration for a tenant.
   *
   * Requirement 33.3: Enable/disable chatbot per tenant with configurable responses.
   *
   * @param tenantId - The tenant ID
   * @param config - Chatbot configuration
   */
  setTenantConfig(tenantId: string, config: ChatbotConfig): void {
    this.tenantConfigs.set(tenantId, config);
    this.logger.log(
      `Chatbot config updated for tenant ${tenantId}: enabled=${config.enabled}`,
    );
  }

  /**
   * Get chatbot configuration for a tenant.
   *
   * @param tenantId - The tenant ID
   * @returns ChatbotConfig or undefined if not configured
   */
  getTenantConfig(tenantId: string): ChatbotConfig | undefined {
    return this.tenantConfigs.get(tenantId);
  }
}
