'use client';

/**
 * Agent Workflow — manage the tenant's line-up of AI agents (personal assistant,
 * customer service, etc.) shown as a simple left-to-right flow. This is the
 * management foundation; live routing runs through the WhatsApp/agent-config layer.
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

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

function AgentModal({ initial, onClose, onSaved }: { initial: Agent | null; onClose: () => void; onSaved: () => void }) {
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
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-4">{initial ? 'Edit Agent' : 'New Agent'}</h3>
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium mb-1.5">Agent name</label>
            <input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="KADEK" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Role</label>
            <select className="input-field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as AgentRole })}>
              {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Description</label>
            <input className="input-field" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Front-line greeter and FAQ assistant" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Prompt / instructions</label>
            <textarea className="input-field" rows={4} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} placeholder="You are KADEK, the friendly front desk assistant for AIRE…" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active
          </label>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : initial ? 'Update' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<{ open: boolean; editing: Agent | null }>({ open: false, editing: null });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setAgents(await api.get<Agent[]>('/agents')); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (a: Agent) => {
    try { await api.put(`/agents/${a.id}`, { isActive: !a.isActive }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  };
  const remove = async (id: string) => {
    if (!confirm('Delete this agent?')) return;
    try { await api.delete(`/agents/${id}`); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Delete failed'); }
  };

  const activeCount = agents.filter((a) => a.isActive).length;

  return (
    <div data-testid="agents-page">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-text-primary">Agent Workflow</h1>
        <button className="btn-primary" onClick={() => setModal({ open: true, editing: null })}>+ Add Agent</button>
      </div>
      <p className="text-sm text-text-secondary mb-6">{agents.length} agent{agents.length !== 1 ? 's' : ''} · {activeCount} active</p>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {loading ? (
        <div className="card text-sm text-text-muted">Loading…</div>
      ) : agents.length === 0 ? (
        <div className="card text-sm text-text-muted">No agents yet. Click &quot;Add Agent&quot; to define your first one.</div>
      ) : (
        <div className="flex items-stretch gap-3 overflow-x-auto pb-4">
          {/* Start node */}
          <div className="flex items-center shrink-0">
            <div className="bg-green-500 text-white rounded-xl px-4 py-3 text-sm font-semibold shadow-sm">● Start</div>
            <span className="text-text-muted mx-1">→</span>
          </div>
          {agents.map((a, idx) => (
            <div key={a.id} className="flex items-center shrink-0">
              <div className={`card w-60 ${a.isActive ? '' : 'opacity-60'}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-lg shrink-0 ${ROLE_ACCENT[a.role]}`}>🤖</div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-text-primary truncate">{a.name}</p>
                    <p className="text-xs text-text-muted uppercase tracking-wide">{ROLE_LABEL[a.role]}</p>
                  </div>
                </div>
                {a.description && <p className="text-xs text-text-secondary mt-2">{a.description}</p>}
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-border">
                  <button onClick={() => toggle(a)} className={`badge text-xs ${a.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {a.isActive ? '● Active' : '○ Inactive'}
                  </button>
                  <div className="flex gap-1">
                    <button className="btn-ghost text-xs" onClick={() => setModal({ open: true, editing: a })}>✎</button>
                    <button className="btn-ghost text-xs text-red-600" onClick={() => remove(a.id)}>🗑</button>
                  </div>
                </div>
              </div>
              {idx < agents.length - 1 && <span className="text-text-muted mx-1">→</span>}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-text-muted mt-4">Agents handle WhatsApp conversations in order; an inactive agent is skipped. Connection &amp; knowledge are configured under Agentic AI.</p>

      {modal.open && <AgentModal initial={modal.editing} onClose={() => setModal({ open: false, editing: null })} onSaved={() => { setModal({ open: false, editing: null }); load(); }} />}
    </div>
  );
}
