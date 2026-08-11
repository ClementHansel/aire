/**
 * The floating mini chat.
 *
 * Its whole reason to exist is asking a question without leaving the page you're
 * on — and then being able to continue that same conversation in full mode. So the
 * behaviour pinned down here is: it stays out of the way until opened, it chats,
 * and **expand carries the open thread** to the full page instead of dropping it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { FloatingChat } from './FloatingChat';
import { TENANT_CHAT } from './useAiChat';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

const widget = () => (
  <FloatingChat
    endpoints={TENANT_CHAT}
    fullPageHref="/dashboard/assistant"
    title="Airin AI Assistant"
    introTitle="Ask me about your business"
    introBody="Orders, revenue, memberships."
    suggestions={['How is business doing today?']}
    placeholder="Ask the assistant…"
    thinkingLabel="Thinking…"
    emptyHistoryLabel="No conversations yet."
  />
);

const openPanel = () => fireEvent.click(screen.getByTestId('floating-chat-launcher'));

describe('FloatingChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockApi.get.mockResolvedValue([]);
  });

  it('shows only a launcher until opened, and fetches nothing before that', () => {
    render(widget());

    expect(screen.getByTestId('floating-chat-launcher')).toBeInTheDocument();
    expect(screen.queryByTestId('floating-chat-panel')).not.toBeInTheDocument();
    expect(mockApi.get).not.toHaveBeenCalled();
  });

  it('opens on click and sends a message', async () => {
    mockApi.post.mockResolvedValue({ sessionId: 'sess-7', reply: 'Rp 4.500.000', toolsUsed: [] });
    render(widget());

    openPanel();
    fireEvent.change(await screen.findByPlaceholderText('Ask the assistant…'), { target: { value: 'omzet?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith('/agent/chat', { message: 'omzet?', sessionId: null }),
    );
    expect(await screen.findByText('Rp 4.500.000')).toBeInTheDocument();
  });

  describe('expand to full mode', () => {
    it('links to the full page with no session before anything is said', async () => {
      render(widget());
      openPanel();

      const expand = await screen.findByTestId('floating-chat-expand');
      expect(expand).toHaveAttribute('href', '/dashboard/assistant');
    });

    it('carries the open thread over once the conversation has one', async () => {
      mockApi.post.mockResolvedValue({ sessionId: 'sess-7', reply: 'Rp 4.500.000', toolsUsed: [] });
      render(widget());
      openPanel();

      fireEvent.change(await screen.findByPlaceholderText('Ask the assistant…'), { target: { value: 'omzet?' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await screen.findByText('Rp 4.500.000');

      // The full page reads ?session= on mount and opens that same thread.
      await waitFor(() =>
        expect(screen.getByTestId('floating-chat-expand')).toHaveAttribute(
          'href',
          '/dashboard/assistant?session=sess-7',
        ),
      );
    });

    it('collapses the panel on the way out, so the chat is not open twice', async () => {
      render(widget());
      openPanel();
      await screen.findByTestId('floating-chat-panel');

      fireEvent.click(screen.getByTestId('floating-chat-expand'));

      // Still mounted (an in-flight reply must survive) but hidden, and the
      // launcher is back.
      await waitFor(() => expect(screen.getByTestId('floating-chat-panel')).toHaveClass('invisible'));
      expect(screen.getByTestId('floating-chat-launcher')).toBeInTheDocument();
    });
  });

  it('remembers that it was open across a remount', async () => {
    const first = render(widget());
    openPanel();
    await screen.findByTestId('floating-chat-panel');
    first.unmount();

    render(widget());

    // No launcher click needed the second time.
    expect(await screen.findByTestId('floating-chat-panel')).not.toHaveClass('invisible');
  });

  it('browses saved conversations from the history icon', async () => {
    mockApi.get.mockImplementation((path: string) => {
      if (path === '/agent/chat/sessions') {
        return Promise.resolve([
          { id: 'sess-1', title: 'Revenue today', pinned: false, messageCount: 2, preview: null, createdAt: 'now', updatedAt: 'now' },
        ]);
      }
      return Promise.resolve([{ role: 'assistant', content: 'from history' }]);
    });
    render(widget());
    openPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Conversation history' }));
    fireEvent.click(await screen.findByText('Revenue today'));

    expect(await screen.findByText('from history')).toBeInTheDocument();
  });
});
