'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from './api';

export interface OnboardingStepState {
  done: boolean;
  count: number;
}

export interface OnboardingStatus {
  steps: {
    legal: OnboardingStepState;
    branch: OnboardingStepState;
    service: OnboardingStepState;
    staff: OnboardingStepState;
  };
  mandatoryComplete: boolean;
  completedAt: string | null;
  state: Record<string, unknown>;
}

/**
 * Fetch the current tenant's onboarding status (GET /onboarding/me).
 *
 * On error it returns null and treats onboarding as complete-unknown, so a
 * backend hiccup never traps a user on a blank gate. `reload` lets the wizard
 * refresh after each step.
 */
export function useOnboarding(): {
  status: OnboardingStatus | null;
  loading: boolean;
  reload: () => Promise<void>;
} {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const res = await api.get<OnboardingStatus>('/onboarding/me');
      setStatus(res);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  return { status, loading, reload };
}
