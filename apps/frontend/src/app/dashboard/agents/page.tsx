'use client';

/**
 * Agent Workflow — manage the tenant's line-up of AI agents (personal assistant,
 * customer service, etc.) shown as a simple left-to-right flow. This is the
 * management foundation; live routing runs through the WhatsApp/agent-config layer.
 */

import { useState, useEffect, useCallback } from 'react';
import { Bot, Pencil, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type AgentRole = 'personal_assistant' | 'customer_service' | 'sales' | 'supervisor';
interface Agent { id: string; name: string; role: AgentRole; description: string | null; prompt: string | null; isActive: boolean; position: number }

const ROLE_LABEL: Record<AgentRole, string> = {
  personal_assistant: 'Personal Assistant',
  customer_service: 'Customer Service',
  sales: 'Sales',
  supervisor: 'Supervisor',
};
const ROLE_ACCENT: Record<AgentRole, string> = {
  personal_assistant: 'bg-blue-500',
  customer_service: 'bg-orange-500',
  sales: 'bg-emerald-500',
  supervisor: 'bg-violet-500',
};

// Which customer-scoped tools each persona role may use. Mirrors the backend
// PERSONA_TOOLS map (whatsapp/customer-tools.ts) — personas GATE tools, so the
// brain only ever runs a conversation with this role's allowed capabilities.
const ROLE_TOOLS: Record<AgentRole, string[]> = {
  personal_assistant: ['My data', 'Prices', 'Plans', 'Promos', 'Book', 'Escalate'],
  customer_service: ['My data', 'Prices', 'Plans', 'Promos', 'Escalate'],
  sales: ['My data', 'Prices', 'Plans', 'Promos', 'Book', 'Escalate'],
  supervisor: ['My data', 'Prices', 'Plans', 'Promos', 'Book', 'Escalate'],
};

function AgentModal({ initial, onClose, onSaved }: { initial: Agent | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    role: (initial?.role ?? 'personal_assistant') as AgentRole,
    description: initial?.description ?? '',
    prompt: initial?.prompt ?? '',
    isActive: initial?.isActive ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    const payload = { ...form, description: form.description || null, prompt: form.prompt || null };
    try {
      if (initial) await api.put(`/agents/${initial.id}`, payload);
      else await api.post('/agents', payload);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : t('dash.agents.saveFailed', 'Save failed')); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-4">{initial ? t('dash.agents.editAgent', 'Edit Agent') : t('dash.agents.newAgent', 'New Agent')}</h3>
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium mb-1.5">{t('dash.agents.agentName', 'Agent name')}</label>
            <input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="KADEK" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">{t('dash.agents.role', 'Role')}</label>
            <select className="input-field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as AgentRole })}>
              {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">{t('dash.agents.description', 'Description')}</label>
            <input className="input-field" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t('dash.agents.descriptionPlaceholder', 'Front-line greeter and FAQ assistant')} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">{t('dash.agents.promptInstructions', 'Prompt / instructions')}</label>
            <textarea className="input-field" rows={4} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} placeholder={t('dash.agents.promptPlaceholder', 'You are KADEK, the friendly front desk assistant for AIRE…')} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> {t('dash.agents.active', 'Active')}
          </label>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>{t('dash.agents.cancel', 'Cancel')}</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? t('dash.agents.saving', 'Saving…') : initial ? t('dash.agents.update', 'Update') : t('dash.agents.create', 'Create')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

type FlowKind = 'whatsapp' | 'automation';
interface AgentFlow { id: string; label: string; description: string | null; kind: FlowKind }
interface FlowSelection { routingMode: 'builtin' | 'n8n'; whatsappFlowId: string | null; automationFlowId: string | null; bridgeConfigured: boolean }

const N8N_URL = process.env.NEXT_PUBLIC_N8N_URL || 'https://flows.useairin.id';

/**
 * Flow routing panel — lets the tenant point their WhatsApp assistant at an
 * admin-built n8n flow (or keep the built-in one). Persona names & prompts below
 * are injected into the flow, so one shared flow serves every tenant.
 */
function FlowRoutingPanel() {
  const { t } = useI18n();
  const [sel, setSel] = useState<FlowSelection | null>(null);
  const [flows, setFlows] = useState<AgentFlow[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, f] = await Promise.all([
        api.get<FlowSelection>('/agent-flow-selection'),
        api.get<AgentFlow[]>('/agent-flow-selection/available'),
      ]);
      setSel(s); setFlows(f);
    } catch (err) { setError(err instanceof Error ? err.message : t('dash.agents.flow.loadFailed', 'Failed to load flow settings')); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  if (!sel) return null;
  const whatsappFlows = flows.filter((f) => f.kind === 'whatsapp');
  const automationFlows = flows.filter((f) => f.kind === 'automation');

  const save = async () => {
    setSaving(true); setError(''); setMsg('');
    try {
      const updated = await api.put<FlowSelection>('/agent-flow-selection', {
        routingMode: sel.routingMode, whatsappFlowId: sel.whatsappFlowId, automationFlowId: sel.automationFlowId,
      });
      setSel(updated); setMsg(t('dash.agents.flow.saved', 'Saved.'));
    } catch (err) { setError(err instanceof Error ? err.message : t('dash.agents.flow.saveFailed', 'Save failed')); }
    finally { setSaving(false); }
  };
  const genToken = async () => {
    setError('');
    try { const r = await api.post<{ token: string }>('/agent-flow-selection/token', {}); setToken(r.token); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.agents.flow.tokenFailed', 'Could not generate token')); }
  };

  return (
    <div className="card mb-6">
      <div>
        <h2 className="section-title">{t('dash.agents.flow.title', 'Agent engine')}</h2>
        <p className="section-description">{t('dash.agents.flow.subtitle', 'Use the built-in assistant, or run a drag-and-drop flow built in n8n. Your personas below (names & prompts) are injected into the flow.')}</p>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mt-3">{error}</div>}
      {msg && <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700 mt-3">{msg}</div>}

      <div className="inline-flex rounded-md border border-border bg-surface-raised p-0.5 my-4">
        {(['builtin', 'n8n'] as const).map((m) => (
          <button key={m} onClick={() => setSel({ ...sel, routingMode: m })}
            className={`px-4 py-1.5 text-sm font-semibold rounded-md ${sel.routingMode === m ? 'bg-primary-500 text-white' : 'text-text-secondary'}`}>
            {m === 'builtin' ? t('dash.agents.flow.builtin', 'Built-in assistant') : t('dash.agents.flow.n8n', 'n8n flow')}
          </button>
        ))}
      </div>

      {sel.routingMode === 'n8n' && (
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1.5">{t('dash.agents.flow.whatsappFlow', 'WhatsApp conversation flow')}</label>
              <select className="input-field" value={sel.whatsappFlowId ?? ''} onChange={(e) => setSel({ ...sel, whatsappFlowId: e.target.value || null })}>
                <option value="">{t('dash.agents.flow.none', 'None (falls back to built-in)')}</option>
                {whatsappFlows.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">{t('dash.agents.flow.automationFlow', 'Automation flow (optional)')}</label>
              <select className="input-field" value={sel.automationFlowId ?? ''} onChange={(e) => setSel({ ...sel, automationFlowId: e.target.value || null })}>
                <option value="">{t('dash.agents.flow.none2', 'None')}</option>
                {automationFlows.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>
          </div>

          <div className="rounded-lg bg-surface-sunken p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t('dash.agents.flow.connToken', 'Connection token')} {sel.bridgeConfigured && !token && <span className="text-xs text-green-600">({t('dash.agents.flow.configured', 'configured')})</span>}</p>
                <p className="text-xs text-text-muted">{t('dash.agents.flow.connTokenHint', 'Paste this into the AIRE credential in n8n so your flow can read data & send replies. Shown once.')}</p>
              </div>
              <button type="button" className="btn-secondary text-xs" onClick={genToken}>{sel.bridgeConfigured ? t('dash.agents.flow.rotate', 'Rotate') : t('dash.agents.flow.generate', 'Generate')}</button>
            </div>
            {token && (
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 text-xs bg-surface-raised border border-border rounded px-2 py-1.5 break-all">{token}</code>
                <button type="button" className="btn-ghost text-xs" onClick={() => navigator.clipboard?.writeText(token)}>{t('dash.agents.flow.copy', 'Copy')}</button>
              </div>
            )}
          </div>

          <p className="text-xs text-text-muted">{t('dash.agents.flow.builderHint', 'Flows are built by the platform team in n8n.')} <a className="text-primary-600 underline" href={N8N_URL} target="_blank" rel="noreferrer">{t('dash.agents.flow.openBuilder', 'Open builder ↗')}</a></p>
        </div>
      )}

      <div className="flex justify-end mt-4">
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? t('dash.agents.flow.saving', 'Saving…') : t('dash.agents.flow.save', 'Save engine settings')}</button>
      </div>
    </div>
  );
}

export default function AgentsPage() {
  const { t } = useI18n();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<{ open: boolean; editing: Agent | null }>({ open: false, editing: null });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setAgents(await api.get<Agent[]>('/agents')); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.agents.failedToLoad', 'Failed to load')); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const toggle = async (a: Agent) => {
    try { await api.put(`/agents/${a.id}`, { isActive: !a.isActive }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.agents.failed', 'Failed')); }
  };
  const remove = async (id: string) => {
    if (!confirm(t('dash.agents.confirmDelete', 'Delete this agent?'))) return;
    try { await api.delete(`/agents/${id}`); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.agents.deleteFailed', 'Delete failed')); }
  };

  const activeCount = agents.filter((a) => a.isActive).length;

  return (
    <div data-testid="agents-page">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-text-primary">{t('dash.agents.title', 'Agent Workflow')}</h1>
        <button className="btn-primary" onClick={() => setModal({ open: true, editing: null })}>+ {t('dash.agents.addAgent', 'Add Agent')}</button>
      </div>
      <p className="text-sm text-text-secondary mb-6">{agents.length} {agents.length !== 1 ? t('dash.agents.agentsWord', 'agents') : t('dash.agents.agentWord', 'agent')} · {activeCount} {t('dash.agents.activeWord', 'active')}</p>

      <FlowRoutingPanel />

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {loading ? (
        <div className="card text-sm text-text-muted">{t('dash.agents.loading', 'Loading…')}</div>
      ) : agents.length === 0 ? (
        <div className="card text-sm text-text-muted">{t('dash.agents.empty', 'No agents yet. Click "Add Agent" to define your first one.')}</div>
      ) : (
        <div className="flex items-stretch gap-3 overflow-x-auto pb-4">
          {/* Start node */}
          <div className="flex items-center shrink-0">
            <div className="bg-green-500 text-white rounded-xl px-4 py-3 text-sm font-semibold shadow-sm">● {t('dash.agents.start', 'Start')}</div>
            <span className="text-text-muted mx-1">→</span>
          </div>
          {agents.map((a, idx) => (
            <div key={a.id} className="flex items-center shrink-0">
              <div className={`card w-60 ${a.isActive ? '' : 'opacity-60'}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0 ${ROLE_ACCENT[a.role]}`}><Bot className="w-5 h-5" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-text-primary truncate">{a.name}</p>
                    <p className="text-xs text-text-muted uppercase tracking-wide">{ROLE_LABEL[a.role]}</p>
                  </div>
                </div>
                {a.description && <p className="text-xs text-text-secondary mt-2">{a.description}</p>}
                <div className="flex flex-wrap gap-1 mt-2">
                  {(ROLE_TOOLS[a.role] ?? []).map((tool) => (
                    <span key={tool} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-sunken text-text-muted">{tool}</span>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-border">
                  <button onClick={() => toggle(a)} className={`badge text-xs ${a.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {a.isActive ? t('dash.agents.badgeActive', '● Active') : t('dash.agents.badgeInactive', '○ Inactive')}
                  </button>
                  <div className="flex gap-1">
                    <button className="btn-ghost text-xs" onClick={() => setModal({ open: true, editing: a })}><Pencil className="w-4 h-4" /></button>
                    <button className="btn-ghost text-xs text-red-600" onClick={() => remove(a.id)}><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
              {idx < agents.length - 1 && <span className="text-text-muted mx-1">→</span>}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-text-muted mt-4">{t('dash.agents.footer', 'Each persona is the brain for its conversations, running only the customer-scoped tools shown on its card (chips above). The engine can be the built-in assistant or an admin-built n8n flow (Agent engine, above). Your WhatsApp number, AI key & knowledge live under Agentic AI (WhatsApp).')}</p>

      {modal.open && <AgentModal initial={modal.editing} onClose={() => setModal({ open: false, editing: null })} onSaved={() => { setModal({ open: false, editing: null }); load(); }} />}
    </div>
  );
}
