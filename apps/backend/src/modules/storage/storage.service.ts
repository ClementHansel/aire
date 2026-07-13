import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'node:stream';
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

export interface StoredObject {
  body: Readable;
  contentType: string;
  contentLength?: number;
}

/**
 * S3-compatible object storage (MinIO in dev/prod today; swappable for
 * Cloudflare R2 / AWS S3 by env alone — the API is identical).
 *
 * Config is read from env: S3_* takes precedence, falling back to the MINIO_*
 * names the Docker Compose stack already provides. The endpoint is built from
 * MINIO_ENDPOINT + MINIO_PORT when S3_ENDPOINT is not set. `forcePathStyle` is
 * required for MinIO (and harmless for R2).
 *
 * The bucket is created on first use (idempotent). If storage is not
 * configured, the service stays disabled and uploads fail loudly rather than
 * silently writing blobs elsewhere.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string;
  private bucketReady: Promise<void> | null = null;

  constructor() {
    const endpoint = this.resolveEndpoint();
    const accessKeyId = process.env.S3_ACCESS_KEY || process.env.MINIO_ACCESS_KEY || '';
    const secretAccessKey = process.env.S3_SECRET_KEY || process.env.MINIO_SECRET_KEY || '';
    this.bucket = process.env.S3_BUCKET || process.env.MINIO_BUCKET || 'aire-storage';

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      this.client = null;
      this.logger.warn('Object storage not configured (S3_/MINIO_ env missing); image uploads will fail until set.');
      return;
    }

    this.client = new S3Client({
      region: process.env.S3_REGION || 'us-east-1',
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
    this.logger.log(`Object storage configured: endpoint=${endpoint} bucket=${this.bucket}`);
  }

  private resolveEndpoint(): string | null {
    if (process.env.S3_ENDPOINT) return process.env.S3_ENDPOINT;
    const host = process.env.MINIO_ENDPOINT;
    if (!host) return null;
    const port = process.env.MINIO_PORT || '9000';
    const ssl = String(process.env.MINIO_USE_SSL).toLowerCase() === 'true';
    return `${ssl ? 'https' : 'http'}://${host}:${port}`;
  }

  /** True when storage is configured and usable. */
  isEnabled(): boolean {
    return this.client !== null;
  }

  private client_(): S3Client {
    if (!this.client) throw new Error('Object storage is not configured');
    return this.client;
  }

  /** Create the bucket if it does not exist. Runs at most once per process. */
  private ensureBucket(): Promise<void> {
    if (!this.bucketReady) {
      this.bucketReady = (async () => {
        const client = this.client_();
        try {
          await client.send(new HeadBucketCommand({ Bucket: this.bucket }));
        } catch {
          try {
            await client.send(new CreateBucketCommand({ Bucket: this.bucket }));
            this.logger.log(`Created bucket "${this.bucket}"`);
          } catch (e) {
            // Reset so a later call can retry (e.g. transient startup race).
            this.bucketReady = null;
            throw e;
          }
        }
      })();
    }
    return this.bucketReady;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.ensureBucket();
    await this.client_().send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  /** Fetch an object as a stream, or null if it does not exist. */
  async get(key: string): Promise<StoredObject | null> {
    await this.ensureBucket();
    try {
      const res = await this.client_().send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        body: res.Body as Readable,
        contentType: res.ContentType || 'application/octet-stream',
        contentLength: res.ContentLength,
      };
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === 'NoSuchKey' || name === 'NotFound') return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.client) return;
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
