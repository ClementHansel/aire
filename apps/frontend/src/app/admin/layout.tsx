'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { isImpersonating, stopImpersonation } from '@/lib/auth';

const navItems = [
  { href: '/hub', label: '🏠 Hub', exact: true },
  { href: '/admin', label: 'Overview', exact: true },
  { href: '/admin/tenants', label: 'Tenants' },
  { href: '/admin/monitoring', label: 'Monitoring' },
  { href: '/admin/ai-usage', label: 'AI Usage' },
  { href: '/admin/health', label: 'System Health' },
  { href: '/admin/billing', label: 'Billing' },
  { href: '/admin/config', label: 'Platform Config' },
  { href: '/admin/support', label: 'Support' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [impersonating, setImpersonating] = useState(false);
  useEffect(() => { setImpersonating(isImpersonating()); }, []);

  const active = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href));

  return (
    <div data-testid="admin-layout" style={{ display: 'flex', minHeight: '100vh' }}>
      <aside
        data-testid="admin-sidebar"
        style={{ width: '240px', backgroundColor: '#1a1a2e', color: '#fff', padding: '1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}
      >
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1.25rem', fontWeight: 600 }}>AIRE Admin</h2>
        <nav data-testid="admin-nav">
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            {navItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  style={{
                    color: active(item.href, item.exact) ? '#fff' : '#9ca3af',
                    background: active(item.href, item.exact) ? 'rgba(255,255,255,0.10)' : 'transparent',
                    textDecoration: 'none', padding: '0.5rem 0.75rem', display: 'block', borderRadius: '6px', fontSize: '0.9rem',
                  }}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <main data-testid="admin-content" style={{ flex: 1, padding: '2rem', backgroundColor: '#f8f9fa', overflow: 'auto' }}>
        {impersonating && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#92400e' }}>⚠️ You are impersonating a tenant. Actions are performed as that tenant.</span>
            <button
              onClick={() => { stopImpersonation(); window.location.href = '/admin'; }}
              style={{ fontSize: 12, fontWeight: 600, color: '#92400e', background: 'transparent', border: '1px solid #fde68a', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
            >
              Stop impersonating
            </button>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
