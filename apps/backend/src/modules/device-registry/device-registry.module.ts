import { Module } from '@nestjs/common';
import { BridgeModule } from '../bridge';
import { AuthModule } from '../auth';
import { DatabasePoolProvider } from '../auth/database.provider';
import { DeviceRegistryService } from './device-registry.service';
import { TopologyService } from './topology.service';
import { DeviceController } from './device.controller';

/**
 * DeviceRegistryModule — the unified device registry + topology tree.
 *
 * Sits ABOVE BridgeModule in the IoT/CCTV layering (imports it for the
 * {@link BridgeEvents} bus + {@link BridgeGateway.isBridgeOnline}) and BELOW
 * DiscoveryModule (which imports this to register confirmed devices). It never
 * imports DiscoveryModule, so the graph stays acyclic:
 *   Bridge ← DeviceRegistry ← Discovery
 * AuthModule is imported for the JWT machinery behind {@link JwtAuthGuard}.
 */
@Module({
  imports: [BridgeModule, AuthModule],
  controllers: [DeviceController],
  providers: [DeviceRegistryService, TopologyService, DatabasePoolProvider],
  exports: [DeviceRegistryService, TopologyService],
})
export class DeviceRegistryModule {}
