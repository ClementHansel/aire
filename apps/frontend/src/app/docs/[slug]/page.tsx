'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Download, Clock, FileText, ArrowLeft, Lock } from 'lucide-react';
import { getUser } from '@/lib/auth';
import { getDoc, visibleDocs, canViewTech, AirinMark } from '../lib';

/**
 * Per-document running header/footer, as @page margin boxes.
 *
 * `content` takes a CSS string, so every value has to be quoted and escaped — an
 * apostrophe or backslash in a document title would otherwise break the rule and
 * silently drop the whole header.
 */
function cssString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function marginBoxCss(title: string, audience: string): string {
  return `@media print { @page {
    @top-left      { content: "airin docs"; font-size: 8.5pt; font-weight: 600; color: #16213c; }
    @top-right     { content: ${cssString(title)}; font-size: 8.5pt; font-weight: 600; color: #16213c; }
    @bottom-left   { content: "© Airin · app.useairin.id/docs"; font-size: 8pt; color: #6b7280; }
    @bottom-center { content: ${cssString(audience)}; font-size: 8pt; color: #6b7280; }
    @bottom-right  { content: counter(page) " / " counter(pages); font-size: 8pt; color: #6b7280; }
  } }`;
}

export default function DocReaderPage() {
  const params = useParams<{ slug: string }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const doc = getDoc(slug);

  const [role, setRole] = useState<ReturnType<typeof getUser>>(null);
  const [printedOn, setPrintedOn] = useState('');
  useEffect(() => {
    setRole(getUser());
    setPrintedOn(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }));
  }, []);

  const siblings = useMemo(() => visibleDocs(role?.role), [role]);
  const idx = siblings.findIndex((d) => d.slug === slug);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  const toc = useMemo(
    () => (doc?.toc || []).filter((t) => t.id !== 'table-of-contents' && t.text.toLowerCase() !== 'table of contents'),
    [doc],
  );

  if (!doc) {
    return (
      <div className="docs-gate">
        <AirinMark size={40} />
        <h2 style={{ marginTop: '1rem', color: '#16213c' }}>Document not found</h2>
        <p style={{ color: '#6b7280' }}>That page doesn’t exist. <Link href="/docs" style={{ color: '#16213c' }}>Back to all docs →</Link></p>
      </div>
    );
  }

  // Gate technical docs to staff/admin roles.
  if (doc.category === 'tech' && role && !canViewTech(role.role)) {
    return (
      <div className="docs-gate">
        <span className="airin-mark" style={{ width: 40, height: 40, fontSize: 20 }}><Lock size={18} /></span>
        <h2 style={{ marginTop: '1rem', color: '#16213c' }}>Staff access only</h2>
        <p style={{ color: '#6b7280' }}>
          The technical documentation is available to platform and business administrators. If you need it,
          ask your administrator. <Link href="/docs" style={{ color: '#16213c' }}>Back to the manuals →</Link>
        </p>
      </div>
    );
  }

  return (
    <>
      {/* ── Branded print-only cover + running header/footer ─────────────── */}
      <div className="doc-print-cover" aria-hidden>
        <span className="airin-mark cover-mark">A</span>
        <div className="cover-kicker">Airin Platform · {doc.category === 'tech' ? 'Technical documentation' : 'User manual'}</div>
        <div className="cover-rule" />
        <h1 className="cover-title">{doc.title}</h1>
        <div className="cover-audience">For: {doc.audience}</div>
        <div className="cover-foot">
          <strong>airin</strong> — operations platform for car-wash &amp; detailing businesses<br />
          Source: app.useairin.id/docs/{doc.slug}{printedOn ? ` · Printed ${printedOn}` : ''}
        </div>
      </div>
      {/*
        The running header/footer are @page MARGIN BOXES, not positioned elements.
        They used to be fixed-position divs, and in paged media Chrome lays a fixed
        element out against the page AREA — inside the margins — so `top: 0` put the
        branding on the first line of body text and every printed page came out with
        the title struck through. Nudging them into the margin with negative offsets
        does not work either: Chrome relocates a fixed box that overflows the page
        area, and they reappeared on the wrong edge.

        A margin box cannot overlap the text, because it lives in the margin by
        definition. The cost is that it takes generated content only — hence the
        title and audience are injected here as CSS strings rather than markup, and
        the Airin logo chip survives on the cover page alone.
      */}
      <style>{marginBoxCss(doc.title, doc.audience)}</style>

      {/* ── On-screen document ───────────────────────────────────────────── */}
      <div className="doc-layout">
        <article style={{ minWidth: 0 }}>
          <header className="doc-header">
            <div className="doc-eyebrow">
              <span className="doc-badge">{doc.category === 'tech' ? 'Technical' : 'Manual'}</span>
              <span className="doc-meta">{doc.audience}</span>
            </div>
            <h1 className="doc-title">{doc.title}</h1>
            <div className="doc-eyebrow" style={{ marginTop: '0.75rem' }}>
              <span className="doc-meta"><Clock size={13} style={{ verticalAlign: '-2px' }} /> {doc.minutes} min read</span>
              <span className="doc-meta"><FileText size={13} style={{ verticalAlign: '-2px' }} /> {toc.length} sections</span>
            </div>
            <div className="doc-actions docs-print-hide">
              <button className="docs-btn docs-btn-primary" onClick={() => window.print()}>
                <Download size={14} /> Download PDF
              </button>
              <Link href="/docs" className="docs-btn"><ArrowLeft size={14} /> All docs</Link>
            </div>
          </header>

          <div className="doc-body" dangerouslySetInnerHTML={{ __html: doc.html }} />

          <nav className="doc-footer-nav docs-print-hide">
            {prev
              ? <Link href={`/docs/${prev.slug}`}><small>Previous</small>← {prev.title}</Link>
              : <span />}
            {next
              ? <Link href={`/docs/${next.slug}`} style={{ textAlign: 'right' }}><small>Next</small>{next.title} →</Link>
              : <span />}
          </nav>
        </article>

        {toc.length > 0 && (
          <aside className="doc-toc docs-print-hide">
            <div className="doc-toc-label">On this page</div>
            {toc.map((t) => (
              <a key={t.id} href={`#${t.id}`} className={t.level === 3 ? 'lvl-3' : ''}>{t.text}</a>
            ))}
          </aside>
        )}
      </div>
    </>
  );
}
