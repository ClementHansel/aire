import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ChatbotService,
  ChatbotResponse,
  WhatsAppWebhookPayload,
} from './chatbot.service';

/**
 * AI Chatbot controller.
 *
 * Provides a webhook endpoint for incoming WhatsApp messages.
 * The webhook is called by the WhatsApp Business API when a customer
 * sends a message to the business number.
 *
 * No authentication is required for the webhook endpoint since it is
 * called by an external service with its own verification mechanism.
 *
 * Endpoints:
 *   POST /api/ai/chatbot/webhook — Incoming WhatsApp message webhook
 *
 * Requirements: 33.1, 33.2
 */
@Controller('api/ai/chatbot')
export class ChatbotController {
  private readonly logger = new Logger(ChatbotController.name);

  constructor(private readonly chatbotService: ChatbotService) {}

  /**
   * POST /api/ai/chatbot/webhook
   *
   * Receives incoming WhatsApp messages and processes them through
   * the AI chatbot for intent recognition and response generation.
   *
   * Requirement 33.1: Respond to customer queries about membership status,
   * remaining quota, voucher balance, and service pricing.
   * Requirement 33.2: Route complex queries to a human operator.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() payload: WhatsAppWebhookPayload,
  ): Promise<ChatbotResponse> {
    this.logger.log(
      `Webhook received from ${payload.from}: "${payload.text?.substring(0, 50) ?? ''}"`,
    );

    const response = await this.chatbotService.handleMessage(
      payload.from,
      payload.text ?? '',
    );

    return response;
  }
}
