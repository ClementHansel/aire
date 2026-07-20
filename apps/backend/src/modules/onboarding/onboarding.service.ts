import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

/** One onboarding step's derived state. `done` is computed from real data. */
export interface OnboardingStep {
  done: boolean;
  count: number;
}

export interface OnboardingStatus {
  /** Legal entity, branch and service are the mandatory gate; staff is guided. */
  steps: {
    legal: OnboardingStep;
    branch: OnboardingStep;
    service: OnboardingStep;
    staff: OnboardingStep;
  };
  /** legal && branch && service — the condition to allow completion. */
  mandatoryComplete: boolean;
  /** Null until the owner finishes the wizard; drives the app gate. */
  completedAt: string | null;
  /** Free-form wizard progress (current step, skipped optional steps, prefilledBy). */
  state: Record<string, unknown>;
}

/**
 * Tenant onboarding status + lifecycle. Step completion is DERIVED from the
 * operational tables (legal_entities / outlets / services / users) so it can
 * never drift from reality; only the "finished" flag and the wizard's UI
 * progress are persisted on the tenant row.
 */
@Injectable()
export class OnboardingService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async getStatus(tenantId: string): Promise<OnboardingStatus> {
    const res = await this.pool.query<{
      legal: string; branch: string; service: string; staff: string;
      onboarding_completed_at: Date | null; onboarding_state: Record<string, unknown> | null;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM legal_entities WHERE tenant_id = $1 AND is_active) AS legal,
         (SELECT COUNT(*) FROM outlets        WHERE tenant_id = $1)               AS branch,
         (SELECT COUNT(*) FROM services       WHERE tenant_id = $1 AND is_active) AS service,
         (SELECT COUNT(*) FROM users          WHERE tenant_id = $1 AND is_active AND role <> 'tenant_owner') AS staff,
         t.onboarding_completed_at, t.onboarding_state
       FROM tenants t WHERE t.id = $1`,
      [tenantId],
    );
    const r = res.rows[0];
    const n = (v: string | undefined) => parseInt(v ?? '0', 10) || 0;
    const legal = n(r?.legal), branch = n(r?.branch), service = n(r?.service), staff = n(r?.staff);
    // Lean onboarding: only a branch + one service are required to start taking
    // orders. Legal entity and finance provisioning are held features, so they
    // are no longer mandatory gates. (Legal count is still reported for the UI.)
    const mandatoryComplete = branch > 0 && service > 0;
    return {
      steps: {
        legal: { done: legal > 0, count: legal },
        branch: { done: branch > 0, count: branch },
        service: { done: service > 0, count: service },
        staff: { done: staff > 0, count: staff },
      },
      mandatoryComplete,
      completedAt: r?.onboarding_completed_at ? r.onboarding_completed_at.toISOString() : null,
      state: r?.onboarding_state ?? {},
    };
  }

  /** Merge a patch into the persisted wizard progress (shallow merge). */
  async saveState(tenantId: string, patch: Record<string, unknown>): Promise<OnboardingStatus> {
    await this.pool.query(
      `UPDATE tenants SET onboarding_state = COALESCE(onboarding_state, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
       WHERE id = $1`,
      [tenantId, JSON.stringify(patch ?? {})],
    );
    return this.getStatus(tenantId);
  }

  /**
   * Finish onboarding — allowed only once the mandatory steps (legal + branch +
   * service) are satisfied. Idempotent: re-completing keeps the first timestamp.
   */
  async complete(tenantId: string): Promise<OnboardingStatus> {
    const status = await this.getStatus(tenantId);
    if (status.completedAt) return status; // already done
    if (!status.mandatoryComplete) {
      throw new BadRequestException('Finish the required steps first: a branch and at least one service.');
    }
    await this.pool.query(
      `UPDATE tenants SET onboarding_completed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND onboarding_completed_at IS NULL`,
      [tenantId],
    );
    return this.getStatus(tenantId);
  }
}
