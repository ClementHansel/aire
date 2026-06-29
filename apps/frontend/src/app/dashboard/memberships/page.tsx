'use client';

import { useState } from 'react';

interface MembershipPlan {
  id: string;
  name: string;
  durationMonths: number;
  quotaCap: number;
  dailyLimit: number;
  maxPlates: number;
  price: number;
  active: boolean;
}

const DEMO_PLANS: MembershipPlan[] = [
  { id: '1', name: 'Basic', durationMonths: 1, quotaCap: 10, dailyLimit: 1, maxPlates: 2, price: 150000, active: true },
  { id: '2', name: 'Silver', durationMonths: 3, quotaCap: 30, dailyLimit: 1, maxPlates: 3, price: 400000, active: true },
  { id: '3', name: 'Gold', durationMonths: 12, quotaCap: 120, dailyLimit: 2, maxPlates: 4, price: 1200000, active: true },
  { id: '4', name: 'Platinum', durationMonths: 12, quotaCap: 999, dailyLimit: 3, maxPlates: 5, price: 2500000, active: false },
];

export default function MembershipsPage() {
  const [plans] = useState<MembershipPlan[]>(DEMO_PLANS);

  return (
    <div data-testid="memberships-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary" data-testid="memberships-title">Membership Plans</h1>
          <p className="mt-1 text-sm text-text-secondary">Configure plans, quotas, and pricing for your members.</p>
        </div>
        <button className="btn-primary" data-testid="add-plan-btn">+ Add Plan</button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => (
          <div key={plan.id} className="card relative" data-testid={`plan-row-${plan.id}`}>
            {!plan.active && (
              <div className="absolute top-3 right-3">
                <span className="badge bg-gray-100 text-gray-500">Inactive</span>
              </div>
            )}
            <h3 className="text-lg font-semibold text-text-primary">{plan.name}</h3>
            <p className="text-2xl font-bold text-primary-600 mt-2">
              Rp {plan.price.toLocaleString('id-ID')}
            </p>
            <p className="text-xs text-text-muted mt-1">{plan.durationMonths} month{plan.durationMonths > 1 ? 's' : ''}</p>

            <div className="mt-4 pt-4 border-t border-border space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Quota Cap</span>
                <span className="font-medium text-text-primary">{plan.quotaCap === 999 ? 'Unlimited' : plan.quotaCap} washes</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Daily Limit</span>
                <span className="font-medium text-text-primary">{plan.dailyLimit}/day</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Max Plates</span>
                <span className="font-medium text-text-primary">{plan.maxPlates} vehicles</span>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-border flex gap-2">
              <button className="btn-secondary flex-1 text-xs">Edit</button>
              <button className="btn-ghost text-xs text-error">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
