'use client';

import { useState, useCallback } from 'react';

/**
 * Automation Controls Section — toggle cards for each AI automation capability.
 * Requirements: 4.1, 4.3, 4.4, 7.1, 7.4
 */

// --- Types ---

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

// --- Capability Definitions ---

export const AUTOMATION_CAPABILITIES: AutomationCapability[] = [
  {
    key: 'campaigns',
    label: 'Campaigns',
    description: 'Automatically create and manage marketing campaigns based on business metrics',
    requiresLLMKey: true,
  },
  {
    key: 'retention_offers',
    label: 'Retention Offers',
    description: 'Send personalized retention offers to customers at risk of churning',
    requiresLLMKey: true,
  },
  {
    key: 'pricing_suggestions',
    label: 'Pricing Suggestions',
    description: 'AI-powered pricing recommendations based on demand patterns',
    requiresLLMKey: false,
  },
  {
    key: 'anomaly_alerts',
    label: 'Anomaly Alerts',
    description: 'Detect and flag unusual patterns in revenue, traffic, or service metrics',
    requiresLLMKey: false,
  },
  {
    key: 'queue_optimization',
    label: 'Queue Optimization',
    description: 'Optimize service queue priorities based on customer data and wait times',
    requiresLLMKey: false,
  },
  {
    key: 'membership_recommendations',
    label: 'Membership Recommendations',
    description: 'Send personalized membership plan recommendations to customers',
    requiresLLMKey: true,
  },
];

// --- Helper: Check if prerequisite is met ---

function isPrerequisiteMet(
  capability: AutomationCapability,
  state: AutomationControlsState
): boolean {
  // All toggles require ai_enabled
  if (!state.ai_enabled) return false;

  // Capabilities requiring LLM key need either an OpenRouter API key configured or Hermes AI selected
  if (capability.requiresLLMKey) {
    if (state.llm_provider === 'hermes_ai') return true;
    if (state.llm_provider === 'openrouter' && state.llm_api_key_configured) return true;
    return false;
  }

  return true;
}

function getPrerequisiteMessage(
  capability: AutomationCapability,
  state: AutomationControlsState
): string {
  if (!state.ai_enabled) {
    return 'Enable global AI automation to use this capability.';
  }
  if (capability.requiresLLMKey) {
    return 'Configure an LLM provider (OpenRouter with API key or Hermes AI) to enable this capability.';
  }
  return '';
}

// --- Confirmation Dialog Component ---

interface ConfirmDialogProps {
  capabilityLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function AutonomousConfirmDialog({ capabilityLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div
      data-testid="autonomous-confirm-dialog"
      className="autonomous-confirm-dialog"
      role="alertdialog"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
    >
      <div className="autonomous-confirm-dialog-backdrop" onClick={onCancel} />
      <div className="autonomous-confirm-dialog-content">
        <h3 id="confirm-dialog-title" className="autonomous-confirm-dialog-title">
          Enable Autonomous Mode
        </h3>
        <p id="confirm-dialog-description" className="autonomous-confirm-dialog-description">
          Switching <strong>{capabilityLabel}</strong> to autonomous mode will allow the AI to
          execute actions immediately without requiring your approval. Are you sure you want to
          proceed?
        </p>
        <div className="autonomous-confirm-dialog-actions">
          <button
            type="button"
            className="autonomous-confirm-dialog-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="autonomous-confirm-dialog-confirm"
            onClick={onConfirm}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// --- AutomationToggleCard Component ---

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
  capability,
  enabled,
  approvalMode,
  prerequisiteMet,
  prerequisiteMessage,
  onToggleChange,
  onApprovalModeChange,
  onRequestAutonomousConfirm,
}: ToggleCardProps) {
  const handleToggleChange = useCallback(() => {
    if (!prerequisiteMet) return;
    onToggleChange(!enabled);
  }, [prerequisiteMet, enabled, onToggleChange]);

  const handleApprovalModeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newMode = e.target.value as ApprovalMode;
      if (newMode === 'autonomous' && approvalMode === 'approval_required') {
        onRequestAutonomousConfirm(capability);
      } else {
        onApprovalModeChange(newMode);
      }
    },
    [approvalMode, capability, onApprovalModeChange, onRequestAutonomousConfirm]
  );

  return (
    <div
      data-testid={`toggle-card-${capability.key}`}
      className="automation-toggle-card"
    >
      <div className="automation-toggle-card-header">
        <label className="automation-toggle-card-label">
          <span className="automation-toggle-card-title">{capability.label}</span>
          <input
            type="checkbox"
            data-testid={`toggle-switch-${capability.key}`}
            className="automation-toggle-switch"
            checked={enabled}
            disabled={!prerequisiteMet}
            onChange={handleToggleChange}
            aria-label={`Toggle ${capability.label}`}
          />
        </label>
      </div>

      <p
        data-testid={`toggle-description-${capability.key}`}
        className="automation-toggle-card-description"
      >
        {capability.description}
      </p>

      {!prerequisiteMet && (
        <p
          data-testid={`prerequisite-warning-${capability.key}`}
          className="automation-toggle-card-prerequisite-warning"
          role="alert"
        >
          {prerequisiteMessage}
        </p>
      )}

      <div className="automation-toggle-card-approval">
        <label htmlFor={`approval-mode-${capability.key}`} className="automation-toggle-card-approval-label">
          Approval Mode
        </label>
        <select
          id={`approval-mode-${capability.key}`}
          data-testid={`approval-mode-${capability.key}`}
          className="automation-toggle-card-approval-select"
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

// --- AutomationControlsSection Component ---

export default function AutomationControlsSection({
  state,
  onToggleChange,
  onApprovalModeChange,
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

  const handleCancelAutonomous = useCallback(() => {
    setConfirmDialog(null);
  }, []);

  return (
    <section
      data-testid="settings-section-automation-controls"
      className="settings-section automation-controls-section"
    >
      <div data-testid="automation-controls-section" className="automation-controls-inner">
        <h2 className="settings-section-title">Automation Controls</h2>
        <p className="settings-section-description">
          Enable or disable individual automation capabilities and set approval modes.
        </p>

        <div className="automation-toggle-cards">
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
