/**
 * Unit tests for VoidDialog component.
 * Requirements: 21.1, 21.2, 21.3, 21.4
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VoidDialog } from './VoidDialog';
import { VOID_PAID_WARNING_MESSAGE } from '@aire/shared/void';

describe('VoidDialog', () => {
  const defaultProps = {
    requiresPin: false,
    isPaidOrder: false,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    defaultProps.onConfirm.mockClear();
    defaultProps.onCancel.mockClear();
  });

  describe('Rendering', () => {
    it('should render the void dialog with title', () => {
      render(<VoidDialog {...defaultProps} />);

      expect(screen.getByTestId('void-dialog')).toBeDefined();
      expect(screen.getByTestId('void-dialog-title').textContent).toBe('Void Order');
    });

    it('should render reason textarea', () => {
      render(<VoidDialog {...defaultProps} />);

      expect(screen.getByTestId('void-reason-input')).toBeDefined();
    });

    it('should render confirm and cancel buttons', () => {
      render(<VoidDialog {...defaultProps} />);

      expect(screen.getByTestId('void-confirm-btn')).toBeDefined();
      expect(screen.getByTestId('void-cancel-btn')).toBeDefined();
    });

    it('should have proper dialog role and aria attributes', () => {
      render(<VoidDialog {...defaultProps} />);

      const dialog = screen.getByTestId('void-dialog');
      expect(dialog.getAttribute('role')).toBe('dialog');
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expect(dialog.getAttribute('aria-labelledby')).toBe('void-dialog-title');
    });
  });

  describe('Requirement 21.1: Free void window (reason only, no PIN)', () => {
    it('should not show PIN input when requiresPin is false', () => {
      render(<VoidDialog {...defaultProps} requiresPin={false} />);

      expect(screen.queryByTestId('void-pin-section')).toBeNull();
      expect(screen.queryByTestId('void-pin-input')).toBeNull();
    });

    it('should confirm with reason only when PIN is not required', () => {
      render(<VoidDialog {...defaultProps} requiresPin={false} />);

      const textarea = screen.getByTestId('void-reason-input');
      fireEvent.change(textarea, { target: { value: 'Customer changed mind' } });
      fireEvent.click(screen.getByTestId('void-confirm-btn'));

      expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
      expect(defaultProps.onConfirm).toHaveBeenCalledWith({
        reason: 'Customer changed mind',
        adminPin: undefined,
      });
    });

    it('should show error when reason is empty', () => {
      render(<VoidDialog {...defaultProps} requiresPin={false} />);

      fireEvent.click(screen.getByTestId('void-confirm-btn'));

      expect(defaultProps.onConfirm).not.toHaveBeenCalled();
      expect(screen.getByTestId('void-error')).toBeDefined();
      expect(screen.getByTestId('void-error').textContent).toBe(
        'A reason is required to void an order',
      );
    });

    it('should show error when reason is whitespace only', () => {
      render(<VoidDialog {...defaultProps} requiresPin={false} />);

      const textarea = screen.getByTestId('void-reason-input');
      fireEvent.change(textarea, { target: { value: '   ' } });
      fireEvent.click(screen.getByTestId('void-confirm-btn'));

      expect(defaultProps.onConfirm).not.toHaveBeenCalled();
      expect(screen.getByTestId('void-error')).toBeDefined();
    });

    it('should trim reason before submitting', () => {
      render(<VoidDialog {...defaultProps} requiresPin={false} />);

      const textarea = screen.getByTestId('void-reason-input');
      fireEvent.change(textarea, { target: { value: '  Wrong order  ' } });
      fireEvent.click(screen.getByTestId('void-confirm-btn'));

      expect(defaultProps.onConfirm).toHaveBeenCalledWith({
        reason: 'Wrong order',
        adminPin: undefined,
      });
    });
  });

  describe('Requirement 21.2: PIN required after free void window', () => {
    it('should show PIN input when requiresPin is true', () => {
      render(<VoidDialog {...defaultProps} requiresPin={true} />);

      expect(screen.getByTestId('void-pin-section')).toBeDefined();
      expect(screen.getByTestId('void-pin-input')).toBeDefined();
    });

    it('should confirm with reason and PIN when both are valid', () => {
      render(<VoidDialog {...defaultProps} requiresPin={true} />);

      const textarea = screen.getByTestId('void-reason-input');
      const pinInput = screen.getByTestId('void-pin-input');

      fireEvent.change(textarea, { target: { value: 'Duplicate order' } });
      fireEvent.change(pinInput, { target: { value: '123456' } });
      fireEvent.click(screen.getByTestId('void-confirm-btn'));

      expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
      expect(defaultProps.onConfirm).toHaveBeenCalledWith({
        reason: 'Duplicate order',
        adminPin: '123456',
      });
    });

    it('should show error when PIN is empty and required', () => {
      render(<VoidDialog {...defaultProps} requiresPin={true} />);

      const textarea = screen.getByTestId('void-reason-input');
      fireEvent.change(textarea, { target: { value: 'Some reason' } });
      fireEvent.click(screen.getByTestId('void-confirm-btn'));

      expect(defaultProps.onConfirm).not.toHaveBeenCalled();
      expect(screen.getByTestId('void-error').textContent).toBe('Admin PIN is required');
    });

    it('should show error when PIN is less than 6 digits', () => {
      render(<VoidDialog {...defaultProps} requiresPin={true} />);

      const textarea = screen.getByTestId('void-reason-input');
      const pinInput = screen.getByTestId('void-pin-input');

      fireEvent.change(textarea, { target: { value: 'Some reason' } });
      fireEvent.change(pinInput, { target: { value: '12345' } });
      fireEvent.click(screen.getByTestId('void-confirm-btn'));

      expect(defaultProps.onConfirm).not.toHaveBeenCalled();
      expect(screen.getByTestId('void-error').textContent).toBe(
        'PIN must be exactly 6 digits',
      );
    });

    it('should only allow numeric input for PIN', () => {
      render(<VoidDialog {...defaultProps} requiresPin={true} />);

      const pinInput = screen.getByTestId('void-pin-input') as HTMLInputElement;

      // Non-numeric characters should not be accepted
      fireEvent.change(pinInput, { target: { value: 'abc123' } });
      expect(pinInput.value).toBe('');

      // Numeric characters should be accepted
      fireEvent.change(pinInput, { target: { value: '123456' } });
      expect(pinInput.value).toBe('123456');
    });

    it('should limit PIN to 6 characters max', () => {
      render(<VoidDialog {...defaultProps} requiresPin={true} />);

      const pinInput = screen.getByTestId('void-pin-input') as HTMLInputElement;

      // More than 6 digits should not be accepted
      fireEvent.change(pinInput, { target: { value: '1234567' } });
      expect(pinInput.value).toBe('');

      // Exactly 6 digits should be fine
      fireEvent.change(pinInput, { target: { value: '123456' } });
      expect(pinInput.value).toBe('123456');
    });

    it('should validate reason before PIN', () => {
      render(<VoidDialog {...defaultProps} requiresPin={true} />);

      const pinInput = screen.getByTestId('void-pin-input');
      fireEvent.change(pinInput, { target: { value: '123456' } });
      fireEvent.click(screen.getByTestId('void-confirm-btn'));

      expect(defaultProps.onConfirm).not.toHaveBeenCalled();
      expect(screen.getByTestId('void-error').textContent).toBe(
        'A reason is required to void an order',
      );
    });

    it('should have password type for PIN input', () => {
      render(<VoidDialog {...defaultProps} requiresPin={true} />);

      const pinInput = screen.getByTestId('void-pin-input');
      expect(pinInput.getAttribute('type')).toBe('password');
    });

    it('should have numeric inputMode for PIN input', () => {
      render(<VoidDialog {...defaultProps} requiresPin={true} />);

      const pinInput = screen.getByTestId('void-pin-input');
      expect(pinInput.getAttribute('inputmode')).toBe('numeric');
    });
  });

  describe('Requirement 21.3: Tenant_Owner bypasses PIN', () => {
    it('should allow void without PIN section when requiresPin is false (TenantOwner scenario)', () => {
      // TenantOwner scenario: requiresPin is set to false by parent component
      render(<VoidDialog {...defaultProps} requiresPin={false} />);

      expect(screen.queryByTestId('void-pin-section')).toBeNull();

      const textarea = screen.getByTestId('void-reason-input');
      fireEvent.change(textarea, { target: { value: 'Owner override' } });
      fireEvent.click(screen.getByTestId('void-confirm-btn'));

      expect(defaultProps.onConfirm).toHaveBeenCalledWith({
        reason: 'Owner override',
        adminPin: undefined,
      });
    });
  });

  describe('Requirement 21.4: Paid order warning', () => {
    it('should display paid order warning when isPaidOrder is true', () => {
      render(<VoidDialog {...defaultProps} isPaidOrder={true} />);

      const warning = screen.getByTestId('void-paid-warning');
      expect(warning).toBeDefined();
      expect(warning.textContent).toBe(VOID_PAID_WARNING_MESSAGE);
    });

    it('should not display paid order warning when isPaidOrder is false', () => {
      render(<VoidDialog {...defaultProps} isPaidOrder={false} />);

      expect(screen.queryByTestId('void-paid-warning')).toBeNull();
    });

    it('should display warning with alert role for accessibility', () => {
      render(<VoidDialog {...defaultProps} isPaidOrder={true} />);

      const warning = screen.getByTestId('void-paid-warning');
      expect(warning.getAttribute('role')).toBe('alert');
    });
  });

  describe('Cancel', () => {
    it('should call onCancel when cancel button is clicked', () => {
      render(<VoidDialog {...defaultProps} />);

      fireEvent.click(screen.getByTestId('void-cancel-btn'));

      expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
    });

    it('should not call onConfirm when cancel is clicked', () => {
      render(<VoidDialog {...defaultProps} />);

      fireEvent.click(screen.getByTestId('void-cancel-btn'));

      expect(defaultProps.onConfirm).not.toHaveBeenCalled();
    });
  });

  describe('Error clearing', () => {
    it('should clear error when reason is typed', () => {
      render(<VoidDialog {...defaultProps} />);

      // Trigger error
      fireEvent.click(screen.getByTestId('void-confirm-btn'));
      expect(screen.getByTestId('void-error')).toBeDefined();

      // Type in reason
      const textarea = screen.getByTestId('void-reason-input');
      fireEvent.change(textarea, { target: { value: 'a' } });

      expect(screen.queryByTestId('void-error')).toBeNull();
    });

    it('should clear error when PIN is typed', () => {
      render(<VoidDialog {...defaultProps} requiresPin={true} />);

      // Fill reason and trigger PIN error
      const textarea = screen.getByTestId('void-reason-input');
      fireEvent.change(textarea, { target: { value: 'reason' } });
      fireEvent.click(screen.getByTestId('void-confirm-btn'));
      expect(screen.getByTestId('void-error')).toBeDefined();

      // Type in PIN
      const pinInput = screen.getByTestId('void-pin-input');
      fireEvent.change(pinInput, { target: { value: '1' } });

      expect(screen.queryByTestId('void-error')).toBeNull();
    });
  });
});
