'use client';

/**
 * FloatingChat — the mini assistant that follows the user across the app.
 *
 * A launcher bubble in the corner opens a small panel with the same brain and the
 * same threads as the full page, so a question asked here shows up in the history
 * there. It exists because the useful moment for "what's revenue today?" is while
 * looking at another screen, not after navigating away from it.
 *
 * Open/closed state is kept in localStorage so it survives navigation (the
 * dashboard shell persists, but a hard reload would otherwise close it), and the
 * transcript stays mounted while open so switching pages never loses a reply.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bot, Maximize2, MessageSquarePlus, X, History } from 'lucide-react';
import { ChatIntro, Composer, MessageList, SessionList } from './parts';
import { useAiChat, type AiChatEndpoints } from './useAiChat';

const OPEN_KEY = 'aire.floatingChat.open';

export function FloatingChat({
  endpoints,
  fullPageHref,
  title,
  introTitle,
  introBody,
  suggestions,
  placeholder,
  thinkingLabel,
  emptyHistoryLabel,
}: {
  endpoints: AiChatEndpoints;
  /** Where "expand" goes — the full-page version of this same chat. */
  fullPageHref: string;
  title: string;
  introTitle: string;
  introBody: string;
  suggestions: string[];
  placeholder: string;
  thinkingLabel: string;
  emptyHistoryLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Mount the chat (and its session fetch) only once the panel has been opened,
  // so a user who never uses it pays nothing on every page load.
  const [everOpened, setEverOpened] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(OPEN_KEY) === '1') {
      setOpen(true);
      setEverOpened(true);
    }
  }, []);

  const toggle = useCallback((next: boolean) => {
    setOpen(next);
    if (next) setEverOpened(true);
    try {
      window.localStorage.setItem(OPEN_KEY, next ? '1' : '0');
    } catch {
      /* private mode — the panel just won't persist */
    }
  }, []);

  // Escape closes the panel, matching every other overlay in the app.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggle(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, toggle]);

  if (!everOpened) {
    return <Launcher onClick={() => toggle(true)} title={title} />;
  }

  return (
    <>
      {!open && <Launcher onClick={() => toggle(true)} title={title} />}
      <div
        ref={panelRef}
        // Kept mounted while closed (hidden) so an in-flight reply is never lost
        // when the user collapses the panel mid-answer.
        className={`fixed bottom-4 right-4 z-40 flex w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-xl ${
          open ? '' : 'pointer-events-none invisible'
        }`}
        style={{ height: 'min(70vh, 34rem)' }}
        role="dialog"
        aria-label={title}
        aria-hidden={!open}
        data-testid="floating-chat-panel"
      >
        <FloatingBody
          endpoints={endpoints}
          fullPageHref={fullPageHref}
          title={title}
          introTitle={introTitle}
          introBody={introBody}
          suggestions={suggestions}
          placeholder={placeholder}
          thinkingLabel={thinkingLabel}
          emptyHistoryLabel={emptyHistoryLabel}
          showHistory={showHistory}
          onToggleHistory={() => setShowHistory((v) => !v)}
          onClose={() => toggle(false)}
          panelOpen={open}
        />
      </div>
    </>
  );
}

function Launcher({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      // Sits above the mobile bottom nav so it never covers a nav item.
      className="fixed bottom-20 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 lg:bottom-6"
      aria-label={title}
      title={title}
      data-testid="floating-chat-launcher"
    >
      <Bot className="h-5 w-5" />
    </button>
  );
}

function FloatingBody({
  endpoints, fullPageHref, title, introTitle, introBody, suggestions, placeholder,
  thinkingLabel, emptyHistoryLabel, showHistory, onToggleHistory, onClose, panelOpen,
}: {
  endpoints: AiChatEndpoints;
  fullPageHref: string;
  title: string;
  introTitle: string;
  introBody: string;
  suggestions: string[];
  placeholder: string;
  thinkingLabel: string;
  emptyHistoryLabel: string;
  showHistory: boolean;
  onToggleHistory: () => void;
  onClose: () => void;
  panelOpen: boolean;
}) {
  const chat = useAiChat(endpoints);

  return (
    <>
      <header className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <Bot className="h-4 w-4 text-primary-600" />
        <span className="flex-1 truncate text-sm font-medium text-text-primary">{title}</span>
        <button className="p-1 text-text-muted hover:text-text-primary" onClick={onToggleHistory} aria-label="Conversation history" title="History">
          <History className="h-4 w-4" />
        </button>
        <button className="p-1 text-text-muted hover:text-text-primary" onClick={chat.newChat} aria-label="New chat" title="New chat">
          <MessageSquarePlus className="h-4 w-4" />
        </button>
        {/* Expand hands the OPEN thread over to the full page (`?session=`), so
            "continue this in full mode" continues *this* conversation rather than
            dumping the user on an empty one. Closing the panel on the way keeps a
            single visible copy of the chat. */}
        <Link
          href={chat.sessionId ? `${fullPageHref}?session=${chat.sessionId}` : fullPageHref}
          onClick={onClose}
          className="p-1 text-text-muted hover:text-text-primary"
          aria-label="Open in full mode"
          title="Open in full mode"
          data-testid="floating-chat-expand"
        >
          <Maximize2 className="h-4 w-4" />
        </Link>
        <button className="p-1 text-text-muted hover:text-text-primary" onClick={onClose} aria-label="Close chat">
          <X className="h-4 w-4" />
        </button>
      </header>

      {showHistory ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <SessionList
            sessions={chat.sessions}
            activeId={chat.sessionId}
            onOpen={(id) => {
              void chat.openSession(id);
              onToggleHistory();
            }}
            onRename={chat.rename}
            onTogglePin={chat.togglePin}
            onDelete={chat.remove}
            emptyLabel={emptyHistoryLabel}
          />
        </div>
      ) : (
        <MessageList
          messages={chat.messages}
          sending={chat.sending}
          thinkingLabel={thinkingLabel}
          compact
          empty={<ChatIntro title={introTitle} body={introBody} suggestions={suggestions} onPick={chat.send} />}
        />
      )}

      {chat.error && (
        <div className="mx-3 mb-2 rounded-lg border border-red-200 bg-red-50 p-2 text-2xs text-red-700">{chat.error}</div>
      )}

      {!showHistory && (
        <Composer onSend={chat.send} disabled={chat.sending} placeholder={placeholder} autoFocus={panelOpen} />
      )}
    </>
  );
}
