/**
 * Cart store using Zustand for POS new order flow.
 * Manages cart items, discounts, and summary calculation.
 *
 * Requirements: 6.2, 6.7, 6.8, 6.9, 6.10
 */
import { create } from 'zustand';
import {
  CartItem,
  CartConfig,
  CartSummary,
  calculateCartSummary,
  addToCart,
  removeFromCart,
  updateQuantity as updateCartQuantity,
  applyManualDiscount,
} from '@aire/shared/cart-calculator';
import { validateOrder, OrderValidationResult } from '@aire/shared/validators';

export interface CartState {
  items: CartItem[];
  config: CartConfig;
  voucherDiscount: number;
  promoDiscount: number;
  note: string;

  // Actions
  addItem: (item: CartItem) => void;
  removeItem: (serviceId: string) => void;
  updateQuantity: (serviceId: string, quantity: number) => void;
  applyDiscount: (serviceId: string, discount: number) => void;
  setVoucherDiscount: (amount: number) => void;
  setPromoDiscount: (amount: number) => void;
  setNote: (note: string) => void;
  setConfig: (config: CartConfig) => void;
  clearCart: () => void;

  // Computed
  getSummary: () => CartSummary;
  validate: (customerName: string, customerPhone: string, memberPlates?: string[], selectedPlate?: string, voucherCodes?: string[], voucherMinOrderAmount?: number) => OrderValidationResult;
}

const DEFAULT_CONFIG: CartConfig = {
  serviceChargePct: 0,
  taxPct: 0,
  maxManualDiscountPct: undefined,
};

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  config: DEFAULT_CONFIG,
  voucherDiscount: 0,
  promoDiscount: 0,
  note: '',

  addItem: (item) => {
    set((state) => ({
      items: addToCart(state.items, item),
    }));
  },

  removeItem: (serviceId) => {
    set((state) => ({
      items: removeFromCart(state.items, serviceId),
    }));
  },

  updateQuantity: (serviceId, quantity) => {
    set((state) => ({
      items: updateCartQuantity(state.items, serviceId, quantity),
    }));
  },

  applyDiscount: (serviceId, discount) => {
    set((state) => ({
      items: applyManualDiscount(state.items, serviceId, discount, state.config),
    }));
  },

  setVoucherDiscount: (amount) => {
    set({ voucherDiscount: amount });
  },

  setPromoDiscount: (amount) => {
    set({ promoDiscount: amount });
  },

  setNote: (note) => {
    set({ note });
  },

  setConfig: (config) => {
    set({ config });
  },

  clearCart: () => {
    set({
      items: [],
      voucherDiscount: 0,
      promoDiscount: 0,
      note: '',
    });
  },

  getSummary: () => {
    const { items, config, voucherDiscount, promoDiscount } = get();
    return calculateCartSummary(items, config, voucherDiscount, promoDiscount);
  },

  validate: (customerName, customerPhone, memberPlates, selectedPlate, voucherCodes, voucherMinOrderAmount) => {
    const { items, config, voucherDiscount, promoDiscount } = get();
    const summary = calculateCartSummary(items, config, voucherDiscount, promoDiscount);

    return validateOrder({
      customerName,
      customerPhone,
      items: items.map((i) => ({
        serviceId: i.serviceId,
        quantity: i.quantity,
        isMainService: i.isMainService,
      })),
      voucherCodes,
      voucherMinOrderAmount,
      orderSubtotal: summary.subtotal,
      memberPlates,
      selectedPlate,
    });
  },
}));
