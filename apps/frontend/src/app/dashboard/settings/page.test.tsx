/**
 * Unit tests for Settings page layout and navigation.
 * Requirements: 11.1, 11.2, 11.6
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SettingsPage from './page';

describe('SettingsPage', () => {
  it('should render the settings page container', () => {
    render(<SettingsPage />);
    expect(screen.getByTestId('settings-page')).toBeInTheDocument();
  });

  it('should render the page title', () => {
    render(<SettingsPage />);
    const title = screen.getByTestId('settings-page-title');
    expect(title).toBeInTheDocument();
    expect(title.tagName).toBe('H1');
    expect(title).toHaveTextContent('Settings');
  });

  it('should render WhatsApp Integration section', () => {
    render(<SettingsPage />);
    const section = screen.getByTestId('settings-section-whatsapp');
    expect(section).toBeInTheDocument();
    expect(section).toHaveTextContent('WhatsApp Integration');
  });

  it('should render AI Automation section', () => {
    render(<SettingsPage />);
    const section = screen.getByTestId('settings-section-ai-automation');
    expect(section).toBeInTheDocument();
    expect(section).toHaveTextContent('AI Automation');
  });

  it('should render Automation Controls section', () => {
    render(<SettingsPage />);
    const section = screen.getByTestId('automation-controls-section');
    expect(section).toBeInTheDocument();
    expect(section).toHaveTextContent('Automation Controls');
  });

  it('should render Device Discovery section', () => {
    render(<SettingsPage />);
    const section = screen.getByTestId('settings-section-device-discovery');
    expect(section).toBeInTheDocument();
    expect(section).toHaveTextContent('Device Discovery');
  });

  it('should render all four sections in logical order', () => {
    render(<SettingsPage />);
    const container = screen.getByTestId('settings-page').querySelector('.settings-sections');
    const sections = container!.querySelectorAll(':scope > *');
    expect(sections).toHaveLength(4);
    expect(sections[0]).toHaveAttribute('data-testid', 'settings-section-whatsapp');
    expect(sections[1]).toHaveAttribute('data-testid', 'settings-section-ai-automation');
    expect(sections[2]).toHaveAttribute('data-testid', 'settings-section-automation-controls-wrapper');
    expect(sections[3]).toHaveAttribute('data-testid', 'settings-section-device-discovery');
  });
});
