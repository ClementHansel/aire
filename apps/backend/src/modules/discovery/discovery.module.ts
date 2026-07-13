import { Module } from '@nestjs/common';
import { DiscoveryService } from './discovery.service';
import { DiscoveryController } from './discovery.controller';
import { SettingsModule } from '../settings/settings.module';
import { AuditModule } from '../audit/audit.module';
import { BridgeModule } from '../bridge';
import { DeviceRegistryModule } from '../device-registry';
import { DatabasePoolProvider } from '../auth/database.provider';

/**
 * Device Discovery Module (bridge model).
 *
 * Scans are dispatched to on-prem bridge agents and their streamed results are
 * buffered here; confirmation auto-configures devices through the agent and
 * registers cameras. Imports BridgeModule for dispatch + the event bus.
 *
 * Requirements: 9.1, 9.2, 9.3
 */
@Module({
  imports: [SettingsModule, AuditModule, BridgeModule, DeviceRegistryModule],
  controllers: [DiscoveryController],
  providers: [DiscoveryService, DatabasePoolProvider],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
