'use client';

import { useState, useCallback } from 'react';

/**
 * Settings page for tenant automation configuration.
 * Requirements: 11.1, 11.2, 11.6
 */

export default function SettingsPage() {
  const [aiEnabled, setAiEnabled] = useState(false);
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [provider, setProvider] = useState<'hermes_ai' | 'openrouter'>('hermes_ai');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const validatePhone = useCallback((value: string) => {
    if (!value) { setPhoneError(''); return; }
    if (!/^\+[1-9]\d{1,14}$/.test(value)) {
      setPhoneError('Invalid format. Use E.164 (e.g. +628123456789)');
    } else {
      setPhoneError('');
    }
  }, []);

  return (
    <div data-testid="settings-page">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-text-primary" data-testid="settings-page-title">Settings</h1>
        <p className="mt-1 text-sm text-text-secondary">Configure your automation, integrations, and devices.</p>
      </div>

      <div className="space-y-6 max-w-3xl">
        {/* WhatsApp Integration */}
        <section className="card" data-testid="settings-section-whatsapp">
          <h2 className="section-title">WhatsApp Integration</h2>
          <p className="section-description">Send notifications from your business WhatsApp number.</p>
          <div className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">Phone Number (E.164)</label>
              <input
                type="tel"
                placeholder="+628123456789"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); validatePhone(e.target.value); }}
                className="input-field"
                data-testid="whatsapp-phone-input"
              />
              {phoneError && <p className="mt-1 text-xs text-error" data-testid="whatsapp-phone-error">{phoneError}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">API Token</label>
              <input type="password" placeholder="••••••••••••" className="input-field" data-testid="whatsapp-token-input" />
            </div>
            <button className="btn-primary" data-testid="whatsapp-save-button" onClick={() => setSaveSuccess(true)}>
              Save WhatsApp Settings
            </button>
            {saveSuccess && <p className="text-sm text-success" data-testid="whatsapp-save-success">Saved successfully!</p>}
          </div>
        </section>

        {/* AI Automation */}
        <section className="card" data-testid="settings-section-ai-automation">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="section-title">AI Automation</h2>
              <p className="section-description">Enable AI-powered insights and actions.</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={aiEnabled}
                onChange={() => setAiEnabled(!aiEnabled)}
                className="sr-only peer"
                data-testid="ai-global-toggle"
              />
              <div className="w-11 h-6 bg-border-strong rounded-full peer peer-checked:bg-primary-500 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
            </label>
          </div>

          {aiEnabled && (
            <div className="mt-5 pt-5 border-t border-border space-y-4" data-testid="ai-hidden-when-off">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">LLM Provider</label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as 'hermes_ai' | 'openrouter')}
                  className="input-field"
                  data-testid="ai-llm-provider-select"
                >
                  <option value="hermes_ai">Hermes AI (Local)</option>
                  <option value="openrouter">OpenRouter (Cloud)</option>
                </select>
              </div>

              {provider === 'openrouter' && (
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1.5">API Key</label>
                  <input type="password" placeholder="sk-or-..." className="input-field" data-testid="ai-api-key-input" />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">Schedule Interval</label>
                <select className="input-field" data-testid="ai-schedule-select">
                  <option value="">Disabled</option>
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                </select>
              </div>

              <button className="btn-primary" data-testid="ai-save-button">Save AI Settings</button>
            </div>
          )}
        </section>

        {/* Automation Controls */}
        <section className="card" data-testid="settings-section-automation-controls">
          <h2 className="section-title">Automation Controls</h2>
          <p className="section-description">Toggle individual AI capabilities on or off.</p>
          <div className="mt-4 space-y-3">
            {[
              { key: 'campaigns', label: 'Campaigns', desc: 'Auto-create marketing campaigns' },
              { key: 'retention_offers', label: 'Retention Offers', desc: 'Send offers to at-risk customers' },
              { key: 'pricing_suggestions', label: 'Pricing Suggestions', desc: 'AI-powered pricing recommendations' },
              { key: 'anomaly_alerts', label: 'Anomaly Alerts', desc: 'Detect unusual patterns' },
              { key: 'queue_optimization', label: 'Queue Optimization', desc: 'Optimize service queue priorities' },
              { key: 'membership_recommendations', label: 'Membership Recs', desc: 'Personalized plan suggestions' },
            ].map((item) => (
              <div key={item.key} className="flex items-center justify-between p-3 rounded-lg border border-border" data-testid={`toggle-card-${item.key}`}>
                <div>
                  <p className="text-sm font-medium text-text-primary">{item.label}</p>
                  <p className="text-xs text-text-muted" data-testid={`toggle-description-${item.key}`}>{item.desc}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!aiEnabled}
                    className="sr-only peer"
                    data-testid={`toggle-switch-${item.key}`}
                  />
                  <div className="w-9 h-5 bg-border-strong rounded-full peer peer-checked:bg-primary-500 peer-disabled:opacity-40 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full"></div>
                </label>
              </div>
            ))}
            {!aiEnabled && (
              <p className="text-xs text-text-muted italic mt-2">Enable AI Automation above to configure individual controls.</p>
            )}
          </div>
        </section>

        {/* Device Discovery */}
        <section className="card" data-testid="settings-section-device-discovery">
          <h2 className="section-title">Device Discovery</h2>
          <p className="section-description">Scan your network for cameras, IoT controllers, and routers.</p>
          <div className="mt-4">
            <button className="btn-secondary" data-testid="scan-button">
              🔍 Scan Network
            </button>
            <p className="mt-3 text-sm text-text-muted italic">No devices discovered yet. Run a scan to find devices on your network.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
