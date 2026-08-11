/**
 * The WhatsApp settings page: per-branch lines and the staff whitelist.
 *
 * Per-branch: the branch list (and its GET /agent-config/branches fetch) appears
 * ONLY when the tenant toggle (perBranchWaEnabled) is on.
 *
 * Whitelist: each row grants access to the business's own data from a phone, so
 * the list must show WHO and WHAT ACCESS, and add/edit/revoke/delete must all
 * reach the API.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AiAgentPage from './page';
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

function baseConfig(perBranchWaEnabled: boolean) {
  return {
    basePrompt: null, productKnowledge: null, skills: null, escalationNumber: null,
    maxMessagesPerDay: 50, waProvider: 'waha', waNumber: null, wahaSession: null,
    kirimConfigured: false, kirimPhoneId: null, aiReplyEnabled: true, perBranchWaEnabled, wahaMockEnabled: false,
    aiEnabled: false, llmProvider: 'openrouter', llmKeyConfigured: false,
  };
}

const OWNER_ROW = {
  id: 'wl-1', phone: '628111111111', label: 'Pak Samuel (owner)',
  accessLevel: 'full', notes: 'kepala cabang', isActive: true, lastUsedAt: null,
};

function routeGet(perBranch: boolean, whitelist: unknown[] = []) {
  mockApi.get.mockImplementation((path: string) => {
    if (path === '/agent-config') return Promise.resolve(baseConfig(perBranch));
    if (path === '/agent-config/branches') return Promise.resolve([{ outletId: 'o1', name: 'Bintaro', waProvider: 'waha', waNumber: null, wahaSession: null, kirimConfigured: false, kirimPhoneId: null, configured: false }]);
    if (path === '/whatsapp/whitelist') return Promise.resolve(whitelist);
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

describe('AiAgentPage — staff whitelist', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('invites the owner to add a number when the list is empty', async () => {
    routeGet(false, []);
    render(<AiAgentPage />);
    expect(await screen.findByText(/No staff numbers yet/)).toBeInTheDocument();
  });

  it('shows who each number belongs to and what access it has', async () => {
    routeGet(false, [OWNER_ROW]);
    render(<AiAgentPage />);

    expect(await screen.findByText('Pak Samuel (owner)')).toBeInTheDocument();
    expect(screen.getByText('full access')).toBeInTheDocument();
    expect(screen.getByText(/\+628111111111/)).toBeInTheDocument();
  });

  it('marks a revoked number so a dead grant is not mistaken for a live one', async () => {
    routeGet(false, [{ ...OWNER_ROW, isActive: false, accessLevel: 'read_only' }]);
    render(<AiAgentPage />);

    expect(await screen.findByText('revoked')).toBeInTheDocument();
    expect(screen.getByText('read only')).toBeInTheDocument();
    // Revoking is reversible, so the action reads "Restore".
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });

  it('adds a number', async () => {
    routeGet(false, []);
    mockApi.post.mockResolvedValue({ ...OWNER_ROW });
    render(<AiAgentPage />);
    await screen.findByText(/No staff numbers yet/);

    fireEvent.change(screen.getByPlaceholderText('0812xxxxxxx'), { target: { value: '08111111111' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Pak Samuel (owner)'), { target: { value: 'Pak Samuel (owner)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add number' }));

    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith('/whatsapp/whitelist', {
        phone: '08111111111', label: 'Pak Samuel (owner)', accessLevel: 'full', notes: null,
      }),
    );
  });

  it('revokes without deleting the record of who had access', async () => {
    routeGet(false, [OWNER_ROW]);
    mockApi.patch.mockResolvedValue({});
    render(<AiAgentPage />);
    await screen.findByText('Pak Samuel (owner)');

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(mockApi.patch).toHaveBeenCalledWith('/whatsapp/whitelist/wl-1', { isActive: false }));
    expect(mockApi.delete).not.toHaveBeenCalled();
  });

  it('edits an existing number through the same form', async () => {
    routeGet(false, [OWNER_ROW]);
    mockApi.patch.mockResolvedValue({});
    render(<AiAgentPage />);
    await screen.findByText('Pak Samuel (owner)');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    // The form is pre-filled with the row being edited, and the button changes.
    expect(screen.getByPlaceholderText('0812xxxxxxx')).toHaveValue('628111111111');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'read_only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update number' }));

    await waitFor(() =>
      expect(mockApi.patch).toHaveBeenCalledWith('/whatsapp/whitelist/wl-1', {
        phone: '628111111111', label: 'Pak Samuel (owner)', accessLevel: 'read_only', notes: 'kepala cabang',
      }),
    );
  });

  it('confirms before deleting', async () => {
    routeGet(false, [OWNER_ROW]);
    mockApi.delete.mockResolvedValue({});
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<AiAgentPage />);
    await screen.findByText('Pak Samuel (owner)');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(confirm).toHaveBeenCalled();
    expect(mockApi.delete).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('/whatsapp/whitelist/wl-1'));
    confirm.mockRestore();
  });

  // A proxy error page or an older backend must not blank the settings page.
  it('survives a non-array response', async () => {
    routeGet(false, undefined as never);
    mockApi.get.mockImplementation((path: string) => {
      if (path === '/agent-config') return Promise.resolve(baseConfig(false));
      if (path === '/whatsapp/whitelist') return Promise.resolve({} as never);
      return Promise.resolve({});
    });
    render(<AiAgentPage />);

    expect(await screen.findByText(/No staff numbers yet/)).toBeInTheDocument();
  });
});
