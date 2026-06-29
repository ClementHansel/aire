/**
 * Unit tests for ProposalsWidget component.
 * Requirements: 6.3, 7.3
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ProposalsWidget, { type ActionProposal } from './ProposalsWidget';

const mockProposals: ActionProposal[] = [
  {
    id: 'proposal-1',
    tenant_id: 'tenant-1',
    action_type: 'create_campaign',
    parameters: { name: 'Summer Sale' },
    ai_reasoning: 'Revenue dropped 15% this week, a targeted campaign could help.',
    confidence_score: 0.87,
    status: 'pending',
    created_at: '2024-06-15T10:30:00Z',
    resolved_at: null,
    resolved_by: null,
  },
  {
    id: 'proposal-2',
    tenant_id: 'tenant-1',
    action_type: 'send_retention_offer',
    parameters: { member_id: 'mem-123', discount: 20 },
    ai_reasoning: 'Member has not visited in 30 days, at risk of churning.',
    confidence_score: 0.72,
    status: 'pending',
    created_at: '2024-06-15T11:00:00Z',
    resolved_at: null,
    resolved_by: null,
  },
];

// Mock WebSocket
class MockWebSocket {
  url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  static instances: MockWebSocket[] = [];
  static reset() {
    MockWebSocket.instances = [];
  }
}

describe('ProposalsWidget', () => {
  beforeEach(() => {
    MockWebSocket.reset();
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render loading state initially', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}) // never resolves
    );

    render(<ProposalsWidget tenantId="tenant-1" />);
    expect(screen.getByTestId('proposals-widget')).toBeInTheDocument();
    expect(screen.getByTestId('proposals-loading')).toBeInTheDocument();
    expect(screen.getByTestId('proposals-loading')).toHaveTextContent('Loading proposals...');
  });

  it('should render empty state when no proposals', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    render(<ProposalsWidget tenantId="tenant-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('proposals-empty')).toBeInTheDocument();
    });
    expect(screen.getByTestId('proposals-empty')).toHaveTextContent('No pending proposals.');
  });

  it('should render proposals list with all required data', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockProposals,
    });

    render(<ProposalsWidget tenantId="tenant-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('proposals-list')).toBeInTheDocument();
    });

    // Check first proposal
    expect(screen.getByTestId('proposal-card-proposal-1')).toBeInTheDocument();
    expect(screen.getByTestId('proposal-action-type-proposal-1')).toHaveTextContent(
      'create_campaign'
    );
    expect(screen.getByTestId('proposal-reasoning-proposal-1')).toHaveTextContent(
      'Revenue dropped 15% this week, a targeted campaign could help.'
    );
    expect(screen.getByTestId('proposal-confidence-proposal-1')).toHaveTextContent('87%');
    expect(screen.getByTestId('proposal-timestamp-proposal-1')).toBeInTheDocument();

    // Check second proposal
    expect(screen.getByTestId('proposal-card-proposal-2')).toBeInTheDocument();
    expect(screen.getByTestId('proposal-action-type-proposal-2')).toHaveTextContent(
      'send_retention_offer'
    );
    expect(screen.getByTestId('proposal-reasoning-proposal-2')).toHaveTextContent(
      'Member has not visited in 30 days, at risk of churning.'
    );
    expect(screen.getByTestId('proposal-confidence-proposal-2')).toHaveTextContent('72%');
    expect(screen.getByTestId('proposal-timestamp-proposal-2')).toBeInTheDocument();
  });

  it('should render approve and reject buttons for each proposal', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockProposals,
    });

    render(<ProposalsWidget tenantId="tenant-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('proposals-list')).toBeInTheDocument();
    });

    expect(screen.getByTestId('proposal-approve-proposal-1')).toBeInTheDocument();
    expect(screen.getByTestId('proposal-reject-proposal-1')).toBeInTheDocument();
    expect(screen.getByTestId('proposal-approve-proposal-2')).toBeInTheDocument();
    expect(screen.getByTestId('proposal-reject-proposal-2')).toBeInTheDocument();
  });

  it('should show confirmation when approve is clicked', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockProposals,
    });

    render(<ProposalsWidget tenantId="tenant-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('proposal-approve-proposal-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('proposal-approve-proposal-1'));

    expect(screen.getByText('Confirm approval?')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('should show confirmation when reject is clicked', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockProposals,
    });

    render(<ProposalsWidget tenantId="tenant-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('proposal-reject-proposal-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('proposal-reject-proposal-1'));

    expect(screen.getByText('Confirm rejection?')).toBeInTheDocument();
  });

  it('should call approve API and remove proposal on confirm', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => mockProposals })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    render(<ProposalsWidget tenantId="tenant-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('proposal-approve-proposal-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('proposal-approve-proposal-1'));
    fireEvent.click(screen.getByText('Yes'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/agent/tenant-1/proposals/proposal-1/approve',
        { method: 'POST' }
      );
    });

    await waitFor(() => {
      expect(screen.queryByTestId('proposal-card-proposal-1')).not.toBeInTheDocument();
    });
  });

  it('should call reject API and remove proposal on confirm', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => mockProposals })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    render(<ProposalsWidget tenantId="tenant-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('proposal-reject-proposal-2')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('proposal-reject-proposal-2'));
    fireEvent.click(screen.getByText('Yes'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/agent/tenant-1/proposals/proposal-2/reject',
        { method: 'POST' }
      );
    });

    await waitFor(() => {
      expect(screen.queryByTestId('proposal-card-proposal-2')).not.toBeInTheDocument();
    });
  });

  it('should cancel confirmation when No is clicked', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockProposals,
    });

    render(<ProposalsWidget tenantId="tenant-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('proposal-approve-proposal-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('proposal-approve-proposal-1'));
    expect(screen.getByText('Confirm approval?')).toBeInTheDocument();

    fireEvent.click(screen.getByText('No'));

    // Buttons should reappear
    expect(screen.getByTestId('proposal-approve-proposal-1')).toBeInTheDocument();
    expect(screen.getByTestId('proposal-reject-proposal-1')).toBeInTheDocument();
  });

  it('should connect to WebSocket and handle new proposals', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    render(
      <ProposalsWidget
        tenantId="tenant-1"
        wsBaseUrl="ws://localhost:3001"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('proposals-empty')).toBeInTheDocument();
    });

    // Verify WebSocket was created with correct URL
    expect(MockWebSocket.instances.length).toBe(1);
    expect(MockWebSocket.instances[0].url).toBe(
      'ws://localhost:3001/agent/tenant-1/proposals'
    );

    // Simulate receiving a new proposal via WebSocket
    const wsInstance = MockWebSocket.instances[0];
    const newProposal: ActionProposal = {
      id: 'proposal-new',
      tenant_id: 'tenant-1',
      action_type: 'flag_anomaly',
      parameters: { anomaly: 'revenue_spike' },
      ai_reasoning: 'Unusual revenue spike detected at outlet A.',
      confidence_score: 0.95,
      status: 'pending',
      created_at: '2024-06-15T12:00:00Z',
      resolved_at: null,
      resolved_by: null,
    };

    wsInstance.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'proposal_created', payload: newProposal }),
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId('proposal-card-proposal-new')).toBeInTheDocument();
    });

    expect(screen.getByTestId('proposal-action-type-proposal-new')).toHaveTextContent(
      'flag_anomaly'
    );
  });

  it('should fetch proposals with pending status filter', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    render(<ProposalsWidget tenantId="tenant-1" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/agent/tenant-1/proposals?status=pending'
      );
    });
  });
});
