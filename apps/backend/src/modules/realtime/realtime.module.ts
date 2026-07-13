import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeBridge } from './realtime-bridge.service';

@Module({
  providers: [RealtimeGateway, RealtimeBridge],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
