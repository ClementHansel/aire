export { BridgeModule } from './bridge.module';
export { BridgeService } from './bridge.service';
export { BridgeDispatchService } from './bridge-dispatch.service';
export { BridgeGateway } from './bridge.gateway';
export { BridgeEvents } from './bridge.events';
export type { BridgeDTO, ResolvedBridge } from './bridge.service';
export type { ConfigureResult } from './bridge-dispatch.service';
export type {
  BridgeEventContext,
  DeviceEvent,
  ScanDoneEvent,
  ConfigureResultEvent,
  HlsPlaylistEvent,
  HlsSegmentEvent,
  SensorEvent,
  HeartbeatEvent,
  BridgeEventMap,
} from './bridge.events';
