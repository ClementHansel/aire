/**
 * Unit tests for MemberBanner component.
 * Requirements: 6.6, 12.3, 12.4, 12.5
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemberBanner } from './MemberBanner';
import { MembershipDetail } from '@aire/shared/interfaces/member';
import { MembershipStatus } from '@aire/shared/enums';

const activeMembership: MembershipDetail = {
  id: 'mem-1',
  planName: 'Gold Plan',
  status: MembershipStatus.Active,
  startDate: '2024-01-01',
  endDate: '2025-01-01',
  usesCount: 10,
  maxUses: 100,
  dailyLimit: 1,
  plates: [
    { plate: 'B1234XYZ', brand: 'Toyota', model: 'Avanza' },
    { plate: 'D5678ABC', brand: 'Honda', model: 'Jazz' },
  ],
  freeServices: ['svc-basic'],
  discountedServices: [{ serviceId: 'svc-premium', discountPct: 20 }],
  dailyUsageToday: { B1234XYZ: 0, D5678ABC: 0 },
};

const expiredMembership: MembershipDetail = {
  id: 'mem-2',
  planName: 'Silver Plan',
  status: MembershipStatus.Expired,
  startDate: '2023-01-01',
  endDate: '2024-01-01',
  usesCount: 50,
  maxUses: 50,
  dailyLimit: 1,
  plates: [{ plate: 'F9999ZZZ' }],
  freeServices: [],
  discountedServices: [],
  dailyUsageToday: {},
};

const serviceNames: Record<string, string> = {
  'svc-basic': 'Basic Wash',
  'svc-premium': 'Premium Wash',
};

describe('MemberBanner', () => {
  it('should not render when no memberships provided', () => {
    const { container } = render(<MemberBanner memberships={[]} />);
    expect(container.querySelector('[data-testid="member-banner"]')).toBeNull();
  });

  it('should not render when all memberships are expired', () => {
    const { container } = render(
      <MemberBanner memberships={[expiredMembership]} />,
    );
    expect(container.querySelector('[data-testid="member-banner"]')).toBeNull();
  });

  it('should render banner for active membership', () => {
    render(<MemberBanner memberships={[activeMembership]} serviceNames={serviceNames} />);

    expect(screen.getByTestId('member-banner')).toBeDefined();
    expect(screen.getByTestId('member-banner-card-mem-1')).toBeDefined();
  });

  it('should display plan name', () => {
    render(<MemberBanner memberships={[activeMembership]} serviceNames={serviceNames} />);

    expect(screen.getByTestId('plan-name-mem-1').textContent).toBe('Gold Plan');
  });

  it('should display expiry date', () => {
    render(<MemberBanner memberships={[activeMembership]} serviceNames={serviceNames} />);

    const expiryEl = screen.getByTestId('plan-expiry-mem-1');
    // The exact format depends on locale, but it should contain "2025"
    expect(expiryEl.textContent).toContain('2025');
  });

  it('should display quota usage', () => {
    render(<MemberBanner memberships={[activeMembership]} serviceNames={serviceNames} />);

    expect(screen.getByTestId('plan-quota-mem-1').textContent).toBe('10 / 100');
  });

  it('should display registered plates', () => {
    render(<MemberBanner memberships={[activeMembership]} serviceNames={serviceNames} />);

    const platesContainer = screen.getByTestId('plan-plates-mem-1');
    expect(platesContainer).toBeDefined();
    expect(screen.getByTestId('plate-chip-B1234XYZ').textContent).toContain('B1234XYZ');
    expect(screen.getByTestId('plate-chip-B1234XYZ').textContent).toContain('Toyota');
    expect(screen.getByTestId('plate-chip-D5678ABC').textContent).toContain('D5678ABC');
    expect(screen.getByTestId('plate-chip-D5678ABC').textContent).toContain('Honda');
  });

  it('should display free services with names', () => {
    render(<MemberBanner memberships={[activeMembership]} serviceNames={serviceNames} />);

    const freeServicesEl = screen.getByTestId('plan-free-services-mem-1');
    expect(freeServicesEl).toBeDefined();
    expect(screen.getByTestId('free-service-svc-basic').textContent).toBe('Basic Wash');
  });

  it('should display discounted services with percentages', () => {
    render(<MemberBanner memberships={[activeMembership]} serviceNames={serviceNames} />);

    const discountedEl = screen.getByTestId('plan-discounted-services-mem-1');
    expect(discountedEl).toBeDefined();
    expect(screen.getByTestId('discount-service-svc-premium').textContent).toContain(
      'Premium Wash',
    );
    expect(screen.getByTestId('discount-service-svc-premium').textContent).toContain(
      '-20%',
    );
  });

  it('should fall back to service ID when no service name is provided', () => {
    render(<MemberBanner memberships={[activeMembership]} />);

    expect(screen.getByTestId('free-service-svc-basic').textContent).toBe('svc-basic');
  });

  it('should render multiple active memberships', () => {
    const secondActive: MembershipDetail = {
      ...activeMembership,
      id: 'mem-3',
      planName: 'Platinum Plan',
    };

    render(
      <MemberBanner
        memberships={[activeMembership, secondActive]}
        serviceNames={serviceNames}
      />,
    );

    expect(screen.getByTestId('member-banner-card-mem-1')).toBeDefined();
    expect(screen.getByTestId('member-banner-card-mem-3')).toBeDefined();
  });

  it('should show daily limit warning when plate has reached daily limit', () => {
    const atLimitMembership: MembershipDetail = {
      ...activeMembership,
      dailyUsageToday: { B1234XYZ: 1, D5678ABC: 0 }, // B1234XYZ at limit (dailyLimit=1)
    };

    render(<MemberBanner memberships={[atLimitMembership]} serviceNames={serviceNames} />);

    expect(screen.getByTestId('daily-limit-warning-mem-1')).toBeDefined();
    expect(screen.getByTestId('daily-limit-warning-mem-1').textContent).toContain(
      'Daily limit reached',
    );
  });

  it('should NOT show daily limit warning when no plate is at limit', () => {
    render(<MemberBanner memberships={[activeMembership]} serviceNames={serviceNames} />);

    expect(
      screen.queryByTestId('daily-limit-warning-mem-1'),
    ).toBeNull();
  });

  it('should only render active memberships, filtering out expired ones', () => {
    render(
      <MemberBanner
        memberships={[activeMembership, expiredMembership]}
        serviceNames={serviceNames}
      />,
    );

    expect(screen.getByTestId('member-banner-card-mem-1')).toBeDefined();
    expect(screen.queryByTestId('member-banner-card-mem-2')).toBeNull();
  });
});
