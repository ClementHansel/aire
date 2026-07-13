import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime';
import { DatabasePoolProvider } from '../auth/database.provider';
import { AuthModule } from '../auth';
import { BridgeService } from './bridge.service';
import { BridgeGateway } from './bridge.gateway';
import { BridgeDispatchService } from './bridge-dispatch.service';
import { BridgeEvents } from './bridge.events';
import { BridgeController } from './bridge.controller';

/**
 * BridgeModule — the on-prem branch-bridge integration layer.
 *
 * Owns the `/bridge` Socket.IO gateway, pairing CRUD, the cloud→agent dispatch
 * surface, and the in-process {@link BridgeEvents} bus. Sits at the bottom of
 * the IoT/CCTV layering: DiscoveryModule and CctvModule import it, but it
 * imports only RealtimeModule (for bay-status fan-out) and AuthModule (JWT +
 * guards), so there are no cycles.
 */
@Module({
  imports: [RealtimeModule, AuthModule],
  controllers: [BridgeController],
  providers: [
    DatabasePoolProvider,
    BridgeService,
    BridgeGateway,
    BridgeDispatchService,
    BridgeEvents,
  ],
  exports: [BridgeService, BridgeDispatchService, BridgeEvents, BridgeGateway],
})
export class BridgeModule {}
