/**
 * Per-branch WhatsApp UI on the Agentic AI page. The branch list (and its
 * GET /agent-config/branches fetch) appears ONLY when the tenant toggle
 * (perBranchWaEnabled) is on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AiAgentPage from './page';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/i18n', () => ({
  useI18n: () => ({ t: (_k: string, fallback?: string) => fallback ?? _k }),
}));

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> };

function baseConfig(perBranchWaEnabled: boolean) {
  return {
    basePrompt: null, productKnowledge: null, skills: null, escalationNumber: null,
    maxMessagesPerDay: 50, waProvider: 'waha', waNumber: null, wahaSession: null,
    kapsoConfigured: false, aiReplyEnabled: true, perBranchWaEnabled, wahaMockEnabled: false,
    aiEnabled: false, llmProvider: 'openrouter', llmKeyConfigured: false,
  };
}

function routeGet(perBranch: boolean) {
  mockApi.get.mockImplementation((path: string) => {
    if (path === '/agent-config') return Promise.resolve(baseConfig(perBranch));
    if (path === '/agent-config/branches') return Promise.resolve([{ outletId: 'o1', name: 'Bintaro', waProvider: 'waha', waNumber: null, wahaSession: null, kapsoConfigured: false, configured: false }]);
    if (path.startsWith('/whatsapp/status')) return Promise.resolve({ status: 'WORKING' });
    return Promise.resolve({});
  });
}

describe('AiAgentPage — per-branch WhatsApp', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the branch list when the toggle is ON', async () => {
    routeGet(true);
    render(<AiAgentPage />);
    expect(await screen.findByText('Bintaro')).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith('/agent-config/branches');
  });

  it('hides the branch list (and does not fetch it) when the toggle is OFF', async () => {
    routeGet(false);
    render(<AiAgentPage />);
    // the toggle card title always renders; wait for the page to settle
    await waitFor(() => expect(screen.getByText('Separate WhatsApp per branch')).toBeInTheDocument());
    expect(screen.queryByText('Bintaro')).not.toBeInTheDocument();
    expect(mockApi.get).not.toHaveBeenCalledWith('/agent-config/branches');
  });
});
