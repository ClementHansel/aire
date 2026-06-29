import { Module } from '@nestjs/common';
import { DiscoveryService } from './discovery.service';
import { DiscoveryController } from './discovery.controller';
import { SettingsModule } from '../settings/settings.module';
import { AuditModule } from '../audit/audit.module';

/**
 * Device Discovery Module.
 *
 * Provides network device discovery (ONVIF cameras, MQTT IoT controllers,
 * SSDP/mDNS routers), device confirmation, auto-configuration, and
 * health monitoring.
 *
 * Requirements: 9.1, 9.2, 9.3
 */
@Module({
  imports: [SettingsModule, AuditModule],
  controllers: [DiscoveryController],
  providers: [DiscoveryService],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
