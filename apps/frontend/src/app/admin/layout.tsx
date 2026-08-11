'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Home, LayoutDashboard, Building2, LifeBuoy, Wallet, CreditCard, BrainCircuit,
  RadioTower, HeartPulse, Workflow, Settings, LogOut, Sun, Moon,
  LineChart, ScrollText, Users, Megaphone, BookOpen, Activity, Bot, type LucideIcon,
} from 'lucide-react';
import { isImpersonating, stopImpersonation, isAuthenticated, getUser, logout, type AuthUser } from '@/lib/auth';
import { useI18n, LanguageToggle } from '@/lib/i18n';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { FloatingChat } from '@/components/shared/ai-chat/FloatingChat';
import { PLATFORM_CHAT } from '@/components/shared/ai-chat/useAiChat';

// The admin panel is the PLATFORM admin dashboard — platform_super_admin only.
// Tenant owners manage their business (branches, catalog, etc.) from /dashboard;
// they are redirected there. Cashiers and outlet admins are redirected too.
const ADMIN_ROLES = ['platform_super_admin'];

// `superOnly` items are hidden from non-super roles. Today every admin role IS
// super-admin, but the flag is kept so the gate stays explicit if that changes.
interface NavItem { href: string; label: string; labelKey: string; icon: LucideIcon; exact?: boolean; superOnly?: boolean }
interface NavSection { title: string | null; titleKey: string; items: NavItem[] }

// Grouped navigation mirrors the tenant dashboard shell: sections keep related
// tools together instead of one flat wall of links.
const NAV_SECTIONS: NavSection[] = [
  {
    title: null, titleKey: '',
    items: [
      { href: '/hub', label: 'Hub', labelKey: 'admin.nav.hub', icon: Home, exact: true },
      { href: '/admin', label: 'Overview', labelKey: 'admin.nav.overview', icon: LayoutDashboard, exact: true },
    ],
  },
  {
    title: 'Tenants', titleKey: 'admin.nav.section.tenants',
    items: [
      { href: '/admin/tenants', label: 'Tenants', labelKey: 'admin.nav.tenants', icon: Building2 },
      { href: '/admin/support', label: 'Support', labelKey: 'admin.nav.support', icon: LifeBuoy },
    ],
  },
  {
    title: 'Growth', titleKey: 'admin.nav.section.growth',
    items: [
      { href: '/admin/analytics', label: 'Analytics', labelKey: 'admin.nav.analytics', icon: LineChart, superOnly: true },
      { href: '/admin/billing', label: 'Billing', labelKey: 'admin.nav.billing', icon: Wallet },
      { href: '/admin/plans', label: 'Subscription Plans', labelKey: 'admin.nav.plans', icon: CreditCard, superOnly: true },
      { href: '/admin/ai-usage', label: 'AI Usage', labelKey: 'admin.nav.aiUsage', icon: BrainCircuit },
    ],
  },
  {
    title: 'Operations', titleKey: 'admin.nav.section.operations',
    items: [
      { href: '/admin/assistant', label: 'Airin AI Console', labelKey: 'admin.nav.assistant', icon: Bot, superOnly: true },
      { href: '/admin/monitoring', label: 'Monitoring', labelKey: 'admin.nav.monitoring', icon: RadioTower },
      { href: '/admin/health', label: 'System Health', labelKey: 'admin.nav.health', icon: HeartPulse },
      { href: '/admin/agent-flows', label: 'Agent Flows', labelKey: 'admin.nav.agentFlows', icon: Workflow, superOnly: true },
    ],
  },
  {
    title: 'Platform', titleKey: 'admin.nav.section.platform',
    items: [
      { href: '/admin/ops', label: 'Ops feed', labelKey: 'admin.nav.ops', icon: Activity, superOnly: true },
      { href: '/admin/users', label: 'Platform Users', labelKey: 'admin.nav.users', icon: Users, superOnly: true },
      { href: '/admin/announcements', label: 'Announcements', labelKey: 'admin.nav.announcements', icon: Megaphone, superOnly: true },
      { href: '/admin/audit', label: 'Audit Log', labelKey: 'admin.nav.audit', icon: ScrollText, superOnly: true },
      { href: '/admin/config', label: 'Platform Config', labelKey: 'admin.nav.config', icon: Settings },
      { href: '/docs', label: 'Documentation', labelKey: 'admin.nav.docs', icon: BookOpen },
    ],
  },
];

