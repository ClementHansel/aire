/**
 * Unit tests for AutomationControlsSection component.
 * Requirements: 4.1, 4.3, 4.4, 7.1, 7.4
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AutomationControlsSection, {
  AUTOMATION_CAPABILITIES,
  isPrerequisiteMet,
  getPrerequisiteMessage,
  type AutomationControlsState,
  type AutomationKey,
  type ApprovalMode,
} from './AutomationControlsSection';

// --- Helper: Create default test state ---

function createDefaultState(overrides?: Partial<AutomationControlsState>): AutomationControlsState {
  return {
    ai_enabled: true,
    llm_provider: 'hermes_ai',
    llm_api_key_configured: false,
    toggles: {
      campaigns: false,
      retention_offers: false,
      pricing_suggestions: false,
      anomaly_alerts: false,
      queue_optimization: false,
      membership_recommendations: false,
    },
    approval_modes: {
      campaigns: 'approval_required',
      retention_offers: 'approval_required',
      pricing_suggestions: 'approval_required',
      anomaly_alerts: 'approval_required',
      queue_optimization: 'approval_required',
      membership_recommendations: 'approval_required',
    },
    ...overrides,
  };
}

describe('AutomationControlsSection', () => {
  it('should render the section container with correct test id', () => {
    const state = createDefaultState();
    render(
      <AutomationControlsSection
        state={state}
        onToggleChange={vi.fn()}
        onApprovalModeChange={vi.fn()}
      />
    );
    expect(screen.getByTestId('automation-controls-section')).toBeInTheDocument();
  });

  it('should render with settings-section-automation-controls test id on outer section', () => {
    const state = createDefaultState();
    render(
      <AutomationControlsSection
        state={state}
        onToggleChange={vi.fn()}
        onApprovalModeChange={vi.fn()}
      />
    );
    expect(screen.getByTestId('settings-section-automation-controls')).toBeInTheDocument();
  });

  it('should render a toggle card for each capability', () => {
    const state = createDefaultState();
    render(
      <AutomationControlsSection
        state={state}
        onToggleChange={vi.fn()}
        onApprovalModeChange={vi.fn()}
      />
    );

    for (const cap of AUTOMATION_CAPABILITIES) {
      expect(screen.getByTestId(`toggle-card-${cap.key}`)).toBeInTheDocument();
    }
  });

  it('should render toggle switch for each capability', () => {
    const state = createDefaultState();
    render(
      <AutomationControlsSection
        state={state}
        onToggleChange={vi.fn()}
        onApprovalModeChange={vi.fn()}
      />
    );

    for (const cap of AUTOMATION_CAPABILITIES) {
      const toggle = screen.getByTestId(`toggle-switch-${cap.key}`);
      expect(toggle).toBeInTheDocument();
      expect(toggle.tagName).toBe('INPUT');
      expect(toggle).toHaveAttribute('type', 'checkbox');
    }
  });

  it('should render descriptions for each capability', () => {
    const state = createDefaultState();
    render(
      <AutomationControlsSection
        state={state}
        onToggleChange={vi.fn()}
        onApprovalModeChange={vi.fn()}
      />
    );

    for (const cap of AUTOMATION_CAPABILITIES) {
      const description = screen.getByTestId(`toggle-description-${cap.key}`);
      expect(description).toBeInTheDocument();
      expect(description).toHaveTextContent(cap.description);
    }
  });

  it('should render approval mode selector for each capability', () => {
    const state = createDefaultState();
    render(
      <AutomationControlsSection
        state={state}
        onToggleChange={vi.fn()}
        onApprovalModeChange={vi.fn()}
      />
    );

    for (const cap of AUTOMATION_CAPABILITIES) {
      const selector = screen.getByTestId(`approval-mode-${cap.key}`);
      expect(selector).toBeInTheDocument();
      expect(selector.tagName).toBe('SELECT');
    }
  });

  it('should call onToggleChange when a toggle is clicked', () => {
    const state = createDefaultState();
    const onToggleChange = vi.fn();
    render(
      <AutomationControlsSection
        state={state}
        onToggleChange={onToggleChange}
        onApprovalModeChange={vi.fn()}
      />
    );

    const toggle = screen.getByTestId('toggle-switch-anomaly_alerts');
    fireEvent.click(toggle);
    expect(onToggleChange).toHaveBeenCalledWith('anomaly_alerts', true);
  });

  it('should disable toggles when ai_enabled is false', () => {
    const state = createDefaultState({ ai_enabled: false });
    render(
      <AutomationControlsSection
        state={state}
        onToggleChange={vi.fn()}
        onApprovalModeChange={vi.fn()}
      />
    );

    for (const cap of AUTOMATION_CAPABILITIES) {
      const toggle = screen.getByTestId(`toggle-switch-${cap.key}`);
      expect(toggle).toBeDisabled();
    }
  });

  it('should show prerequisite warnings when ai_enabled is false', () => {
    const state = createDefaultState({ ai_enabled: false });
    render(
      <AutomationControlsSection
        state={state}
        onToggleChange={vi.fn()}
        onApprovalModeChange={vi.fn()}
      />
    );

    for (const cap of AUTOMATION_CAPABILITIES) {
      const warning = screen.getByTestId(`prerequisite-warning-${cap.key}`);
      expect(warning).toBeInTheDocument();
      expect(warning).toHaveTextContent('Enable global AI automation');
    }
  });

  it('should disable LLM-dependent toggles when OpenRouter selected without API key', () => {
    const state = createDefaultState({
      ai_enabled: true,
      llm_provider: 'openrouter',
      llm_api_key_configured: false,
    });
    render(
      <AutomationControlsSection
        state={state}
        onToggleChange={vi.fn()}
        onApprovalModeChange={vi.fn()}
      />
    );

    // LLM-dependent capabilities should be disabled
    const llmDependentKeys: AutomationKey[] = ['campaigns', 'retention_offers', 'membership_recommendations'];
    for (const key of llmDependentKeys) {
      const toggle = screen.getByTestId(`toggle-switch-${key}`);
      expect(toggle).toBeDisabled();
      const warning = screen.getByTestId(`prerequisite-warning-${key}`);
      expect(warning).toBeInTheDocument();
      expect(warning).toHaveTextContent('LLM provider');
    }

    // Non-LLM-dependent capabilities should be enabled
    const nonLlmKeys: AutomationKey[] = ['pricing_suggestions', 'anomaly_alerts', 'queue_optimization'];
    for (const key of nonLlmKeys) {
      const toggle = screen.getByTestId(`toggle-switch-${key}`);
      expect(toggle).not.toBeDisabled();
    }
  });

  it('should enable all toggles when Hermes AI is selected', () => {
    const state = createDefaultState({
      ai_enabled: true,
      llm_provider: 'hermes_ai',
      llm_api_key_configured: false,
    });
    render(
      <AutomationControlsSection
        state={state}
        onToggleChange={vi.fn()}
        onApprovalModeChange={vi.fn()}
      />
    );

    for (const cap of AUTOMATION_CAPABILITIES) {
      const toggle = screen.getByTestId(`toggle-switch-${cap.key}`);
      expect(toggle).not.toBeDisabled();
    }
  });

  it('should not call onToggleChange when a disabled toggle is clicked', () => {
    const state = createDefaultState({ ai_enabled: false });
    const onToggleChange = vi.fn();
    render(
      <AutomationControlsSection
        state={state}
        onToggleChange={onToggleChange}
        onApprovalModeChange={vi.fn()}
      />
    );

    const toggle = screen.getByTestId('toggle-switch-campaigns');
    fireEvent.click(toggle);
    expect(onToggleChange).not.toHaveBeenCalled();
  });

  it('should show confirmation dialog when switching to autonomous mode', () => {
    const state = createDefaultState({
      toggles: {
        campaigns: true,
        retention_offers: false,
        pricing_suggestions: false,
        anomaly_alerts: false,
        queue_optimization: false,
        membership_recommendations: false,
      },
    });
    render(
      <AutomationControlsSection
        state={state}
        onToggleChange={vi.fn()}
        onApprovalModeChange={vi.fn()}
      />
    );

    const selector = screen.getByTestId('approval-mode-campaigns');
    fireEvent.change(selector, { target: { value: 'autonomous' } });

    expect(screen.getByTestId('autonomous-confirm-dialog')).toBeInTheDocument();
  });

  it('should call onApprovalModeChange on confirm in autonomous dialog', () => {
    const state = createDefaultState({
      toggles: {
        campaigns: true,
        retention_offers: false,
        pricing_suggestions: false,
        anomaly_alerts: false,
        queue_optimization: false,
        membership_recommendations: false,
      },
    });
    const onApprovalModeChange = vi.fn();
    render(
      <AutomationControlsSection
        state={state}
        onToggleChange={vi.fn()}
        onApprovalModeChange={onApprovalModeChange}
      />
    );

    // Trigger the dialog
    const selector = screen.getByTestId('approval-mode-campaigns');
    fireEvent.change(selector, { target: { value: 'autonomous' } });

    // Click confirm
    const confirmBtn = screen.getByText('Confirm');
    fireEvent.click(confirmBtn);

    expect(onApprovalModeChange).toHaveBeenCalledWith('campaigns', 'autonomous');
    expect(screen.queryByTestId('autonomous-confirm-dialog')).not.toBeInTheDocument();
  });

  it('should dismiss dialog without changing mode on cancel', () => {
    const state = createDefaultState({
      toggles: {
        campaigns: true,
        retention_offers: false,
        pricing_suggestions: false,
        anomaly_alerts: false,
        queue_optimization: false,
        membership_recommendations: false,
      },
    });
    const onApprovalModeChange = vi.fn();
    render(
      <AutomationControlsSection
        state={state}
        onToggleChange={vi.fn()}
        onApprovalModeChange={onApprovalModeChange}
      />
    );

    // Trigger the dialog
    const selector = screen.getByTestId('approval-mode-campaigns');
    fireEvent.change(selector, { target: { value: 'autonomous' } });

    // Click cancel
    const cancelBtn = screen.getByText('Cancel');
    fireEvent.click(cancelBtn);

    expect(onApprovalModeChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId('autonomous-confirm-dialog')).not.toBeInTheDocument();
  });

  it('should not show confirmation when switching from autonomous to approval_required', () => {
    const state = createDefaultState({
      toggles: {
        campaigns: true,
        retention_offers: false,
        pricing_suggestions: false,
        anomaly_alerts: false,
        queue_optimization: false,
        membership_recommendations: false,
      },
      approval_modes: {
        campaigns: 'autonomous',
        retention_offers: 'approval_required',
        pricing_suggestions: 'approval_required',
        anomaly_alerts: 'approval_required',
        queue_optimization: 'approval_required',
        membership_recommendations: 'approval_required',
      },
    });
    const onApprovalModeChange = vi.fn();
    render(
      <AutomationControlsSection
        state={state}
        onToggleChange={vi.fn()}
        onApprovalModeChange={onApprovalModeChange}
      />
    );

    const selector = screen.getByTestId('approval-mode-campaigns');
    fireEvent.change(selector, { target: { value: 'approval_required' } });

    // Should directly call handler without dialog
    expect(onApprovalModeChange).toHaveBeenCalledWith('campaigns', 'approval_required');
    expect(screen.queryByTestId('autonomous-confirm-dialog')).not.toBeInTheDocument();
  });

  it('should disable approval mode selector when toggle is off', () => {
    const state = createDefaultState({
      toggles: {
        campaigns: false,
        retention_offers: false,
        pricing_suggestions: false,
        anomaly_alerts: false,
        queue_optimization: false,
        membership_recommendations: false,
      },
    });
    render(
      <AutomationControlsSection
        state={state}
        onToggleChange={vi.fn()}
        onApprovalModeChange={vi.fn()}
      />
    );

    for (const cap of AUTOMATION_CAPABILITIES) {
      const selector = screen.getByTestId(`approval-mode-${cap.key}`);
      expect(selector).toBeDisabled();
    }
  });
});

// --- Unit tests for helper functions ---

describe('isPrerequisiteMet', () => {
  it('should return false when ai_enabled is false', () => {
    const state = createDefaultState({ ai_enabled: false });
    for (const cap of AUTOMATION_CAPABILITIES) {
      expect(isPrerequisiteMet(cap, state)).toBe(false);
    }
  });

  it('should return true for non-LLM capabilities when ai_enabled is true', () => {
    const state = createDefaultState({ ai_enabled: true, llm_provider: null });
    const nonLlmCaps = AUTOMATION_CAPABILITIES.filter((c) => !c.requiresLLMKey);
    for (const cap of nonLlmCaps) {
      expect(isPrerequisiteMet(cap, state)).toBe(true);
    }
  });

  it('should return true for LLM capabilities when Hermes AI selected', () => {
    const state = createDefaultState({ ai_enabled: true, llm_provider: 'hermes_ai' });
    const llmCaps = AUTOMATION_CAPABILITIES.filter((c) => c.requiresLLMKey);
    for (const cap of llmCaps) {
      expect(isPrerequisiteMet(cap, state)).toBe(true);
    }
  });

  it('should return true for LLM capabilities when OpenRouter with API key', () => {
    const state = createDefaultState({
      ai_enabled: true,
      llm_provider: 'openrouter',
      llm_api_key_configured: true,
    });
    const llmCaps = AUTOMATION_CAPABILITIES.filter((c) => c.requiresLLMKey);
    for (const cap of llmCaps) {
      expect(isPrerequisiteMet(cap, state)).toBe(true);
    }
  });

  it('should return false for LLM capabilities when OpenRouter without API key', () => {
    const state = createDefaultState({
      ai_enabled: true,
      llm_provider: 'openrouter',
      llm_api_key_configured: false,
    });
    const llmCaps = AUTOMATION_CAPABILITIES.filter((c) => c.requiresLLMKey);
    for (const cap of llmCaps) {
      expect(isPrerequisiteMet(cap, state)).toBe(false);
    }
  });
});

describe('getPrerequisiteMessage', () => {
  it('should return AI-related message when ai_enabled is false', () => {
    const state = createDefaultState({ ai_enabled: false });
    const msg = getPrerequisiteMessage(AUTOMATION_CAPABILITIES[0], state);
    expect(msg).toContain('Enable global AI automation');
  });

  it('should return LLM-related message when LLM key missing for LLM capability', () => {
    const state = createDefaultState({
      ai_enabled: true,
      llm_provider: 'openrouter',
      llm_api_key_configured: false,
    });
    const llmCap = AUTOMATION_CAPABILITIES.find((c) => c.requiresLLMKey)!;
    const msg = getPrerequisiteMessage(llmCap, state);
    expect(msg).toContain('LLM provider');
  });
});
