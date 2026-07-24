import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true keeps the raw request Buffer (req.rawBody) alongside the
  // parsed body — needed to verify the kirimdev webhook HMAC signature over
  // the exact bytes Nest received, before/independent of JSON parsing.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // The app always runs behind nginx (1 hop), which forwards X-Forwarded-For.
  // Trust that first proxy so req.ip / @Ip() resolve to the real client IP
  // (used e.g. by the audit log) instead of the nginx container address.
  app.set('trust proxy', 1);

  // Branding + membership-card send base64 data-URL images INSIDE JSON bodies.
  // Nest/Express default JSON limit is 100kb; a 5 MB image is ~6.7 MB base64, so
  // raise the limit with headroom. (Binary multipart uploads go through per-route
  // FileInterceptors, not this parser.)
  app.useBodyParser('json', { limit: '10mb' });
  app.useBodyParser('urlencoded', { limit: '10mb', extended: true });

  app.enableCors();

  const port = process.env.PORT ?? 4000;
  await app.listen(port, '0.0.0.0');
  console.log(`Backend running on http://localhost:${port}`);
}

bootstrap();
