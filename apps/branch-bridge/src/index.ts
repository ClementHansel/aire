import http from 'node:http';
import { loadConfig, type BridgeConfig } from './config';
import { CloudClient } from './cloud-client';
import { runScan, injectRtspCreds, detectNvrVendor } from './scanner';
import { resolveNvrChannels } from './nvr-provision';
import { Streamer } from './streamer';
import { MqttBridge } from './mqtt-bridge';
import type {
  CommandRequest,
  ConfigureRequest,
  ScanRequest,
  StreamStartRequest,
  StreamStopRequest,
  PlaybackStartRequest,
  PlaybackStopRequest,
} from './types';

// Re-export the public surface so this package can be imported + unit-tested.
export * from './types';
export { loadConfig } from './config';
export {
  runScan,
  classifyByPorts,
  classifyMdnsService,
  deriveLocalSubnet,
  hostsInSubnet,
  dedupeByIp,
  simulatedDevices,
} from './scanner';
export {
  Streamer,
  buildRealFfmpegArgs,
  buildSimulatedFfmpegArgs,
  buildWebcamFfmpegArgs,
  isSimulatedSource,
  isWebcamSource,
  webcamDevice,
  parseFirstDshowVideo,
  parseSegmentSeq,
} from './streamer';
export {
  MqttBridge,
  parseSensorTopic,
  buildCommandTopic,
  toSensorEvent,
} from './mqtt-bridge';
export { CloudClient } from './cloud-client';

/** Extract an rtsp url from arbitrary connection_params. */
function rtspUrlFromParams(params: Record<string, unknown>): string | null {
  const candidate = params.rtsp_url ?? params.rtspUrl;
  return typeof candidate === 'string' && candidate ? candidate : null;
}