// Flat list for the mobile bottom bar (kept short and explicit).
const MOBILE_ITEMS: NavItem[] = [
  { href: '/admin', label: 'Overview', labelKey: 'admin.nav.overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/tenants', label: 'Tenants', labelKey: 'admin.nav.tenants', icon: Building2 },
  { href: '/admin/billing', label: 'Billing', labelKey: 'admin.nav.billing', icon: Wallet },
  { href: '/admin/health', label: 'Health', labelKey: 'admin.nav.health', icon: HeartPulse },
  { href: '/admin/config', label: 'Config', labelKey: 'admin.nav.config', icon: Settings },
];

function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

function ThemeToggle() {
  const { theme, toggleTheme, canToggleTheme } = useTheme();
  const { t } = useI18n();
  if (!canToggleTheme) return null;
  return (
    <button
      onClick={toggleTheme}
      className="btn-ghost text-xs justify-start inline-flex items-center gap-2"
      aria-label={t('admin.shell.toggleTheme', 'Toggle theme')}
    >
      {theme === 'dark' ? <Sun className="w-4 h-4" strokeWidth={1.75} /> : <Moon className="w-4 h-4" strokeWidth={1.75} />}
      {theme === 'dark' ? t('admin.shell.lightMode', 'Light mode') : t('admin.shell.darkMode', 'Dark mode')}
    </button>
  );
}

