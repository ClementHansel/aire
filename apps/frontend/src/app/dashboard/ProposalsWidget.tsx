'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Action Proposals dashboard widget.
 * Displays pending AI action proposals with approve/reject capabilities.
 * Connects to WebSocket for real-time proposal notifications.
 * Requirements: 6.3, 7.3
 */

export interface ActionProposal {
  id: string;
  tenant_id: string;
  action_type: string;
  parameters: Record<string, unknown>;
  ai_reasoning: string;
  confidence_score: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

interface ProposalsWidgetProps {
  tenantId: string;
  apiBaseUrl?: string;
  wsBaseUrl?: string;
}

export default function ProposalsWidget({
  tenantId,
  apiBaseUrl = '/api',
  wsBaseUrl,
}: ProposalsWidgetProps) {
  const [proposals, setProposals] = useState<ActionProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<'approve' | 'reject' | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const fetchProposals = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `${apiBaseUrl}/agent/${tenantId}/proposals?status=pending`
      );
      if (response.ok) {
        const data: ActionProposal[] = await response.json();
        setProposals(data);
      }
    } catch {
      // Silently handle fetch errors — widget is non-critical
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, tenantId]);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  // WebSocket connection for real-time proposal notifications
  useEffect(() => {
    if (!wsBaseUrl) return;

    const ws = new WebSocket(`${wsBaseUrl}/agent/${tenantId}/proposals`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'proposal_created') {
          const newProposal: ActionProposal = message.payload;
          setProposals((prev) => [newProposal, ...prev]);
        } else if (message.type === 'proposal_updated') {
          const updated: ActionProposal = message.payload;
          setProposals((prev) =>
            prev
              .map((p) => (p.id === updated.id ? updated : p))
              .filter((p) => p.status === 'pending')
          );
        }
      } catch {
        // Ignore malformed messages
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [wsBaseUrl, tenantId]);

  const handleApprove = useCallback(
    async (proposalId: string) => {
      try {
        const response = await fetch(
          `${apiBaseUrl}/agent/${tenantId}/proposals/${proposalId}/approve`,
          { method: 'POST' }
        );
        if (response.ok) {
          setProposals((prev) => prev.filter((p) => p.id !== proposalId));
        }
      } catch {
        // Silently handle errors
      } finally {
        setConfirmingId(null);
        setConfirmAction(null);
      }
    },
    [apiBaseUrl, tenantId]
  );

  const handleReject = useCallback(
    async (proposalId: string) => {
      try {
        const response = await fetch(
          `${apiBaseUrl}/agent/${tenantId}/proposals/${proposalId}/reject`,
          { method: 'POST' }
        );
        if (response.ok) {
          setProposals((prev) => prev.filter((p) => p.id !== proposalId));
        }
      } catch {
        // Silently handle errors
      } finally {
        setConfirmingId(null);
        setConfirmAction(null);
      }
    },
    [apiBaseUrl, tenantId]
  );

  const requestConfirmation = (id: string, action: 'approve' | 'reject') => {
    setConfirmingId(id);
    setConfirmAction(action);
  };

  const cancelConfirmation = () => {
    setConfirmingId(null);
    setConfirmAction(null);
  };

  const confirmActionHandler = () => {
    if (!confirmingId || !confirmAction) return;
    if (confirmAction === 'approve') {
      handleApprove(confirmingId);
    } else {
      handleReject(confirmingId);
    }
  };

  const formatTimestamp = (isoString: string): string => {
    try {
      return new Date(isoString).toLocaleString();
    } catch {
      return isoString;
    }
  };

  const formatConfidence = (score: number): string => {
    return `${Math.round(score * 100)}%`;
  };

  if (loading) {
    return (
      <div data-testid="proposals-widget" className="proposals-widget">
        <h2>Action Proposals</h2>
        <div data-testid="proposals-loading" className="proposals-loading">
          Loading proposals...
        </div>
      </div>
    );
  }

  return (
    <div data-testid="proposals-widget" className="proposals-widget">
      <h2>Action Proposals</h2>

      {proposals.length === 0 ? (
        <p data-testid="proposals-empty" className="proposals-empty">
          No pending proposals.
        </p>
      ) : (
        <ul data-testid="proposals-list" className="proposals-list">
          {proposals.map((proposal) => (
            <li
              key={proposal.id}
              data-testid={`proposal-card-${proposal.id}`}
              className="proposal-card"
            >
              <div className="proposal-header">
                <span
                  data-testid={`proposal-action-type-${proposal.id}`}
                  className="proposal-action-type"
                >
                  {proposal.action_type}
                </span>
                <span
                  data-testid={`proposal-confidence-${proposal.id}`}
                  className="proposal-confidence"
                >
                  {formatConfidence(proposal.confidence_score)}
                </span>
              </div>

              <p
                data-testid={`proposal-reasoning-${proposal.id}`}
                className="proposal-reasoning"
              >
                {proposal.ai_reasoning}
              </p>

              <time
                data-testid={`proposal-timestamp-${proposal.id}`}
                className="proposal-timestamp"
                dateTime={proposal.created_at}
              >
                {formatTimestamp(proposal.created_at)}
              </time>

              <div className="proposal-actions">
                {confirmingId === proposal.id ? (
                  <div className="proposal-confirmation">
                    <span>
                      Confirm {confirmAction === 'approve' ? 'approval' : 'rejection'}?
                    </span>
                    <button
                      onClick={confirmActionHandler}
                      className="btn-confirm-yes"
                    >
                      Yes
                    </button>
                    <button
                      onClick={cancelConfirmation}
                      className="btn-confirm-no"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      data-testid={`proposal-approve-${proposal.id}`}
                      onClick={() => requestConfirmation(proposal.id, 'approve')}
                      className="btn-approve"
                    >
                      Approve
                    </button>
                    <button
                      data-testid={`proposal-reject-${proposal.id}`}
                      onClick={() => requestConfirmation(proposal.id, 'reject')}
                      className="btn-reject"
                    >
                      Reject
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
