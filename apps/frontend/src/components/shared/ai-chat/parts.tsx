'use client';

/**
 * The visual pieces of the chat surface, shared by the full page and the
 * floating mini chat so both stay identical as either evolves.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Bot, Check, Pencil, Pin, PinOff, Send, Trash2, Wrench, X } from 'lucide-react';
import type { ChatMessage, ChatSession } from './useAiChat';

/* ── Message list ───────────────────────────────────────────────────── */

export function MessageList({
  messages,
  sending,
  empty,
  compact = false,
  thinkingLabel,
}: {
  messages: ChatMessage[];
  sending: boolean;
  /** Shown instead of the transcript when the thread is empty (suggestions, intro). */
  empty?: ReactNode;
  compact?: boolean;
  thinkingLabel: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  // useLayoutEffect: scroll before paint so a new message never appears
  // mid-scroll (which reads as a jump on a long transcript).
  useLayoutEffect(() => {
    const el = endRef.current;
    // `scrollIntoView` is missing in jsdom and in a few older mobile webviews;
    // auto-scroll is a nicety, so never let its absence throw during render.
    if (typeof el?.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: messages.length > 2 ? 'smooth' : 'auto', block: 'end' });
    }
  }, [messages, sending]);

  if (messages.length === 0 && empty) {
    return <div className="flex-1 overflow-auto p-4">{empty}</div>;
  }

  return (
    <div className={`flex-1 overflow-auto ${compact ? 'p-3 space-y-3' : 'p-4 space-y-4'}`}>
      {messages.map((m, i) => (
        <Bubble key={i} message={m} compact={compact} />
      ))}
      {sending && (
        <div className="flex justify-start">
          <div className="flex items-center gap-2 rounded-2xl bg-surface-sunken px-4 py-2.5 text-sm text-text-muted">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary-400" />
            {thinkingLabel}
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

function Bubble({ message, compact }: { message: ChatMessage; compact: boolean }) {
  const mine = message.role === 'user';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`${compact ? 'max-w-[92%]' : 'max-w-[80%]'} space-y-1`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm ${
            mine
              ? message.failed
                ? 'bg-red-100 text-red-800 ring-1 ring-red-300 dark:bg-red-950 dark:text-red-200'
                : 'bg-primary-500 text-white'
              : 'bg-surface-sunken text-text-primary'
          }`}
        >
          {mine ? <span className="whitespace-pre-wrap">{message.content}</span> : <RichText text={message.content} />}
        </div>
        {message.failed && <p className="pr-1 text-right text-2xs text-red-600">Not sent</p>}
        {!mine && message.toolsUsed && message.toolsUsed.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {message.toolsUsed.map((t, i) => (
              <span
                key={`${t.tool}-${i}`}
                title={t.ok ? 'Tool ran successfully' : 'Tool returned an error'}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs ${
                  t.ok ? 'bg-surface-sunken text-text-muted' : 'bg-amber-100 text-amber-800'
                }`}
              >
                <Wrench className="h-3 w-3" />
                {t.tool}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Minimal inline formatting for assistant replies.
 *
 * The agents answer in light markdown (**bold**, `code`, - bullets) because the
 * same brain also writes to WhatsApp. Rendering those few forms — and nothing
 * else — keeps replies readable without pulling in a markdown parser or ever
 * putting model output through `dangerouslySetInnerHTML`.
 */
export function RichText({ text }: { text: string }) {
  const lines = (text ?? '').split('\n');
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const bullet = /^\s*[-*•]\s+/.test(line);
        const numbered = /^\s*\d+[.)]\s+/.test(line);
        if (line.trim() === '') return <div key={i} className="h-1.5" />;
        return (
          <p key={i} className={bullet || numbered ? 'pl-4 -indent-2' : ''}>
            {bullet ? '• ' : ''}
            {inline(bullet ? line.replace(/^\s*[-*•]\s+/, '') : line)}
          </p>
        );
      })}
    </div>
  );
}

/** Split a line on **bold**, *italic* and `code`, returning React nodes. */
function inline(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) {
      out.push(
        <code key={key++} className="rounded bg-surface px-1 py-0.5 font-mono text-xs">
          {tok.slice(1, -1)}
        </code>,
      );
    } else out.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

/* ── Composer ───────────────────────────────────────────────────────── */

