'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Which console this chat talks to. The two surfaces are identical in behaviour
 * and differ only in their endpoints, so every screen (full page + floating mini
 * chat) shares one hook and one component tree.
 */
export interface AiChatEndpoints {
  /** POST { message, sessionId } → { sessionId, reply, toolsUsed, title? } */
  chat: string;
  /** GET (list) / POST (create) / :id GET, PATCH, DELETE */
  sessions: string;
}

export const TENANT_CHAT: AiChatEndpoints = { chat: '/agent/chat', sessions: '/agent/chat/sessions' };
export const PLATFORM_CHAT: AiChatEndpoints = { chat: '/admin/ai/chat', sessions: '/admin/ai/chat/sessions' };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  /** Tools the agent ran to produce this answer (assistant turns only). */
  toolsUsed?: { tool: string; ok: boolean }[];
  /** Set on a locally-added turn that failed to send, so it can be retried. */
  failed?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  pinned: boolean;
  messageCount: number;
  preview: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ChatResponse {
  sessionId: string;
  reply: string;
  toolsUsed: { tool: string; ok: boolean }[];
  title?: string;
}

/**
 * useAiChat — all the chat state one surface needs.
 *
 * Sessions are lazy: a thread row is only created server-side when the first
 * message is sent, so clicking "New chat" and walking away leaves no debris in
 * the history list. That is why `sessionId` can be null while messages are
 * already on screen — the id arrives with the first reply.
 */
export function useAiChat(endpoints: AiChatEndpoints, options?: { loadHistory?: boolean }) {
  const loadHistory = options?.loadHistory ?? true;

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState('');
  // Guards against a slow thread-load landing after the user has already moved
  // on to another thread (or started a new one) and overwriting the screen.
  const activeLoad = useRef(0);

  const refreshSessions = useCallback(async () => {
    if (!loadHistory) return;
    try {
      setSessions(await api.get<ChatSession[]>(endpoints.sessions));
    } catch {
      /* history is a convenience; never block chatting on it */
    }
  }, [endpoints.sessions, loadHistory]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  const openSession = useCallback(
    async (id: string) => {
      const token = ++activeLoad.current;
      setSessionId(id);
      setError('');
      setLoadingThread(true);
      try {
        const msgs = await api.get<ChatMessage[]>(`${endpoints.sessions}/${id}`);
        if (activeLoad.current === token) setMessages(msgs);
      } catch (e) {
        if (activeLoad.current === token) setError(errText(e, 'Could not open that conversation'));
      } finally {
        if (activeLoad.current === token) setLoadingThread(false);
      }
    },
    [endpoints.sessions],
  );

  const newChat = useCallback(() => {
    activeLoad.current++;
    setSessionId(null);
    setMessages([]);
    setError('');
  }, []);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || sending) return;
      setError('');
      setMessages((prev) => [...prev, { role: 'user', content: message }]);
      setSending(true);
      try {
        const res = await api.post<ChatResponse>(endpoints.chat, { message, sessionId });
        setSessionId(res.sessionId || sessionId);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: res.reply, toolsUsed: res.toolsUsed },
        ]);
        // A fresh thread only appears in the history once it has content, and its
        // title is written by the server-side titler — so refresh after the turn.
        void refreshSessions();
      } catch (e) {
        setError(errText(e, 'Failed to reach the assistant'));
        // Mark the user's turn as unsent rather than silently dropping it: they
        // can see exactly which message did not go through.
        setMessages((prev) => {
          const copy = [...prev];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i]!.role === 'user') {
              copy[i] = { ...copy[i]!, failed: true };
              break;
            }
          }
          return copy;
        });
      } finally {
        setSending(false);
      }
    },
    [endpoints.chat, refreshSessions, sending, sessionId],
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      const clean = title.trim();
      if (!clean) return;
      // Optimistic: renaming is the one action where a round-trip delay is felt
      // most (the user is looking straight at the text they just typed).
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title: clean } : s)));
      try {
        await api.patch(`${endpoints.sessions}/${id}`, { title: clean });
      } catch (e) {
        setError(errText(e, 'Rename failed'));
        void refreshSessions();
      }
    },
    [endpoints.sessions, refreshSessions],
  );

  const togglePin = useCallback(
    async (id: string, pinned: boolean) => {
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, pinned } : s)));
      try {
        await api.patch(`${endpoints.sessions}/${id}`, { pinned });
      } finally {
        void refreshSessions();
      }
    },
    [endpoints.sessions, refreshSessions],
  );

  const remove = useCallback(
    async (id: string) => {
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (id === sessionId) {
        setSessionId(null);
        setMessages([]);
      }
      try {
        await api.delete(`${endpoints.sessions}/${id}`);
      } catch (e) {
        setError(errText(e, 'Delete failed'));
        void refreshSessions();
      }
    },
    [endpoints.sessions, refreshSessions, sessionId],
  );

  return {
    sessions, sessionId, messages, sending, loadingThread, error,
    setError, send, openSession, newChat, rename, togglePin, remove, refreshSessions,
  };
}

function errText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
