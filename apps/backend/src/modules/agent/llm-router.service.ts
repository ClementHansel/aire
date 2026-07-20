import { Injectable, Logger, Optional } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { MonitoringService } from '../monitoring/monitoring.service';

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
  /** Optional branch attribution for per-outlet AI-usage monitoring. */
  outletId?: string | null;
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

  constructor(
    private readonly settingsService: SettingsService,
    @Optional() private readonly monitoring?: MonitoringService,
  ) {
    this.hermesAiEndpoint =
      process.env.HERMES_AI_ENDPOINT ?? 'http://localhost:11434/api/chat';
    this.requestTimeoutMs = parseInt(process.env.LLM_REQUEST_TIMEOUT_MS ?? '30000', 10);
  }

  /**
   * Public entry point: routes the chat to the tenant's provider and records
   * the invocation (latency, tokens, success/error) for the monitoring panel.
   */
  async chat(
    tenantId: string,
    messages: ChatMessage[],
    options?: LLMOptions,
  ): Promise<LLMResponse | LLMErrorResponse> {
    const start = Date.now();
    const response = await this.routeChat(tenantId, messages, options);
    const isError = 'error' in response && (response as LLMErrorResponse).error === true;
    await this.monitoring?.record({
      tenantId,
      outletId: options?.outletId ?? null,
      kind: 'llm',
      name: response.model || options?.model || 'unknown',
      status: isError ? 'error' : 'success',
      durationMs: Date.now() - start,
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
      error: isError ? (response as LLMErrorResponse).errorMessage : undefined,
    });
    return response;
  }

  /**
   * Validate the tenant's configured LLM connection with a minimal ping.
   * Returns provider/model, latency, and a clear error if it fails — used by
   * the "Test connection" button in AI settings.
   */
  async validateConnection(
    tenantId: string,
  ): Promise<{ ok: boolean; provider: string; model: string; latencyMs: number; message: string }> {
    let provider = 'unknown';
    try {
      const platform = await this.settingsService.getPlatformLlm();
      provider = platform.provider;
    } catch {
      /* fall through; routeChat will report */
    }
    const start = Date.now();
    const res = await this.routeChat(
      tenantId,
      [
        { role: 'system', content: 'You are a connectivity probe. Reply with the single word: OK.' },
        { role: 'user', content: 'ping' },
      ],
      { max_tokens: 5, temperature: 0 },
    );
    const latencyMs = Date.now() - start;
    const isError = 'error' in res && (res as LLMErrorResponse).error === true;
    if (isError) {
      const err = res as LLMErrorResponse;
      return { ok: false, provider, model: res.model, latencyMs, message: `${err.errorType}: ${err.errorMessage}` };
    }
    return { ok: true, provider, model: res.model, latencyMs, message: 'Connection successful' };
  }

  /**
   * Route a chat completion to the tenant's configured LLM provider.
   *
   * Requirements: 3.6, 3.7
   */
  private async routeChat(
    tenantId: string,
    messages: ChatMessage[],
    options?: LLMOptions,
  ): Promise<LLMResponse | LLMErrorResponse> {
    try {
      // The LLM connection is PLATFORM-WIDE (Airin's own account), not per-tenant.
      const platform = await this.settingsService.getPlatformLlm();
      const provider = platform.provider;
      // Explicit per-call model wins, else the platform model, else undefined so
      // the provider callers fall back to their hardcoded default.
      const model = options?.model ?? platform.model ?? undefined;
      const routedOptions: LLMOptions = { ...options, model };

      if (provider === 'openrouter') {
        const apiKey = platform.apiKey;
        if (!apiKey || apiKey.trim() === '') {
          this.logger.error('Platform OpenRouter API key is not configured');
          return this.createErrorResponse(
            'invalid_api_key',
            'Platform OpenRouter API key is not configured (set it in Admin → Platform Config → AI)',
            model,
          );
        }
        return this.callOpenRouter(apiKey, messages, routedOptions);
      }

      // Default: Hermes AI (local)
      return this.callHermesAi(messages, routedOptions);
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
    const model = options?.model ?? 'qwen/qwen3.5-flash-02-23';
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
