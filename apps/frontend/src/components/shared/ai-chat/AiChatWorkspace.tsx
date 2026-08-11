'use client';

/**
 * AiChatWorkspace — the full-page chat: history rail on the left, transcript on
 * the right. Used by both the tenant assistant (/dashboard/assistant) and the
 * platform console (/admin/assistant); only the endpoints and copy differ.
 */

import { useEffect, useRef, useState } from 'react';
import { MessageSquarePlus, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { ChatIntro, Composer, MessageList, SessionList } from './parts';
import { useAiChat, type AiChatEndpoints } from './useAiChat';

export function AiChatWorkspace({
  endpoints,
  title,
  subtitle,
  introTitle,
  introBody,
  suggestions,
  placeholder,
  thinkingLabel,
  historyLabel,
  newChatLabel,
  emptyHistoryLabel,
  testId = 'ai-chat-workspace',
}: {
  endpoints: AiChatEndpoints;
  title: string;
  subtitle: string;
  introTitle: string;
  introBody: string;
  suggestions: string[];
  placeholder: string;
  thinkingLabel: string;
  historyLabel: string;
  newChatLabel: string;
  emptyHistoryLabel: string;
  testId?: string;
}) {
  const chat = useAiChat(endpoints);
  const [railOpen, setRailOpen] = useState(true);
  const handedOff = useRef(false);

  // Hand-off from the floating mini chat: `?session=<id>` opens that thread here,
  // so "expand" continues the conversation instead of starting a blank one. Read
  // from `location` rather than useSearchParams to keep this component out of a
  // Suspense boundary, then strip the param so a later reload (after the user has
  // moved to another thread) doesn't yank them back to this one.
  useEffect(() => {
    if (handedOff.current || typeof window === 'undefined') return;
    const id = new URLSearchParams(window.location.search).get('session');
    if (!id) return;
    handedOff.current = true;
    void chat.openSession(id);
    window.history.replaceState(null, '', window.location.pathname);
    // Runs once on mount; `chat.openSession` is stable per endpoint set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={testId}>
      <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">{title}</h1>
          <p className="text-sm text-text-muted">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost hidden items-center gap-1.5 text-xs lg:inline-flex"
            onClick={() => setRailOpen((v) => !v)}
            aria-label={railOpen ? 'Hide history' : 'Show history'}
          >
            {railOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          </button>
          <button className="btn-secondary inline-flex items-center gap-1.5 text-sm" onClick={chat.newChat}>
            <MessageSquarePlus className="h-4 w-4" /> {newChatLabel}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        {railOpen && (
          <aside className="card hidden w-64 shrink-0 flex-col overflow-hidden p-0 lg:flex">
            <p className="border-b border-border px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-text-muted">
              {historyLabel}
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <SessionList
                sessions={chat.sessions}
                activeId={chat.sessionId}
                onOpen={chat.openSession}
                onRename={chat.rename}
                onTogglePin={chat.togglePin}
                onDelete={chat.remove}
                emptyLabel={emptyHistoryLabel}
              />
            </div>
          </aside>
        )}

        <div className="card flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <MessageList
            messages={chat.messages}
            sending={chat.sending}
            thinkingLabel={thinkingLabel}
            empty={
              chat.loadingThread ? (
                <p className="py-10 text-center text-sm text-text-muted">Loading…</p>
              ) : (
                <ChatIntro title={introTitle} body={introBody} suggestions={suggestions} onPick={chat.send} />
              )
            }
          />

          {chat.error && (
            <div className="mx-4 mb-2 flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              <span>{chat.error}</span>
              <button onClick={() => chat.setError('')} aria-label="Dismiss error">
                ✕
              </button>
            </div>
          )}

          <Composer onSend={chat.send} disabled={chat.sending} placeholder={placeholder} autoFocus />
        </div>
      </div>
    </div>
  );
}
