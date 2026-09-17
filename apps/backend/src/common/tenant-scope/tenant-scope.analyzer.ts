import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Static analysis for tenant-scoping regressions.
 *
 * Tenant isolation in this codebase is enforced in APPLICATION CODE: every query
 * against a tenant-owned table carries a `tenant_id` predicate (or is reached
 * through an id already proven to belong to the caller's tenant). Postgres RLS
 * is NOT a backstop — the app connects as the database owner, which bypasses
 * row-level security entirely, so a forgotten predicate is a silent cross-tenant
 * leak. That has happened before (the reports leak, July 2026).
 *
 * This analyzer finds SQL in the backend that touches a tenant-owned table with
 * no `tenant_id` anywhere in the statement. It is deliberately a coarse net: a
 * good number of its hits are safe (scope supplied via an interpolated WHERE
 * fragment, or an id validated by an earlier tenant-scoped read, or a genuinely
 * cross-tenant platform query). That is why the accompanying test is a RATCHET
 * against a checked-in baseline rather than a hard zero — the value is catching
 * NEW unscoped queries, which is exactly the regression that leaks data.
 */

/** A table is tenant-owned if any migration gives it a `tenant_id` column. */
export function findTenantScopedTables(migrationsDir: string): Set<string> {
  const tables = new Set<string>();
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');

    const created = sql.matchAll(
      /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([a-z_]+)\s*\(([\s\S]*?)\n\);/gi,
    );
    for (const m of created) {
      if (/\btenant_id\b/i.test(m[2]!)) tables.add(m[1]!.toLowerCase());
    }

    // A table that gained tenant_id later is just as tenant-owned.
    const altered = sql.matchAll(
      /ALTER TABLE\s+([a-z_]+)\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+tenant_id/gi,
    );
    for (const m of altered) tables.add(m[1]!.toLowerCase());
  }
  return tables;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.includes('.test.') && !p.includes('.spec.')) out.push(p);
  }
  return out;
}

/** How a query names a table. Built once: a fresh /g regex per call would be
 *  rebuilt for every statement in every file. */
const TABLE_REF_KEYWORDS = [
  /FROM\s+([a-z_]+)/gi,
  /JOIN\s+([a-z_]+)/gi,
  /INTO\s+([a-z_]+)/gi,
  /UPDATE\s+([a-z_]+)/gi,
];

/** Violations per source file, keyed by a repo-relative POSIX path. */
export type ScopeReport = Record<string, number>;

export function analyzeTenantScope(srcDir: string, tables: Set<string>): ScopeReport {
  const report: ScopeReport = {};

  for (const file of walk(srcDir)) {
    const source = readFileSync(file, 'utf8');
    let count = 0;

    // Template literals are how every query in this codebase is written.
    for (const m of source.matchAll(/`([^`]*?\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^`]*?)`/gi)) {
      const query = m[1]!;
      // Guard against a runaway match swallowing a whole file of backticks.
      if (query.length > 4000) continue;

      const touched = new Set<string>();
      for (const kw of TABLE_REF_KEYWORDS) {
        for (const t of query.matchAll(kw)) {
          const name = t[1]!.toLowerCase();
          if (tables.has(name)) touched.add(name);
        }
      }
      if (touched.size === 0) continue;
      if (/tenant_id/i.test(query)) continue;
      count++;
    }

    if (count > 0) {
      report[relative(srcDir, file).split(sep).join('/')] = count;
    }
  }
  return report;
}

export interface ScopeDiff {
  /** Files with unscoped SQL that the baseline does not know about at all. */
  newFiles: { file: string; count: number }[];
  /** Files whose unscoped-query count went UP. */
  increased: { file: string; was: number; now: number }[];
  /** Files that improved — the baseline should be tightened to lock the win in. */
  improved: { file: string; was: number; now: number }[];
}

export function diffAgainstBaseline(report: ScopeReport, baseline: ScopeReport): ScopeDiff {
  const diff: ScopeDiff = { newFiles: [], increased: [], improved: [] };

  for (const [file, count] of Object.entries(report)) {
    const was = baseline[file];
    if (was === undefined) diff.newFiles.push({ file, count });
    else if (count > was) diff.increased.push({ file, was, now: count });
    else if (count < was) diff.improved.push({ file, was, now: count });
  }
  for (const [file, was] of Object.entries(baseline)) {
    if (report[file] === undefined) diff.improved.push({ file, was, now: 0 });
  }
  return diff;
}
