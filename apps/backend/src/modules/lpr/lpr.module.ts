import { Module } from '@nestjs/common';
import { BridgeModule } from '../bridge';
import { RealtimeModule } from '../realtime';
import { AuthModule } from '../auth';
import { DatabasePoolProvider } from '../auth/database.provider';
import { LprController } from './lpr.controller';
import { LprService } from './lpr.service';
import { LprBridgeGuard } from './lpr-bridge.guard';

/**
 * LprModule — AIRIN-59 LPR/ANPR plate detection ingest + matching.
 *
 * Imports BridgeModule for {@link LprBridgeGuard} (reuses BridgeService's
 * pairing-token resolution — the same mechanism the branch-bridge socket
 * gateway authenticates with), RealtimeModule for the POS push, and
 * AuthModule for the dashboard/POS-facing JwtAuthGuard. ScopeService is
 * global (ScopeModule), so it needs no explicit import here.
 */
@Module({
  imports: [BridgeModule, RealtimeModule, AuthModule],
  controllers: [LprController],
  providers: [LprService, LprBridgeGuard, DatabasePoolProvider],
  exports: [LprService],
})
export class LprModule {}