function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [impersonating, setImpersonating] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [isSuper, setIsSuper] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/'; return; }
    const u = getUser();
    if (!u?.role || !ADMIN_ROLES.includes(u.role)) { window.location.href = '/hub'; return; }
    setUser(u);
    setAllowed(true);
    setIsSuper(u.role === 'platform_super_admin');
    setImpersonating(isImpersonating());
  }, []);

  if (!allowed) {
    return (
      <div className="h-screen bg-surface flex items-center justify-center">
        <p className="text-sm text-text-muted">{t('admin.shell.loading', 'Loading…')}</p>
      </div>
    );
  }

  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(href + '/'));
  const visibleSections = NAV_SECTIONS
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.superOnly || isSuper) }))
    .filter((s) => s.items.length > 0);

  return (
    <div className="h-screen overflow-hidden bg-surface flex" data-testid="admin-layout">
      {/* Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 bg-surface-raised border-r border-border" data-testid="admin-sidebar">
        {/* Brand — platform-level (Airin), not tenant-branded. */}
        <div className="p-5 border-b border-border shrink-0">
          <Link href="/hub" className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <span className="text-sm font-bold text-primary-foreground font-display">A</span>
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-text-primary font-display leading-tight">{t('admin.shell.brand', 'Airin Admin')}</p>
              <p className="text-[11px] text-text-muted leading-tight">{t('admin.shell.brandSub', 'Platform control plane')}</p>
            </div>
          </Link>
        </div>

        {/* Navigation (its own scroll region) */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-4 min-h-0" data-testid="admin-nav">
          {visibleSections.map((section, idx) => (
            <div key={section.titleKey || `section-${idx}`} className="space-y-0.5">
              {section.title && (
                <p className="px-3 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  {t(section.titleKey, section.title)}
                </p>
              )}
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive(item.href, item.exact)
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary'
                  }`}
                >
                  <item.icon className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} />
                  {t(item.labelKey, item.label)}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        {/* Footer — identity, language, theme, sign out. */}
        <div className="p-4 border-t border-border shrink-0">
          {user && (
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                <span className="text-xs font-medium text-primary-700">{initials(user.name)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{user.name}</p>
                <p className="text-xs text-text-muted truncate capitalize">{user.role?.replace(/_/g, ' ')}</p>
              </div>
            </div>
          )}
          <div className="mb-2 flex items-center gap-2"><LanguageToggle /><ThemeToggle /></div>
          <button
            data-testid="admin-signout"
            onClick={() => { logout(); window.location.href = '/'; }}
            className="btn-ghost w-full text-xs justify-start inline-flex items-center gap-2"
          >
            <LogOut className="w-4 h-4" strokeWidth={1.75} /> {t('common.signOut', 'Sign out')}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 h-screen">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center justify-between p-4 bg-surface-raised border-b border-border shrink-0">
          <Link href="/hub" className="flex items-center gap-2">
            <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center">
              <span className="text-xs font-bold text-primary-foreground font-display">A</span>
            </div>
            <span className="font-semibold text-sm text-text-primary font-display">{t('admin.shell.brand', 'Airin Admin')}</span>
          </Link>
          <div className="flex items-center gap-2"><LanguageToggle /><button onClick={() => { logout(); window.location.href = '/'; }} className="text-xs text-text-secondary">{t('common.signOut', 'Sign out')}</button></div>
        </header>

        <main className="flex-1 overflow-y-auto min-h-0 p-6 lg:p-8 pb-20 lg:pb-8" data-testid="admin-content">
          {impersonating && (
            <div className="mb-4 flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5">
              <span className="text-sm text-amber-800">⚠️ {t('admin.shell.impersonating', 'You are impersonating a tenant. Actions are performed as that tenant.')}</span>
              <button
                onClick={() => { stopImpersonation(); window.location.href = '/admin'; }}
                className="text-xs font-semibold text-amber-800 rounded-md border border-amber-300 px-2.5 py-1 hover:bg-amber-100"
              >
                {t('admin.shell.stopImpersonating', 'Stop impersonating')}
              </button>
            </div>
          )}
          {children}
        </main>

        {/* Floating mini console — same threads as /admin/assistant. Hidden on
            that page (it would duplicate the surface) and for non-super roles,
            which have no cross-tenant read access. */}
        {isSuper && !pathname.startsWith('/admin/assistant') && (
          <FloatingChat
            endpoints={PLATFORM_CHAT}
            fullPageHref="/admin/assistant"
            title={t('admin.assistant.title', 'Airin AI Console')}
            introTitle={t('admin.assistant.introTitle', 'Ask about the platform')}
            introBody={t('admin.assistant.introShort', 'Tenants, billing, incidents, jobs and AI usage — read-only.')}
            suggestions={[
              t('admin.assistant.suggestOverdue', 'Which tenants have overdue invoices?'),
              t('admin.assistant.suggestIncidents', 'What went wrong in the last 24 hours?'),
            ]}
            placeholder={t('admin.assistant.inputPlaceholder', 'Ask about tenants, billing, incidents…')}
            thinkingLabel={t('admin.assistant.thinking', 'Thinking…')}
            emptyHistoryLabel={t('admin.assistant.noHistory', 'No conversations yet.')}
          />
        )}

        {/* Mobile bottom nav */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-surface-raised border-t border-border flex justify-around py-2 px-4" aria-label="Admin mobile navigation">
          {MOBILE_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 text-xs ${isActive(item.href, item.exact) ? 'text-primary-600' : 'text-text-muted'}`}
            >
              <item.icon className="w-5 h-5" strokeWidth={1.75} />
              <span>{t(item.labelKey, item.label)}</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  // Platform-level dark-mode support without tenant branding (admin is not
  // scoped to a tenant). Uses the default theme config: dark mode toggleable.
  return (
    <ThemeProvider>
      <AdminShell>{children}</AdminShell>
    </ThemeProvider>
  );
}
