'use client';

import { useState, useCallback } from 'react';

/**
 * Settings page for tenant automation configuration.
 * Organizes settings into logical sections: WhatsApp, AI Automation, Automation Controls, Device Discovery.
 * Requirements: 11.1, 11.2, 11.6
 */

import WhatsAppSection from './WhatsAppSection';
import { AIAutomationSection as AIAutomationSectionComponent } from './AIAutomationSection';
import AutomationControlsSectionComponent, {
  type AutomationControlsState,
  type AutomationKey,
  type ApprovalMode,
} from './AutomationControlsSection';
import { DeviceDiscoverySection as DeviceDiscoverySectionComponent } from './DeviceDiscoverySection';

function WhatsAppSectionWrapper() {
  return (
    <div data-testid="settings-section-whatsapp" className="settings-section">
      <WhatsAppSection />
    </div>
  );
}

function AIAutomationSectionWrapper() {
  return (
    <div data-testid="settings-section-ai-automation" className="settings-section">
      <AIAutomationSectionComponent
        ai_enabled={false}
        llm_provider="hermes_ai"
        llm_api_key_encrypted={null}
        schedule_interval={null}
      />
    </div>
  );
}

const DEFAULT_AUTOMATION_STATE: AutomationControlsState = {
  ai_enabled: false,
  llm_provider: null,
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
};

function AutomationControlsSectionWrapper() {
  const [automationState, setAutomationState] =
    useState<AutomationControlsState>(DEFAULT_AUTOMATION_STATE);

  const handleToggleChange = useCallback((key: AutomationKey, enabled: boolean) => {
    setAutomationState((prev) => ({
      ...prev,
      toggles: { ...prev.toggles, [key]: enabled },
    }));
  }, []);

  const handleApprovalModeChange = useCallback((key: AutomationKey, mode: ApprovalMode) => {
    setAutomationState((prev) => ({
      ...prev,
      approval_modes: { ...prev.approval_modes, [key]: mode },
    }));
  }, []);

  return (
    <div data-testid="settings-section-automation-controls-wrapper" className="settings-section">
      <AutomationControlsSectionComponent
        state={automationState}
        onToggleChange={handleToggleChange}
        onApprovalModeChange={handleApprovalModeChange}
      />
    </div>
  );
}

function DeviceDiscoverySectionWrapper() {
  return (
    <section data-testid="settings-section-device-discovery" className="settings-section">
      <DeviceDiscoverySectionComponent />
    </section>
  );
}

export default function SettingsPage() {
  return (
    <div data-testid="settings-page" className="settings-page">
      <h1 data-testid="settings-page-title" className="settings-page-title">
        Settings
      </h1>

      <div className="settings-sections">
        <WhatsAppSectionWrapper />
        <AIAutomationSectionWrapper />
        <AutomationControlsSectionWrapper />
        <DeviceDiscoverySectionWrapper />
      </div>
    </div>
  );
}
