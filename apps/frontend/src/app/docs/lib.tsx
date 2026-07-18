'use client';

import { DOCS, type DocEntry, type DocCategory } from './generated';
import type { AuthUser } from '@/lib/auth';

export { DOCS };
export type { DocEntry, DocCategory };

/** Roles allowed to read the technical documentation (staff / admins). */
const TECH_ROLES: AuthUser['role'][] = ['platform_super_admin', 'tenant_owner', 'outlet_admin'];

export function canViewTech(role: AuthUser['role'] | undefined | null): boolean {
  return !!role && TECH_ROLES.includes(role);
}

export const manuals = DOCS.filter((d) => d.category === 'manual').sort((a, b) => a.order - b.order);
export const techDocs = DOCS.filter((d) => d.category === 'tech').sort((a, b) => a.order - b.order);

export function getDoc(slug: string): DocEntry | undefined {
  return DOCS.find((d) => d.slug === slug);
}

/** Docs a given role may open, in display order. */
export function visibleDocs(role: AuthUser['role'] | undefined | null): DocEntry[] {
  return canViewTech(role) ? [...manuals, ...techDocs] : manuals;
}

/** The Airin logo mark — navy tile with a gold accent dot. */
export function AirinMark({ size = 30, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`airin-mark ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.52) }}
      aria-hidden
    >
      A
    </span>
  );
}
