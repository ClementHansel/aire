'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface AgentConfig {
  basePrompt: string | null; productKnowledge: string | null; skills: string | null;
  escalationNumber: string | null; maxMessagesPerDay: number;
  waProvider: 'waha' | 'kapso'; waNumber: string | null; wahaSession: string | null;
  kapsoConfigured: boolean; aiReplyEnabled: boolean;
  aiEnabled: boolean; llmProvider: 'openrouter' | 'hermes_ai'; llmKeyConfigured: boolean;
}

export default function AiAgentPage() {
  const { t } = useI18n();
  const [cfg, setCfg] = useState<AgentConfig | null>(null);
  const [kapsoApiKey, setKapsoApiKey] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
    setError('');
    try { setCfg(await api.get<AgentConfig>('/agent-config')); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.aiAgent.failedToLoad', 'Failed to load')); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const set = <K extends keyof AgentConfig>(k: K, v: AgentConfig[K]) => setCfg((c) => c ? { ...c, [k]: v } : c);

  const save = async () => {
    if (!cfg) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      const updated = await api.put<AgentConfig>('/agent-config', {
        basePrompt: cfg.basePrompt, productKnowledge: cfg.productKnowledge, skills: cfg.skills,
        escalationNumber: cfg.escalationNumber, maxMessagesPerDay: cfg.maxMessagesPerDay,
        waProvider: cfg.waProvider, waNumber: cfg.waNumber, wahaSession: cfg.wahaSession,
        aiReplyEnabled: cfg.aiReplyEnabled, ...(kapsoApiKey ? { kapsoApiKey } : {}),
        aiEnabled: cfg.aiEnabled, llmProvider: cfg.llmProvider, ...(llmApiKey ? { llmApiKey } : {}),
      });
      setCfg(updated); setKapsoApiKey(''); setLlmApiKey(''); setSaved(true);
    } catch (err) { setError(err instanceof Error ? err.message : t('dash.aiAgent.saveFailed', 'Save failed')); }
    finally { setSaving(false); }
  };

  const testConnection = async () => {
    setTesting(true); setTestResult(null);
    try {
      const res = await api.post<{ ok: boolean; provider: string; model: string; latencyMs: number; message: string }>('/agent/validate-connection');
      setTestResult({ ok: res.ok, message: res.ok ? `${res.provider} (${res.model}) · ${res.latencyMs}ms` : res.message });
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : t('dash.aiAgent.testFailed', 'Connection test failed') });
    } finally { setTesting(false); }
  };

  // AI is "on" but won't actually reach a model: OpenRouter selected with no key set
  // (and no key being entered right now). Surfaces the silent-fallback trap.
  const aiActive = !!cfg && cfg.aiReplyEnabled && cfg.aiEnabled;
  const keyMissing = !!cfg && cfg.llmProvider === 'openrouter' && !cfg.llmKeyConfigured && !llmApiKey.trim();

  if (!cfg) return <p className="text-text-muted">{t('dash.aiAgent.loading', 'Loading…')}</p>;

  return (
    <div data-testid="ai-agent-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{t('dash.aiAgent.title', 'Agentic AI')}</h1>
          <p className="mt-1 text-sm text-text-secondary">{t('dash.aiAgent.subtitle', 'Your WhatsApp connection, AI key, prompt & knowledge live here. Personas and the conversation engine (built-in or an admin-built n8n flow) are set under Agent Workflow.')}</p>
        </div>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? t('dash.aiAgent.saving', 'Saving…') : t('dash.aiAgent.saveChanges', 'Save changes')}</button>
      </div>
      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}
      {saved && <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700 mb-4">{t('dash.aiAgent.savedMsg', 'Saved.')}</div>}
      {aiActive && keyMissing && (
        <div className="rounded-lg bg-amber-50 border border-amber-300 p-3 text-sm text-amber-800 mb-4 max-w-3xl">
          <span className="font-semibold">{t('dash.aiAgent.keyWarnTitle', 'AI is on, but no OpenRouter API key is set.')}</span>{' '}
          {t('dash.aiAgent.keyWarnBody', 'Customers currently get basic template replies (no AI). Add your key in “AI model” below to enable natural replies.')}
        </div>
      )}

      <div className="space-y-5 max-w-3xl">
        {/* AI reply toggle */}
        <div className="card flex items-center justify-between">
          <div>
            <h2 className="section-title">{t('dash.aiAgent.autoReply', 'AI auto-reply')}</h2>
            <p className="section-description">{t('dash.aiAgent.autoReplyDesc', 'When off, the agent stops replying to customers (you can still chat manually).')}</p>
          </div>
          <button onClick={() => set('aiReplyEnabled', !cfg.aiReplyEnabled)} className={`relative w-12 h-7 rounded-full transition-colors ${cfg.aiReplyEnabled ? 'bg-primary-500' : 'bg-gray-300'}`}>
            <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform ${cfg.aiReplyEnabled ? 'translate-x-5' : ''}`} />
          </button>
        </div>

        {/* AI model / LLM key */}
        <div className="card">
          <div className="flex items-center justify-between mb-1">
            <h2 className="section-title">{t('dash.aiAgent.model', 'AI model')}</h2>
            <button onClick={() => set('aiEnabled', !cfg.aiEnabled)} className={`relative w-12 h-7 rounded-full transition-colors ${cfg.aiEnabled ? 'bg-primary-500' : 'bg-gray-300'}`} title={t('dash.aiAgent.aiEnabledToggle', 'Enable AI model')}>
              <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform ${cfg.aiEnabled ? 'translate-x-5' : ''}`} />
            </button>
          </div>
          <p className="section-description mb-3">{t('dash.aiAgent.modelDesc', 'The AI engine that writes replies. Use your own OpenRouter key, or a self-hosted model. Without a working model, replies fall back to fixed templates.')}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1.5">{t('dash.aiAgent.provider', 'Provider')}</label>
              <select className="input-field" value={cfg.llmProvider} onChange={(e) => set('llmProvider', e.target.value as AgentConfig['llmProvider'])}>
                <option value="openrouter">OpenRouter</option>
                <option value="hermes_ai">{t('dash.aiAgent.hermes', 'Hermes AI (self-hosted)')}</option>
              </select>
            </div>
            {cfg.llmProvider === 'openrouter' && (
              <div>
                <label className="block text-sm font-medium mb-1.5">{t('dash.aiAgent.apiKey', 'API key')} {cfg.llmKeyConfigured && <span className="text-xs text-green-600">({t('dash.aiAgent.configured', 'configured')})</span>}</label>
                <input className="input-field" type="password" value={llmApiKey} onChange={(e) => setLlmApiKey(e.target.value)} placeholder={cfg.llmKeyConfigured ? t('dash.aiAgent.keyKeep', '•••••••• (leave blank to keep)') : t('dash.aiAgent.keyEnter', 'sk-or-…')} />
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button type="button" className="btn-secondary text-sm" onClick={testConnection} disabled={testing}>{testing ? t('dash.aiAgent.testing', 'Testing…') : t('dash.aiAgent.testConnection', 'Test AI connection')}</button>
            {testResult && <span className={`text-sm ${testResult.ok ? 'text-green-600' : 'text-red-600'}`}>{testResult.ok ? '✓ ' : '✗ '}{testResult.message}</span>}
          </div>
          <p className="text-xs text-text-muted mt-2">{t('dash.aiAgent.testHint', 'Save your key first, then test. The same key powers both the built-in assistant and any n8n flow.')}</p>
        </div>

        {/* Connection */}
        <div className="card">
          <h2 className="section-title mb-3">{t('dash.aiAgent.connection', 'WhatsApp connection')}</h2>
          <div className="inline-flex rounded-md border border-border bg-surface-raised p-0.5 mb-4">
            {(['waha', 'kapso'] as const).map((p) => (
              <button key={p} onClick={() => set('waProvider', p)} className={`px-4 py-1.5 text-sm font-semibold rounded-md ${cfg.waProvider === p ? 'bg-primary-500 text-white' : 'text-text-secondary'}`}>
                {p === 'waha' ? t('dash.aiAgent.wahaOption', 'WAHA (QR scan)') : 'Kapso.com'}
              </button>
            ))}
          </div>
          {cfg.waProvider === 'waha' ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium mb-1.5">{t('dash.aiAgent.waNumber', 'WhatsApp number')}</label><input className="input-field" value={cfg.waNumber ?? ''} onChange={(e) => set('waNumber', e.target.value)} placeholder="628xxxx" /></div>
                <div><label className="block text-sm font-medium mb-1.5">{t('dash.aiAgent.wahaSession', 'WAHA session name')}</label><input className="input-field" value={cfg.wahaSession ?? ''} onChange={(e) => set('wahaSession', e.target.value)} placeholder="default" /></div>
              </div>
              <WahaConnect />
            </div>
          ) : (
            <div className="space-y-3">
              <div><label className="block text-sm font-medium mb-1.5">{t('dash.aiAgent.waNumber', 'WhatsApp number')}</label><input className="input-field" value={cfg.waNumber ?? ''} onChange={(e) => set('waNumber', e.target.value)} placeholder="628xxxx" /></div>
              <div><label className="block text-sm font-medium mb-1.5">{t('dash.aiAgent.kapsoApiKey', 'Kapso API key')} {cfg.kapsoConfigured && <span className="text-xs text-green-600">({t('dash.aiAgent.configured', 'configured')})</span>}</label><input className="input-field" type="password" value={kapsoApiKey} onChange={(e) => setKapsoApiKey(e.target.value)} placeholder={cfg.kapsoConfigured ? t('dash.aiAgent.kapsoKeep', '•••••••• (leave blank to keep)') : t('dash.aiAgent.kapsoEnter', 'Enter Kapso API key')} /></div>
            </div>
          )}
        </div>

        {/* Base prompt */}
        <div className="card">
          <h2 className="section-title mb-1">{t('dash.aiAgent.basePrompt', 'Base prompt')}</h2>
          <p className="section-description mb-3">{t('dash.aiAgent.basePromptDesc', "The agent's core persona and instructions.")}</p>
          <textarea className="input-field min-h-28" value={cfg.basePrompt ?? ''} onChange={(e) => set('basePrompt', e.target.value)} placeholder={t('dash.aiAgent.basePromptPlaceholder', 'You are the friendly assistant for AIRE Car Wash…')} />
        </div>

        {/* Product knowledge */}
        <div className="card">
          <h2 className="section-title mb-1">{t('dash.aiAgent.productKnowledge', 'Product knowledge')}</h2>
          <p className="section-description mb-3">{t('dash.aiAgent.productKnowledgeDesc', 'Opening hours, products, membership info, SOP — used to answer customers.')}</p>
          <textarea className="input-field min-h-28" value={cfg.productKnowledge ?? ''} onChange={(e) => set('productKnowledge', e.target.value)} placeholder={t('dash.aiAgent.productKnowledgePlaceholder', 'Hours: 08:00–20:00. Memberships: 1/3/12 months…')} />
        </div>

        {/* Skills */}
        <div className="card">
          <h2 className="section-title mb-1">{t('dash.aiAgent.skills', 'Agent skills')}</h2>
          <p className="section-description mb-3">{t('dash.aiAgent.skillsDesc', 'What the agent is allowed to do (one per line).')}</p>
          <textarea className="input-field min-h-20" value={cfg.skills ?? ''} onChange={(e) => set('skills', e.target.value)} placeholder={t('dash.aiAgent.skillsPlaceholder', 'Answer membership status\nShare pricing\nCheck voucher validity')} />
        </div>

        {/* Limits + escalation */}
        <div className="card grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">{t('dash.aiAgent.maxMessages', 'Max messages per user / day')}</label>
            <input type="number" className="input-field" value={cfg.maxMessagesPerDay} onChange={(e) => set('maxMessagesPerDay', Number(e.target.value))} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">{t('dash.aiAgent.escalationNumber', 'Escalation number')}</label>
            <input className="input-field" value={cfg.escalationNumber ?? ''} onChange={(e) => set('escalationNumber', e.target.value)} placeholder={t('dash.aiAgent.escalationPlaceholder', '628xxxx (admin/supervisor)')} />
          </div>
        </div>
      </div>
    </div>
  );
}

