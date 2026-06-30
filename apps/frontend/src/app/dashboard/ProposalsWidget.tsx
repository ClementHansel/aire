'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

export interface ActionProposal {
  id: string;
  tenant_id: string;
  action_type: string;
  parameters: Record<string, unknown>;
  ai_reasoning: string;
  confidence_score: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  created_at: string;
}

export default function ProposalsWidget({ tenantId }: { tenantId: string }) {
  const [proposals, setProposals] = useState<ActionProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<ActionProposal[]>(`/agent/${tenantId}/proposals?status=pending`);
      setProposals(data);
    } catch {
      setProposals([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const resolve = async (id: string, action: 'approve' | 'reject') => {
    setBusyId(id);
    try {
      await api.post(`/agent/${tenantId}/proposals/${id}/${action}`);
      setProposals((prev) => prev.filter((p) => p.id !== id));
    } catch {
      // keep item on failure
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="card" data-testid="proposals-widget">
      <h2 className="section-title">AI Action Proposals</h2>
      <p className="section-description">Pending recommendations from the AI agent.</p>

      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-text-muted">Loading…</p>
        ) : proposals.length === 0 ? (
          <p className="text-sm text-text-muted italic" data-testid="proposals-empty">
            No pending proposals. Enable AI automation in Settings to get started.
          </p>
        ) : (
          <ul className="space-y-3" data-testid="proposals-list">
            {proposals.map((p) => (
              <li key={p.id} className="rounded-lg border border-border p-4" data-testid={`proposal-card-${p.id}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="badge bg-primary-50 text-primary-700 capitalize">{p.action_type.replace(/_/g, ' ')}</span>
                  <span className="text-xs text-text-muted">{Math.round(p.confidence_score * 100)}% confidence</span>
                </div>
                <p className="text-sm text-text-secondary">{p.ai_reasoning}</p>
                <div className="flex gap-2 mt-3">
                  <button className="btn-primary text-xs py-1.5 px-3" disabled={busyId === p.id} onClick={() => resolve(p.id, 'approve')}>Approve</button>
                  <button className="btn-secondary text-xs py-1.5 px-3" disabled={busyId === p.id} onClick={() => resolve(p.id, 'reject')}>Reject</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
