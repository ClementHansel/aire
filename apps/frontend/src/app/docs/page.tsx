'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Wrench, Clock, FileText } from 'lucide-react';
import { getUser } from '@/lib/auth';
import { manuals, techDocs, canViewTech, type DocEntry } from './lib';

function DocCard({ doc }: { doc: DocEntry }) {
  return (
    <Link href={`/docs/${doc.slug}`} className="docs-card">
      <span className="docs-card-badge">{doc.audience}</span>
      <h3>{doc.title}</h3>
      <p>{doc.blurb}</p>
      <div className="docs-card-meta">
        <span><Clock size={13} style={{ verticalAlign: '-2px' }} /> {doc.minutes} min read</span>
        <span><FileText size={13} style={{ verticalAlign: '-2px' }} /> {doc.toc.length} sections</span>
      </div>
    </Link>
  );
}

export default function DocsIndex() {
  const [showTech, setShowTech] = useState(false);
  useEffect(() => { setShowTech(canViewTech(getUser()?.role)); }, []);

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <section className="docs-hero">
        <span className="docs-hero-kicker">Airin Platform</span>
        <h1>Documentation &amp; manuals</h1>
        <p>
          Step-by-step guides for every role — read them online, or download any manual as a
          branded PDF. Pick the guide that matches how you use Airin.
        </p>
      </section>

      <div className="docs-section-title">
        <BookOpen size={18} color="#16213c" />
        <h2>User manuals</h2>
        <span>Guides written for each kind of user</span>
      </div>
      <div className="docs-cards">
        {manuals.map((d) => <DocCard key={d.slug} doc={d} />)}
      </div>

      {showTech && (
        <>
          <div className="docs-section-title">
            <Wrench size={18} color="#16213c" />
            <h2>Technical documentation</h2>
            <span>Architecture &amp; engineering reference — staff only</span>
          </div>
          <div className="docs-cards">
            {techDocs.map((d) => <DocCard key={d.slug} doc={d} />)}
          </div>
        </>
      )}
    </div>
  );
}
