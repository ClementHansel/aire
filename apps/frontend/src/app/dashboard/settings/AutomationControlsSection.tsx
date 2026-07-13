'use client';

import { useState, useCallback } from 'react';

/**
 * Automation Controls Section — a toggle card per AI automation capability, each
 * with a per-capability approval mode. Controlled by the parent, which persists
 * every change immediately (PATCH /api/settings/:tenantId) so the runtime honors it.
 * Requirements: 4.1, 4.3, 4.4, 7.1, 7.4
 */

export type ApprovalMode = 'approval_required' | 'autonomous';

export type AutomationKey =
  | 'campaigns'
  | 'retention_offers'
  | 'pricing_suggestions'
  | 'anomaly_alerts'
  | 'queue_optimization'
  | 'membership_recommendations';

export interface AutomationCapability {
  key: AutomationKey;
  label: string;
  description: string;
  requiresLLMKey: boolean;
}

export interface AutomationControlsState {
  ai_enabled: boolean;
  llm_provider: 'openrouter' | 'hermes_ai' | null;
  llm_api_key_configured: boolean;
  toggles: Record<AutomationKey, boolean>;
  approval_modes: Record<AutomationKey, ApprovalMode>;
}

export interface AutomationControlsSectionProps {
  state: AutomationControlsState;
  onToggleChange: (key: AutomationKey, enabled: boolean) => void;
  onApprovalModeChange: (key: AutomationKey, mode: ApprovalMode) => void;
}

export const AUTOMATION_CAPABILITIES: AutomationCapability[] = [
  { key: 'campaigns', label: 'Campaigns', description: 'Automatically create and manage marketing campaigns based on business metrics', requiresLLMKey: true },
  { key: 'retention_offers', label: 'Retention Offers', description: 'Send personalized retention offers to customers at risk of churning', requiresLLMKey: true },
  { key: 'pricing_suggestions', label: 'Pricing Suggestions', description: 'AI-powered pricing recommendations based on demand patterns', requiresLLMKey: false },
  { key: 'anomaly_alerts', label: 'Anomaly Alerts', description: 'Detect and flag unusual patterns in revenue, traffic, or service metrics', requiresLLMKey: false },
  { key: 'queue_optimization', label: 'Queue Optimization', description: 'Optimize service queue priorities based on customer data and wait times', requiresLLMKey: false },
  { key: 'membership_recommendations', label: 'Membership Recommendations', description: 'Send personalized membership plan recommendations to customers', requiresLLMKey: true },
];

function isPrerequisiteMet(capability: AutomationCapability, state: AutomationControlsState): boolean {
  if (!state.ai_enabled) return false;
  if (capability.requiresLLMKey) {
    if (state.llm_provider === 'hermes_ai') return true;
    if (state.llm_provider === 'openrouter' && state.llm_api_key_configured) return true;
    return false;
  }
  return true;
}

function getPrerequisiteMessage(capability: AutomationCapability, state: AutomationControlsState): string {
  if (!state.ai_enabled) return 'Enable global AI automation to use this capability.';
  if (capability.requiresLLMKey) return 'Configure an LLM provider (OpenRouter with API key or Hermes AI) to enable this capability.';
  return '';
}

