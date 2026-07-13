/**
 * One-off migration: move base64 data-URL images out of tenants.settings (JSONB)
 * into object storage (MinIO/S3).
 *
 *   - settings.logo_url (data:...)                 -> object tenants/<id>/logo
 *                                                     settings.logo_version = <hash>, logo_url dropped
 *   - settings.membershipCard.backgroundImage (data:...) -> object tenants/<id>/card-bg
 *                                                     backgroundImage = versioned public URL
 *
 * Idempotent: rows whose images are already URLs (or absent) are skipped, so it
 * is safe to run more than once. Reads the same MINIO_ / S3_ env as the backend.
 *
 * Run from apps/backend:  node scripts/migrate-images-to-storage.mjs
 */
import { createHash } from 'node:crypto';
import pg from 'pg';
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

const BUCKET = process.env.S3_BUCKET || process.env.MINIO_BUCKET || 'aire-storage';

function resolveEndpoint() {
  if (process.env.S3_ENDPOINT) return process.env.S3_ENDPOINT;
  const host = process.env.MINIO_ENDPOINT;
  if (!host) throw new Error('No S3_ENDPOINT or MINIO_ENDPOINT configured');
  const port = process.env.MINIO_PORT || '9000';
  const ssl = String(process.env.MINIO_USE_SSL).toLowerCase() === 'true';
  return `${ssl ? 'https' : 'http'}://${host}:${port}`;
}

const s3 = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: resolveEndpoint(),
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || process.env.MINIO_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY || process.env.MINIO_SECRET_KEY,
  },
});

async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    console.log(`Created bucket "${BUCKET}"`);
  }
}

/** Parse a data URL into { buffer, contentType } or null if not a data URL. */
function parseDataUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('data:')) return null;
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(value);
  if (!m) return null;
  const contentType = m[1] || 'application/octet-stream';
  const buffer = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
  return { buffer, contentType };
}

async function put(key, buffer, contentType) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType }));
  return createHash('sha256').update(buffer).digest('hex').slice(0, 12);
}

async function main() {
  await ensureBucket();
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://aire:aire_secret@localhost:5432/aire',
  });
  await client.connect();

  const { rows } = await client.query('SELECT id, settings FROM tenants');
  let logos = 0;
  let backgrounds = 0;

  for (const row of rows) {
    const settings = row.settings || {};
    let changed = false;

    const logo = parseDataUrl(settings.logo_url);
    if (logo) {
      const version = await put(`tenants/${row.id}/logo`, logo.buffer, logo.contentType);
      settings.logo_version = version;
      delete settings.logo_url;
      changed = true;
      logos++;
    }

    const card = settings.membershipCard;
    const bg = card && parseDataUrl(card.backgroundImage);
    if (bg) {
      const version = await put(`tenants/${row.id}/card-bg`, bg.buffer, bg.contentType);
      card.backgroundImage = `/api/public/card-template/background?tenantId=${encodeURIComponent(row.id)}&v=${version}`;
      changed = true;
      backgrounds++;
    }

    if (changed) {
      await client.query('UPDATE tenants SET settings = $1, updated_at = NOW() WHERE id = $2', [
        JSON.stringify(settings),
        row.id,
      ]);
      console.log(`  migrated tenant ${row.id}`);
    }
  }

  await client.end();
  console.log(`Done. Migrated ${logos} logo(s), ${backgrounds} card background(s).`);
}

main().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});
