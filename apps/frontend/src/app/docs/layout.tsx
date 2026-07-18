'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';
import { getUser, isAuthenticated, type AuthUser } from '@/lib/auth';
import { manuals, techDocs, canViewTech, AirinMark } from './lib';
import './docs.css';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      const next = encodeURIComponent(pathname || '/docs');
      window.location.href = `/?next=${next}`;
      return;
    }
    setUser(getUser());
    setReady(true);
  }, [pathname]);

  if (!ready) {
    return (
      <div className="docs-root" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#6b7280' }}>
          <AirinMark size={26} /> <span>Loading documentation…</span>
        </div>
      </div>
    );
  }

  const showTech = canViewTech(user?.role);

  const NavLink = ({ slug, title }: { slug: string; title: string }) => {
    const href = `/docs/${slug}`;
    const active = pathname === href;
    return (
      <Link href={href} className={`docs-navlink${active ? ' active' : ''}`}>
        {title}
      </Link>
    );
  };

  return (
    <div className="docs-root">
      <header className="docs-topbar">
        <Link href="/docs" className="docs-brand">
          <AirinMark size={30} />
          <span className="docs-brand-name">airin<span> docs</span></span>
        </Link>
        <div className="docs-topbar-actions">
          <Link href="/hub" className="docs-btn">Open app <ArrowUpRight size={14} /></Link>
        </div>
      </header>

      <div className="docs-shell">
        <aside className="docs-sidebar docs-print-hide">
          <nav className="docs-navgroup">
            <div className="docs-navlabel">User manuals</div>
            {manuals.map((d) => <NavLink key={d.slug} slug={d.slug} title={d.title} />)}
          </nav>
          {showTech && (
            <nav className="docs-navgroup">
              <div className="docs-navlabel">Technical</div>
              {techDocs.map((d) => <NavLink key={d.slug} slug={d.slug} title={d.title} />)}
            </nav>
          )}
        </aside>

        <main className="docs-content">{children}</main>
      </div>
    </div>
  );
}
