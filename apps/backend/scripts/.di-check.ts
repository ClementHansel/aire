import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
NestFactory.create(AppModule, { logger: ['error'], abortOnError: false })
  .then(async (app) => { await app.init().catch(() => undefined); console.log('DI GRAPH OK'); process.exit(0); })
  .catch((e) => { console.error('DI FAILED:', e?.message ?? e); process.exit(1); });
