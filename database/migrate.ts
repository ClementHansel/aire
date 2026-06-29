/**
 * Database Migration Runner
 *
 * Applies SQL migration files in order, tracking which migrations
 * have already been applied in a `schema_migrations` table.
 *
 * Usage:
 *   npx tsx database/migrate.ts                # Run pending migrations
 *   npx tsx database/migrate.ts --status       # Show migration status
 *   npx tsx database/migrate.ts --rollback     # Not implemented (use manual SQL)
 *
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

const { Client } = pg;

const MIGRATIONS_DIR = join(import.meta.dirname ?? __dirname, 'migrations');

interface Migration {
  filename: string;
  version: string;
  appliedAt?: Date;
}

async function getClient(): Promise<pg.Client> {
  const connectionString =
    process.env.DATABASE_URL ||
    'postgresql://aire:aire_secret@localhost:5432/aire';

  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

async function ensureMigrationsTable(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      filename VARCHAR(255) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedMigrations(
  client: pg.Client,
): Promise<Map<string, Date>> {
  const result = await client.query(
    'SELECT version, applied_at FROM schema_migrations ORDER BY version',
  );
  const map = new Map<string, Date>();
  for (const row of result.rows) {
    map.set(row.version, row.applied_at);
  }
  return map;
}

async function getPendingMigrations(
  client: pg.Client,
): Promise<Migration[]> {
  const applied = await getAppliedMigrations(client);
  const files = await readdir(MIGRATIONS_DIR);

  const sqlFiles = files
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const pending: Migration[] = [];
  for (const filename of sqlFiles) {
    const version = filename.replace('.sql', '');
    if (!applied.has(version)) {
      pending.push({ filename, version });
    }
  }

  return pending;
}

async function runMigration(
  client: pg.Client,
  migration: Migration,
): Promise<void> {
  const filePath = join(MIGRATIONS_DIR, migration.filename);
  const sql = await readFile(filePath, 'utf-8');

  console.log(`  Applying: ${migration.filename}...`);

  await client.query(sql);
  await client.query(
    'INSERT INTO schema_migrations (version, filename) VALUES ($1, $2)',
    [migration.version, migration.filename],
  );

  console.log(`  ✓ Applied: ${migration.filename}`);
}

async function showStatus(client: pg.Client): Promise<void> {
  const applied = await getAppliedMigrations(client);
  const files = await readdir(MIGRATIONS_DIR);
  const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort();

  console.log('\nMigration Status:');
  console.log('─'.repeat(60));

  for (const filename of sqlFiles) {
    const version = filename.replace('.sql', '');
    const appliedAt = applied.get(version);
    const status = appliedAt
      ? `✓ Applied (${appliedAt.toISOString()})`
      : '○ Pending';
    console.log(`  ${status}  ${filename}`);
  }

  console.log('─'.repeat(60));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isStatus = args.includes('--status');

  let client: pg.Client | null = null;

  try {
    client = await getClient();
    await ensureMigrationsTable(client);

    if (isStatus) {
      await showStatus(client);
      return;
    }

    const pending = await getPendingMigrations(client);

    if (pending.length === 0) {
      console.log('\n✓ Database is up to date. No pending migrations.\n');
      return;
    }

    console.log(`\nRunning ${pending.length} pending migration(s):\n`);

    for (const migration of pending) {
      await runMigration(client, migration);
    }

    console.log(`\n✓ All migrations applied successfully.\n`);
  } catch (error) {
    console.error('\n✗ Migration failed:', error);
    process.exit(1);
  } finally {
    if (client) {
      await client.end();
    }
  }
}

main();
