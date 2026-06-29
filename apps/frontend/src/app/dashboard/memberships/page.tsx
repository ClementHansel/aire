/**
 * Tenant Dashboard — Membership Plan Management page.
 * CRUD interface for managing membership plans.
 * Requirements: 3.3
 */
'use client';

import { useState, useEffect, useCallback } from 'react';

/** Membership plan record */
export interface MembershipPlan {
  id: string;
  name: string;
  durationMonths: 1 | 3 | 12;
  quotaCap: number;
  dailyLimit: number;
  maxPlates: number;
  price: number;
  freeServices: string[];
  discountedServices: string[];
  outletScope: 'all' | string[];
  active: boolean;
}

/** Props for MembershipPlanForm dialog */
interface PlanFormProps {
  plan: MembershipPlan | null;
  onSave: (data: Omit<MembershipPlan, 'id'>) => void;
  onCancel: () => void;
}

function PlanForm({ plan, onSave, onCancel }: PlanFormProps) {
  const [name, setName] = useState(plan?.name ?? '');
  const [durationMonths, setDurationMonths] = useState<1 | 3 | 12>(plan?.durationMonths ?? 1);
  const [quotaCap, setQuotaCap] = useState(plan?.quotaCap?.toString() ?? '30');
  const [dailyLimit, setDailyLimit] = useState(plan?.dailyLimit?.toString() ?? '1');
  const [maxPlates, setMaxPlates] = useState(plan?.maxPlates?.toString() ?? '3');
  const [price, setPrice] = useState(plan?.price?.toString() ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name,
      durationMonths,
      quotaCap: Number(quotaCap),
      dailyLimit: Number(dailyLimit),
      maxPlates: Number(maxPlates),
      price: Number(price),
      freeServices: [],
      discountedServices: [],
      outletScope: 'all',
      active: plan?.active ?? true,
    });
  };

  return (
    <div data-testid="plan-form-dialog" className="modal-overlay">
      <form onSubmit={handleSubmit} data-testid="plan-form" className="modal-form">
        <h3>{plan ? 'Edit Membership Plan' : 'Create Membership Plan'}</h3>
        <div>
          <label htmlFor="plan-name">Plan Name</label>
          <input
            id="plan-name"
            data-testid="plan-name-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="plan-duration">Duration (months)</label>
          <select
            id="plan-duration"
            data-testid="plan-duration-select"
            value={durationMonths}
            onChange={(e) => setDurationMonths(Number(e.target.value) as 1 | 3 | 12)}
          >
            <option value={1}>1 month</option>
            <option value={3}>3 months</option>
            <option value={12}>12 months</option>
          </select>
        </div>
        <div>
          <label htmlFor="plan-quota">Lifetime Quota Cap</label>
          <input
            id="plan-quota"
            data-testid="plan-quota-input"
            type="number"
            value={quotaCap}
            onChange={(e) => setQuotaCap(e.target.value)}
            min="1"
            required
          />
        </div>
        <div>
          <label htmlFor="plan-daily-limit">Daily Limit</label>
          <input
            id="plan-daily-limit"
            data-testid="plan-daily-limit-input"
            type="number"
            value={dailyLimit}
            onChange={(e) => setDailyLimit(e.target.value)}
            min="1"
            required
          />
        </div>
        <div>
          <label htmlFor="plan-max-plates">Max Plates</label>
          <input
            id="plan-max-plates"
            data-testid="plan-max-plates-input"
            type="number"
            value={maxPlates}
            onChange={(e) => setMaxPlates(e.target.value)}
            min="1"
            required
          />
        </div>
        <div>
          <label htmlFor="plan-price">Price</label>
          <input
            id="plan-price"
            data-testid="plan-price-input"
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            min="0"
            required
          />
        </div>
        <div className="form-actions">
          <button type="button" data-testid="plan-form-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" data-testid="plan-form-save">
            {plan ? 'Update' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Membership Plan Management page for the Tenant Dashboard.
 * Lists all membership plans with CRUD operations.
 */
export default function MembershipsPage() {
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<MembershipPlan | null>(null);

  const fetchPlans = useCallback(async () => {
    try {
      const res = await fetch('/api/membership-plans');
      if (!res.ok) throw new Error(`Failed to fetch plans: ${res.status}`);
      const data: MembershipPlan[] = await res.json();
      setPlans(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch plans');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const handleAdd = () => {
    setEditingPlan(null);
    setFormOpen(true);
  };

  const handleEdit = (plan: MembershipPlan) => {
    setEditingPlan(plan);
    setFormOpen(true);
  };

  const handleSave = async (data: Omit<MembershipPlan, 'id'>) => {
    try {
      if (editingPlan) {
        const res = await fetch(`/api/membership-plans/${editingPlan.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('Failed to update plan');
      } else {
        const res = await fetch('/api/membership-plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('Failed to create plan');
      }
      setFormOpen(false);
      setEditingPlan(null);
      await fetchPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handleDelete = async (planId: string) => {
    try {
      const res = await fetch(`/api/membership-plans/${planId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete plan');
      await fetchPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  if (loading) {
    return (
      <div data-testid="memberships-loading">
        <p>Loading membership plans...</p>
      </div>
    );
  }

  return (
    <div data-testid="memberships-page">
      <header className="page-header">
        <h1 data-testid="memberships-title">Membership Plans</h1>
        <button data-testid="add-plan-btn" onClick={handleAdd}>
          Add Plan
        </button>
      </header>

      {error && (
        <div data-testid="memberships-error" className="error-banner">
          {error}
        </div>
      )}

      {plans.length === 0 ? (
        <p data-testid="no-plans">No membership plans found. Create one to get started.</p>
      ) : (
        <table data-testid="plans-table" className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Duration</th>
              <th>Quota</th>
              <th>Daily Limit</th>
              <th>Max Plates</th>
              <th>Price</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.id} data-testid={`plan-row-${plan.id}`}>
                <td>{plan.name}</td>
                <td>{plan.durationMonths} mo</td>
                <td>{plan.quotaCap}</td>
                <td>{plan.dailyLimit}</td>
                <td>{plan.maxPlates}</td>
                <td>{plan.price.toLocaleString('id-ID')}</td>
                <td>
                  <button
                    data-testid={`edit-plan-${plan.id}`}
                    onClick={() => handleEdit(plan)}
                  >
                    Edit
                  </button>
                  <button
                    data-testid={`delete-plan-${plan.id}`}
                    onClick={() => handleDelete(plan.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {formOpen && (
        <PlanForm
          plan={editingPlan}
          onSave={handleSave}
          onCancel={() => {
            setFormOpen(false);
            setEditingPlan(null);
          }}
        />
      )}
    </div>
  );
}
