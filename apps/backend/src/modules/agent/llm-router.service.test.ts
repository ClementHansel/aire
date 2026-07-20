import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { LLMRouterService, ChatMessage, LLMErrorResponse } from './llm-router.service';
import type { SettingsService } from '../settings/settings.service';
import type { TenantAutomationSettings } from '../settings/settings.interfaces';
import { DEFAULT_AUTOMATION_SETTINGS } from '../settings/settings.interfaces';

/**
 * Unit tests for LLMRouterService.
 *
 * Tests routing to OpenRouter vs Hermes AI based on tenant settings,
 * and graceful error handling when providers are unreachable.
 *
 * Requirements: 3.6, 3.7
 */

function createMockSettingsService(
  overrides: Partial<TenantAutomationSettings> = {},
): SettingsService {
  const settings: TenantAutomationSettings = {
    ...DEFAULT_AUTOMATION_SETTINGS,
    ...overrides,
  };

  return {
    getSettings: vi.fn().mockResolvedValue(settings),
    // The router now reads the PLATFORM LLM connection; map the same overrides.
    getPlatformLlm: vi.fn().mockResolvedValue({
      provider: settings.llm_provider,
      model: settings.llm_model,
      apiKey: settings.llm_api_key_encrypted,
    }),
  } as unknown as SettingsService;
}

