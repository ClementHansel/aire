'use client';

import { useEffect, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResolvedTenant {
  /** Canonical tenant UUID — use for ALL API calls + localStorage keys. */
  id: string | null;
  slug: string | null;
  name: string;
  status: 'loading' | 'ok' | 'notfound';
}

/**
 * Resolve the public route's `[tenantId]` segment — which may be a pretty slug
 * OR a legacy UUID — into the canonical tenant identity via the public resolver
 * endpoint. Customer pages should key every API call and localStorage entry off
 * the returned `id` (uuid), so behaviour is identical whichever form the URL
 * used. When the URL used a UUID but a slug exists, the address bar is
 * prettified with router.replace (swapping just the segment, preserving the
 * query string) — this does NOT change `id`, so tokens keyed on the uuid survive.
 */
export function useResolveTenant(): ResolvedTenant {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const ref = params?.tenantId as string | undefined;
  const [state, setState] = useState<ResolvedTenant>({ id: null, slug: null, name: '', status: 'loading' });

  useEffect(() => {
    if (!ref) {
      setState({ id: null, slug: null, name: '', status: 'notfound' });
      return;
    }
    let alive = true;
    const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;
    fetch(`${base}/public/tenant/${encodeURIComponent(ref)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('not found'))))
      .then((tn: { id: string; slug: string | null; name: string }) => {
        if (!alive) return;
        setState({ id: tn.id, slug: tn.slug, name: tn.name, status: 'ok' });
        // Prettify: URL used the UUID but a slug exists → swap the segment only.
        if (tn.slug && ref !== tn.slug && UUID_RE.test(ref) && pathname) {
          const search = typeof window !== 'undefined' ? window.location.search : '';
          router.replace(pathname.replace(ref, tn.slug) + search);
        }
      })
      .catch(() => {
        if (alive) setState({ id: null, slug: null, name: '', status: 'notfound' });
      });
    return () => {
      alive = false;
    };
  }, [ref, pathname, router]);

  return state;
}
