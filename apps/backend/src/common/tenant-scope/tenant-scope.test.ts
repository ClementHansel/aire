import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  analyzeTenantScope,
  diffAgainstBaseline,
  findTenantScopedTables,
  type ScopeReport,
} from './tenant-scope.analyzer';

/**
 * TENANT-SCOPE RATCHET
 *
 * Isolation between companies on this platform is enforced by application code:
 * every query against a tenant-owned table must carry a `tenant_id` predicate.
 * Postgres RLS does NOT back this up — the app connects as the database owner,
 * which bypasses row-level security — so a single forgotten predicate is a
 * silent cross-tenant data leak.
 *
 * This test does not demand zero unscoped queries: many of the ones it finds are
 * safe (scope injected via an interpolated WHERE fragment, an id already proven
 * to belong to the caller's tenant, or a deliberate platform-wide admin query).
 * Auditing all of those is a separate job. What this test DOES do is stop the
 * number from growing: a new feature that queries tenant data without scoping it
 * fails the build.
 *
 * When this test fails:
 *   1. Look at the query it names. Does it read or write another tenant's rows?
 *   2. If yes — add `AND tenant_id = $n`. That is the bug this test exists for.
 *   3. If no — the scope is genuinely established elsewhere (or the query is
 *      intentionally cross-tenant). Re-run with UPDATE_TENANT_SCOPE_BASELINE=1
 *      to accept it, and say WHY in the PR.
 */

const SRC_DIR = join(__dirname, '..', '..');
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', '..', '..', 'database', 'migrations');
const BASELINE_PATH = join(__dirname, 'tenant-scope.baseline.json');

describe('tenant-scope ratchet', () => {
  it('finds the tenant-owned tables from the migrations', () => {
    const tables = findTenantScopedTables(MIGRATIONS_DIR);
    // Sanity: the core tenant-owned tables must be recognised, otherwise the
    // analyzer is silently inspecting nothing and would pass no matter what.
    expect(tables.has('orders')).toBe(true);
    expect(tables.has('customers')).toBe(true);
    expect(tables.has('memberships')).toBe(true);
    expect(tables.size).toBeGreaterThan(50);
  });

  it('introduces no NEW unscoped tenant queries', () => {
    const tables = findTenantScopedTables(MIGRATIONS_DIR);
    const report = analyzeTenantScope(SRC_DIR, tables);

    if (process.env.UPDATE_TENANT_SCOPE_BASELINE === '1') {
      writeFileSync(BASELINE_PATH, `${JSON.stringify(sortReport(report), null, 2)}\n`);
    }

    expect(existsSync(BASELINE_PATH), `missing baseline at ${BASELINE_PATH}`).toBe(true);
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as ScopeReport;
    const diff = diffAgainstBaseline(report, baseline);

    const problems = [
      ...diff.newFiles.map(
        (f) => `NEW unscoped tenant query in ${f.file} (${f.count}). ` +
               `Add a tenant_id predicate, or justify it and re-baseline.`,
      ),
      ...diff.increased.map(
        (f) => `${f.file}: unscoped tenant queries went ${f.was} -> ${f.now}.`,
      ),
    ];

    expect(problems, problems.join('\n')).toEqual([]);
  });
});

/** Stable key order so the baseline diffs cleanly in review. */
function sortReport(report: ScopeReport): ScopeReport {
  return Object.fromEntries(Object.entries(report).sort(([a], [b]) => a.localeCompare(b)));
}