function WahaConnect() {
  const { t } = useI18n();
  const [status, setStatus] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    try { const s = await api.get<{ status: string }>('/whatsapp/status'); setStatus(s.status); } catch { setStatus('unreachable'); }
  };
  useEffect(() => { refresh(); }, []);

  const connect = async () => {
    setLoading(true);
    try {
      await api.post('/whatsapp/connect', {});
      const res = await api.get<{ qr: string | null; status: string }>('/whatsapp/qr');
      setQr(res.qr); setStatus(res.status);
    } catch { setStatus('unreachable'); }
    finally { setLoading(false); }
  };

  return (
    <div className="rounded-lg bg-surface-sunken p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-text-secondary">{t('dash.aiAgent.connectionStatus', 'Connection status:')} <span className="font-medium text-text-primary">{status || '—'}</span></span>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost text-xs" onClick={refresh}>{t('dash.aiAgent.refresh', 'Refresh')}</button>
          <button type="button" className="btn-primary text-xs py-1" onClick={connect} disabled={loading}>{loading ? t('dash.aiAgent.connecting', 'Connecting…') : t('dash.aiAgent.connectGetQr', 'Connect / Get QR')}</button>
        </div>
      </div>
      {qr && (
        <div className="mt-3 text-center">
          <p className="text-xs text-text-muted mb-2">{t('dash.aiAgent.scanQr', 'Scan this with WhatsApp on the agent phone')}</p>
          <img src={qr} alt={t('dash.aiAgent.qrAlt', 'WhatsApp QR')} className="mx-auto rounded-lg border border-border" width={240} height={240} />
        </div>
      )}
      <p className="text-xs text-text-muted mt-2">{t('dash.aiAgent.wahaHint', 'Save your number & session above first. The QR comes from your WAHA service; once scanned, the agent is live.')}</p>
    </div>
  );
}
