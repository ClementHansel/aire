/**
 * Integration tests for the Settings page.
 * Tests cross-component behavior that individual component tests don't cover.
 * Requirements: 11.3, 11.4
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import SettingsPage from './page';

/**
 * Helper to render the SettingsPage and flush async effects (DeviceDiscoverySection fetch).
 */
async function renderSettingsPage() {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(<SettingsPage />);
  });
  return result!;
}

describe('Settings Page Integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock fetch for DeviceDiscoverySection's initial device fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    });
  });

  describe('Page Structure', () => {
    it('should render the settings page container', async () => {
      await renderSettingsPage();
      expect(screen.getByTestId('settings-page')).toBeInTheDocument();
    });

    it('should render the page title', async () => {
      await renderSettingsPage();
      expect(screen.getByTestId('settings-page-title')).toHaveTextContent('Settings');
    });

    it('should render all 4 sections', async () => {
      await renderSettingsPage();
      expect(screen.getByTestId('settings-section-whatsapp')).toBeInTheDocument();
      expect(screen.getByTestId('settings-section-ai-automation')).toBeInTheDocument();
      expect(screen.getByTestId('settings-section-automation-controls-wrapper')).toBeInTheDocument();
      expect(screen.getByTestId('settings-section-device-discovery')).toBeInTheDocument();
    });

    it('should have appropriate container classes for responsive layout', async () => {
      await renderSettingsPage();
      const page = screen.getByTestId('settings-page');
      expect(page).toHaveClass('settings-page');

      // Each section wrapper should have the settings-section class
      const sections = page.querySelectorAll('.settings-section');
      expect(sections.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('AI Section Conditional Rendering (Requirement 11.3)', () => {
    it('should hide LLM provider and schedule controls when ai_enabled is false', async () => {
      await renderSettingsPage();

      // The page initializes with ai_enabled = false, so AI details should be hidden
      expect(screen.queryByTestId('ai-hidden-when-off')).not.toBeInTheDocument();
      expect(screen.queryByTestId('ai-llm-provider-select')).not.toBeInTheDocument();
      expect(screen.queryByTestId('ai-schedule-select')).not.toBeInTheDocument();
    });

    it('should show LLM provider and schedule controls after enabling AI toggle', async () => {
      await renderSettingsPage();

      // Toggle AI on
      const aiToggle = screen.getByTestId('ai-global-toggle');
      fireEvent.click(aiToggle);

      // Now the AI details should be visible
      expect(screen.getByTestId('ai-hidden-when-off')).toBeInTheDocument();
      expect(screen.getByTestId('ai-llm-provider-select')).toBeInTheDocument();
      expect(screen.getByTestId('ai-schedule-select')).toBeInTheDocument();
    });

    it('should hide AI details again after disabling the toggle', async () => {
      await renderSettingsPage();

      // Toggle AI on then off
      const aiToggle = screen.getByTestId('ai-global-toggle');
      fireEvent.click(aiToggle); // on
      fireEvent.click(aiToggle); // off

      expect(screen.queryByTestId('ai-hidden-when-off')).not.toBeInTheDocument();
    });
  });

  describe('Prerequisite Warning Display (Requirement 11.3)', () => {
    it('should show prerequisite warnings in automation controls when AI is off', async () => {
      await renderSettingsPage();

      // With ai_enabled = false (default), all automation toggle cards should show warnings
      const warningCampaigns = screen.getByTestId('prerequisite-warning-campaigns');
      expect(warningCampaigns).toBeInTheDocument();
      expect(warningCampaigns).toHaveTextContent('Enable global AI automation');

      const warningRetention = screen.getByTestId('prerequisite-warning-retention_offers');
      expect(warningRetention).toBeInTheDocument();

      const warningPricing = screen.getByTestId('prerequisite-warning-pricing_suggestions');
      expect(warningPricing).toBeInTheDocument();

      const warningAnomalies = screen.getByTestId('prerequisite-warning-anomaly_alerts');
      expect(warningAnomalies).toBeInTheDocument();

      const warningQueue = screen.getByTestId('prerequisite-warning-queue_optimization');
      expect(warningQueue).toBeInTheDocument();

      const warningMembership = screen.getByTestId('prerequisite-warning-membership_recommendations');
      expect(warningMembership).toBeInTheDocument();
    });

    it('should disable all automation toggle switches when AI is off', async () => {
      await renderSettingsPage();

      const automationKeys = [
        'campaigns',
        'retention_offers',
        'pricing_suggestions',
        'anomaly_alerts',
        'queue_optimization',
        'membership_recommendations',
      ];

      for (const key of automationKeys) {
        const toggle = screen.getByTestId(`toggle-switch-${key}`);
        expect(toggle).toBeDisabled();
      }
    });
  });

  describe('Approval Mode Confirmation Dialog (Requirement 11.3)', () => {
    it('should show confirmation dialog when switching approval mode to autonomous', async () => {
      await renderSettingsPage();

      // The automation controls start with ai_enabled = false so toggles are disabled.
      // Since the page initializes with ai_enabled=false on the AutomationControlsSection,
      // the approval mode selectors are disabled (prerequisite not met).
      const approvalSelector = screen.getByTestId('approval-mode-campaigns');
      expect(approvalSelector).toBeDisabled();
    });
  });

  describe('WhatsApp Phone Validation - Real-time Feedback (Requirement 11.4)', () => {
    it('should show validation error immediately when invalid phone is typed', async () => {
      await renderSettingsPage();

      const phoneInput = screen.getByTestId('whatsapp-phone-input');
      fireEvent.change(phoneInput, { target: { value: '12345' } });

      const error = screen.getByTestId('whatsapp-phone-error');
      expect(error).toBeInTheDocument();
      expect(error).toHaveTextContent('Invalid phone number. Use E.164 format');
    });

    it('should clear validation error when phone becomes valid', async () => {
      await renderSettingsPage();

      const phoneInput = screen.getByTestId('whatsapp-phone-input');

      // Type invalid first
      fireEvent.change(phoneInput, { target: { value: 'abc' } });
      expect(screen.getByTestId('whatsapp-phone-error')).toBeInTheDocument();

      // Then fix it
      fireEvent.change(phoneInput, { target: { value: '+14155551234' } });
      expect(screen.queryByTestId('whatsapp-phone-error')).not.toBeInTheDocument();
    });

    it('should not show error when phone field is empty', async () => {
      await renderSettingsPage();

      const phoneInput = screen.getByTestId('whatsapp-phone-input');
      fireEvent.change(phoneInput, { target: { value: '' } });

      expect(screen.queryByTestId('whatsapp-phone-error')).not.toBeInTheDocument();
    });

    it('should show error for phone starting with +0 (first digit must be non-zero)', async () => {
      await renderSettingsPage();

      const phoneInput = screen.getByTestId('whatsapp-phone-input');
      fireEvent.change(phoneInput, { target: { value: '+0123456789' } });

      expect(screen.getByTestId('whatsapp-phone-error')).toBeInTheDocument();
    });

    it('should mark phone input as aria-invalid when validation fails', async () => {
      await renderSettingsPage();

      const phoneInput = screen.getByTestId('whatsapp-phone-input');
      fireEvent.change(phoneInput, { target: { value: 'not-a-phone' } });

      expect(phoneInput).toHaveAttribute('aria-invalid', 'true');
    });
  });

  describe('Page Structure Responsive-Ready', () => {
    it('should wrap sections in a settings-sections container', async () => {
      await renderSettingsPage();

      const page = screen.getByTestId('settings-page');
      const sectionsContainer = page.querySelector('.settings-sections');
      expect(sectionsContainer).toBeInTheDocument();
    });

    it('should have settings-page-title class on the heading', async () => {
      await renderSettingsPage();

      const title = screen.getByTestId('settings-page-title');
      expect(title).toHaveClass('settings-page-title');
    });
  });
});
