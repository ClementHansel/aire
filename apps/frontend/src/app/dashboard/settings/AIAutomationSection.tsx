'use client';

import { useState, useCallback } from 'react';
import { Check, X } from 'lucide-react';
import { api } from '@/lib/api';

/**
 * AI Automation section for the Settings page. Global AI toggle, LLM provider,
 * conditional API key, schedule interval, and a live connection test.
 * Controlled by the parent (which persists via PATCH /api/settings/:tenantId).
 * Requirements: 3.1, 3.2, 3.5, 11.3
 */

export interface AIAutomationSectionProps {
  ai_enabled: boolean;
  llm_provider: 'openrouter' | 'hermes_ai';
  /** Truthy when a key is already stored (never the plaintext secret). */
  llm_api_key_encrypted: string | null;
  schedule_interval: 'hourly' | 'daily' | null;
  onSave?: (settings: {
    ai_enabled: boolean;
    llm_provider: 'openrouter' | 'hermes_ai';
    llm_api_key: string;
    schedule_interval: 'hourly' | 'daily' | null;
  }) => void;
}

export function AIAutomationSection({
  ai_enabled,
  llm_provider,
  llm_api_key_encrypted,
  schedule_interval,
  onSave,
}: AIAutomationSectionProps) {
  const [aiEnabled, setAiEnabled] = useState(ai_enabled);
  const [provider, setProvider] = useState<'openrouter' | 'hermes_ai'>(llm_provider);
  const [apiKey, setApiKey] = useState(llm_api_key_encrypted ? '••••••••' : '');
  const [interval, setInterval] = useState<'hourly' | 'daily' | null>(schedule_interval);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post<{ ok: boolean; provider: string; model: string; latencyMs: number; message: string }>(
        '/agent/validate-connection',
      );
      setTestResult({
        ok: res.ok,
        message: res.ok
          ? `Connected to ${res.provider} (${res.model}) in ${res.latencyMs}ms`
          : `Failed: ${res.message}`,
      });
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  }, []);

  const handleProviderChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as 'openrouter' | 'hermes_ai';
    setProvider(value);
    if (value === 'hermes_ai') setApiKeyError(null);
  }, []);

  const handleApiKeyChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setApiKey(e.target.value);
    setApiKeyDirty(true);
    if (e.target.value.trim()) setApiKeyError(null);
  }, []);

  const handleSave = useCallback(() => {
    // OpenRouter requires a key — either a freshly typed one or one already stored.
    if (provider === 'openrouter') {
      const effectiveKey = apiKeyDirty ? apiKey.trim() : (llm_api_key_encrypted || '');
      if (!effectiveKey) {
        setApiKeyError('API key is required when using OpenRouter');
        return;
      }
    }
    setApiKeyError(null);
    onSave?.({
      ai_enabled: aiEnabled,
      llm_provider: provider,
      llm_api_key: apiKeyDirty ? apiKey : '',
      schedule_interval: interval,
    });
  }, [aiEnabled, provider, apiKey, apiKeyDirty, interval, llm_api_key_encrypted, onSave]);

  return (
    <section data-testid="ai-automation-section" className="card space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="section-title">AI Automation</h2>
          <p className="section-description">
            Configure the AI provider, scheduling, and whether automation runs at all.
          </p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
          <input
            id="ai-global-toggle"
            data-testid="ai-global-toggle"
            type="checkbox"
            className="sr-only peer"
            checked={aiEnabled}
            onChange={() => setAiEnabled((p) => !p)}
            aria-label="Enable AI Automation"
          />
          <div className="w-11 h-6 bg-border-strong rounded-full peer peer-checked:bg-primary-500 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
        </label>
      </div>

      {aiEnabled && (
        <div data-testid="ai-hidden-when-off" className="pt-4 border-t border-border space-y-4">
          <div>
            <label htmlFor="ai-llm-provider-select" className="block text-sm font-medium text-text-primary mb-1.5">LLM Provider</label>
            <select
              id="ai-llm-provider-select"
              data-testid="ai-llm-provider-select"
              className="input-field"
              value={provider}
              onChange={handleProviderChange}
              aria-label="LLM Provider"
            >
              <option value="hermes_ai">Hermes AI (Local)</option>
              <option value="openrouter">OpenRouter (Cloud)</option>
            </select>
          </div>

          {provider === 'openrouter' && (
            <div>
              <label htmlFor="ai-api-key-input" className="block text-sm font-medium text-text-primary mb-1.5">
                API Key {llm_api_key_encrypted && <span className="text-xs text-text-muted font-normal">· stored</span>}
              </label>
              <input
                id="ai-api-key-input"
                data-testid="ai-api-key-input"
                type="password"
                className="input-field"
                value={apiKey}
                onChange={handleApiKeyChange}
                placeholder="sk-or-..."
                aria-label="OpenRouter API Key"
                aria-invalid={!!apiKeyError}
                aria-describedby={apiKeyError ? 'ai-api-key-error' : undefined}
              />
              {apiKeyError && (
                <p id="ai-api-key-error" data-testid="ai-api-key-error" className="mt-1 text-xs text-error" role="alert">
                  {apiKeyError}
                </p>
              )}
            </div>
          )}

          <div>
            <label htmlFor="ai-schedule-select" className="block text-sm font-medium text-text-primary mb-1.5">Schedule Interval</label>
            <select
              id="ai-schedule-select"
              data-testid="ai-schedule-select"
              className="input-field"
              value={interval ?? ''}
              onChange={(e) => setInterval(e.target.value === '' ? null : (e.target.value as 'hourly' | 'daily'))}
              aria-label="Schedule Interval"
            >
              <option value="">Disabled</option>
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
            </select>
          </div>

          <div>
            <button
              type="button"
              data-testid="ai-test-connection-button"
              className="btn-secondary"
              onClick={handleTestConnection}
              disabled={testing}
            >
              {testing ? 'Testing…' : 'Test AI Connection'}
            </button>
            {testResult && (
              <p
                data-testid="ai-test-connection-result"
                role="status"
                className={`mt-2 text-sm inline-flex items-center gap-1.5 ${testResult.ok ? 'text-success' : 'text-error'}`}
              >
                {testResult.ok ? <Check size={14} /> : <X size={14} />}{testResult.message}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="pt-2">
        <button data-testid="ai-save-button" type="button" className="btn-primary" onClick={handleSave}>
          Save AI Settings
        </button>
      </div>
    </section>
  );
}

export default AIAutomationSection;
