'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getUser, isAuthenticated, logout, type AuthUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { useTenantModules, moduleEnabled } from '@/lib/useModules';
import { isHeld, isHeldRoute } from '@aire/shared';
import { usePermissions, hasPermission } from '@/lib/usePermissions';
import { useI18n, LanguageToggle } from '@/lib/i18n';
import { BrandingProvider, useBranding } from '@/contexts/BrandingContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import AnnouncementsBanner from '@/components/dashboard/AnnouncementsBanner';
import { OfflineIndicator } from '@/components/shared/OfflineIndicator';
import {
  Home, LayoutDashboard, Receipt, Calculator, FileText, TrendingUp,
  Users, CalendarDays, Ticket, TicketPercent, Building2, Droplets,
  Tags, CreditCard, Package, ShoppingBag, ShoppingCart, Wallet, ArrowLeftRight,
  UsersRound, Banknote, Bot, Workflow, BrainCircuit, MessageSquare,
  RadioTower, KeyRound, Settings, LogOut, Tablet, ClipboardCheck, LineChart, Car, Landmark, ChefHat, BookOpen, MonitorSmartphone, Cctv, ScrollText, Coins, Rocket,
  FileType, Waypoints, HardDrive, Brain,
  RotateCcw, Star, Megaphone, HandCoins, Barcode, type LucideIcon,
} from 'lucide-react';

// `module` maps a nav item to a toggleable per-tenant module (see @aire/shared
// TENANT_MODULES). Items without a `module` are core and always shown.
// `permission` (optional) hides the item from users whose custom role lacks that
// granular RBAC key. Items without one are shown to everyone (subject to `module`).
interface NavItem { id: string; label: string; href: string; icon: LucideIcon; module?: string; permission?: string; roles?: AuthUser['role'][] }
interface NavSection { title: string | null; items: NavItem[] }

