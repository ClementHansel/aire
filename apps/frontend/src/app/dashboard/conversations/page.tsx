'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';

interface Conversation { id: string; customerName: string | null; customerPhone: string | null; aiEnabled: boolean; status: string; summary: string | null; lastMessageAt: string | null }
interface Message { direction: 'inbound' | 'outbound'; body: string; fromAi: boolean; createdAt: string }

export default function ConversationsPage() {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [simOpen, setSimOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const loadConvs = useCallback(async () => {
    try { setConvs(await api.get<Conversation[]>('/whatsapp/conversations')); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    try { setMessages(await api.get<Message[]>(`/whatsapp/conversations/${id}/messages`)); }
    catch { /* ignore */ }
  }, []);

  useEffect(() => { loadConvs(); const t = setInterval(loadConvs, 6000); return () => clearInterval(t); }, [loadConvs]);
  useEffect(() => {
    if (!active) return;
    loadMessages(active.id);
    const t = setInterval(() => loadMessages(active.id), 4000);
    return () => clearInterval(t);
  }, [active, loadMessages]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const toggleAi = async (c: Conversation) => {
    try { await api.patch(`/whatsapp/conversations/${c.id}`, { aiEnabled: !c.aiEnabled }); await loadConvs(); if (active?.id === c.id) setActive({ ...c, aiEnabled: !c.aiEnabled }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  };
  const newSession = async (c: Conversation) => {
    if (!confirm('Start a new session (close this conversation)?')) return;
    try { await api.post(`/whatsapp/conversations/${c.id}/new-session`, {}); await loadConvs(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  };
  const summarize = async (c: Conversation) => {
    try { const s = await api.post<string>(`/whatsapp/conversations/${c.id}/summary`, {}); await loadConvs(); alert(typeof s === 'string' ? s : JSON.stringify(s)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  };
  const send = async () => {
    if (!active || !reply.trim()) return;
    try { await api.post(`/whatsapp/conversations/${active.id}/send`, { text: reply.trim() }); setReply(''); await loadMessages(active.id); }
    catch (err) { setError(err instanceof Error ? err.message : 'Send failed'); }
  };

  return (
    <div data-testid="conversations-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Conversation Log</h1>
          <p className="mt-1 text-sm text-text-secondary">Realtime customer ↔ AI WhatsApp conversations.</p>
        </div>
        <button className="btn-secondary" onClick={() => setSimOpen(true)}>Simulate inbound</button>
      </div>
      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      <div className="grid lg:grid-cols-3 gap-5" style={{ minHeight: '60vh' }}>
        {/* Conversation list */}
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-border"><h2 className="text-sm font-semibold">Conversations ({convs.length})</h2></div>
          <div className="divide-y divide-border max-h-[70vh] overflow-auto">
            {convs.length === 0 ? <p className="p-4 text-sm text-text-muted">No conversations yet.</p> : convs.map((c) => (
              <button key={c.id} onClick={() => setActive(c)} className={`w-full text-left px-4 py-3 hover:bg-surface-sunken ${active?.id === c.id ? 'bg-primary-50' : ''}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-text-primary">{c.customerName || c.customerPhone}</span>
                  <span className={`badge ${c.status === 'escalated' ? 'bg-amber-50 text-amber-700' : c.status === 'closed' ? 'bg-gray-100 text-gray-500' : 'bg-green-50 text-green-700'}`}>{c.status}</span>
                </div>
                <p className="text-xs text-text-muted mt-0.5">{c.customerPhone} · AI {c.aiEnabled ? 'on' : 'off'}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Active conversation */}
        <div className="card p-0 overflow-hidden lg:col-span-2 flex flex-col">
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-sm text-text-muted">Select a conversation.</div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">{active.customerName || active.customerPhone}</p>
                  <p className="text-xs text-text-muted">{active.customerPhone}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button className={`btn-ghost text-xs ${active.aiEnabled ? 'text-green-600' : 'text-amber-600'}`} onClick={() => toggleAi(active)}>{active.aiEnabled ? 'AI: ON (stop)' : 'AI: OFF (start)'}</button>
                  <button className="btn-ghost text-xs" onClick={() => summarize(active)}>Summary</button>
                  <button className="btn-ghost text-xs text-red-600" onClick={() => newSession(active)}>New session</button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4 space-y-2 bg-surface-sunken/30 max-h-[55vh]">
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${m.direction === 'outbound' ? 'bg-primary-500 text-white' : 'bg-surface-raised border border-border text-text-primary'}`}>
                      {m.body}
                      <div className={`text-[10px] mt-1 ${m.direction === 'outbound' ? 'text-primary-100' : 'text-text-muted'}`}>{m.fromAi ? '🤖 AI · ' : ''}{new Date(m.createdAt).toLocaleTimeString()}</div>
                    </div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              <div className="p-3 border-t border-border flex gap-2">
                <input className="input-field flex-1" placeholder="Type a manual reply…" value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} />
                <button className="btn-primary" onClick={send}>Send</button>
              </div>
            </>
          )}
        </div>
      </div>

      {simOpen && <SimulateModal onClose={() => setSimOpen(false)} onSent={() => { setSimOpen(false); loadConvs(); }} />}
    </div>
  );
}

function SimulateModal({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [from, setFrom] = useState('628123456789');
  const [name, setName] = useState('Test Customer');
  const [text, setText] = useState('Halo, jam buka berapa?');
  const [err, setErr] = useState('');
  const submit = async () => {
    try { await api.post('/whatsapp/simulate-inbound', { from, name, text }); onSent(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-4">Simulate inbound message</h3>
        {err && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-3">{err}</div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium mb-1.5">From (phone)</label><input className="input-field" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="block text-sm font-medium mb-1.5">Name</label><input className="input-field" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="block text-sm font-medium mb-1.5">Message</label><input className="input-field" value={text} onChange={(e) => setText(e.target.value)} /></div>
        </div>
        <div className="flex gap-2 justify-end mt-4">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit}>Send</button>
        </div>
      </div>
    </div>
  );
}