export function Composer({
  onSend,
  disabled,
  placeholder,
  autoFocus,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  // The floating panel stays mounted while collapsed, so `autoFocus` (a
  // mount-only attribute) would only ever fire once. Focus on the flag turning
  // true instead, so re-opening the panel puts the cursor in the box every time.
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  // Grow with the text up to a few lines, then scroll — a single-line input makes
  // it impossible to re-read a long question before sending it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    setValue('');
    onSend(text);
  };

  return (
    <form
      className="flex items-end gap-2 border-t border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        autoFocus={autoFocus}
        className="input-field flex-1 resize-none py-2"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends; Shift+Enter is a newline. IME composition must never be
          // cut off mid-word, so a composing Enter is left to the input method.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button
        type="submit"
        className="btn-primary shrink-0 px-3 py-2"
        disabled={disabled || !value.trim()}
        aria-label="Send"
      >
        <Send className="h-4 w-4" />
      </button>
    </form>
  );
}

/* ── History sidebar ────────────────────────────────────────────────── */

export function SessionList({
  sessions,
  activeId,
  onOpen,
  onRename,
  onTogglePin,
  onDelete,
  emptyLabel,
}: {
  sessions: ChatSession[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
  emptyLabel: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);

  if (sessions.length === 0) {
    return <p className="px-3 py-6 text-center text-xs text-text-muted">{emptyLabel}</p>;
  }

  return (
    <ul className="space-y-0.5" data-testid="chat-session-list">
      {sessions.map((s) => {
        const active = s.id === activeId;
        if (editing === s.id) {
          return (
            <li key={s.id} className="rounded-lg bg-surface-sunken p-2">
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  onRename(s.id, draft);
                  setEditing(null);
                }}
              >
                <input
                  className="input-field flex-1 px-2 py-1 text-sm"
                  value={draft}
                  autoFocus
                  maxLength={120}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  aria-label="Conversation title"
                />
                <button type="submit" className="p-1 text-primary-600" aria-label="Save title">
                  <Check className="h-4 w-4" />
                </button>
                <button type="button" className="p-1 text-text-muted" onClick={() => setEditing(null)} aria-label="Cancel rename">
                  <X className="h-4 w-4" />
                </button>
              </form>
            </li>
          );
        }
        return (
          <li key={s.id}>
            <div
              className={`group flex items-center gap-1 rounded-lg px-2 py-2 text-sm ${
                active ? 'bg-primary-50 text-primary-700' : 'text-text-secondary hover:bg-surface-sunken'
              }`}
            >
              <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(s.id)} title={s.preview ?? s.title}>
                <span className="flex items-center gap-1.5">
                  {s.pinned && <Pin className="h-3 w-3 shrink-0 text-primary-500" />}
                  <span className="truncate font-medium">{s.title}</span>
                </span>
                {s.preview && <span className="mt-0.5 block truncate text-xs text-text-muted">{s.preview}</span>}
              </button>
              {/* Row actions stay visible on the active row (and on touch, where
                  there is no hover) but fade in elsewhere to keep the list calm. */}
              <span className={`flex shrink-0 items-center ${active ? '' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
                <button
                  className="p-1 text-text-muted hover:text-text-primary"
                  onClick={() => onTogglePin(s.id, !s.pinned)}
                  aria-label={s.pinned ? 'Unpin conversation' : 'Pin conversation'}
                  title={s.pinned ? 'Unpin' : 'Pin'}
                >
                  {s.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                </button>
                <button
                  className="p-1 text-text-muted hover:text-text-primary"
                  onClick={() => {
                    setEditing(s.id);
                    setDraft(s.title);
                  }}
                  aria-label="Rename conversation"
                  title="Rename"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  className="p-1 text-text-muted hover:text-red-600"
                  onClick={() => setConfirming(s.id)}
                  aria-label="Delete conversation"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
            {confirming === s.id && (
              <div className="mx-2 mb-1 rounded-lg border border-border bg-surface-sunken p-2 text-xs">
                <p className="mb-2 text-text-secondary">Delete this conversation?</p>
                <div className="flex gap-2">
                  <button
                    className="rounded bg-red-600 px-2 py-1 font-medium text-white"
                    onClick={() => {
                      setConfirming(null);
                      onDelete(s.id);
                    }}
                  >
                    Delete
                  </button>
                  <button className="rounded px-2 py-1 text-text-secondary" onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ── Empty state ────────────────────────────────────────────────────── */

export function ChatIntro({
  title,
  body,
  suggestions,
  onPick,
}: {
  title: string;
  body: string;
  suggestions: string[];
  onPick: (s: string) => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-100 text-primary-600">
        <Bot className="h-6 w-6" />
      </div>
      <div>
        <p className="font-medium text-text-primary">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-text-muted">{body}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="badge bg-surface-sunken text-text-secondary hover:bg-primary-50 hover:text-primary-700"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
