import { Module } from '@nestjs/common';
import { CctvController } from './cctv.controller';
import { CctvService } from './cctv.service';
import { StreamAuthGuard } from './stream-auth.guard';
import { BridgeModule } from '../bridge';
import { StorageModule } from '../storage';
import { AuthModule } from '../auth';
import { DatabasePoolProvider } from '../auth/database.provider';

/**
 * CCTV Module — DB-backed cameras, live HLS relay, and MinIO VOD recordings.
 *
 * Imports BridgeModule (dispatch + event bus for relayed segments),
 * StorageModule (MinIO), and AuthModule (JwtService for {@link StreamAuthGuard}
 * + the standard JwtAuthGuard). BridgeModule sits below CCTV in the layering,
 * so there is no cycle.
 */
@Module({
  imports: [BridgeModule, StorageModule, AuthModule],
  controllers: [CctvController],
  providers: [CctvService, StreamAuthGuard, DatabasePoolProvider],
  exports: [CctvService],
})
export class CctvModule {}
