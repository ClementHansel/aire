/**
 * Unit tests for the cart store.
 * Requirements: 6.2, 6.7, 6.8, 6.9, 6.10
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useCartStore } from './cartStore';
import { CartItem } from '@aire/shared/cart-calculator';

function createTestItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    serviceId: 'svc-1',
    serviceName: 'Basic Wash',
    quantity: 1,
    unitPrice: 50000,
    discount: 0,
    isMainService: true,
    ...overrides,
  };
}

describe('cartStore', () => {
  beforeEach(() => {
    // Reset store between tests
    useCartStore.setState({
      items: [],
      config: { serviceChargePct: 0, taxPct: 0 },
      voucherDiscount: 0,
      promoDiscount: 0,
      note: '',
    });
  });

  describe('addItem', () => {
    it('should add a new item to the cart', () => {
      const item = createTestItem();
      useCartStore.getState().addItem(item);

      const { items } = useCartStore.getState();
      expect(items).toHaveLength(1);
      expect(items[0].serviceId).toBe('svc-1');
      expect(items[0].quantity).toBe(1);
    });

    it('should increment quantity when adding an existing item', () => {
      const item = createTestItem();
      useCartStore.getState().addItem(item);
      useCartStore.getState().addItem(item);

      const { items } = useCartStore.getState();
      expect(items).toHaveLength(1);
      expect(items[0].quantity).toBe(2);
    });

    it('should add multiple different items', () => {
      useCartStore.getState().addItem(createTestItem({ serviceId: 'svc-1' }));
      useCartStore.getState().addItem(createTestItem({ serviceId: 'svc-2', serviceName: 'Premium Wash' }));

      const { items } = useCartStore.getState();
      expect(items).toHaveLength(2);
    });
  });

  describe('removeItem', () => {
    it('should remove an item from the cart', () => {
      useCartStore.getState().addItem(createTestItem({ serviceId: 'svc-1' }));
      useCartStore.getState().addItem(createTestItem({ serviceId: 'svc-2' }));
      useCartStore.getState().removeItem('svc-1');

      const { items } = useCartStore.getState();
      expect(items).toHaveLength(1);
      expect(items[0].serviceId).toBe('svc-2');
    });

    it('should do nothing when removing non-existent item', () => {
      useCartStore.getState().addItem(createTestItem());
      useCartStore.getState().removeItem('non-existent');

      const { items } = useCartStore.getState();
      expect(items).toHaveLength(1);
    });
  });

  describe('updateQuantity', () => {
    it('should update quantity of an item', () => {
      useCartStore.getState().addItem(createTestItem());
      useCartStore.getState().updateQuantity('svc-1', 5);

      const { items } = useCartStore.getState();
      expect(items[0].quantity).toBe(5);
    });

    it('should remove item when quantity is set to 0', () => {
      useCartStore.getState().addItem(createTestItem());
      useCartStore.getState().updateQuantity('svc-1', 0);

      const { items } = useCartStore.getState();
      expect(items).toHaveLength(0);
    });
  });

  describe('applyDiscount', () => {
    it('should apply manual discount to an item', () => {
      useCartStore.getState().addItem(createTestItem({ unitPrice: 100000 }));
      useCartStore.getState().applyDiscount('svc-1', 10000);

      const { items } = useCartStore.getState();
      expect(items[0].discount).toBe(10000);
    });

    it('should cap discount based on maxManualDiscountPct', () => {
      useCartStore.setState({
        ...useCartStore.getState(),
        config: { serviceChargePct: 0, taxPct: 0, maxManualDiscountPct: 0.5 },
      });
      useCartStore.getState().addItem(createTestItem({ unitPrice: 100000, quantity: 1 }));
      // Try to apply 60000 discount on a 100000 item with 50% cap → should be capped at 50000
      useCartStore.getState().applyDiscount('svc-1', 60000);

      const { items } = useCartStore.getState();
      expect(items[0].discount).toBe(50000);
    });
  });

  describe('setNote', () => {
    it('should set the order note', () => {
      useCartStore.getState().setNote('Rush order');
      expect(useCartStore.getState().note).toBe('Rush order');
    });
  });

  describe('clearCart', () => {
    it('should reset all cart state', () => {
      useCartStore.getState().addItem(createTestItem());
      useCartStore.getState().setVoucherDiscount(5000);
      useCartStore.getState().setPromoDiscount(3000);
      useCartStore.getState().setNote('test note');
      useCartStore.getState().clearCart();

      const state = useCartStore.getState();
      expect(state.items).toHaveLength(0);
      expect(state.voucherDiscount).toBe(0);
      expect(state.promoDiscount).toBe(0);
      expect(state.note).toBe('');
    });
  });

  describe('getSummary', () => {
    it('should calculate correct summary for items', () => {
      useCartStore.getState().addItem(createTestItem({ unitPrice: 50000, quantity: 1 }));
      useCartStore.getState().addItem(
        createTestItem({ serviceId: 'svc-2', unitPrice: 30000, quantity: 2, isMainService: false }),
      );

      const summary = useCartStore.getState().getSummary();
      // subtotal = 50000*1 + 30000*2 = 110000
      expect(summary.subtotal).toBe(110000);
      expect(summary.total).toBe(110000);
    });

    it('should include service charge and tax in summary', () => {
      useCartStore.setState({
        ...useCartStore.getState(),
        config: { serviceChargePct: 0.05, taxPct: 0.11 },
      });
      useCartStore.getState().addItem(createTestItem({ unitPrice: 100000 }));

      const summary = useCartStore.getState().getSummary();
      expect(summary.subtotal).toBe(100000);
      expect(summary.serviceCharge).toBe(5000);
      expect(summary.tax).toBe(11000);
      expect(summary.total).toBe(116000);
    });

    it('should subtract discounts from total', () => {
      useCartStore.getState().addItem(createTestItem({ unitPrice: 100000 }));
      useCartStore.getState().setVoucherDiscount(10000);
      useCartStore.getState().setPromoDiscount(5000);

      const summary = useCartStore.getState().getSummary();
      expect(summary.total).toBe(85000);
    });

    it('should not produce negative total', () => {
      useCartStore.getState().addItem(createTestItem({ unitPrice: 10000 }));
      useCartStore.getState().setVoucherDiscount(50000);

      const summary = useCartStore.getState().getSummary();
      expect(summary.total).toBe(0);
    });
  });

  describe('validate', () => {
    it('should return errors when cart is empty and no customer info', () => {
      const result = useCartStore.getState().validate('', '', undefined, undefined, undefined, undefined);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.message === 'Name is required')).toBe(true);
      expect(result.errors.some((e) => e.message === 'Add at least one service')).toBe(true);
    });

    it('should return errors when no main service is in cart', () => {
      useCartStore.getState().addItem(createTestItem({ isMainService: false, serviceId: 'addon-1' }));
      const result = useCartStore.getState().validate('John', '081234567890');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message === 'Add a main wash service first')).toBe(true);
    });

    it('should pass validation with valid data', () => {
      useCartStore.getState().addItem(createTestItem({ isMainService: true }));
      const result = useCartStore.getState().validate('John', '081234567890');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject phone with fewer than 8 digits', () => {
      useCartStore.getState().addItem(createTestItem({ isMainService: true }));
      const result = useCartStore.getState().validate('John', '12345');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message === 'Phone must be at least 8 digits')).toBe(true);
    });

    it('should require plate selection when multiple member plates exist', () => {
      useCartStore.getState().addItem(createTestItem({ isMainService: true }));
      const result = useCartStore.getState().validate(
        'John',
        '081234567890',
        ['B 1234 AB', 'B 5678 CD'],
        '', // no plate selected
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message === 'Select vehicle plate')).toBe(true);
    });
  });
});
