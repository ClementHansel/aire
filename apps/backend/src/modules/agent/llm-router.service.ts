import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';

/**
 * Interfaces for LLM communication.
 *
 * Requirements: 3.6, 3.7
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

export interface LLMErrorResponse extends LLMResponse {
  error: true;
  errorType: 'provider_unreachable' | 'invalid_api_key' | 'timeout' | 'unknown';
  errorMessage: string;
}

/**
 * LLM Router Service.
 *
 * Routes LLM calls to either OpenRouter (using tenant's encrypted API key)
 * or Hermes AI (local endpoint) based on the tenant's `llm_provider` setting.
 *
 * Handles provider unreachable errors, invalid API key errors, and timeouts
 * gracefully with structured error responses and logging.
 *
 * Requirements: 3.6, 3.7
 */
@Injectable()
export class LLMRouterService {
  private readonly logger = new Logger(LLMRouterService.name);

  /** OpenRouter API endpoint */
  private readonly openRouterEndpoint = 'https://openrouter.ai/api/v1/chat/completions';

  /** Hermes AI (Ollama) endpoint - configurable via env var */
  private readonly hermesAiEndpoint: string;

  /** Request timeout in milliseconds */
  private readonly requestTimeoutMs: number;

  constructor(private readonly settingsService: SettingsService) {
    this.hermesAiEndpoint =
      process.env.HERMES_AI_ENDPOINT ?? 'http://localhost:11434/api/chat';
    this.requestTimeoutMs = parseInt(process.env.LLM_REQUEST_TIMEOUT_MS ?? '30000', 10);
  }

  /**
   * Send a chat completion request routed to the tenant's configured LLM provider.
   *
   * 1. Fetches tenant settings to determine provider
   * 2. Routes to OpenRouter or Hermes AI accordingly
   * 3. Returns structured response or error
   *
   * Requirements: 3.6, 3.7
   */
  async chat(
    tenantId: string,
    messages: ChatMessage[],
    options?: LLMOptions,
  ): Promise<LLMResponse | LLMErrorResponse> {
    try {
      const settings = await this.settingsService.getSettings(tenantId);
      const provider = settings.llm_provider;

      if (provider === 'openrouter') {
        const apiKey = settings.llm_api_key_encrypted;
        if (!apiKey || apiKey.trim() === '') {
          this.logger.error(
            `Tenant ${tenantId}: OpenRouter selected but no API key configured`,
          );
          return this.createErrorResponse(
            'invalid_api_key',
            'OpenRouter API key is not configured for this tenant',
            options?.model,
          );
        }
        return this.callOpenRouter(apiKey, messages, options);
      }

      // Default: Hermes AI (local)
      return this.callHermesAi(messages, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`LLM chat failed for tenant ${tenantId}: ${message}`);
      return this.createErrorResponse(
        'unknown',
        `Failed to process LLM request: ${message}`,
        options?.model,
      );
    }
  }

  /**
   * Call OpenRouter API with the tenant's API key.
   */
  private async callOpenRouter(
    apiKey: string,
    messages: ChatMessage[],
    options?: LLMOptions,
  ): Promise<LLMResponse | LLMErrorResponse> {
    const model = options?.model ?? 'openai/gpt-4o-mini';
    const body = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      ...(options?.temperature !== undefined && { temperature: options.temperature }),
      ...(options?.max_tokens !== undefined && { max_tokens: options.max_tokens }),
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

      const response = await fetch(this.openRouterEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 401 || response.status === 403) {
        this.logger.error('OpenRouter: Invalid or unauthorized API key');
        return this.createErrorResponse(
          'invalid_api_key',
          'OpenRouter API key is invalid or unauthorized',
          model,
        );
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        this.logger.error(
          `OpenRouter: HTTP ${response.status} — ${errorText}`,
        );
        return this.createErrorResponse(
          'provider_unreachable',
          `OpenRouter returned HTTP ${response.status}`,
          model,
        );
      }

      const data: any = await response.json();
      const choice = data.choices?.[0];

      return {
        content: choice?.message?.content ?? '',
        model: data.model ?? model,
        usage: data.usage
          ? {
              prompt_tokens: data.usage.prompt_tokens ?? 0,
              completion_tokens: data.usage.completion_tokens ?? 0,
            }
          : undefined,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.error('OpenRouter: Request timed out');
        return this.createErrorResponse(
          'timeout',
          `OpenRouter request timed out after ${this.requestTimeoutMs}ms`,
          model,
        );
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`OpenRouter: ${message}`);
      return this.createErrorResponse('provider_unreachable', message, model);
    }
  }

  /**
   * Call Hermes AI (local Ollama endpoint).
   */
  private async callHermesAi(
    messages: ChatMessage[],
    options?: LLMOptions,
  ): Promise<LLMResponse | LLMErrorResponse> {
    const model = options?.model ?? 'hermes3:latest';
    const body = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      ...(options?.temperature !== undefined && {
        options: { temperature: options.temperature },
      }),
      ...(options?.max_tokens !== undefined && {
        options: {
          ...(options?.temperature !== undefined && { temperature: options.temperature }),
          num_predict: options.max_tokens,
        },
      }),
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

      const response = await fetch(this.hermesAiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        this.logger.error(
          `Hermes AI: HTTP ${response.status} — ${errorText}`,
        );
        return this.createErrorResponse(
          'provider_unreachable',
          `Hermes AI returned HTTP ${response.status}`,
          model,
        );
      }

      const data: any = await response.json();

      return {
        content: data.message?.content ?? '',
        model: data.model ?? model,
        usage: data.prompt_eval_count !== undefined
          ? {
              prompt_tokens: data.prompt_eval_count ?? 0,
              completion_tokens: data.eval_count ?? 0,
            }
          : undefined,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.error('Hermes AI: Request timed out');
        return this.createErrorResponse(
          'timeout',
          `Hermes AI request timed out after ${this.requestTimeoutMs}ms`,
          model,
        );
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Hermes AI: ${message}`);
      return this.createErrorResponse('provider_unreachable', message, model);
    }
  }

  /**
   * Create a structured error response.
   */
  private createErrorResponse(
    errorType: LLMErrorResponse['errorType'],
    errorMessage: string,
    model?: string,
  ): LLMErrorResponse {
    return {
      content: '',
      model: model ?? 'unknown',
      error: true,
      errorType,
      errorMessage,
    };
  }
}
