/**
 * Database Reset Script
 *
 * Drops all tables and re-runs migrations + seed.
 * Only for development use!
 *
 * Usage:
 *   npx tsx database/reset.ts
 *
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string
 */

import pg from 'pg';

const { Client } = pg;

async function reset(): Promise<void> {
  const connectionString =
    process.env.DATABASE_URL ||
    'postgresql://aire:aire_secret@localhost:5432/aire';

  // Safety check: refuse to run on production-like URLs
  if (
    connectionString.includes('production') ||
    connectionString.includes('prod')
  ) {
    console.error('✗ Refusing to reset a production database!');
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    console.log('\n⚠ Resetting database (dropping all tables)...\n');

    await client.query(`
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
      GRANT ALL ON SCHEMA public TO public;
    `);

    console.log('  ✓ Schema dropped and recreated');
    console.log('\nRun migrations and seed separately:');
    console.log('  pnpm --filter @aire/database migrate');
    console.log('  pnpm --filter @aire/database seed\n');
  } catch (error) {
    console.error('\n✗ Reset failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

reset();
