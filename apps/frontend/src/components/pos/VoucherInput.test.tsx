/**
 * Unit tests for VoucherInput component.
 * Requirements: 17.1–17.10
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VoucherInput, VoucherInputProps, VoucherValidationResult } from './VoucherInput';
import { VoucherType } from '@aire/shared/enums';
import { AppliedVoucher } from '@aire/shared/voucher/stacking';

describe('VoucherInput', () => {
  let defaultProps: VoucherInputProps;

  beforeEach(() => {
    defaultProps = {
      onValidate: vi.fn(),
      appliedVouchers: [],
      onApply: vi.fn(),
      onRemove: vi.fn(),
    };
  });

  it('should render input field and apply button', () => {
    render(<VoucherInput {...defaultProps} />);

    expect(screen.getByTestId('voucher-code-input')).toBeDefined();
    expect(screen.getByTestId('voucher-apply-btn')).toBeDefined();
    expect(screen.getByTestId('voucher-apply-btn').textContent).toBe('Apply');
  });

  it('should disable apply button when input is empty', () => {
    render(<VoucherInput {...defaultProps} />);

    const applyBtn = screen.getByTestId('voucher-apply-btn') as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
  });

  it('should enable apply button when code is entered', () => {
    render(<VoucherInput {...defaultProps} />);

    fireEvent.change(screen.getByTestId('voucher-code-input'), {
      target: { value: 'VOUCHER123' },
    });

    const applyBtn = screen.getByTestId('voucher-apply-btn') as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(false);
  });

  it('should call onValidate with trimmed code when Apply is clicked', async () => {
    const validResult: VoucherValidationResult = {
      state: {
        status: 'valid_applicable',
        type: VoucherType.Fixed,
        discountValue: 10000,
      },
    };
    defaultProps.onValidate = vi.fn().mockResolvedValue(validResult);

    render(<VoucherInput {...defaultProps} />);

    fireEvent.change(screen.getByTestId('voucher-code-input'), {
      target: { value: '  CODE123  ' },
    });
    fireEvent.click(screen.getByTestId('voucher-apply-btn'));

    await waitFor(() => {
      expect(defaultProps.onValidate).toHaveBeenCalledWith('CODE123');
    });
  });

  it('should call onApply and clear input when voucher is valid and applicable', async () => {
    const validResult: VoucherValidationResult = {
      state: {
        status: 'valid_applicable',
        type: VoucherType.Fixed,
        discountValue: 10000,
      },
    };
    defaultProps.onValidate = vi.fn().mockResolvedValue(validResult);

    render(<VoucherInput {...defaultProps} />);

    fireEvent.change(screen.getByTestId('voucher-code-input'), {
      target: { value: 'VALID-CODE' },
    });
    fireEvent.click(screen.getByTestId('voucher-apply-btn'));

    await waitFor(() => {
      expect(defaultProps.onApply).toHaveBeenCalledWith({
        code: 'VALID-CODE',
        type: VoucherType.Fixed,
        discountValue: 10000,
      });
    });

    // Input should be cleared
    const input = screen.getByTestId('voucher-code-input') as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('should display orange badge with reason when voucher is valid but not applicable', async () => {
    const notApplicableResult: VoucherValidationResult = {
      state: {
        status: 'valid_not_applicable',
        type: VoucherType.Percentage,
        discountValue: 15,
        reason: 'Voucher is not valid for this outlet',
      },
    };
    defaultProps.onValidate = vi.fn().mockResolvedValue(notApplicableResult);

    render(<VoucherInput {...defaultProps} />);

    fireEvent.change(screen.getByTestId('voucher-code-input'), {
      target: { value: 'OUTLET-MISMATCH' },
    });
    fireEvent.click(screen.getByTestId('voucher-apply-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('voucher-warning')).toBeDefined();
      expect(screen.getByTestId('voucher-badge-orange')).toBeDefined();
      expect(screen.getByTestId('voucher-badge-orange').textContent).toBe('PERCENTAGE');
      expect(screen.getByTestId('voucher-warning-reason').textContent).toBe(
        'Voucher is not valid for this outlet',
      );
    });
  });

  it('should display error for not found voucher (Req 17.7)', async () => {
    const notFoundResult: VoucherValidationResult = {
      state: { status: 'not_found' },
    };
    defaultProps.onValidate = vi.fn().mockResolvedValue(notFoundResult);

    render(<VoucherInput {...defaultProps} />);

    fireEvent.change(screen.getByTestId('voucher-code-input'), {
      target: { value: 'INVALID' },
    });
    fireEvent.click(screen.getByTestId('voucher-apply-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('voucher-error')).toBeDefined();
      expect(screen.getByTestId('voucher-error').textContent).toBe(
        'Voucher not found or not active',
      );
    });
  });

  it('should display error for inactive voucher (Req 17.7)', async () => {
    const inactiveResult: VoucherValidationResult = {
      state: { status: 'inactive' },
    };
    defaultProps.onValidate = vi.fn().mockResolvedValue(inactiveResult);

    render(<VoucherInput {...defaultProps} />);

    fireEvent.change(screen.getByTestId('voucher-code-input'), {
      target: { value: 'INACTIVE' },
    });
    fireEvent.click(screen.getByTestId('voucher-apply-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('voucher-error').textContent).toBe(
        'Voucher not found or not active',
      );
    });
  });

  it('should display error for fully redeemed voucher (Req 17.8)', async () => {
    const redeemedResult: VoucherValidationResult = {
      state: { status: 'fully_redeemed' },
    };
    defaultProps.onValidate = vi.fn().mockResolvedValue(redeemedResult);

    render(<VoucherInput {...defaultProps} />);

    fireEvent.change(screen.getByTestId('voucher-code-input'), {
      target: { value: 'USED-UP' },
    });
    fireEvent.click(screen.getByTestId('voucher-apply-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('voucher-error').textContent).toBe('Voucher fully redeemed');
    });
  });

  it('should display error for expired voucher (Req 17.9)', async () => {
    const expiredResult: VoucherValidationResult = {
      state: { status: 'expired' },
    };
    defaultProps.onValidate = vi.fn().mockResolvedValue(expiredResult);

    render(<VoucherInput {...defaultProps} />);

    fireEvent.change(screen.getByTestId('voucher-code-input'), {
      target: { value: 'EXPIRED' },
    });
    fireEvent.click(screen.getByTestId('voucher-apply-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('voucher-error').textContent).toBe('Voucher expired');
    });
  });

  it('should display error for not-yet-active voucher with start date (Req 17.10)', async () => {
    const notYetActiveResult: VoucherValidationResult = {
      state: { status: 'not_yet_active', startDate: '2025-03-01' },
    };
    defaultProps.onValidate = vi.fn().mockResolvedValue(notYetActiveResult);

    render(<VoucherInput {...defaultProps} />);

    fireEvent.change(screen.getByTestId('voucher-code-input'), {
      target: { value: 'FUTURE' },
    });
    fireEvent.click(screen.getByTestId('voucher-apply-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('voucher-error').textContent).toBe(
        'Voucher belum aktif (berlaku mulai 2025-03-01)',
      );
    });
  });

  it('should display error for parent code entry (Req 17.6)', async () => {
    const parentCodeResult: VoucherValidationResult = {
      state: { status: 'parent_code' },
    };
    defaultProps.onValidate = vi.fn().mockResolvedValue(parentCodeResult);

    render(<VoucherInput {...defaultProps} />);

    fireEvent.change(screen.getByTestId('voucher-code-input'), {
      target: { value: 'PACK-PARENT' },
    });
    fireEvent.click(screen.getByTestId('voucher-apply-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('voucher-error').textContent).toBe(
        'This is a voucher pack — present one of its individual codes',
      );
    });
  });

  it('should display blue badge for applied vouchers (Req 17.3)', () => {
    const appliedVouchers: AppliedVoucher[] = [
      { code: 'FIXED-10K', type: VoucherType.Fixed, discountValue: 10000 },
    ];

    render(<VoucherInput {...defaultProps} appliedVouchers={appliedVouchers} />);

    expect(screen.getByTestId('voucher-applied-list')).toBeDefined();
    expect(screen.getByTestId('voucher-applied-FIXED-10K')).toBeDefined();
    expect(screen.getByTestId('voucher-badge-blue-FIXED-10K')).toBeDefined();
    expect(screen.getByTestId('voucher-badge-blue-FIXED-10K').textContent).toBe('FIXED');
  });

  it('should show discount value for fixed voucher', () => {
    const appliedVouchers: AppliedVoucher[] = [
      { code: 'FIX-50', type: VoucherType.Fixed, discountValue: 50000 },
    ];

    render(<VoucherInput {...defaultProps} appliedVouchers={appliedVouchers} />);

    const item = screen.getByTestId('voucher-applied-FIX-50');
    expect(item.textContent).toContain('-Rp');
    expect(item.textContent).toContain('50,000');
  });

  it('should show percentage for percentage voucher', () => {
    const appliedVouchers: AppliedVoucher[] = [
      { code: 'PCT-20', type: VoucherType.Percentage, discountValue: 20 },
    ];

    render(<VoucherInput {...defaultProps} appliedVouchers={appliedVouchers} />);

    const item = screen.getByTestId('voucher-applied-PCT-20');
    expect(item.textContent).toContain('-20%');
  });

  it('should show Service Pack label for service_pack voucher', () => {
    const appliedVouchers: AppliedVoucher[] = [
      { code: 'SP-1', type: VoucherType.ServicePack, discountValue: 0 },
    ];

    render(<VoucherInput {...defaultProps} appliedVouchers={appliedVouchers} />);

    const item = screen.getByTestId('voucher-applied-SP-1');
    expect(item.textContent).toContain('Service Pack');
  });

  it('should call onRemove when remove button is clicked', () => {
    const appliedVouchers: AppliedVoucher[] = [
      { code: 'REMOVE-ME', type: VoucherType.Fixed, discountValue: 5000 },
    ];

    render(<VoucherInput {...defaultProps} appliedVouchers={appliedVouchers} />);

    fireEvent.click(screen.getByTestId('voucher-remove-REMOVE-ME'));

    expect(defaultProps.onRemove).toHaveBeenCalledWith('REMOVE-ME');
  });

  it('should prevent stacking same voucher type (Req 17.2)', async () => {
    const appliedVouchers: AppliedVoucher[] = [
      { code: 'FIRST-FIXED', type: VoucherType.Fixed, discountValue: 10000 },
    ];
    const validResult: VoucherValidationResult = {
      state: {
        status: 'valid_applicable',
        type: VoucherType.Fixed,
        discountValue: 20000,
      },
    };
    defaultProps.onValidate = vi.fn().mockResolvedValue(validResult);

    render(<VoucherInput {...defaultProps} appliedVouchers={appliedVouchers} />);

    fireEvent.change(screen.getByTestId('voucher-code-input'), {
      target: { value: 'SECOND-FIXED' },
    });
    fireEvent.click(screen.getByTestId('voucher-apply-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('voucher-error')).toBeDefined();
      expect(screen.getByTestId('voucher-error').textContent).toContain(
        'FIXED voucher is already applied',
      );
    });

    // onApply should NOT have been called
    expect(defaultProps.onApply).not.toHaveBeenCalled();
  });

  it('should allow stacking different voucher types (Req 17.2)', async () => {
    const appliedVouchers: AppliedVoucher[] = [
      { code: 'MY-FIXED', type: VoucherType.Fixed, discountValue: 10000 },
    ];
    const validResult: VoucherValidationResult = {
      state: {
        status: 'valid_applicable',
        type: VoucherType.Percentage,
        discountValue: 15,
      },
    };
    defaultProps.onValidate = vi.fn().mockResolvedValue(validResult);

    render(<VoucherInput {...defaultProps} appliedVouchers={appliedVouchers} />);

    fireEvent.change(screen.getByTestId('voucher-code-input'), {
      target: { value: 'MY-PERCENTAGE' },
    });
    fireEvent.click(screen.getByTestId('voucher-apply-btn'));

    await waitFor(() => {
      expect(defaultProps.onApply).toHaveBeenCalledWith({
        code: 'MY-PERCENTAGE',
        type: VoucherType.Percentage,
        discountValue: 15,
      });
    });
  });

  it('should show loading state during validation', async () => {
    let resolveValidation: (value: VoucherValidationResult) => void;
    const validationPromise = new Promise<VoucherValidationResult>((resolve) => {
      resolveValidation = resolve;
    });
    defaultProps.onValidate = vi.fn().mockReturnValue(validationPromise);

    render(<VoucherInput {...defaultProps} />);

    fireEvent.change(screen.getByTestId('voucher-code-input'), {
      target: { value: 'LOADING' },
    });
    fireEvent.click(screen.getByTestId('voucher-apply-btn'));

    // Should show loading state
    expect(screen.getByTestId('voucher-apply-btn').textContent).toBe('Validating...');

    // Resolve to finish
    resolveValidation!({ state: { status: 'not_found' } });
    await waitFor(() => {
      expect(screen.getByTestId('voucher-apply-btn').textContent).toBe('Apply');
    });
  });

  it('should handle API error gracefully', async () => {
    defaultProps.onValidate = vi.fn().mockRejectedValue(new Error('Network error'));

    render(<VoucherInput {...defaultProps} />);

    fireEvent.change(screen.getByTestId('voucher-code-input'), {
      target: { value: 'ERROR-CODE' },
    });
    fireEvent.click(screen.getByTestId('voucher-apply-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('voucher-error').textContent).toBe(
        'Failed to validate voucher. Please try again.',
      );
    });
  });

  it('should apply voucher on Enter key press', async () => {
    const validResult: VoucherValidationResult = {
      state: {
        status: 'valid_applicable',
        type: VoucherType.Fixed,
        discountValue: 5000,
      },
    };
    defaultProps.onValidate = vi.fn().mockResolvedValue(validResult);

    render(<VoucherInput {...defaultProps} />);

    const input = screen.getByTestId('voucher-code-input');
    fireEvent.change(input, { target: { value: 'ENTER-CODE' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(defaultProps.onValidate).toHaveBeenCalledWith('ENTER-CODE');
    });
  });

  it('should clear error when typing new code', async () => {
    defaultProps.onValidate = vi.fn().mockResolvedValue({
      state: { status: 'not_found' },
    });

    render(<VoucherInput {...defaultProps} />);

    // Trigger an error
    fireEvent.change(screen.getByTestId('voucher-code-input'), {
      target: { value: 'BAD' },
    });
    fireEvent.click(screen.getByTestId('voucher-apply-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('voucher-error')).toBeDefined();
    });

    // Type new code - error should clear
    fireEvent.change(screen.getByTestId('voucher-code-input'), {
      target: { value: 'NEW' },
    });

    expect(screen.queryByTestId('voucher-error')).toBeNull();
  });

  it('should disable input and button when disabled prop is true', () => {
    render(<VoucherInput {...defaultProps} disabled={true} />);

    const input = screen.getByTestId('voucher-code-input') as HTMLInputElement;
    const button = screen.getByTestId('voucher-apply-btn') as HTMLButtonElement;

    expect(input.disabled).toBe(true);
    expect(button.disabled).toBe(true);
  });

  it('should display multiple applied vouchers', () => {
    const appliedVouchers: AppliedVoucher[] = [
      { code: 'V-FIXED', type: VoucherType.Fixed, discountValue: 10000 },
      { code: 'V-PCT', type: VoucherType.Percentage, discountValue: 10 },
      { code: 'V-SP', type: VoucherType.ServicePack, discountValue: 0 },
    ];

    render(<VoucherInput {...defaultProps} appliedVouchers={appliedVouchers} />);

    expect(screen.getByTestId('voucher-applied-V-FIXED')).toBeDefined();
    expect(screen.getByTestId('voucher-applied-V-PCT')).toBeDefined();
    expect(screen.getByTestId('voucher-applied-V-SP')).toBeDefined();
  });
});
