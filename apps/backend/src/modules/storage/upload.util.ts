import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import type { StoredObject } from './storage.service';

/** Max size for a single uploaded image (logo, card background). */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
  'image/gif',
]);

/**
 * Validate a single uploaded image (from multer memoryStorage) into a buffer,
 * checking the content type and size. Throws BadRequest for a missing file, a
 * disallowed type, an empty file, or a file over the configured size limit.
 *
 * Size is enforced here on the decoded buffer rather than via multer's
 * `limits.fileSize` so the caller gets a clean 400 (multer's own limit surfaces
 * as an unhandled 500).
 */
export function readUploadedImage(
  file: Express.Multer.File | undefined,
): { buffer: Buffer; contentType: string } {
  if (!file) throw new BadRequestException('No file uploaded');

  const contentType = file.mimetype;
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    throw new BadRequestException(`Unsupported image type: ${contentType}`);
  }

  const buffer = file.buffer;
  if (!buffer || buffer.length === 0) throw new BadRequestException('Uploaded file is empty');
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new BadRequestException('Image is too large (max 5 MB)');
  }

  return { buffer, contentType };
}

/**
 * Stream a stored image to the client with long-lived immutable caching.
 * Callers build versioned URLs (?v=<hash>), so a changed image gets a new URL
 * and the cache never serves a stale one. Sends 404 when the object is absent.
 */
export function streamImage(res: Response, obj: StoredObject | null): void {
  if (!obj) {
    res.status(404).json({ statusCode: 404, message: 'Not found' });
    return;
  }
  res.set('Content-Type', obj.contentType);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  if (obj.contentLength) res.set('Content-Length', String(obj.contentLength));
  // obj.body is a Readable (S3/MinIO GetObject stream). Express's res.send()
  // can't serialize a stream — pipe it. (Fastify's reply.send() handled streams.)
  obj.body.on('error', () => {
    if (!res.headersSent) res.status(500).end();
    else res.destroy();
  });
  obj.body.pipe(res);
}
