'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface Conversation { id: string; customerName: string | null; customerPhone: string | null; aiEnabled: boolean; status: string; summary: string | null; lastMessageAt: string | null }
interface Message { direction: 'inbound' | 'outbound'; body: string; fromAi: boolean; persona: string | null; createdAt: string }
interface AiHealth { aiReplyEnabled: boolean; aiEnabled: boolean; llmProvider: 'openrouter' | 'hermes_ai'; llmKeyConfigured: boolean }
interface WaStatus { status: string; mock: boolean }
interface MockOutboxEntry { id: string; provider: string; chatId: string; toPhone: string | null; body: string; session: string | null; createdAt: string }
interface PendingApproval { bookingId: string; ref: string; summary: string; customerPhone: string; proposedAt: string }
interface ApprovalHistory { bookingId: string; summary: string; customerPhone: string; decision: 'confirmed' | 'cancelled'; channel: 'whatsapp' | 'dashboard'; decidedBy: string | null; decidedAt: string }

export default function ConversationsPage() {
  const { t } = useI18n();
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [simOpen, setSimOpen] = useState(false);
  const [outboxOpen, setOutboxOpen] = useState(false);
  const [health, setHealth] = useState<AiHealth | null>(null);
  const [mock, setMock] = useState(false);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [history, setHistory] = useState<ApprovalHistory[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const loadConvs = useCallback(async () => {
    try { setConvs(await api.get<Conversation[]>('/whatsapp/conversations')); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.conversations.failedToLoad', 'Failed to load')); }
  }, [t]);

  const loadApprovals = useCallback(async () => {
    try { setApprovals(await api.get<PendingApproval[]>('/whatsapp/pending-approvals')); }
    catch { /* non-fatal */ }
  }, []);

  const loadHistory = useCallback(async () => {
    try { setHistory(await api.get<ApprovalHistory[]>('/whatsapp/booking-approvals/history')); }
    catch { /* non-fatal */ }
  }, []);

  const decide = async (bookingId: string, accept: boolean) => {
    try { await api.post(`/whatsapp/pending-approvals/${bookingId}/decision`, { accept }); await loadApprovals(); await loadConvs(); await loadHistory(); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.conversations.failed', 'Failed')); }
  };

  useEffect(() => { api.get<AiHealth>('/agent-config').then(setHealth).catch(() => {}); }, []);
  useEffect(() => { api.get<WaStatus>('/whatsapp/status').then((s) => setMock(!!s.mock)).catch(() => {}); }, []);
  const aiMisconfigured = !!health && health.aiReplyEnabled && health.aiEnabled && health.llmProvider === 'openrouter' && !health.llmKeyConfigured;

  const loadMessages = useCallback(async (id: string) => {
    try { setMessages(await api.get<Message[]>(`/whatsapp/conversations/${id}/messages`)); }
    catch { /* ignore */ }
  }, []);

  useEffect(() => { loadConvs(); const t = setInterval(loadConvs, 6000); return () => clearInterval(t); }, [loadConvs]);
  useEffect(() => { loadApprovals(); const t = setInterval(loadApprovals, 6000); return () => clearInterval(t); }, [loadApprovals]);
  useEffect(() => { if (showHistory) loadHistory(); }, [showHistory, loadHistory]);
  useEffect(() => {
    if (!active) return;
    loadMessages(active.id);
    const t = setInterval(() => loadMessages(active.id), 4000);
    return () => clearInterval(t);
  }, [active, loadMessages]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const toggleAi = async (c: Conversation) => {
    try { await api.patch(`/whatsapp/conversations/${c.id}`, { aiEnabled: !c.aiEnabled }); await loadConvs(); if (active?.id === c.id) setActive({ ...c, aiEnabled: !c.aiEnabled }); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.conversations.failed', 'Failed')); }
  };
  const newSession = async (c: Conversation) => {
    if (!confirm(t('dash.conversations.confirmNewSession', 'Start a new session (close this conversation)?'))) return;
    try { await api.post(`/whatsapp/conversations/${c.id}/new-session`, {}); await loadConvs(); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.conversations.failed', 'Failed')); }
  };
  const summarize = async (c: Conversation) => {
    try { const s = await api.post<string>(`/whatsapp/conversations/${c.id}/summary`, {}); await loadConvs(); alert(typeof s === 'string' ? s : JSON.stringify(s)); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.conversations.failed', 'Failed')); }
  };
  const send = async () => {
    if (!active || !reply.trim()) return;
    try { await api.post(`/whatsapp/conversations/${active.id}/send`, { text: reply.trim() }); setReply(''); await loadMessages(active.id); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.conversations.sendFailed', 'Send failed')); }
  };

  return (
    <div data-testid="conversations-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-text-primary">{t('dash.conversations.title', 'Conversation Log')}</h1>
            {mock && <span className="badge bg-purple-100 text-purple-700 border border-purple-300">{t('dash.conversations.simMode', '● SIMULATION MODE')}</span>}
            {approvals.length > 0 && <span className="badge bg-amber-100 text-amber-800 border border-amber-300">{approvals.length} {t('dash.conversations.approvalsBadge', 'booking(s) to approve')}</span>}
          </div>
          <p className="mt-1 text-sm text-text-secondary">{t('dash.conversations.subtitle', 'Realtime customer ↔ AI WhatsApp conversations.')}</p>
        </div>
        <div className="flex gap-2">
          {mock && <button className="btn-secondary" onClick={() => setOutboxOpen(true)}>{t('dash.conversations.mockOutbox', 'Mock outbox')}</button>}
          <button className="btn-secondary" onClick={() => setSimOpen(true)}>{t('dash.conversations.simulateInbound', 'Simulate inbound')}</button>
        </div>
      </div>
      {mock && (
        <div className="rounded-lg bg-purple-50 border border-purple-200 p-3 text-sm text-purple-800 mb-4">
          {t('dash.conversations.simBanner', 'WAHA_MOCK is ON — no messages reach real WhatsApp. Outbound replies are captured in the Mock outbox so you can verify the full pipeline without a live number.')}
        </div>
      )}
      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}
      {aiMisconfigured && (
        <div className="rounded-lg bg-amber-50 border border-amber-300 p-3 text-sm text-amber-800 mb-4">
          {t('dash.conversations.aiWarn', 'AI replies are on but no OpenRouter API key is set — customers get basic template answers. ')}
          <a href="/dashboard/ai-agent" className="font-semibold underline">{t('dash.conversations.aiWarnLink', 'Configure AI model →')}</a>
        </div>
      )}

      {approvals.length > 0 && (
        <div className="card mb-5 border-amber-300 bg-amber-50/40">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="section-title">{t('dash.conversations.approvalsTitle', 'Booking approvals')}</h2>
            <span className="badge bg-amber-100 text-amber-800">{approvals.length}</span>
          </div>
          <p className="section-description mb-3">{t('dash.conversations.approvalsDesc', 'The AI proposed these bookings and the customer confirmed on WhatsApp. Approve to confirm (customer is notified) or reject to cancel. You can also reply TERIMA / TOLAK on the escalation WhatsApp number.')}</p>
          <div className="divide-y divide-border">
            {approvals.map((a) => (
              <div key={a.bookingId} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">
                    {a.ref && <span className="mr-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-sunken text-text-muted align-middle">{a.ref}</span>}
                    {a.summary}
                  </p>
                  <p className="text-xs text-text-muted">{a.customerPhone} · {t('dash.conversations.proposed', 'proposed')} {new Date(a.proposedAt).toLocaleString()}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button className="btn-primary text-xs" onClick={() => decide(a.bookingId, true)}>{t('dash.conversations.approve', 'Approve')}</button>
                  <button className="btn-ghost text-xs text-red-600" onClick={() => decide(a.bookingId, false)}>{t('dash.conversations.reject', 'Reject')}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-5">
        <button className="text-xs text-text-secondary hover:text-text-primary underline" onClick={() => setShowHistory((v) => !v)}>
          {showHistory ? t('dash.conversations.hideHistory', 'Hide approval history') : t('dash.conversations.showHistory', 'Approval history')}
        </button>
        {showHistory && (
          <div className="card mt-2 p-0 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border"><h3 className="text-sm font-semibold">{t('dash.conversations.historyTitle', 'Booking approval history')}</h3></div>
            <div className="divide-y divide-border max-h-[40vh] overflow-auto">
              {history.length === 0 ? <p className="p-4 text-sm text-text-muted">{t('dash.conversations.historyEmpty', 'No decisions yet.')}</p> : history.map((h, i) => (
                <div key={i} className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-text-primary truncate">{h.summary}</p>
                    <p className="text-xs text-text-muted">{h.customerPhone} · {t('dash.conversations.via', 'via')} {h.channel === 'whatsapp' ? 'WhatsApp' : t('dash.conversations.dashboard', 'dashboard')}{h.decidedBy ? ` · ${h.decidedBy}` : ''} · {new Date(h.decidedAt).toLocaleString()}</p>
                  </div>
                  <span className={`badge shrink-0 ${h.decision === 'confirmed' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {h.decision === 'confirmed' ? t('dash.conversations.confirmed', 'confirmed') : t('dash.conversations.cancelled', 'cancelled')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-5" style={{ minHeight: '60vh' }}>
        {/* Conversation list */}
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-border"><h2 className="text-sm font-semibold">{t('dash.conversations.listTitle', 'Conversations')} ({convs.length})</h2></div>
          <div className="divide-y divide-border max-h-[70vh] overflow-auto">
            {convs.length === 0 ? <p className="p-4 text-sm text-text-muted">{t('dash.conversations.empty', 'No conversations yet.')}</p> : convs.map((c) => (
              <button key={c.id} onClick={() => setActive(c)} className={`w-full text-left px-4 py-3 hover:bg-surface-sunken ${active?.id === c.id ? 'bg-primary-50' : ''}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-text-primary">{c.customerName || c.customerPhone}</span>
                  <span className={`badge ${c.status === 'escalated' ? 'bg-amber-50 text-amber-700' : c.status === 'closed' ? 'bg-gray-100 text-gray-500' : 'bg-green-50 text-green-700'}`}>{c.status}</span>
                </div>
                <p className="text-xs text-text-muted mt-0.5">{c.customerPhone} · AI {c.aiEnabled ? t('dash.conversations.on', 'on') : t('dash.conversations.off', 'off')}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Active conversation */}
        <div className="card p-0 overflow-hidden lg:col-span-2 flex flex-col">
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-sm text-text-muted">{t('dash.conversations.selectPrompt', 'Select a conversation.')}</div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">{active.customerName || active.customerPhone}</p>
                  <p className="text-xs text-text-muted">{active.customerPhone}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button className={`btn-ghost text-xs ${active.aiEnabled ? 'text-green-600' : 'text-amber-600'}`} onClick={() => toggleAi(active)}>{active.aiEnabled ? t('dash.conversations.aiOnStop', 'AI: ON (stop)') : t('dash.conversations.aiOffStart', 'AI: OFF (start)')}</button>
                  <button className="btn-ghost text-xs" onClick={() => summarize(active)}>{t('dash.conversations.summary', 'Summary')}</button>
                  <button className="btn-ghost text-xs text-red-600" onClick={() => newSession(active)}>{t('dash.conversations.newSession', 'New session')}</button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4 space-y-2 bg-surface-sunken/30 max-h-[55vh]">
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${m.direction === 'outbound' ? 'bg-primary-500 text-white' : 'bg-surface-raised border border-border text-text-primary'}`}>
                      {m.body}
                      <div className={`text-[10px] mt-1 ${m.direction === 'outbound' ? 'text-primary-100' : 'text-text-muted'}`}>{m.fromAi ? `🤖 ${m.persona || t('dash.conversations.ai', 'AI')} · ` : ''}{new Date(m.createdAt).toLocaleTimeString()}</div>
                    </div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              <div className="p-3 border-t border-border flex gap-2">
                <input className="input-field flex-1" placeholder={t('dash.conversations.replyPlaceholder', 'Type a manual reply…')} value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} />
                <button className="btn-primary" onClick={send}>{t('dash.conversations.send', 'Send')}</button>
              </div>
            </>
          )}
        </div>
      </div>

      {simOpen && <SimulateModal onClose={() => setSimOpen(false)} onSent={() => { setSimOpen(false); loadConvs(); }} />}
      {outboxOpen && <MockOutboxModal onClose={() => setOutboxOpen(false)} />}
    </div>
  );
}

function MockOutboxModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<MockOutboxEntry[]>([]);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try { setRows(await api.get<MockOutboxEntry[]>('/whatsapp/mock-outbox')); }
    catch (e) { setErr(e instanceof Error ? e.message : t('dash.conversations.failed', 'Failed')); }
  }, [t]);
  useEffect(() => { load(); const id = setInterval(load, 4000); return () => clearInterval(id); }, [load]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="section-title">{t('dash.conversations.mockOutboxTitle', 'Mock outbox — captured outbound sends')}</h3>
          <button className="btn-ghost text-xs" onClick={load}>{t('dash.conversations.refresh', 'Refresh')}</button>
        </div>
        <p className="section-description mb-3">{t('dash.conversations.mockOutboxDesc', 'These are the replies that WOULD be delivered to WhatsApp via the gateway. Nothing was actually sent.')}</p>
        {err && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-3">{err}</div>}
        <div className="flex-1 overflow-auto divide-y divide-border">
          {rows.length === 0 ? <p className="p-4 text-sm text-text-muted">{t('dash.conversations.mockOutboxEmpty', 'No captured sends yet. Simulate an inbound message to trigger a reply.')}</p> : rows.map((r) => (
            <div key={r.id} className="py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-text-primary">{r.chatId}</span>
                <span className="text-[11px] text-text-muted">{r.provider}{r.session ? ` · ${r.session}` : ''} · {new Date(r.createdAt).toLocaleTimeString()}</span>
              </div>
              <p className="text-sm text-text-secondary mt-0.5 whitespace-pre-wrap">{r.body}</p>
            </div>
          ))}
        </div>
        <div className="flex justify-end mt-4"><button className="btn-secondary" onClick={onClose}>{t('dash.conversations.close', 'Close')}</button></div>
      </div>
    </div>
  );
}

function SimulateModal({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const { t } = useI18n();
  const [from, setFrom] = useState('628123456789');
  const [name, setName] = useState('Test Customer');
  const [text, setText] = useState('Halo, jam buka berapa?');
  const [err, setErr] = useState('');
  const submit = async () => {
    try { await api.post('/whatsapp/simulate-inbound', { from, name, text }); onSent(); }
    catch (e) { setErr(e instanceof Error ? e.message : t('dash.conversations.failed', 'Failed')); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-4">{t('dash.conversations.simulateTitle', 'Simulate inbound message')}</h3>
        {err && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-3">{err}</div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium mb-1.5">{t('dash.conversations.fromPhone', 'From (phone)')}</label><input className="input-field" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="block text-sm font-medium mb-1.5">{t('dash.conversations.name', 'Name')}</label><input className="input-field" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="block text-sm font-medium mb-1.5">{t('dash.conversations.message', 'Message')}</label><input className="input-field" value={text} onChange={(e) => setText(e.target.value)} /></div>
        </div>
        <div className="flex gap-2 justify-end mt-4">
          <button className="btn-secondary" onClick={onClose}>{t('dash.conversations.cancel', 'Cancel')}</button>
          <button className="btn-primary" onClick={submit}>{t('dash.conversations.send', 'Send')}</button>
        </div>
      </div>
    </div>
  );
}
