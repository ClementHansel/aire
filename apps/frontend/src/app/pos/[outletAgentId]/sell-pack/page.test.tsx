/**
 * Unit tests for POS Sell Pack page.
 * Requirements: 14.1, 14.2, 14.4, 18.1
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SellPackPage, {
  VehicleRegistrationDialog,
  MembershipPlanCard,
  VoucherPackCard,
} from './page';

const MOCK_MEMBERSHIP_PLANS: MembershipPlanCard[] = [
  {
    id: 'plan-1',
    name: 'Silver Plan',
    price: 300000,
    durationMonths: 1,
    maxUses: 30,
    dailyLimit: 1,
    maxPlates: 3,
    freeServices: ['Basic Wash'],
    discountedServices: [{ serviceId: 'svc-2', serviceName: 'Premium Wash', discountPct: 20 }],
  },
  {
    id: 'plan-2',
    name: 'Gold Plan',
    price: 750000,
    durationMonths: 3,
    maxUses: 90,
    dailyLimit: 2,
    maxPlates: 5,
    freeServices: ['Basic Wash', 'Premium Wash'],
    discountedServices: [],
  },
];

const MOCK_VOUCHER_PACKS: VoucherPackCard[] = [
  {
    id: 'pack-1',
    name: '5x Wash Pack',
    price: 200000,
    type: 'service_pack',
    value: 0,
    totalUses: 5,
    services: ['Basic Wash'],
    validityDays: 90,
  },
  {
    id: 'pack-2',
    name: 'Discount Bundle',
    price: 150000,
    type: 'percentage',
    value: 25,
    totalUses: 3,
    services: [],
    validityDays: 60,
  },
];

describe('SellPackPage', () => {
  describe('Tab Navigation', () => {
    it('should render with membership tab active by default', () => {
      render(<SellPackPage membershipPlans={MOCK_MEMBERSHIP_PLANS} voucherPacks={MOCK_VOUCHER_PACKS} />);

      const membershipTab = screen.getByTestId('tab-membership');
      expect(membershipTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('membership-panel')).toBeDefined();
    });

    it('should switch to voucher tab when clicked', () => {
      render(<SellPackPage membershipPlans={MOCK_MEMBERSHIP_PLANS} voucherPacks={MOCK_VOUCHER_PACKS} />);

      fireEvent.click(screen.getByTestId('tab-voucher'));

      const voucherTab = screen.getByTestId('tab-voucher');
      expect(voucherTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('voucher-panel')).toBeDefined();
    });

    it('should render tabs with correct roles for accessibility', () => {
      render(<SellPackPage />);

      const tablist = screen.getByRole('tablist');
      expect(tablist).toBeDefined();

      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(2);
    });
  });

  describe('Membership Plans Tab', () => {
    it('should display membership plan cards', () => {
      render(<SellPackPage membershipPlans={MOCK_MEMBERSHIP_PLANS} />);

      expect(screen.getByTestId('plan-card-plan-1')).toBeDefined();
      expect(screen.getByTestId('plan-card-plan-2')).toBeDefined();
    });

    it('should display plan name and price', () => {
      render(<SellPackPage membershipPlans={MOCK_MEMBERSHIP_PLANS} />);

      expect(screen.getByTestId('plan-card-plan-1').textContent).toContain('Silver Plan');
      expect(screen.getByTestId('plan-price-plan-1').textContent).toContain('300,000');
    });

    it('should display plan details', () => {
      render(<SellPackPage membershipPlans={MOCK_MEMBERSHIP_PLANS} />);

      const card = screen.getByTestId('plan-card-plan-1');
      expect(card.textContent).toContain('1 month');
      expect(card.textContent).toContain('30 washes');
      expect(card.textContent).toContain('1/day limit');
      expect(card.textContent).toContain('Max 3 plates');
    });

    it('should display free services in plan card', () => {
      render(<SellPackPage membershipPlans={MOCK_MEMBERSHIP_PLANS} />);

      const card = screen.getByTestId('plan-card-plan-1');
      expect(card.textContent).toContain('Free: Basic Wash');
    });

    it('should display discounted services in plan card', () => {
      render(<SellPackPage membershipPlans={MOCK_MEMBERSHIP_PLANS} />);

      const card = screen.getByTestId('plan-card-plan-1');
      expect(card.textContent).toContain('Premium Wash (20%)');
    });

    it('should show empty state when no plans available', () => {
      render(<SellPackPage membershipPlans={[]} />);

      expect(screen.getByTestId('no-membership-plans')).toBeDefined();
      expect(screen.getByTestId('no-membership-plans').textContent).toContain(
        'No membership plans available',
      );
    });

    it('should add membership plan to cart when Add to Cart is clicked (Req 14.1)', () => {
      render(<SellPackPage membershipPlans={MOCK_MEMBERSHIP_PLANS} />);

      fireEvent.click(screen.getByTestId('add-plan-plan-1'));

      expect(screen.getByTestId('sell-pack-cart-item')).toBeDefined();
      expect(screen.getByTestId('cart-item-name').textContent).toBe('Silver Plan');
      expect(screen.getByTestId('cart-item-price').textContent).toContain('300,000');
    });

    it('should enforce max one membership plan per order (Req 14.2)', () => {
      render(<SellPackPage membershipPlans={MOCK_MEMBERSHIP_PLANS} />);

      // Add first plan
      fireEvent.click(screen.getByTestId('add-plan-plan-1'));

      // Second plan button should be disabled
      const addBtn = screen.getByTestId('add-plan-plan-2');
      expect(addBtn).toHaveAttribute('disabled');
      expect(addBtn.textContent).toBe('Max 1 plan per order');
    });
  });

  describe('Voucher Packs Tab', () => {
    it('should display voucher pack cards', () => {
      render(<SellPackPage voucherPacks={MOCK_VOUCHER_PACKS} />);

      fireEvent.click(screen.getByTestId('tab-voucher'));

      expect(screen.getByTestId('pack-card-pack-1')).toBeDefined();
      expect(screen.getByTestId('pack-card-pack-2')).toBeDefined();
    });

    it('should display pack name and price (Req 18.1)', () => {
      render(<SellPackPage voucherPacks={MOCK_VOUCHER_PACKS} />);

      fireEvent.click(screen.getByTestId('tab-voucher'));

      expect(screen.getByTestId('pack-card-pack-1').textContent).toContain('5x Wash Pack');
      expect(screen.getByTestId('pack-price-pack-1').textContent).toContain('200,000');
    });

    it('should display pack details (uses, validity, services)', () => {
      render(<SellPackPage voucherPacks={MOCK_VOUCHER_PACKS} />);

      fireEvent.click(screen.getByTestId('tab-voucher'));

      const card = screen.getByTestId('pack-card-pack-1');
      expect(card.textContent).toContain('5 uses');
      expect(card.textContent).toContain('Valid for 90 days');
      expect(card.textContent).toContain('Basic Wash');
    });

    it('should show empty state when no packs available', () => {
      render(<SellPackPage voucherPacks={[]} />);

      fireEvent.click(screen.getByTestId('tab-voucher'));

      expect(screen.getByTestId('no-voucher-packs')).toBeDefined();
    });

    it('should add voucher pack to cart when Add to Cart is clicked (Req 18.1)', () => {
      render(<SellPackPage voucherPacks={MOCK_VOUCHER_PACKS} />);

      fireEvent.click(screen.getByTestId('tab-voucher'));
      fireEvent.click(screen.getByTestId('add-pack-pack-1'));

      expect(screen.getByTestId('sell-pack-cart-item')).toBeDefined();
      expect(screen.getByTestId('cart-item-name').textContent).toBe('5x Wash Pack');
      expect(screen.getByTestId('cart-item-type').textContent).toBe('Voucher Pack');
    });
  });

  describe('Cart', () => {
    it('should show empty cart state initially', () => {
      render(<SellPackPage />);

      expect(screen.getByTestId('sell-pack-cart-empty')).toBeDefined();
      expect(screen.getByTestId('sell-pack-cart-empty').textContent).toContain('No pack selected');
    });

    it('should display cart item details after adding', () => {
      render(<SellPackPage membershipPlans={MOCK_MEMBERSHIP_PLANS} />);

      fireEvent.click(screen.getByTestId('add-plan-plan-1'));

      expect(screen.getByTestId('cart-item-name').textContent).toBe('Silver Plan');
      expect(screen.getByTestId('cart-item-type').textContent).toBe('Membership Plan');
      expect(screen.getByTestId('cart-item-details').textContent).toContain('1mo');
      expect(screen.getByTestId('cart-item-details').textContent).toContain('30 washes');
    });

    it('should display total matching item price', () => {
      render(<SellPackPage membershipPlans={MOCK_MEMBERSHIP_PLANS} />);

      fireEvent.click(screen.getByTestId('add-plan-plan-1'));

      expect(screen.getByTestId('cart-total').textContent).toContain('300,000');
    });

    it('should remove item from cart', () => {
      render(<SellPackPage membershipPlans={MOCK_MEMBERSHIP_PLANS} />);

      fireEvent.click(screen.getByTestId('add-plan-plan-1'));
      fireEvent.click(screen.getByTestId('cart-remove-btn'));

      expect(screen.getByTestId('sell-pack-cart-empty')).toBeDefined();
    });

    it('should re-enable add buttons after removing membership from cart', () => {
      render(<SellPackPage membershipPlans={MOCK_MEMBERSHIP_PLANS} />);

      fireEvent.click(screen.getByTestId('add-plan-plan-1'));
      fireEvent.click(screen.getByTestId('cart-remove-btn'));

      const addBtn = screen.getByTestId('add-plan-plan-2');
      expect(addBtn).not.toHaveAttribute('disabled');
    });

    it('should show proceed to payment button when cart has item', () => {
      render(<SellPackPage membershipPlans={MOCK_MEMBERSHIP_PLANS} />);

      fireEvent.click(screen.getByTestId('add-plan-plan-1'));

      expect(screen.getByTestId('proceed-payment-btn')).toBeDefined();
    });
  });

  describe('Vehicle Registration (Req 14.4)', () => {
    it('should show vehicle registration dialog after membership payment', () => {
      render(<SellPackPage membershipPlans={MOCK_MEMBERSHIP_PLANS} />);

      fireEvent.click(screen.getByTestId('add-plan-plan-1'));
      fireEvent.click(screen.getByTestId('proceed-payment-btn'));

      expect(screen.getByTestId('vehicle-registration-dialog')).toBeDefined();
    });

    it('should NOT show vehicle registration for voucher pack payment', () => {
      render(<SellPackPage voucherPacks={MOCK_VOUCHER_PACKS} />);

      fireEvent.click(screen.getByTestId('tab-voucher'));
      fireEvent.click(screen.getByTestId('add-pack-pack-1'));
      fireEvent.click(screen.getByTestId('proceed-payment-btn'));

      expect(screen.queryByTestId('vehicle-registration-dialog')).toBeNull();
    });

    it('should pre-fill vehicle registration from order data', () => {
      render(
        <SellPackPage
          membershipPlans={MOCK_MEMBERSHIP_PLANS}
          prefillPlate="B 1234 XYZ"
          prefillBrand="Toyota"
          prefillModel="Avanza"
        />,
      );

      fireEvent.click(screen.getByTestId('add-plan-plan-1'));
      fireEvent.click(screen.getByTestId('proceed-payment-btn'));

      const plateInput = screen.getByTestId('vehicle-plate-0') as HTMLInputElement;
      const brandInput = screen.getByTestId('vehicle-brand-0') as HTMLInputElement;
      const modelInput = screen.getByTestId('vehicle-model-0') as HTMLInputElement;

      expect(plateInput.value).toBe('B 1234 XYZ');
      expect(brandInput.value).toBe('Toyota');
      expect(modelInput.value).toBe('Avanza');
    });
  });
});

describe('VehicleRegistrationDialog', () => {
  const defaultProps = {
    maxPlates: 3,
    onSave: vi.fn(),
    onClose: vi.fn(),
  };

  it('should render one vehicle entry by default', () => {
    render(<VehicleRegistrationDialog {...defaultProps} />);

    expect(screen.getByTestId('vehicle-entry-0')).toBeDefined();
  });

  it('should pre-fill first vehicle with provided data', () => {
    render(
      <VehicleRegistrationDialog
        {...defaultProps}
        prefillPlate="AB 123 CD"
        prefillBrand="Honda"
        prefillModel="Jazz"
      />,
    );

    expect((screen.getByTestId('vehicle-plate-0') as HTMLInputElement).value).toBe('AB 123 CD');
    expect((screen.getByTestId('vehicle-brand-0') as HTMLInputElement).value).toBe('Honda');
    expect((screen.getByTestId('vehicle-model-0') as HTMLInputElement).value).toBe('Jazz');
  });

  it('should allow adding vehicles up to maxPlates', () => {
    render(<VehicleRegistrationDialog {...defaultProps} maxPlates={2} />);

    fireEvent.click(screen.getByTestId('add-vehicle-btn'));
    expect(screen.getByTestId('vehicle-entry-1')).toBeDefined();

    // Should not show add button when max reached
    expect(screen.queryByTestId('add-vehicle-btn')).toBeNull();
  });

  it('should allow removing a vehicle entry', () => {
    render(<VehicleRegistrationDialog {...defaultProps} />);

    fireEvent.click(screen.getByTestId('add-vehicle-btn'));
    expect(screen.getByTestId('vehicle-entry-1')).toBeDefined();

    fireEvent.click(screen.getByTestId('remove-vehicle-1'));
    expect(screen.queryByTestId('vehicle-entry-1')).toBeNull();
  });

  it('should disable save when no valid plate entered', () => {
    render(<VehicleRegistrationDialog {...defaultProps} />);

    const saveBtn = screen.getByTestId('vehicle-save-btn');
    expect(saveBtn).toHaveAttribute('disabled');
  });

  it('should enable save when at least one plate is entered', () => {
    render(<VehicleRegistrationDialog {...defaultProps} />);

    fireEvent.change(screen.getByTestId('vehicle-plate-0'), {
      target: { value: 'B 1234 XYZ' },
    });

    const saveBtn = screen.getByTestId('vehicle-save-btn');
    expect(saveBtn).not.toHaveAttribute('disabled');
  });

  it('should call onSave with valid vehicles only', () => {
    const onSave = vi.fn();
    render(<VehicleRegistrationDialog {...defaultProps} onSave={onSave} />);

    fireEvent.change(screen.getByTestId('vehicle-plate-0'), {
      target: { value: 'B 1234 XYZ' },
    });
    fireEvent.change(screen.getByTestId('vehicle-brand-0'), {
      target: { value: 'Toyota' },
    });

    // Add empty vehicle (should be filtered out)
    fireEvent.click(screen.getByTestId('add-vehicle-btn'));

    fireEvent.click(screen.getByTestId('vehicle-save-btn'));

    expect(onSave).toHaveBeenCalledWith([
      { plate: 'B 1234 XYZ', brand: 'Toyota', model: '' },
    ]);
  });

  it('should call onClose when cancel is clicked', () => {
    const onClose = vi.fn();
    render(<VehicleRegistrationDialog {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('vehicle-cancel-btn'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should have correct aria attributes for accessibility', () => {
    render(<VehicleRegistrationDialog {...defaultProps} />);

    const dialog = screen.getByTestId('vehicle-registration-dialog');
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Vehicle registration');
  });
});
