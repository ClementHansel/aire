/**
 * Unit tests for AIAutomationSection component.
 * Requirements: 3.1, 3.2, 3.5, 11.3
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AIAutomationSection } from './AIAutomationSection';

const defaultProps = {
  ai_enabled: false,
  llm_provider: 'hermes_ai' as const,
  llm_api_key_encrypted: null,
  schedule_interval: null as 'hourly' | 'daily' | null,
};

describe('AIAutomationSection', () => {
  it('should render the section container', () => {
    render(<AIAutomationSection {...defaultProps} />);
    expect(screen.getByTestId('ai-automation-section')).toBeInTheDocument();
  });

  it('should render the global AI toggle', () => {
    render(<AIAutomationSection {...defaultProps} />);
    const toggle = screen.getByTestId('ai-global-toggle');
    expect(toggle).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
  });

  it('should render with AI enabled when ai_enabled is true', () => {
    render(<AIAutomationSection {...defaultProps} ai_enabled={true} />);
    const toggle = screen.getByTestId('ai-global-toggle');
    expect(toggle).toBeChecked();
  });

  it('should hide AI details when AI is toggled OFF', () => {
    render(<AIAutomationSection {...defaultProps} ai_enabled={false} />);
    expect(screen.queryByTestId('ai-hidden-when-off')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-llm-provider-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-schedule-select')).not.toBeInTheDocument();
  });

  it('should show AI details when AI is toggled ON', () => {
    render(<AIAutomationSection {...defaultProps} ai_enabled={true} />);
    expect(screen.getByTestId('ai-hidden-when-off')).toBeInTheDocument();
    expect(screen.getByTestId('ai-llm-provider-select')).toBeInTheDocument();
    expect(screen.getByTestId('ai-schedule-select')).toBeInTheDocument();
  });

  it('should toggle AI on/off when clicking the toggle', () => {
    render(<AIAutomationSection {...defaultProps} ai_enabled={false} />);
    const toggle = screen.getByTestId('ai-global-toggle');

    fireEvent.click(toggle);
    expect(screen.getByTestId('ai-hidden-when-off')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByTestId('ai-hidden-when-off')).not.toBeInTheDocument();
  });

  it('should show API key input when OpenRouter is selected and AI is enabled', () => {
    render(
      <AIAutomationSection {...defaultProps} ai_enabled={true} llm_provider="openrouter" />
    );
    expect(screen.getByTestId('ai-api-key-input')).toBeInTheDocument();
  });

  it('should hide API key input when Hermes AI is selected', () => {
    render(
      <AIAutomationSection {...defaultProps} ai_enabled={true} llm_provider="hermes_ai" />
    );
    expect(screen.queryByTestId('ai-api-key-input')).not.toBeInTheDocument();
  });

  it('should show API key input when switching to OpenRouter', () => {
    render(<AIAutomationSection {...defaultProps} ai_enabled={true} llm_provider="hermes_ai" />);
    const select = screen.getByTestId('ai-llm-provider-select');

    fireEvent.change(select, { target: { value: 'openrouter' } });
    expect(screen.getByTestId('ai-api-key-input')).toBeInTheDocument();
  });

  it('should hide API key input when switching to Hermes AI', () => {
    render(<AIAutomationSection {...defaultProps} ai_enabled={true} llm_provider="openrouter" />);
    const select = screen.getByTestId('ai-llm-provider-select');

    fireEvent.change(select, { target: { value: 'hermes_ai' } });
    expect(screen.queryByTestId('ai-api-key-input')).not.toBeInTheDocument();
  });

  it('should show validation error when saving with OpenRouter but no API key', () => {
    render(
      <AIAutomationSection {...defaultProps} ai_enabled={true} llm_provider="openrouter" />
    );

    // Clear the API key field
    const apiKeyInput = screen.getByTestId('ai-api-key-input');
    fireEvent.change(apiKeyInput, { target: { value: '' } });

    // Try to save
    const saveButton = screen.getByTestId('ai-save-button');
    fireEvent.click(saveButton);

    expect(screen.getByTestId('ai-api-key-error')).toBeInTheDocument();
    expect(screen.getByTestId('ai-api-key-error')).toHaveTextContent(
      'API key is required when using OpenRouter'
    );
  });

  it('should not show validation error when saving with Hermes AI (no key needed)', () => {
    const onSave = vi.fn();
    render(
      <AIAutomationSection {...defaultProps} ai_enabled={true} llm_provider="hermes_ai" onSave={onSave} />
    );

    const saveButton = screen.getByTestId('ai-save-button');
    fireEvent.click(saveButton);

    expect(screen.queryByTestId('ai-api-key-error')).not.toBeInTheDocument();
    expect(onSave).toHaveBeenCalled();
  });

  it('should not show error when OpenRouter has a valid API key', () => {
    const onSave = vi.fn();
    render(
      <AIAutomationSection
        {...defaultProps}
        ai_enabled={true}
        llm_provider="openrouter"
        llm_api_key_encrypted="encrypted-key-value"
        onSave={onSave}
      />
    );

    const saveButton = screen.getByTestId('ai-save-button');
    fireEvent.click(saveButton);

    expect(screen.queryByTestId('ai-api-key-error')).not.toBeInTheDocument();
    expect(onSave).toHaveBeenCalled();
  });

  it('should clear validation error when entering an API key', () => {
    render(
      <AIAutomationSection {...defaultProps} ai_enabled={true} llm_provider="openrouter" />
    );

    const apiKeyInput = screen.getByTestId('ai-api-key-input');
    fireEvent.change(apiKeyInput, { target: { value: '' } });

    const saveButton = screen.getByTestId('ai-save-button');
    fireEvent.click(saveButton);
    expect(screen.getByTestId('ai-api-key-error')).toBeInTheDocument();

    // Type in a key - error should clear
    fireEvent.change(apiKeyInput, { target: { value: 'sk-my-key' } });
    expect(screen.queryByTestId('ai-api-key-error')).not.toBeInTheDocument();
  });

  it('should render the save button', () => {
    render(<AIAutomationSection {...defaultProps} />);
    expect(screen.getByTestId('ai-save-button')).toBeInTheDocument();
  });

  it('should render schedule interval selector with correct options', () => {
    render(<AIAutomationSection {...defaultProps} ai_enabled={true} />);
    const select = screen.getByTestId('ai-schedule-select');
    expect(select).toBeInTheDocument();

    const options = select.querySelectorAll('option');
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveValue('');
    expect(options[1]).toHaveValue('hourly');
    expect(options[2]).toHaveValue('daily');
  });

  it('should call onSave with correct values', () => {
    const onSave = vi.fn();
    render(
      <AIAutomationSection {...defaultProps} ai_enabled={true} llm_provider="hermes_ai" onSave={onSave} />
    );

    // Change schedule
    const scheduleSelect = screen.getByTestId('ai-schedule-select');
    fireEvent.change(scheduleSelect, { target: { value: 'daily' } });

    const saveButton = screen.getByTestId('ai-save-button');
    fireEvent.click(saveButton);

    expect(onSave).toHaveBeenCalledWith({
      ai_enabled: true,
      llm_provider: 'hermes_ai',
      llm_api_key: '',
      schedule_interval: 'daily',
    });
  });

  it('should have correct default provider selection', () => {
    render(
      <AIAutomationSection {...defaultProps} ai_enabled={true} llm_provider="openrouter" />
    );
    const select = screen.getByTestId('ai-llm-provider-select') as HTMLSelectElement;
    expect(select.value).toBe('openrouter');
  });

  it('should have correct default schedule interval', () => {
    render(
      <AIAutomationSection {...defaultProps} ai_enabled={true} schedule_interval="hourly" />
    );
    const select = screen.getByTestId('ai-schedule-select') as HTMLSelectElement;
    expect(select.value).toBe('hourly');
  });
});
