/**
 * Unit tests for WhatsAppSection component.
 * Requirements: 2.1, 11.4, 11.5
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WhatsAppSection from './WhatsAppSection';

describe('WhatsAppSection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should render the section container', () => {
    render(<WhatsAppSection />);
    expect(screen.getByTestId('whatsapp-section')).toBeInTheDocument();
  });

  it('should render the phone number input', () => {
    render(<WhatsAppSection />);
    const input = screen.getByTestId('whatsapp-phone-input');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'tel');
  });

  it('should render the token input as masked (password type)', () => {
    render(<WhatsAppSection />);
    const input = screen.getByTestId('whatsapp-token-input');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'password');
  });

  it('should render the save button', () => {
    render(<WhatsAppSection />);
    expect(screen.getByTestId('whatsapp-save-button')).toBeInTheDocument();
  });

  describe('E.164 Phone Validation', () => {
    it('should show error for invalid phone number format', () => {
      render(<WhatsAppSection />);
      const input = screen.getByTestId('whatsapp-phone-input');

      fireEvent.change(input, { target: { value: '12345' } });

      expect(screen.getByTestId('whatsapp-phone-error')).toBeInTheDocument();
      expect(screen.getByTestId('whatsapp-phone-error')).toHaveTextContent(
        'Invalid phone number. Use E.164 format'
      );
    });

    it('should show error for phone without + prefix', () => {
      render(<WhatsAppSection />);
      const input = screen.getByTestId('whatsapp-phone-input');

      fireEvent.change(input, { target: { value: '14155551234' } });

      expect(screen.getByTestId('whatsapp-phone-error')).toBeInTheDocument();
    });

    it('should show error for phone starting with +0', () => {
      render(<WhatsAppSection />);
      const input = screen.getByTestId('whatsapp-phone-input');

      fireEvent.change(input, { target: { value: '+0123456789' } });

      expect(screen.getByTestId('whatsapp-phone-error')).toBeInTheDocument();
    });

    it('should not show error for valid E.164 phone number', () => {
      render(<WhatsAppSection />);
      const input = screen.getByTestId('whatsapp-phone-input');

      fireEvent.change(input, { target: { value: '+14155551234' } });

      expect(screen.queryByTestId('whatsapp-phone-error')).not.toBeInTheDocument();
    });

    it('should not show error when phone is empty', () => {
      render(<WhatsAppSection />);
      const input = screen.getByTestId('whatsapp-phone-input');

      fireEvent.change(input, { target: { value: '' } });

      expect(screen.queryByTestId('whatsapp-phone-error')).not.toBeInTheDocument();
    });

    it('should clear error when phone becomes valid', () => {
      render(<WhatsAppSection />);
      const input = screen.getByTestId('whatsapp-phone-input');

      fireEvent.change(input, { target: { value: 'invalid' } });
      expect(screen.getByTestId('whatsapp-phone-error')).toBeInTheDocument();

      fireEvent.change(input, { target: { value: '+14155551234' } });
      expect(screen.queryByTestId('whatsapp-phone-error')).not.toBeInTheDocument();
    });
  });

  describe('Save Functionality', () => {
    it('should call PATCH /api/settings/:tenantId on save with valid data', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;

      render(<WhatsAppSection />);

      fireEvent.change(screen.getByTestId('whatsapp-phone-input'), {
        target: { value: '+14155551234' },
      });
      fireEvent.change(screen.getByTestId('whatsapp-token-input'), {
        target: { value: 'my-secret-token' },
      });
      fireEvent.click(screen.getByTestId('whatsapp-save-button'));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/settings/current', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            whatsapp_phone: '+14155551234',
            whatsapp_token: 'my-secret-token',
          }),
        });
      });
    });

    it('should display success message after successful save', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      render(<WhatsAppSection />);

      fireEvent.change(screen.getByTestId('whatsapp-phone-input'), {
        target: { value: '+14155551234' },
      });
      fireEvent.click(screen.getByTestId('whatsapp-save-button'));

      await waitFor(() => {
        expect(screen.getByTestId('whatsapp-save-success')).toBeInTheDocument();
        expect(screen.getByTestId('whatsapp-save-success')).toHaveTextContent(
          'WhatsApp credentials saved successfully'
        );
      });
    });

    it('should not save when phone number is invalid', () => {
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      render(<WhatsAppSection />);

      fireEvent.change(screen.getByTestId('whatsapp-phone-input'), {
        target: { value: 'invalid' },
      });
      fireEvent.click(screen.getByTestId('whatsapp-save-button'));

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should show phone error when trying to save with empty phone', async () => {
      render(<WhatsAppSection />);

      fireEvent.click(screen.getByTestId('whatsapp-save-button'));

      expect(screen.getByTestId('whatsapp-phone-error')).toBeInTheDocument();
      expect(screen.getByTestId('whatsapp-phone-error')).toHaveTextContent(
        'Phone number is required'
      );
    });

    it('should disable save button while saving', async () => {
      let resolveFetch: (value: { ok: boolean }) => void;
      global.fetch = vi.fn().mockImplementation(
        () => new Promise((resolve) => { resolveFetch = resolve; })
      );

      render(<WhatsAppSection />);

      fireEvent.change(screen.getByTestId('whatsapp-phone-input'), {
        target: { value: '+14155551234' },
      });
      fireEvent.click(screen.getByTestId('whatsapp-save-button'));

      expect(screen.getByTestId('whatsapp-save-button')).toBeDisabled();

      resolveFetch!({ ok: true });

      await waitFor(() => {
        expect(screen.getByTestId('whatsapp-save-button')).not.toBeDisabled();
      });
    });
  });
});