async function main(): Promise<void> {
  const config: BridgeConfig = loadConfig();
  console.log('[branch-bridge] starting Branch Bridge Agent');
  console.log(`[branch-bridge] cloud=${config.cloudUrl} simulate=${config.simulate}`);

  if (!config.bridgeToken) {
    console.error('[branch-bridge] AIRE_BRIDGE_TOKEN is required (or set AIRE_SIMULATE=true)');
    process.exit(1);
  }

  // Track known device ips reported to the cloud (for heartbeats).
  const knownDevices = new Set<string>();

  // --- Streamer ---------------------------------------------------------
  const streamer = new Streamer(
    config.ffmpegPath,
    config.hlsTmpDir,
    config.simulate,
    {
      onPlaylist: (event) => cloud.emit('hls:playlist', event),
      onSegment: (event) => cloud.emit('hls:segment', event),
    },
  );

  // --- MQTT bridge ------------------------------------------------------
  const mqttBridge = new MqttBridge(
    {
      mqttUrl: config.mqttUrl,
      simulate: config.simulate,
      tenantId: config.tenantId,
      outletId: config.outletId,
    },
    (sensor) => cloud.emit('sensor', sensor),
  );

  // --- Cloud client handlers -------------------------------------------
  const handlers = {
    onScan: async (req: ScanRequest) => {
      console.log(`[branch-bridge] scan requested scanId=${req.scanId}`);
      const outcome = await runScan(
        {
          simulate: config.simulate,
          subnet: config.scanSubnet,
          protocols: req.protocols,
        },
        (device) => {
          knownDevices.add(device.ip_address);
          cloud.emit('device', { scanId: req.scanId, device });
        },
      );
      cloud.emit('scan:done', {
        scanId: req.scanId,
        count: outcome.devices.length,
        errors: outcome.errors,
      });
    },

    onConfigure: async (req: ConfigureRequest) => {
      knownDevices.add(req.deviceId);
      try {
        if (req.device_type === 'camera') {
          const rtspUrl = rtspUrlFromParams(req.connection_params);
          if (!rtspUrl && !config.simulate) {
            cloud.emit('configure:result', {
              deviceId: req.deviceId,
              ok: false,
              error: 'connection_params.rtsp_url is required for a camera',
            });
            return;
          }
          // Do NOT start a persistent stream here. The cloud issues a dedicated
          // stream:start keyed by the cameraId once the camera row exists;
          // starting one under the deviceId too would run a second, unused
          // ffmpeg for the same source. Configure only validates + echoes the
          // effective connection params (incl. the resolved RTSP URL).
          cloud.emit('configure:result', {
            deviceId: req.deviceId,
            ok: true,
            connection_params: {
              ...req.connection_params,
              rtsp_url: rtspUrl ?? `test:${req.deviceId}`,
            },
          });
        } else if (req.device_type === 'nvr') {
          // Enumerate the camera channels behind the NVR over ONVIF (needs the
          // device credentials, passed in connection_params). The cloud turns
          // each returned channel into its own camera. No creds / non-ONVIF NVR
          // → channels:[] and the NVR still registers (registry-only).
          const cp = req.connection_params ?? {};
          const host =
            (cp.host as string) ||
            (cp.ip_address as string) ||
            (cp.ip as string) ||
            '';
          const ffprobePath = config.ffmpegPath.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
          const vendor = detectNvrVendor((cp.vendor as string) || (cp.manufacturer as string));
          // Tries the provided creds + common defaults, and (if nothing streams)
          // best-effort enables RTSP/ONVIF over ISAPI/CGI, then re-enumerates.
          const res = host
            ? await resolveNvrChannels({
                host,
                port: typeof cp.onvif_port === 'number' ? cp.onvif_port : 80,
                rtspPort: typeof cp.rtsp_port === 'number' ? cp.rtsp_port : 554,
                vendor,
                provided: { username: cp.username as string, password: cp.password as string },
                ffprobePath,
              })
            : { channels: [], username: '', password: '', autoEnabled: false };
          cloud.emit('configure:result', {
            deviceId: req.deviceId,
            ok: true,
            // Return the WORKING credential so the cloud stores the right one
            // (it is encrypted at rest and never returned to the browser after).
            connection_params: {
              ...cp,
              vendor,
              username: res.username || undefined,
              password: res.password || undefined,
              channels: res.channels,
              channel_count: res.channels.length,
              auto_enabled: res.autoEnabled,
            },
          });
        } else {
          // iot_controller / router / printer / scanner / etc: nothing to
          // configure on the agent — sensor topics are already wildcard-subscribed.
          cloud.emit('configure:result', {
            deviceId: req.deviceId,
            ok: true,
            connection_params: req.connection_params,
          });
        }
      } catch (e) {
        cloud.emit('configure:result', {
          deviceId: req.deviceId,
          ok: false,
          error: (e as Error).message,
        });
      }
    },

    onStreamStart: async (req: StreamStartRequest) => {
      const url = injectRtspCreds(req.rtspUrl, req.username ?? '', req.password ?? '');
      await streamer.startStream(req.cameraId, url);
    },

    onStreamStop: async (req: StreamStopRequest) => {
      await streamer.stopStream(req.cameraId);
    },

    // NVR archive playback: relay the vendor playback URL as a transient HLS
    // session keyed by sessionId (the cloud serves it under /playback/:sessionId).
    onPlaybackStart: async (req: PlaybackStartRequest) => {
      const url = injectRtspCreds(req.rtspUrl, req.username ?? '', req.password ?? '');
      await streamer.startStream(req.sessionId, url);
    },

    onPlaybackStop: async (req: PlaybackStopRequest) => {
      await streamer.stopStream(req.sessionId);
    },

    onCommand: async (req: CommandRequest) => {
      mqttBridge.publishCommand(req);
    },
  };

  const cloud = new CloudClient(
    config.cloudUrl,
    config.bridgeToken,
    handlers,
    () => ({
      cameras: streamer.activeCameras(),
      devices: [...knownDevices],
    }),
  );
  cloud.start();

  // --- MQTT connect (non-fatal if the local broker is down) -------------
  try {
    await mqttBridge.connect();
  } catch (e) {
    console.error('[branch-bridge] MQTT connect failed (continuing):', (e as Error).message);
  }

  // --- Health endpoint --------------------------------------------------
  const healthServer = http.createServer((reqHttp, res) => {
    if (reqHttp.url === '/health' && reqHttp.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: cloud.isConnected() ? 'ok' : 'degraded',
          service: 'branch-bridge',
          simulate: config.simulate,
          cloud_connected: cloud.isConnected(),
          mqtt_connected: mqttBridge.isConnected(),
          active_cameras: streamer.activeCameras(),
        }),
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  healthServer.listen(config.healthPort, () => {
    console.log(`[branch-bridge] health on :${config.healthPort}/health`);
  });

  // --- Graceful shutdown ------------------------------------------------
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('[branch-bridge] shutting down...');
    healthServer.close();
    await streamer.stopAll();
    await mqttBridge.disconnect();
    cloud.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[branch-bridge] fatal:', err);
    process.exit(1);
  });
}
