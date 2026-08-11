/**
 * The chat surface, exercised through the tenant assistant page.
 *
 * What matters here is the chat-product behaviour the old single-textarea version
 * lacked: a browsable history, titles you can edit, threads you can delete, and a
 * transcript that survives a failed send instead of swallowing the message.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AssistantPage from '@/app/dashboard/assistant/page';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/i18n', () => ({
  useI18n: () => ({ t: (_k: string, fallback?: string) => fallback ?? _k }),
}));

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const SESSION = {
  id: 'sess-1', title: 'Revenue today', pinned: false, messageCount: 2,
  preview: 'Rp 4.500.000', createdAt: 'now', updatedAt: 'now',
};

function routes(sessions: unknown[] = [], messages: unknown[] = []) {
  mockApi.get.mockImplementation((path: string) => {
    if (path === '/agent/chat/sessions') return Promise.resolve(sessions);
    if (path.startsWith('/agent/chat/sessions/')) return Promise.resolve(messages);
    return Promise.resolve({});
  });
}

const typeAndSend = (text: string) => {
  fireEvent.change(screen.getByPlaceholderText('Ask the assistant…'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
};

describe('AiChatWorkspace (tenant assistant)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('offers suggestions on an empty thread and sends one on click', async () => {
    routes();
    mockApi.post.mockResolvedValue({ sessionId: 'sess-9', reply: 'Rp 4.500.000', toolsUsed: [] });
    render(<AssistantPage />);

    fireEvent.click(await screen.findByText('How is business doing today?'));

    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith('/agent/chat', {
        message: 'How is business doing today?',
        sessionId: null,
      }),
    );
    expect(await screen.findByText('Rp 4.500.000')).toBeInTheDocument();
  });

  it('keeps the reply in the same thread on the next turn', async () => {
    routes();
    mockApi.post.mockResolvedValue({ sessionId: 'sess-9', reply: 'ok', toolsUsed: [] });
    render(<AssistantPage />);
    await screen.findByText('Ask me about your business');

    typeAndSend('first');
    await waitFor(() => expect(mockApi.post).toHaveBeenCalledTimes(1));
    typeAndSend('second');

    // The id returned by turn one is threaded into turn two.
    await waitFor(() =>
      expect(mockApi.post).toHaveBeenLastCalledWith('/agent/chat', { message: 'second', sessionId: 'sess-9' }),
    );
  });

  it('shows which tools the agent ran, so an answer can be trusted or questioned', async () => {
    routes();
    mockApi.post.mockResolvedValue({
      sessionId: 'sess-9', reply: 'Rp 4.500.000',
      toolsUsed: [{ tool: 'get_revenue', ok: true }],
    });
    render(<AssistantPage />);
    await screen.findByText('Ask me about your business');

    typeAndSend('omzet?');

    expect(await screen.findByText('get_revenue')).toBeInTheDocument();
  });

  it('marks the message as unsent when the turn fails, instead of losing it', async () => {
    routes();
    mockApi.post.mockRejectedValue(new Error('AI is unreachable'));
    render(<AssistantPage />);
    await screen.findByText('Ask me about your business');

    typeAndSend('omzet?');

    expect(await screen.findByText('AI is unreachable')).toBeInTheDocument();
    expect(screen.getByText('Not sent')).toBeInTheDocument();
    expect(screen.getByText('omzet?')).toBeInTheDocument();
  });

  it('lists past conversations and opens one', async () => {
    routes([SESSION], [{ role: 'user', content: 'omzet?' }, { role: 'assistant', content: 'Rp 4.500.000' }]);
    render(<AssistantPage />);

    fireEvent.click(await screen.findByText('Revenue today'));

    expect(await screen.findByText('Rp 4.500.000')).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith('/agent/chat/sessions/sess-1');
  });

  it('renames a conversation inline', async () => {
    routes([SESSION]);
    mockApi.patch.mockResolvedValue({ id: 'sess-1', title: 'Weekly numbers' });
    render(<AssistantPage />);
    await screen.findByText('Revenue today');

    fireEvent.click(screen.getByRole('button', { name: 'Rename conversation' }));
    fireEvent.change(screen.getByLabelText('Conversation title'), { target: { value: 'Weekly numbers' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save title' }));

    await waitFor(() =>
      expect(mockApi.patch).toHaveBeenCalledWith('/agent/chat/sessions/sess-1', { title: 'Weekly numbers' }),
    );
    // Optimistic: the new title is on screen without waiting for a refetch.
    expect(screen.getByText('Weekly numbers')).toBeInTheDocument();
  });

  it('asks before deleting a conversation', async () => {
    routes([SESSION]);
    mockApi.delete.mockResolvedValue({ deleted: true });
    render(<AssistantPage />);
    await screen.findByText('Revenue today');

    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }));
    expect(screen.getByText('Delete this conversation?')).toBeInTheDocument();
    expect(mockApi.delete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('/agent/chat/sessions/sess-1'));
    expect(screen.queryByText('Revenue today')).not.toBeInTheDocument();
  });

  it('pins a conversation', async () => {
    routes([SESSION]);
    mockApi.patch.mockResolvedValue({});
    render(<AssistantPage />);
    await screen.findByText('Revenue today');

    fireEvent.click(screen.getByRole('button', { name: 'Pin conversation' }));

    await waitFor(() =>
      expect(mockApi.patch).toHaveBeenCalledWith('/agent/chat/sessions/sess-1', { pinned: true }),
    );
  });

  it('clears the transcript for a new chat without touching the server', async () => {
    routes([SESSION], [{ role: 'assistant', content: 'Rp 4.500.000' }]);
    render(<AssistantPage />);
    fireEvent.click(await screen.findByText('Revenue today'));
    await screen.findByText('Rp 4.500.000');

    fireEvent.click(screen.getByRole('button', { name: /New chat/ }));

    // Back to the intro, and no empty thread was created server-side — a thread
    // only exists once it has a message in it.
    expect(await screen.findByText('Ask me about your business')).toBeInTheDocument();
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  // The floating mini chat expands by linking here with `?session=<id>`. If that
  // were ignored, "open in full mode" would silently drop the conversation the
  // user was in the middle of.
  describe('hand-off from the floating mini chat', () => {
    const setSearch = (search: string) => {
      window.history.replaceState(null, '', `/dashboard/assistant${search}`);
    };

    it('opens the thread named in ?session= and cleans the URL', async () => {
      routes([SESSION], [{ role: 'assistant', content: 'handed-over transcript' }]);
      setSearch('?session=sess-1');
      render(<AssistantPage />);

      expect(await screen.findByText('handed-over transcript')).toBeInTheDocument();
      expect(mockApi.get).toHaveBeenCalledWith('/agent/chat/sessions/sess-1');
      // The param is consumed, so a later reload doesn't yank the user back.
      await waitFor(() => expect(window.location.search).toBe(''));
    });

    it('continues that thread on the next turn', async () => {
      routes([SESSION], [{ role: 'assistant', content: 'handed-over transcript' }]);
      mockApi.post.mockResolvedValue({ sessionId: 'sess-1', reply: 'kemarin Rp 3.900.000', toolsUsed: [] });
      setSearch('?session=sess-1');
      render(<AssistantPage />);
      await screen.findByText('handed-over transcript');

      typeAndSend('kalau kemarin?');

      await waitFor(() =>
        expect(mockApi.post).toHaveBeenCalledWith('/agent/chat', { message: 'kalau kemarin?', sessionId: 'sess-1' }),
      );
    });

    it('starts a normal empty chat when no session is handed over', async () => {
      routes([SESSION]);
      setSearch('');
      render(<AssistantPage />);

      expect(await screen.findByText('Ask me about your business')).toBeInTheDocument();
      expect(mockApi.get).not.toHaveBeenCalledWith('/agent/chat/sessions/sess-1');
    });
  });

  it('never blocks chatting when the history fetch fails', async () => {
    mockApi.get.mockRejectedValue(new Error('history down'));
    mockApi.post.mockResolvedValue({ sessionId: 'sess-9', reply: 'still works', toolsUsed: [] });
    render(<AssistantPage />);
    await screen.findByText('Ask me about your business');

    typeAndSend('omzet?');

    expect(await screen.findByText('still works')).toBeInTheDocument();
  });
});
