/**
 * Unit tests for Cart component.
 * Requirements: 6.7, 6.8, 6.9, 6.10
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Cart } from './Cart';
import { useCartStore } from '@/stores/cartStore';

describe('Cart', () => {
  const defaultProps = {
    customerName: 'John Doe',
    customerPhone: '081234567890',
    onPlaceOrder: vi.fn(),
    onValidationErrors: vi.fn(),
  };

  beforeEach(() => {
    useCartStore.setState({
      items: [],
      config: { serviceChargePct: 0, taxPct: 0 },
      voucherDiscount: 0,
      promoDiscount: 0,
      note: '',
    });
    defaultProps.onPlaceOrder.mockClear();
    defaultProps.onValidationErrors.mockClear();
  });

  it('should show empty state when no items', () => {
    render(<Cart {...defaultProps} />);
    expect(screen.getByTestId('cart-empty')).toBeDefined();
    expect(screen.getByTestId('cart-empty').textContent).toContain('No items in cart');
  });

  it('should render cart items with name and price', () => {
    useCartStore.setState({
      ...useCartStore.getState(),
      items: [
        {
          serviceId: 'svc-1',
          serviceName: 'Basic Wash',
          quantity: 2,
          unitPrice: 50000,
          discount: 0,
          isMainService: true,
        },
      ],
    });

    render(<Cart {...defaultProps} />);
    const item = screen.getByTestId('cart-item-svc-1');
    expect(item.textContent).toContain('Basic Wash');
    expect(item.textContent).toContain('100,000'); // 50000 * 2
  });

  it('should increment quantity when + is clicked', () => {
    useCartStore.setState({
      ...useCartStore.getState(),
      items: [
        {
          serviceId: 'svc-1',
          serviceName: 'Basic Wash',
          quantity: 1,
          unitPrice: 50000,
          discount: 0,
          isMainService: true,
        },
      ],
    });

    render(<Cart {...defaultProps} />);
    fireEvent.click(screen.getByTestId('qty-plus-svc-1'));

    expect(useCartStore.getState().items[0].quantity).toBe(2);
  });

  it('should decrement quantity when − is clicked', () => {
    useCartStore.setState({
      ...useCartStore.getState(),
      items: [
        {
          serviceId: 'svc-1',
          serviceName: 'Basic Wash',
          quantity: 3,
          unitPrice: 50000,
          discount: 0,
          isMainService: true,
        },
      ],
    });

    render(<Cart {...defaultProps} />);
    fireEvent.click(screen.getByTestId('qty-minus-svc-1'));

    expect(useCartStore.getState().items[0].quantity).toBe(2);
  });

  it('should remove item when quantity reaches 0 via decrement', () => {
    useCartStore.setState({
      ...useCartStore.getState(),
      items: [
        {
          serviceId: 'svc-1',
          serviceName: 'Basic Wash',
          quantity: 1,
          unitPrice: 50000,
          discount: 0,
          isMainService: true,
        },
      ],
    });

    render(<Cart {...defaultProps} />);
    fireEvent.click(screen.getByTestId('qty-minus-svc-1'));

    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('should remove item when remove button is clicked', () => {
    useCartStore.setState({
      ...useCartStore.getState(),
      items: [
        {
          serviceId: 'svc-1',
          serviceName: 'Basic Wash',
          quantity: 2,
          unitPrice: 50000,
          discount: 0,
          isMainService: true,
        },
      ],
    });

    render(<Cart {...defaultProps} />);
    fireEvent.click(screen.getByTestId('remove-svc-1'));

    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('should display cart summary', () => {
    useCartStore.setState({
      ...useCartStore.getState(),
      items: [
        {
          serviceId: 'svc-1',
          serviceName: 'Basic Wash',
          quantity: 2,
          unitPrice: 50000,
          discount: 0,
          isMainService: true,
        },
      ],
    });

    render(<Cart {...defaultProps} />);
    expect(screen.getByTestId('summary-subtotal').textContent).toContain('100,000');
    expect(screen.getByTestId('summary-total').textContent).toContain('100,000');
  });

  it('should display service charge and tax in summary when configured', () => {
    useCartStore.setState({
      ...useCartStore.getState(),
      config: { serviceChargePct: 0.05, taxPct: 0.11 },
      items: [
        {
          serviceId: 'svc-1',
          serviceName: 'Basic Wash',
          quantity: 1,
          unitPrice: 100000,
          discount: 0,
          isMainService: true,
        },
      ],
    });

    render(<Cart {...defaultProps} />);
    expect(screen.getByTestId('summary-service-charge').textContent).toContain('5,000');
    expect(screen.getByTestId('summary-tax').textContent).toContain('11,000');
    expect(screen.getByTestId('summary-total').textContent).toContain('116,000');
  });

  it('should display voucher and promo discounts in summary', () => {
    useCartStore.setState({
      ...useCartStore.getState(),
      items: [
        {
          serviceId: 'svc-1',
          serviceName: 'Basic Wash',
          quantity: 1,
          unitPrice: 100000,
          discount: 0,
          isMainService: true,
        },
      ],
      voucherDiscount: 10000,
      promoDiscount: 5000,
    });

    render(<Cart {...defaultProps} />);
    expect(screen.getByTestId('summary-voucher-discount').textContent).toContain('10,000');
    expect(screen.getByTestId('summary-promo-discount').textContent).toContain('5,000');
    expect(screen.getByTestId('summary-total').textContent).toContain('85,000');
  });

  it('should allow note entry', () => {
    render(<Cart {...defaultProps} />);

    const noteInput = screen.getByTestId('cart-note');
    fireEvent.change(noteInput, { target: { value: 'Rush order' } });

    expect(useCartStore.getState().note).toBe('Rush order');
  });

  it('should call onPlaceOrder when validation passes', () => {
    useCartStore.setState({
      ...useCartStore.getState(),
      items: [
        {
          serviceId: 'svc-1',
          serviceName: 'Basic Wash',
          quantity: 1,
          unitPrice: 50000,
          discount: 0,
          isMainService: true,
        },
      ],
    });

    render(<Cart {...defaultProps} />);
    fireEvent.click(screen.getByTestId('place-order-btn'));

    expect(defaultProps.onPlaceOrder).toHaveBeenCalledTimes(1);
    expect(defaultProps.onValidationErrors).not.toHaveBeenCalled();
  });

  it('should call onValidationErrors when validation fails', () => {
    // Cart is empty, no customer info
    render(
      <Cart
        {...defaultProps}
        customerName=""
        customerPhone=""
      />,
    );
    fireEvent.click(screen.getByTestId('place-order-btn'));

    expect(defaultProps.onPlaceOrder).not.toHaveBeenCalled();
    expect(defaultProps.onValidationErrors).toHaveBeenCalledTimes(1);

    const errors = defaultProps.onValidationErrors.mock.calls[0][0];
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e: { message: string }) => e.message === 'Name is required')).toBe(true);
  });

  it('should show quantity value in the controls', () => {
    useCartStore.setState({
      ...useCartStore.getState(),
      items: [
        {
          serviceId: 'svc-1',
          serviceName: 'Basic Wash',
          quantity: 3,
          unitPrice: 50000,
          discount: 0,
          isMainService: true,
        },
      ],
    });

    render(<Cart {...defaultProps} />);
    expect(screen.getByTestId('qty-value-svc-1').textContent).toBe('3');
  });
});
