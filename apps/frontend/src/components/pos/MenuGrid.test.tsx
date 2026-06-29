/**
 * Unit tests for MenuGrid component.
 * Requirements: 6.1, 6.2, 6.3
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MenuGrid, ServiceTile } from './MenuGrid';
import { ServiceCategory } from '@aire/shared/enums';
import { useCartStore } from '@/stores/cartStore';

const mockServices: ServiceTile[] = [
  {
    id: 'wash-1',
    name: 'Basic Wash',
    price: 50000,
    category: ServiceCategory.CarWash,
    isActive: true,
    isMainService: true,
  },
  {
    id: 'wash-2',
    name: 'Premium Wash',
    price: 100000,
    category: ServiceCategory.CarWash,
    isActive: true,
    isMainService: true,
  },
  {
    id: 'prod-1',
    name: 'Air Freshener',
    price: 25000,
    category: ServiceCategory.Product,
    isActive: true,
    isMainService: false,
  },
  {
    id: 'addon-1',
    name: 'Interior Clean',
    price: 75000,
    category: ServiceCategory.AddOn,
    isActive: true,
    isMainService: false,
  },
  {
    id: 'wash-3',
    name: 'Sold Out Wash',
    price: 80000,
    category: ServiceCategory.CarWash,
    isActive: false,
    isMainService: true,
  },
  {
    id: 'wash-4',
    name: 'Member Free Wash',
    price: 60000,
    category: ServiceCategory.CarWash,
    isActive: true,
    isMainService: true,
    isMemberFree: true,
  },
  {
    id: 'wash-5',
    name: 'Member Discount Wash',
    price: 90000,
    category: ServiceCategory.CarWash,
    isActive: true,
    isMainService: true,
    memberDiscountPct: 20,
  },
];

describe('MenuGrid', () => {
  beforeEach(() => {
    useCartStore.setState({
      items: [],
      config: { serviceChargePct: 0, taxPct: 0 },
      voucherDiscount: 0,
      promoDiscount: 0,
      note: '',
    });
  });

  it('should render category tabs with item counts', () => {
    render(<MenuGrid services={mockServices} />);

    const allTab = screen.getByTestId('tab-all');
    const carWashTab = screen.getByTestId('tab-car_wash');
    const productTab = screen.getByTestId('tab-product');
    const addOnTab = screen.getByTestId('tab-add_on');

    expect(allTab).toBeDefined();
    expect(carWashTab).toBeDefined();
    expect(productTab).toBeDefined();
    expect(addOnTab).toBeDefined();

    // Check count badges
    expect(allTab.textContent).toContain('7');
    expect(carWashTab.textContent).toContain('5');
    expect(productTab.textContent).toContain('1');
    expect(addOnTab.textContent).toContain('1');
  });

  it('should show all services by default', () => {
    render(<MenuGrid services={mockServices} />);

    const tiles = screen.getByTestId('service-tiles');
    expect(tiles.children).toHaveLength(7);
  });

  it('should filter services by category when tab is clicked', () => {
    render(<MenuGrid services={mockServices} />);

    fireEvent.click(screen.getByTestId('tab-product'));

    const tiles = screen.getByTestId('service-tiles');
    expect(tiles.children).toHaveLength(1);
    expect(screen.getByTestId('tile-prod-1')).toBeDefined();
  });

  it('should add item to cart when active tile is clicked', () => {
    render(<MenuGrid services={mockServices} />);

    fireEvent.click(screen.getByTestId('tile-wash-1'));

    const { items } = useCartStore.getState();
    expect(items).toHaveLength(1);
    expect(items[0].serviceId).toBe('wash-1');
    expect(items[0].quantity).toBe(1);
  });

  it('should increment quantity when same tile is clicked again', () => {
    render(<MenuGrid services={mockServices} />);

    fireEvent.click(screen.getByTestId('tile-wash-1'));
    fireEvent.click(screen.getByTestId('tile-wash-1'));

    const { items } = useCartStore.getState();
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
  });

  it('should not add inactive (Habis) tiles to cart', () => {
    render(<MenuGrid services={mockServices} />);

    const disabledTile = screen.getByTestId('tile-wash-3');
    expect(disabledTile).toHaveProperty('disabled', true);

    fireEvent.click(disabledTile);
    const { items } = useCartStore.getState();
    expect(items).toHaveLength(0);
  });

  it('should display "Habis" badge on inactive services', () => {
    render(<MenuGrid services={mockServices} />);
    expect(screen.getByTestId('badge-habis-wash-3')).toBeDefined();
  });

  it('should display "GRATIS" badge for member free services', () => {
    render(<MenuGrid services={mockServices} />);
    expect(screen.getByTestId('badge-gratis-wash-4')).toBeDefined();
  });

  it('should display discount badge for member discounted services', () => {
    render(<MenuGrid services={mockServices} />);
    const badge = screen.getByTestId('badge-discount-wash-5');
    expect(badge.textContent).toContain('-20%');
  });

  it('should display quantity badge for items in cart', () => {
    // Pre-populate cart
    useCartStore.setState({
      ...useCartStore.getState(),
      items: [
        {
          serviceId: 'wash-1',
          serviceName: 'Basic Wash',
          quantity: 3,
          unitPrice: 50000,
          discount: 0,
          isMainService: true,
        },
      ],
    });

    render(<MenuGrid services={mockServices} />);
    const badge = screen.getByTestId('badge-qty-wash-1');
    expect(badge.textContent).toBe('3');
  });

  it('should show tile name and price', () => {
    render(<MenuGrid services={mockServices} />);

    const tile = screen.getByTestId('tile-wash-1');
    expect(tile.textContent).toContain('Basic Wash');
    expect(tile.textContent).toContain('50,000');
  });
});
