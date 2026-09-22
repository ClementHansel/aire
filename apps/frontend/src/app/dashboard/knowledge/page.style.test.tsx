/**
 * The reply-behaviour controls on the AI Knowledge page.
 *
 * These exist so a client can retune their bot themselves — "easier to change
 * here and there" — rather than asking us to edit a prompt. That only holds if
 * the controls round-trip: load the stored value, change it, send ONLY what
 * changed, and show the saved result. Each of those is a separate way for the
 * feature to look present and do nothing, so each is pinned here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import KnowledgePage from './page';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/i18n', () => ({
  useI18n: () => ({ t: (_k: string, fallback?: string) => fallback ?? _k }),
}));
// The uploaded-documents panel does its own fetching and is not under test here.
vi.mock('./KnowledgeDocuments', () => ({ default: () => null }));

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
};

const DEFAULT_STYLE = {
  replyStyle: 'balanced',
  replyMaxLines: null,
  knowledgeScope: 'open',
  styleInstructions: null,
  escalateOnQuote: false,
};

function knowledge(style: Partial<typeof DEFAULT_STYLE> = {}) {
  return {
    basePrompt: null,
    productKnowledge: null,
    skills: null,
    style: { ...DEFAULT_STYLE, ...style },
    categories: {
      service_prices: true, promotions: true, membership_plans: true, vouchers: true,
      branches: true, opening_hours: true, branch_contact: true,
    },
    items: { services: [], promotions: [], plans: [], outlets: [] },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.get.mockResolvedValue(knowledge());
  mockApi.put.mockImplementation(async (_url: string, body: Record<string, unknown>) => {
    const s = (body.style ?? {}) as Record<string, unknown>;
    return knowledge(s as Partial<typeof DEFAULT_STYLE>);
  });
});

describe('reply-behaviour controls', () => {
  it('renders every control with the tenant\'s stored values, not the defaults', async () => {
    mockApi.get.mockResolvedValue(knowledge({
      replyStyle: 'concise', replyMaxLines: 5, knowledgeScope: 'strict',
      escalateOnQuote: true, styleInstructions: 'Sebut akreditasi KAN.',
    }));
    render(<KnowledgePage />);

    await waitFor(() => expect(screen.getByTestId('reply-style')).toHaveValue('concise'));
    expect(screen.getByTestId('reply-max-lines')).toHaveValue(5);
    expect(screen.getByTestId('knowledge-scope')).toHaveValue('strict');
    expect(screen.getByTestId('escalate-on-quote')).toBeChecked();
    expect(screen.getByTestId('style-instructions')).toHaveValue('Sebut akreditasi KAN.');
  });

  it('sends ONLY the setting that changed', async () => {
    // The whole per-tenant guarantee rests on this: a page that PUT the entire
    // object would write values the owner never touched, and a later change to
    // a platform default would stop reaching them.
    render(<KnowledgePage />);
    await waitFor(() => expect(screen.getByTestId('reply-style')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('reply-style'), { target: { value: 'concise' } });
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() => expect(mockApi.put).toHaveBeenCalled());
    const [url, body] = mockApi.put.mock.calls[0];
    expect(url).toBe('/agent-config/knowledge');
    expect(body.style).toEqual({ replyStyle: 'concise' });
  });

  it('sends nothing for style when the owner only edited something else', async () => {
    render(<KnowledgePage />);
    await waitFor(() => expect(screen.getByTestId('base-prompt')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('base-prompt'), { target: { value: 'Halo' } });
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() => expect(mockApi.put).toHaveBeenCalled());
    expect(mockApi.put.mock.calls[0][1]).not.toHaveProperty('style');
  });

  it('clears a blank line cap to null rather than sending 0 or NaN', async () => {
    // "No limit" is a real choice, and an empty number input reads as ''.
    mockApi.get.mockResolvedValue(knowledge({ replyMaxLines: 8 }));
    render(<KnowledgePage />);
    await waitFor(() => expect(screen.getByTestId('reply-max-lines')).toHaveValue(8));

    fireEvent.change(screen.getByTestId('reply-max-lines'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() => expect(mockApi.put).toHaveBeenCalled());
    expect(mockApi.put.mock.calls[0][1].style).toEqual({ replyMaxLines: null });
  });

  it('saves the checkbox and the free-text box', async () => {
    render(<KnowledgePage />);
    await waitFor(() => expect(screen.getByTestId('escalate-on-quote')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('escalate-on-quote'));
    fireEvent.change(screen.getByTestId('style-instructions'), { target: { value: 'Jangan janjikan lead time.' } });
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() => expect(mockApi.put).toHaveBeenCalled());
    expect(mockApi.put.mock.calls[0][1].style).toEqual({
      escalateOnQuote: true,
      styleInstructions: 'Jangan janjikan lead time.',
    });
  });
});

describe('reset to default', () => {
  it('is hidden while the tenant is on the defaults', async () => {
    render(<KnowledgePage />);
    await waitFor(() => expect(screen.getByTestId('reply-style')).toBeInTheDocument());
    expect(screen.queryByTestId('reset-style')).toBeNull();
  });

  it('appears once anything is customised, and puts every control back', async () => {
    // Experimenting is only safe if there is a way back; without this an owner
    // who dislikes their change has to remember what the defaults were.
    mockApi.get.mockResolvedValue(knowledge({
      replyStyle: 'concise', replyMaxLines: 4, knowledgeScope: 'strict', escalateOnQuote: true,
    }));
    render(<KnowledgePage />);
    await waitFor(() => expect(screen.getByTestId('reset-style')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('reset-style'));

    expect(screen.getByTestId('reply-style')).toHaveValue('balanced');
    expect(screen.getByTestId('reply-max-lines')).toHaveValue(null);
    expect(screen.getByTestId('knowledge-scope')).toHaveValue('open');
    expect(screen.getByTestId('escalate-on-quote')).not.toBeChecked();
  });
});

describe('the controls come before the free-text prompt', () => {
  it('puts "How your assistant replies" above "Assistant instructions"', async () => {
    // Ordering is the guidance: a prompt textarea first invites an owner to
    // rewrite in prose what a dropdown already does, and then to contradict it.
    render(<KnowledgePage />);
    await waitFor(() => expect(screen.getByText('How your assistant replies')).toBeInTheDocument());

    const controls = screen.getByText('How your assistant replies');
    const freeText = screen.getByText('Assistant instructions');
    expect(controls.compareDocumentPosition(freeText) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
