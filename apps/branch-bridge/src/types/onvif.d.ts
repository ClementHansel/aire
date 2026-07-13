/**
 * Minimal type shim for the `onvif` package (which ships no TypeScript types).
 * Only the surface we use — Discovery.probe for WS-Discovery — is declared.
 */
declare module 'onvif' {
  /** A device found via ONVIF WS-Discovery. Fields are best-effort. */
  export interface OnvifProbeMatch {
    /** SOAP xaddrs endpoints, e.g. ["http://192.168.1.64/onvif/device_service"]. */
    xaddrs?: string[];
    /** Some builds expose a single string. */
    xaddr?: string;
    urn?: string;
    name?: string | string[];
    hardware?: string | string[];
    location?: string | string[];
    types?: string[];
    scopes?: string[];
    [key: string]: unknown;
  }

  export interface DiscoveryProbeOptions {
    timeout?: number;
    resolve?: boolean;
    [key: string]: unknown;
  }

  export const Discovery: {
    probe(
      options: DiscoveryProbeOptions,
      callback: (err: Error | null, cams: OnvifProbeMatch[]) => void,
    ): void;
    probe(
      callback: (err: Error | null, cams: OnvifProbeMatch[]) => void,
    ): void;
    on(event: string, listener: (...args: unknown[]) => void): void;
  };

  export class Cam {
    constructor(
      options: Record<string, unknown>,
      callback: (err: Error | null) => void,
    );
  }
}