// Grouped navigation. Sections keep related tools together and prevent the
// "wall of links" problem. Icons are unique per item to avoid visual collisions.
const navSections: NavSection[] = [
  {
    title: null,
    items: [
      { id: 'hub', label: 'Hub', href: '/hub', icon: Home },
      { id: 'overview', label: 'Overview', href: '/dashboard', icon: LayoutDashboard },
    ],
  },
  {
    title: 'Analytics',
    items: [
      { id: 'transactions', label: 'Transactions', href: '/dashboard/transactions', icon: Receipt, module: 'analytics', permission: 'transactions.read' },
      { id: 'refunds', label: 'Refunds', href: '/dashboard/refunds', icon: RotateCcw, module: 'analytics', permission: 'transactions.read' },
      { id: 'invoices', label: 'Invoices', href: '/dashboard/invoices', icon: Calculator, module: 'analytics', permission: 'reports.read' },
      { id: 'reports', label: 'Reports', href: '/dashboard/reports', icon: FileText, module: 'analytics', permission: 'reports.read' },
      { id: 'sales', label: 'Sales & Leads', href: '/dashboard/sales', icon: TrendingUp, module: 'analytics', permission: 'reports.read' },
      { id: 'shifts', label: 'Shifts & Cash', href: '/dashboard/shifts', icon: Coins, module: 'analytics', permission: 'reports.read' },
    ],
  },
  {
    title: 'Customers',
    items: [
      { id: 'crm', label: 'Customers & CRM', href: '/dashboard/crm', icon: Users, module: 'crm', permission: 'customers.read' },
      { id: 'bookings', label: 'Bookings', href: '/dashboard/bookings', icon: CalendarDays, module: 'crm' },
      { id: 'memberships', label: 'Memberships', href: '/dashboard/memberships', icon: Ticket, module: 'memberships' },
      { id: 'vouchers', label: 'Vouchers & Promotions', href: '/dashboard/vouchers', icon: TicketPercent, module: 'vouchers', permission: 'vouchers.write' },
      { id: 'feedback', label: 'Feedback & NPS', href: '/dashboard/feedback', icon: Star, module: 'crm', permission: 'customers.read' },
      { id: 'broadcast', label: 'WA Broadcast', href: '/dashboard/broadcast', icon: Megaphone, module: 'whatsapp' },
    ],
  },
  {
    title: 'Catalog & Outlets',
    items: [
      { id: 'branches', label: 'Branches', href: '/dashboard/branches', icon: Building2, module: 'catalog' },
      { id: 'legal-entities', label: 'Legal Entities', href: '/dashboard/legal-entities', icon: Landmark, module: 'catalog' },
      { id: 'services', label: 'Services', href: '/dashboard/services', icon: Droplets, module: 'catalog' },
      { id: 'products', label: 'Products', href: '/dashboard/products', icon: ShoppingBag, module: 'catalog', permission: 'products.write' },
      { id: 'catalog', label: 'Categories & Brands', href: '/dashboard/catalog', icon: Tags, module: 'catalog', permission: 'products.write' },
      { id: 'payment-methods', label: 'Payment Methods', href: '/dashboard/payment-methods', icon: CreditCard, module: 'catalog' },
      { id: 'kiosks', label: 'Kiosks', href: '/dashboard/kiosks', icon: Tablet, module: 'catalog' },
      { id: 'pos-devices', label: 'POS Terminals', href: '/dashboard/pos-devices', icon: MonitorSmartphone, module: 'catalog' },
      { id: 'barcode-settings', label: 'Barcode', href: '/dashboard/barcode-settings', icon: Barcode, module: 'catalog', permission: 'products.write' },
      { id: 'vehicles', label: 'Vehicle Catalog', href: '/dashboard/vehicles', icon: Car, module: 'catalog' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { id: 'inventory', label: 'Inventory', href: '/dashboard/inventory', icon: Package, module: 'inventory' },
      { id: 'procurement', label: 'Procurement', href: '/dashboard/procurement', icon: ShoppingCart, module: 'inventory' },
      { id: 'opname', label: 'Stock Opname', href: '/dashboard/opname', icon: ClipboardCheck, module: 'inventory' },
      { id: 'cctv', label: 'CCTV', href: '/dashboard/cctv', icon: Cctv },
      { id: 'topology', label: 'Topology', href: '/dashboard/topology', icon: Waypoints },
      { id: 'devices', label: 'Devices', href: '/dashboard/devices', icon: HardDrive },
    ],
  },
  {
    title: 'Finance & People',
    items: [
      { id: 'finance-setup', label: 'Finance Setup', href: '/dashboard/finance-setup', icon: Rocket, module: 'finance', permission: 'finance.write' },
      { id: 'finance', label: 'Finance', href: '/dashboard/finance', icon: Wallet, module: 'finance', permission: 'finance.read' },
      { id: 'accounting', label: 'Bookkeeping', href: '/dashboard/accounting', icon: BookOpen, module: 'finance', permission: 'finance.read' },
      { id: 'pnl', label: 'P&L', href: '/dashboard/pnl', icon: LineChart, module: 'finance', permission: 'finance.read' },
      { id: 'cogs', label: 'COGS (Recipe & Pricing)', href: '/dashboard/cogs', icon: ChefHat, module: 'finance', permission: 'finance.write' },
      { id: 'settlement', label: 'Settlement', href: '/dashboard/settlement', icon: ArrowLeftRight, module: 'finance', permission: 'finance.read' },
      { id: 'tax-invoices', label: 'Tax Invoices (e-Faktur)', href: '/dashboard/tax-invoices', icon: FileType, module: 'finance', permission: 'finance.read' },
      { id: 'hr', label: 'HR', href: '/dashboard/hr', icon: UsersRound, module: 'hr', permission: 'hr.read' },
      { id: 'payroll', label: 'Payroll', href: '/dashboard/payroll', icon: Banknote, module: 'hr', permission: 'payroll.read' },
      { id: 'commission', label: 'Commission & Tips', href: '/dashboard/commission', icon: HandCoins, module: 'hr', permission: 'payroll.read' },
    ],
  },
  {
    title: 'AI',
    items: [
      { id: 'assistant', label: 'AI Assistant', href: '/dashboard/assistant', icon: Bot, module: 'ai_assistant' },
      { id: 'agents', label: 'Agent Workflow', href: '/dashboard/agents', icon: Workflow, module: 'ai_assistant' },
      { id: 'ai-agent', label: 'WhatsApp', href: '/dashboard/ai-agent', icon: BrainCircuit, module: 'whatsapp' },
      { id: 'knowledge', label: 'AI Knowledge', href: '/dashboard/knowledge', icon: Brain, module: 'whatsapp', roles: ['tenant_owner'] },
      { id: 'conversations', label: 'Conversations', href: '/dashboard/conversations', icon: MessageSquare, module: 'whatsapp' },
      { id: 'monitoring', label: 'AI Monitoring', href: '/dashboard/monitoring', icon: RadioTower, module: 'whatsapp' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { id: 'users', label: 'Users & Roles', href: '/dashboard/users', icon: KeyRound, permission: 'users.write' },
      { id: 'billing', label: 'Billing', href: '/dashboard/billing', icon: CreditCard, roles: ['tenant_owner'] },
      { id: 'audit', label: 'Audit Log', href: '/dashboard/audit', icon: ScrollText },
      // Payment Gateway now lives as a tab inside Settings (/dashboard/settings?tab=payment).
      { id: 'settings', label: 'Settings', href: '/dashboard/settings', icon: Settings },
      { id: 'docs', label: 'Help & Docs', href: '/docs', icon: BookOpen },
    ],
  },
];

// Flat list for the mobile bottom bar (kept short and explicit).
const mobileItems: NavItem[] = [
  { id: 'hub', label: 'Hub', href: '/hub', icon: Home },
  { id: 'overview', label: 'Overview', href: '/dashboard', icon: LayoutDashboard },
  { id: 'transactions', label: 'Transactions', href: '/dashboard/transactions', icon: Receipt, module: 'analytics' },
  { id: 'crm', label: 'CRM', href: '/dashboard/crm', icon: Users, module: 'crm' },
  { id: 'assistant', label: 'Assistant', href: '/dashboard/assistant', icon: Bot, module: 'ai_assistant' },
];

function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

const SECTION_KEY: Record<string, string> = {
  'Analytics': 'analytics', 'Customers': 'customers', 'Catalog & Outlets': 'catalog',
  'Operations': 'operations', 'Finance & People': 'finance', 'AI': 'ai', 'Administration': 'admin',
};

function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checked, setChecked] = useState(false);
  const { modules } = useTenantModules();
  const { permissions } = usePermissions();
  const { companyName, logoUrl } = useBranding();
  const { t } = useI18n();
  const [approvalCount, setApprovalCount] = useState(0);

  // Live count of bookings the WhatsApp agent proposed that are awaiting staff
  // approval — surfaced as a badge on the Conversations nav item.
  useEffect(() => {
    if (!moduleEnabled(modules, 'whatsapp')) { setApprovalCount(0); return; }
    let stop = false;
    const poll = () => api.get<unknown[]>('/whatsapp/pending-approvals')
      .then((r) => { if (!stop) setApprovalCount(Array.isArray(r) ? r.length : 0); })
      .catch(() => {});
    poll();
    const id = setInterval(poll, 30000);
    return () => { stop = true; clearInterval(id); };
  }, [modules]);

  useEffect(() => {
    if (!isAuthenticated()) {
      window.location.href = '/';
      return;
    }
    const u = getUser();
    setUser(u);
    setChecked(true);
    // Lean-mode route guard: held features are hidden from nav, but a client
    // could still deep-link. Redirect non-super-admins off any held route.
    // Super-admins keep access so they can inspect held surfaces.
    if (u && u.role !== 'platform_super_admin' && isHeldRoute(pathname)) {
      window.location.href = '/dashboard';
      return;
    }
    // Onboarding gate: a tenant whose owner hasn't finished setup is sent to the
    // wizard. Super-admins (not impersonating) are never gated. The onboarding
    // route itself is exempt so it can render.
    if (u && u.role !== 'platform_super_admin' && pathname !== '/dashboard/onboarding') {
      api.get<{ completedAt: string | null }>('/onboarding/me')
        .then((st) => { if (!st.completedAt) window.location.href = '/dashboard/onboarding'; })
        .catch(() => { /* never trap the user on a backend hiccup */ });
    }
    // Runs once when the dashboard shell mounts (it persists across client-side
    // navigation), so the gate isn't re-fetched on every page change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lean-mode guard on every navigation (the shell persists, so the mount effect
  // above only catches the initial load). Keeps a non-super-admin off held routes.
  useEffect(() => {
    const u = getUser();
    if (u && u.role !== 'platform_super_admin' && isHeldRoute(pathname)) {
      window.location.href = '/dashboard';
    }
  }, [pathname]);

  // Role-gated items (e.g. Billing → tenant_owner only) are cosmetic — the server
  // enforces access on every endpoint. Undefined `roles` = visible to all roles.
  const roleAllows = (item: NavItem) => !item.roles || (user != null && item.roles.includes(user.role));

  // Hide nav for modules the tenant has disabled; drop sections left empty.
  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !isHeld(item.id) && moduleEnabled(modules, item.module) && hasPermission(permissions, item.permission) && roleAllows(item),
      ),
    }))
    .filter((section) => section.items.length > 0);
  const visibleMobileItems = mobileItems.filter(
    (item) => !isHeld(item.id) && moduleEnabled(modules, item.module) && hasPermission(permissions, item.permission) && roleAllows(item),
  );

  if (!checked) {
    return (
      <div className="h-screen bg-surface flex items-center justify-center">
        <p className="text-sm text-text-muted">Loading…</p>
      </div>
    );
  }

  // The onboarding wizard is a blocking, full-page experience — render it without
  // the dashboard sidebar/nav so the tenant follows the steps without wandering.
  if (pathname === '/dashboard/onboarding') {
    return <div className="min-h-screen overflow-y-auto bg-surface">{children}</div>;
  }

  const isActive = (href: string) =>
    pathname === href || (href !== '/dashboard' && href !== '/hub' && pathname.startsWith(href));

  return (
    // h-screen + overflow-hidden makes the app shell own the viewport; only the
    // <main> region scrolls, so pages never produce a second (body) scrollbar.
    <div className="h-screen overflow-hidden bg-surface flex" data-testid="dashboard-layout">
      {/* Connectivity banner — warns staff (esp. on-site POS on flaky wifi) that
          the connection dropped so they don't assume a failed action succeeded. */}
      <OfflineIndicator />
      {/* Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 bg-surface-raised border-r border-border" data-testid="dashboard-sidebar">
        {/* Brand */}
        <div className="p-5 border-b border-border shrink-0">
          <Link href="/hub" className="flex items-center gap-2.5">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={companyName} className="w-8 h-8 rounded-lg object-contain border border-border bg-surface" />
            ) : (
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-sm font-bold text-primary-foreground font-display">{companyName.charAt(0).toUpperCase()}</span>
              </div>
            )}
            <span className="font-semibold text-text-primary font-display" data-testid="header-tenant-name">{companyName}</span>
          </Link>
        </div>

        {/* Navigation (its own scroll region) */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-4 min-h-0" data-testid="sidebar-nav-list">
          {visibleSections.map((section, idx) => (
            <div key={section.title ?? `section-${idx}`} className="space-y-0.5">
              {section.title && (
                <p className="px-3 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  {t('nav.section.' + (SECTION_KEY[section.title] ?? ''), section.title)}
                </p>
              )}
              {section.items.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  data-testid={`nav-item-${item.id}`}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive(item.href)
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary'
                  }`}
                >
                  <item.icon className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} />
                  <span className="flex-1">{t('nav.' + item.id, item.label)}</span>
                  {item.id === 'conversations' && approvalCount > 0 && (
                    <span className="ml-auto inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-amber-500 text-white text-[11px] font-semibold" title={t('nav.approvalsBadge', 'Bookings awaiting approval')}>{approvalCount}</span>
                  )}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        {/* Bottom section */}
        <div className="p-4 border-t border-border shrink-0">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
              <span className="text-xs font-medium text-primary-700">{user ? initials(user.name) : '··'}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">{user?.name ?? 'User'}</p>
              <p className="text-xs text-text-muted truncate capitalize">{user?.role?.replace(/_/g, ' ') ?? ''}</p>
            </div>
          </div>
          <div className="mb-2"><LanguageToggle /></div>
          <button onClick={logout} className="btn-ghost w-full text-xs justify-start inline-flex items-center gap-2">
            <LogOut className="w-4 h-4" strokeWidth={1.75} /> {t('common.signOut', 'Sign out')}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 h-screen">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center justify-between p-4 bg-surface-raised border-b border-border shrink-0" data-testid="dashboard-header">
          <Link href="/hub" className="flex items-center gap-2">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={companyName} className="w-7 h-7 rounded-lg object-contain border border-border bg-surface" />
            ) : (
              <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-xs font-bold text-primary-foreground font-display">{companyName.charAt(0).toUpperCase()}</span>
              </div>
            )}
            <span className="font-semibold text-sm text-text-primary font-display">{companyName}</span>
          </Link>
          <div className="flex items-center gap-2"><LanguageToggle /><button onClick={logout} className="text-xs text-text-secondary">{t('common.signOut', 'Sign out')}</button></div>
        </header>

        {/* Page content — the single vertical scroll container */}
        <main className="flex-1 overflow-y-auto min-h-0 p-6 lg:p-8 pb-20 lg:pb-8" data-testid="dashboard-content">
          <AnnouncementsBanner />
          {children}
        </main>

        {/* Mobile bottom nav */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-surface-raised border-t border-border flex justify-around py-2 px-4" data-testid="dashboard-bottom-nav" aria-label="Mobile navigation">
          {visibleMobileItems.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              data-testid={`bottom-nav-${item.id}`}
              className={`flex flex-col items-center gap-0.5 text-xs ${
                isActive(item.href) ? 'text-primary-600' : 'text-text-muted'
              }`}
            >
              <item.icon className="w-5 h-5" strokeWidth={1.75} />
              <span>{t('nav.' + item.id, item.label)}</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

/** Applies the tenant's dark-mode policy from branding to the theme provider. */
function ThemeGate({ children }: { children: React.ReactNode }) {
  const { branding } = useBranding();
  return <ThemeProvider themeConfig={branding}>{children}</ThemeProvider>;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <BrandingProvider>
      <ThemeGate>
        <DashboardShell>{children}</DashboardShell>
      </ThemeGate>
    </BrandingProvider>
  );
}
