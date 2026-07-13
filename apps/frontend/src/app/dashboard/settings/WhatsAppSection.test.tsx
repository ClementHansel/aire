/**
 * Unit tests for WhatsAppSection component (controlled — parent persists via
 * onSave → PATCH /api/settings/:tenantId).
 * Requirements: 2.1, 11.4, 11.5
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WhatsAppSection from './WhatsAppSection';

function renderSection(props: Partial<React.ComponentProps<typeof WhatsAppSection>> = {}) {
  const onSave = props.onSave ?? vi.fn().mockResolvedValue(undefined);
  render(
    <WhatsAppSection
      phone={props.phone ?? null}
      tokenSet={props.tokenSet ?? false}
      onSave={onSave}
    />,
  );
  return { onSave };
}

describe('WhatsAppSection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should render the section container', () => {
    renderSection();
    expect(screen.getByTestId('whatsapp-section')).toBeInTheDocument();
  });

  it('should render the phone number input', () => {
    renderSection();
    const input = screen.getByTestId('whatsapp-phone-input');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'tel');
  });

  it('should render the token input as masked (password type)', () => {
    renderSection();
    const input = screen.getByTestId('whatsapp-token-input');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'password');
  });

  it('should render the save button', () => {
    renderSection();
    expect(screen.getByTestId('whatsapp-save-button')).toBeInTheDocument();
  });

  it('should prefill the saved phone number', () => {
    renderSection({ phone: '+6281234567890' });
    expect(screen.getByTestId('whatsapp-phone-input')).toHaveValue('+6281234567890');
  });

  it('should indicate when a token is already stored', () => {
    renderSection({ tokenSet: true });
    expect(screen.getByTestId('whatsapp-token-input')).toHaveAttribute(
      'placeholder',
      'Leave blank to keep current token',
    );
  });

  describe('E.164 Phone Validation', () => {
    it('should show error for invalid phone number format', () => {
      renderSection();
      fireEvent.change(screen.getByTestId('whatsapp-phone-input'), { target: { value: '12345' } });
      expect(screen.getByTestId('whatsapp-phone-error')).toBeInTheDocument();
    });

    it('should not show error for valid E.164 number', () => {
      renderSection();
      fireEvent.change(screen.getByTestId('whatsapp-phone-input'), { target: { value: '+14155551234' } });
      expect(screen.queryByTestId('whatsapp-phone-error')).not.toBeInTheDocument();
    });

    it('should block save when the number is invalid', () => {
      const { onSave } = renderSection();
      fireEvent.change(screen.getByTestId('whatsapp-phone-input'), { target: { value: 'bad' } });
      fireEvent.click(screen.getByTestId('whatsapp-save-button'));
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe('Save Functionality', () => {
    it('should call onSave with phone and token, then show success', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      renderSection({ onSave });

      fireEvent.change(screen.getByTestId('whatsapp-phone-input'), { target: { value: '+14155551234' } });
      fireEvent.change(screen.getByTestId('whatsapp-token-input'), { target: { value: 'tok_123' } });
      fireEvent.click(screen.getByTestId('whatsapp-save-button'));

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith('+14155551234', 'tok_123');
      });
      expect(await screen.findByTestId('whatsapp-save-success')).toBeInTheDocument();
    });

    it('should pass an empty token when the field is left untouched', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      renderSection({ phone: '+14155551234', tokenSet: true, onSave });

      fireEvent.click(screen.getByTestId('whatsapp-save-button'));

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith('+14155551234', '');
      });
    });

    it('should surface a save error', async () => {
      const onSave = vi.fn().mockRejectedValue(new Error('nope'));
      renderSection({ phone: '+14155551234', onSave });

      fireEvent.click(screen.getByTestId('whatsapp-save-button'));

      expect(await screen.findByText('nope')).toBeInTheDocument();
    });
  });
});
