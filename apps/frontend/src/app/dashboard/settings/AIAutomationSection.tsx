'use client';

import { useState, useCallback } from 'react';

/**
 * AI Automation section for the Settings page.
 * Provides global AI toggle, LLM provider selection, conditional API key input,
 * and schedule interval configuration.
 * Requirements: 3.1, 3.2, 3.5, 11.3
 */

export interface AIAutomationSectionProps {
  ai_enabled: boolean;
  llm_provider: 'openrouter' | 'hermes_ai';
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

  const handleToggleAI = useCallback(() => {
    setAiEnabled((prev) => !prev);
  }, []);

  const handleProviderChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as 'openrouter' | 'hermes_ai';
    setProvider(value);
    // Clear error when switching away from openrouter
    if (value === 'hermes_ai') {
      setApiKeyError(null);
    }
  }, []);

  const handleApiKeyChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setApiKey(e.target.value);
    setApiKeyDirty(true);
    if (e.target.value.trim()) {
      setApiKeyError(null);
    }
  }, []);

  const handleIntervalChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setInterval(value === '' ? null : (value as 'hourly' | 'daily'));
  }, []);

  const handleSave = useCallback(() => {
    // Validate: OpenRouter requires API key
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
    <section data-testid="ai-automation-section" className="settings-section">
      <h2 className="settings-section-title">AI Automation</h2>
      <p className="settings-section-description">
        Configure AI-powered automation, LLM provider, and scheduling preferences.
      </p>

      <div className="settings-field">
        <label className="settings-toggle-label" htmlFor="ai-global-toggle">
          <span>Enable AI Automation</span>
          <input
            id="ai-global-toggle"
            data-testid="ai-global-toggle"
            type="checkbox"
            checked={aiEnabled}
            onChange={handleToggleAI}
            aria-label="Enable AI Automation"
          />
        </label>
      </div>

      {aiEnabled && (
        <div data-testid="ai-hidden-when-off" className="settings-ai-details">
          <div className="settings-field">
            <label htmlFor="ai-llm-provider-select">LLM Provider</label>
            <select
              id="ai-llm-provider-select"
              data-testid="ai-llm-provider-select"
              value={provider}
              onChange={handleProviderChange}
              aria-label="LLM Provider"
            >
              <option value="openrouter">OpenRouter</option>
              <option value="hermes_ai">Hermes AI</option>
            </select>
          </div>

          {provider === 'openrouter' && (
            <div className="settings-field">
              <label htmlFor="ai-api-key-input">API Key</label>
              <input
                id="ai-api-key-input"
                data-testid="ai-api-key-input"
                type="password"
                value={apiKey}
                onChange={handleApiKeyChange}
                placeholder="Enter your OpenRouter API key"
                aria-label="OpenRouter API Key"
                aria-invalid={!!apiKeyError}
                aria-describedby={apiKeyError ? 'ai-api-key-error' : undefined}
              />
              {apiKeyError && (
                <p
                  id="ai-api-key-error"
                  data-testid="ai-api-key-error"
                  className="settings-field-error"
                  role="alert"
                >
                  {apiKeyError}
                </p>
              )}
            </div>
          )}

          <div className="settings-field">
            <label htmlFor="ai-schedule-select">Schedule Interval</label>
            <select
              id="ai-schedule-select"
              data-testid="ai-schedule-select"
              value={interval ?? ''}
              onChange={handleIntervalChange}
              aria-label="Schedule Interval"
            >
              <option value="">Disabled</option>
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
            </select>
          </div>
        </div>
      )}

      <div className="settings-actions">
        <button
          data-testid="ai-save-button"
          type="button"
          className="settings-save-button"
          onClick={handleSave}
        >
          Save AI Settings
        </button>
      </div>
    </section>
  );
}

export default AIAutomationSection;