interface ConfirmDialogProps {
  capabilityLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function AutonomousConfirmDialog({ capabilityLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div
      data-testid="autonomous-confirm-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="alertdialog"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="card relative w-full max-w-md">
        <h3 id="confirm-dialog-title" className="section-title mb-2">Enable Autonomous Mode</h3>
        <p id="confirm-dialog-description" className="text-sm text-text-secondary">
          Switching <strong className="text-text-primary">{capabilityLabel}</strong> to autonomous mode lets the AI
          execute actions immediately without your approval. Are you sure?
        </p>
        <div className="flex gap-2 justify-end mt-5">
          <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn-primary" onClick={onConfirm}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

interface ToggleCardProps {
  capability: AutomationCapability;
  enabled: boolean;
  approvalMode: ApprovalMode;
  prerequisiteMet: boolean;
  prerequisiteMessage: string;
  onToggleChange: (enabled: boolean) => void;
  onApprovalModeChange: (mode: ApprovalMode) => void;
  onRequestAutonomousConfirm: (capability: AutomationCapability) => void;
}

function AutomationToggleCard({
  capability, enabled, approvalMode, prerequisiteMet, prerequisiteMessage,
  onToggleChange, onApprovalModeChange, onRequestAutonomousConfirm,
}: ToggleCardProps) {
  const handleToggleChange = useCallback(() => {
    if (!prerequisiteMet) return;
    onToggleChange(!enabled);
  }, [prerequisiteMet, enabled, onToggleChange]);

  const handleApprovalModeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newMode = e.target.value as ApprovalMode;
    if (newMode === 'autonomous' && approvalMode === 'approval_required') {
      onRequestAutonomousConfirm(capability);
    } else {
      onApprovalModeChange(newMode);
    }
  }, [approvalMode, capability, onApprovalModeChange, onRequestAutonomousConfirm]);

  return (
    <div data-testid={`toggle-card-${capability.key}`} className={`rounded-lg border border-border p-4 ${prerequisiteMet ? '' : 'opacity-70'}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-text-primary">{capability.label}</span>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            data-testid={`toggle-switch-${capability.key}`}
            className="sr-only peer"
            checked={enabled}
            disabled={!prerequisiteMet}
            onChange={handleToggleChange}
            aria-label={`Toggle ${capability.label}`}
          />
          <div className="w-9 h-5 bg-border-strong rounded-full peer peer-checked:bg-primary-500 peer-disabled:opacity-40 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
        </label>
      </div>

      <p data-testid={`toggle-description-${capability.key}`} className="text-xs text-text-muted mt-1">
        {capability.description}
      </p>

      {!prerequisiteMet && (
        <p data-testid={`prerequisite-warning-${capability.key}`} className="mt-2 text-xs text-warning" role="alert">
          {prerequisiteMessage}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <label htmlFor={`approval-mode-${capability.key}`} className="text-xs text-text-secondary">Approval Mode</label>
        <select
          id={`approval-mode-${capability.key}`}
          data-testid={`approval-mode-${capability.key}`}
          className="input-field py-1.5 text-xs w-auto"
          value={approvalMode}
          onChange={handleApprovalModeChange}
          disabled={!prerequisiteMet || !enabled}
          aria-label={`Approval mode for ${capability.label}`}
        >
          <option value="approval_required">Approval Required</option>
          <option value="autonomous">Autonomous</option>
        </select>
      </div>
    </div>
  );
}

export default function AutomationControlsSection({
  state, onToggleChange, onApprovalModeChange,
}: AutomationControlsSectionProps) {
  const [confirmDialog, setConfirmDialog] = useState<AutomationCapability | null>(null);

  const handleRequestAutonomousConfirm = useCallback((capability: AutomationCapability) => {
    setConfirmDialog(capability);
  }, []);

  const handleConfirmAutonomous = useCallback(() => {
    if (confirmDialog) {
      onApprovalModeChange(confirmDialog.key, 'autonomous');
      setConfirmDialog(null);
    }
  }, [confirmDialog, onApprovalModeChange]);

  const handleCancelAutonomous = useCallback(() => setConfirmDialog(null), []);

  return (
    <section data-testid="settings-section-automation-controls" className="card">
      <div data-testid="automation-controls-section">
        <h2 className="section-title">Automation Controls</h2>
        <p className="section-description">
          Enable individual automation capabilities and choose whether each requires approval.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
          {AUTOMATION_CAPABILITIES.map((capability) => {
            const prerequisiteMet = isPrerequisiteMet(capability, state);
            const prerequisiteMessage = getPrerequisiteMessage(capability, state);
            return (
              <AutomationToggleCard
                key={capability.key}
                capability={capability}
                enabled={state.toggles[capability.key]}
                approvalMode={state.approval_modes[capability.key]}
                prerequisiteMet={prerequisiteMet}
                prerequisiteMessage={prerequisiteMessage}
                onToggleChange={(enabled) => onToggleChange(capability.key, enabled)}
                onApprovalModeChange={(mode) => onApprovalModeChange(capability.key, mode)}
                onRequestAutonomousConfirm={handleRequestAutonomousConfirm}
              />
            );
          })}
        </div>

        {confirmDialog && (
          <AutonomousConfirmDialog
            capabilityLabel={confirmDialog.label}
            onConfirm={handleConfirmAutonomous}
            onCancel={handleCancelAutonomous}
          />
        )}
      </div>
    </section>
  );
}

export { AutomationToggleCard, AutonomousConfirmDialog, isPrerequisiteMet, getPrerequisiteMessage };
