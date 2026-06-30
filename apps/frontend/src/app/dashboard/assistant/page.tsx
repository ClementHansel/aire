'use client';

/**
 * AI Assistant — conversational co-pilot.
 * Chats with the tenant's configured LLM (AI settings) via /api/agent/chat.
 * The assistant can read business data and operate the app through tools.
 */

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  sessionId: string;
  reply: string;
  toolsUsed: { tool: string; ok: boolean }[];
}

const SUGGESTIONS = [
  'How is business doing today?',
  'Which memberships expire in the next 30 days?',
  'Show me the last 10 orders',
  'What happened in the last hour?',
];

export default function AssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || sending) return;
    setError('');
    setMessages((prev) => [...prev, { role: 'user', content: message }]);
    setInput('');
    setSending(true);
    try {
      const res = await api.post<ChatResponse>('/agent/chat', { message, sessionId });
      setSessionId(res.sessionId);
      setMessages((prev) => [...prev, { role: 'assistant', content: res.reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reach the assistant');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto flex flex-col h-[calc(100vh-8rem)]">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-text-primary">AI Assistant</h1>
        <p className="text-sm text-text-muted">Ask about your business or tell the assistant what to automate. It reads live data and can act through governed tools.</p>
      </div>

      <div className="card flex-1 flex flex-col overflow-hidden p-0">
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center gap-4">
              <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center text-2xl">🤖</div>
              <p className="text-sm text-text-muted max-w-sm">I can see your orders, revenue, memberships, queue, and recent activity. Try one of these:</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="badge bg-surface-sunken text-text-secondary hover:bg-primary-50 hover:text-primary-700">{s}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-primary-500 text-white' : 'bg-surface-sunken text-text-primary'}`}>
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-surface-sunken rounded-2xl px-4 py-2.5 text-sm text-text-muted flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-primary-400 animate-pulse" />
                Thinking…
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {error && <div className="mx-4 mb-2 rounded-lg bg-red-50 border border-red-200 p-2 text-xs text-red-700">{error}</div>}

        <div className="border-t border-border p-3">
          <form
            onSubmit={(e) => { e.preventDefault(); send(input); }}
            className="flex gap-2"
          >
            <input
              className="input-field flex-1"
              placeholder="Ask the assistant…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending}
            />
            <button type="submit" className="btn-primary" disabled={sending || !input.trim()}>Send</button>
          </form>
        </div>
      </div>
    </div>
  );
}
