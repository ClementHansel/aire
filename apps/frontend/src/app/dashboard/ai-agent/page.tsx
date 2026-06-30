'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

interface AgentConfig {
  basePrompt: string | null; productKnowledge: string | null; skills: string | null;
  escalationNumber: string | null; maxMessagesPerDay: number;
  waProvider: 'waha' | 'kapso'; waNumber: string | null; wahaSession: string | null;
  kapsoConfigured: boolean; aiReplyEnabled: boolean;
}

export default function AiAgentPage() {
  const [cfg, setCfg] = useState<AgentConfig | null>(null);
  const [kapsoApiKey, setKapsoApiKey] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try { setCfg(await api.get<AgentConfig>('/agent-config')); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
  }, []);
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
      });
      setCfg(updated); setKapsoApiKey(''); setSaved(true);
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  };

  if (!cfg) return <p className="text-text-muted">Loading…</p>;

  return (
    <div data-testid="ai-agent-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Agentic AI</h1>
          <p className="mt-1 text-sm text-text-secondary">Configure the WhatsApp AI agent — connection, prompt, knowledge, skills, and escalation.</p>
        </div>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>
      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}
      {saved && <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700 mb-4">Saved.</div>}

      <div className="space-y-5 max-w-3xl">
        {/* AI reply toggle */}
        <div className="card flex items-center justify-between">
          <div>
            <h2 className="section-title">AI auto-reply</h2>
            <p className="section-description">When off, the agent stops replying to customers (you can still chat manually).</p>
          </div>
          <button onClick={() => set('aiReplyEnabled', !cfg.aiReplyEnabled)} className={`relative w-12 h-7 rounded-full transition-colors ${cfg.aiReplyEnabled ? 'bg-primary-500' : 'bg-gray-300'}`}>
            <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform ${cfg.aiReplyEnabled ? 'translate-x-5' : ''}`} />
          </button>
        </div>

        {/* Connection */}
        <div className="card">
          <h2 className="section-title mb-3">WhatsApp connection</h2>
          <div className="inline-flex rounded-full border border-border bg-surface-raised p-0.5 mb-4">
            {(['waha', 'kapso'] as const).map((p) => (
              <button key={p} onClick={() => set('waProvider', p)} className={`px-4 py-1.5 text-sm font-semibold rounded-full ${cfg.waProvider === p ? 'bg-primary-500 text-white' : 'text-text-secondary'}`}>
                {p === 'waha' ? 'WAHA (QR scan)' : 'Kapso.com'}
              </button>
            ))}
          </div>
          {cfg.waProvider === 'waha' ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium mb-1.5">WhatsApp number</label><input className="input-field" value={cfg.waNumber ?? ''} onChange={(e) => set('waNumber', e.target.value)} placeholder="628xxxx" /></div>
                <div><label className="block text-sm font-medium mb-1.5">WAHA session name</label><input className="input-field" value={cfg.wahaSession ?? ''} onChange={(e) => set('wahaSession', e.target.value)} placeholder="default" /></div>
              </div>
              <div className="rounded-lg bg-surface-sunken p-3 text-xs text-text-secondary">
                Connect by scanning the QR from your WAHA instance for this session. (Live QR display requires the WAHA service to be running; settings are stored here.)
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div><label className="block text-sm font-medium mb-1.5">WhatsApp number</label><input className="input-field" value={cfg.waNumber ?? ''} onChange={(e) => set('waNumber', e.target.value)} placeholder="628xxxx" /></div>
              <div><label className="block text-sm font-medium mb-1.5">Kapso API key {cfg.kapsoConfigured && <span className="text-xs text-green-600">(configured)</span>}</label><input className="input-field" type="password" value={kapsoApiKey} onChange={(e) => setKapsoApiKey(e.target.value)} placeholder={cfg.kapsoConfigured ? '•••••••• (leave blank to keep)' : 'Enter Kapso API key'} /></div>
            </div>
          )}
        </div>

        {/* Base prompt */}
        <div className="card">
          <h2 className="section-title mb-1">Base prompt</h2>
          <p className="section-description mb-3">The agent&apos;s core persona and instructions.</p>
          <textarea className="input-field min-h-28" value={cfg.basePrompt ?? ''} onChange={(e) => set('basePrompt', e.target.value)} placeholder="You are the friendly assistant for AIRE Car Wash…" />
        </div>

        {/* Product knowledge */}
        <div className="card">
          <h2 className="section-title mb-1">Product knowledge</h2>
          <p className="section-description mb-3">Opening hours, products, membership info, SOP — used to answer customers.</p>
          <textarea className="input-field min-h-28" value={cfg.productKnowledge ?? ''} onChange={(e) => set('productKnowledge', e.target.value)} placeholder="Hours: 08:00–20:00. Memberships: 1/3/12 months…" />
        </div>

        {/* Skills */}
        <div className="card">
          <h2 className="section-title mb-1">Agent skills</h2>
          <p className="section-description mb-3">What the agent is allowed to do (one per line).</p>
          <textarea className="input-field min-h-20" value={cfg.skills ?? ''} onChange={(e) => set('skills', e.target.value)} placeholder={'Answer membership status\nShare pricing\nCheck voucher validity'} />
        </div>

        {/* Limits + escalation */}
        <div className="card grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Max messages per user / day</label>
            <input type="number" className="input-field" value={cfg.maxMessagesPerDay} onChange={(e) => set('maxMessagesPerDay', Number(e.target.value))} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Escalation number</label>
            <input className="input-field" value={cfg.escalationNumber ?? ''} onChange={(e) => set('escalationNumber', e.target.value)} placeholder="628xxxx (admin/supervisor)" />
          </div>
        </div>
      </div>
    </div>
  );
}