describe('LLMRouterService', () => {
  let service: LLMRouterService;
  let mockSettingsService: SettingsService;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('routing to OpenRouter', () => {
    beforeEach(() => {
      mockSettingsService = createMockSettingsService({
        llm_provider: 'openrouter',
        llm_api_key_encrypted: 'sk-test-key-12345',
      });
      service = new LLMRouterService(mockSettingsService);
    });

    it('should call OpenRouter endpoint when llm_provider is openrouter', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'Hello from OpenRouter!' } }],
          model: 'openai/gpt-4o-mini',
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        text: vi.fn(),
      };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      const result = await service.chat('tenant-123', messages);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer sk-test-key-12345',
          }),
        }),
      );
      expect(result.content).toBe('Hello from OpenRouter!');
      expect(result.model).toBe('openai/gpt-4o-mini');
      expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5 });
    });

    it('should use tenant API key in Authorization header', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'Response' } }],
          model: 'openai/gpt-4o-mini',
        }),
        text: vi.fn(),
      };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      await service.chat('tenant-123', [{ role: 'user', content: 'Hi' }]);

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const requestInit = fetchCall[1] as RequestInit;
      expect((requestInit.headers as Record<string, string>).Authorization).toBe(
        'Bearer sk-test-key-12345',
      );
    });

    it('should pass model and temperature options to OpenRouter', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'Test' } }],
          model: 'anthropic/claude-3.5-sonnet',
        }),
        text: vi.fn(),
      };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      await service.chat(
        'tenant-123',
        [{ role: 'user', content: 'Hi' }],
        { model: 'anthropic/claude-3.5-sonnet', temperature: 0.7, max_tokens: 100 },
      );

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.model).toBe('anthropic/claude-3.5-sonnet');
      expect(body.temperature).toBe(0.7);
      expect(body.max_tokens).toBe(100);
    });

    it('should return error when API key is not configured', async () => {
      mockSettingsService = createMockSettingsService({
        llm_provider: 'openrouter',
        llm_api_key_encrypted: null,
      });
      service = new LLMRouterService(mockSettingsService);

      const result = await service.chat('tenant-123', [
        { role: 'user', content: 'Hello' },
      ]);

      expect((result as LLMErrorResponse).error).toBe(true);
      expect((result as LLMErrorResponse).errorType).toBe('invalid_api_key');
      expect((result as LLMErrorResponse).errorMessage).toContain('not configured');
    });

    it('should return invalid_api_key error on 401 response', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        text: vi.fn().mockResolvedValue('Unauthorized'),
      };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await service.chat('tenant-123', [
        { role: 'user', content: 'Hello' },
      ]);

      expect((result as LLMErrorResponse).error).toBe(true);
      expect((result as LLMErrorResponse).errorType).toBe('invalid_api_key');
    });

    it('should return provider_unreachable on non-auth HTTP error', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('Internal Server Error'),
      };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await service.chat('tenant-123', [
        { role: 'user', content: 'Hello' },
      ]);

      expect((result as LLMErrorResponse).error).toBe(true);
      expect((result as LLMErrorResponse).errorType).toBe('provider_unreachable');
      expect((result as LLMErrorResponse).errorMessage).toContain('500');
    });
  });

  describe('routing to Hermes AI', () => {
    beforeEach(() => {
      mockSettingsService = createMockSettingsService({
        llm_provider: 'hermes_ai',
      });
      service = new LLMRouterService(mockSettingsService);
    });

    it('should call Hermes AI endpoint when llm_provider is hermes_ai', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          message: { content: 'Hello from Hermes!' },
          model: 'hermes3:latest',
          prompt_eval_count: 15,
          eval_count: 8,
        }),
        text: vi.fn(),
      };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ];

      const result = await service.chat('tenant-456', messages);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/chat',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
      expect(result.content).toBe('Hello from Hermes!');
      expect(result.model).toBe('hermes3:latest');
      expect(result.usage).toEqual({ prompt_tokens: 15, completion_tokens: 8 });
    });

    it('should not include Authorization header for Hermes AI', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          message: { content: 'Response' },
          model: 'hermes3:latest',
        }),
        text: vi.fn(),
      };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      await service.chat('tenant-456', [{ role: 'user', content: 'Hi' }]);

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const headers = fetchCall[1].headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    });

    it('should set stream: false for Hermes AI requests', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          message: { content: 'Test' },
          model: 'hermes3:latest',
        }),
        text: vi.fn(),
      };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      await service.chat('tenant-456', [{ role: 'user', content: 'Hi' }]);

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.stream).toBe(false);
    });

    it('should return provider_unreachable when Hermes AI endpoint fails', async () => {
      const mockResponse = {
        ok: false,
        status: 503,
        text: vi.fn().mockResolvedValue('Service Unavailable'),
      };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await service.chat('tenant-456', [
        { role: 'user', content: 'Hello' },
      ]);

      expect((result as LLMErrorResponse).error).toBe(true);
      expect((result as LLMErrorResponse).errorType).toBe('provider_unreachable');
      expect((result as LLMErrorResponse).errorMessage).toContain('503');
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      mockSettingsService = createMockSettingsService({
        llm_provider: 'openrouter',
        llm_api_key_encrypted: 'sk-test-key',
      });
      service = new LLMRouterService(mockSettingsService);
    });

    it('should return timeout error when request times out', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      globalThis.fetch = vi.fn().mockRejectedValue(abortError);

      const result = await service.chat('tenant-123', [
        { role: 'user', content: 'Hello' },
      ]);

      expect((result as LLMErrorResponse).error).toBe(true);
      expect((result as LLMErrorResponse).errorType).toBe('timeout');
      expect((result as LLMErrorResponse).errorMessage).toContain('timed out');
    });

    it('should return provider_unreachable when network error occurs', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(
        new TypeError('fetch failed'),
      );

      const result = await service.chat('tenant-123', [
        { role: 'user', content: 'Hello' },
      ]);

      expect((result as LLMErrorResponse).error).toBe(true);
      expect((result as LLMErrorResponse).errorType).toBe('provider_unreachable');
      expect((result as LLMErrorResponse).errorMessage).toContain('fetch failed');
    });

    it('should handle settings service failure gracefully', async () => {
      mockSettingsService = {
        getPlatformLlm: vi.fn().mockRejectedValue(new Error('DB unavailable')),
      } as unknown as SettingsService;
      service = new LLMRouterService(mockSettingsService);

      const result = await service.chat('tenant-123', [
        { role: 'user', content: 'Hello' },
      ]);

      expect((result as LLMErrorResponse).error).toBe(true);
      expect((result as LLMErrorResponse).errorType).toBe('unknown');
      expect((result as LLMErrorResponse).errorMessage).toContain('DB unavailable');
    });

    it('should return structured error with content empty string', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(
        new Error('Connection refused'),
      );

      const result = await service.chat('tenant-123', [
        { role: 'user', content: 'Hello' },
      ]);

      expect(result.content).toBe('');
      expect((result as LLMErrorResponse).error).toBe(true);
    });

    it('should handle Hermes AI timeout gracefully', async () => {
      mockSettingsService = createMockSettingsService({
        llm_provider: 'hermes_ai',
      });
      service = new LLMRouterService(mockSettingsService);

      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      globalThis.fetch = vi.fn().mockRejectedValue(abortError);

      const result = await service.chat('tenant-456', [
        { role: 'user', content: 'Hello' },
      ]);

      expect((result as LLMErrorResponse).error).toBe(true);
      expect((result as LLMErrorResponse).errorType).toBe('timeout');
      expect((result as LLMErrorResponse).errorMessage).toContain('Hermes AI');
    });
  });
});
