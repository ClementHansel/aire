'use client';

/**
 * Frontend DTOs + helpers for the Device Registry / Topology feature.
 * Mirrors the contract in docs/tech/08-device-registry-topology.md. Kept local
 * to the frontend (not @aire/shared) per the doc conventions. camelCase DTOs.
 */

import {
  Cctv, Cpu, Printer, Monitor, Smartphone, Router, Waypoints, HardDrive,
  type LucideIcon,
} from 'lucide-react';

/* ── Enums ──────────────────────────────────────────────────────────── */

export type DeviceCategory =
  | 'camera' | 'controller' | 'printer' | 'kiosk' | 'pos_terminal' | 'router' | 'other';

export type DeviceStatus = 'online' | 'offline' | 'unconfigured';

export const DEVICE_CATEGORIES: DeviceCategory[] = [
  'camera', 'controller', 'printer', 'kiosk', 'pos_terminal', 'router', 'other',
];

/* ── Topology JSON (GET /api/topology) ──────────────────────────────── */

export interface TopologyDevice {
  id: string;
  name: string;
  category: DeviceCategory;
  status: DeviceStatus;
  ipAddress: string | null;
  refId: string | null;
  vendor: string | null;
  model: string | null;
  lastSeenAt: string | null;
}

export interface TopologyCategory {
  category: DeviceCategory;
  devices: TopologyDevice[];
}

export interface TopologyBridge {
  id: string;
  status: 'online' | 'offline';
  live: boolean;
  lastSeenAt: string | null;
  name?: string | null;
}

export interface TopologyBranchOutlet {
  id: string;
  name: string;
  code?: string | null;
}

export interface TopologyCounts {
  online: number;
  offline: number;
  total: number;
}

export interface TopologyBranch {
  outlet: TopologyBranchOutlet;
  bridge: TopologyBridge | null;
  counts: TopologyCounts;
  categories: TopologyCategory[];
}

export interface TopologyTree {
  tenant: { id: string; name: string };
  generatedAt: string;
  branches: TopologyBranch[];
}

/* ── Registry list (GET /api/devices, GET /api/devices/:id) ─────────── */

export interface RegistryDevice {
  id: string;
  tenantId: string;
  outletId: string;
  /** Convenience join returned by the registry endpoints (may be absent). */
  outletName?: string | null;
  bridgeId: string | null;
  category: DeviceCategory;
  name: string;
  vendor: string | null;
  model: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  refId: string | null;
  connectionParams: Record<string, unknown>;
  status: DeviceStatus;
  metadata: Record<string, unknown>;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Present on GET /api/devices/:id when category === 'camera' — the id used
   * against /api/cctv/... (falls back to refId if absent).
   */
  cameraId?: string | null;
}

/* ── Category presentation ──────────────────────────────────────────── */

export interface CategoryMeta {
  label: string;
  /** lucide icon name (per the contract) … */
  iconName: string;
  /** … and the resolved component for convenience. */
  icon: LucideIcon;
}

export const CATEGORY_META: Record<DeviceCategory, CategoryMeta> = {
  camera:       { label: 'Cameras',    iconName: 'Cctv',       icon: Cctv },
  controller:   { label: 'Controllers', iconName: 'Cpu',       icon: Cpu },
  printer:      { label: 'Printers',   iconName: 'Printer',    icon: Printer },
  kiosk:        { label: 'Kiosks',     iconName: 'Monitor',    icon: Monitor },
  pos_terminal: { label: 'Terminals',  iconName: 'Smartphone', icon: Smartphone },
  router:       { label: 'Routers',    iconName: 'Router',     icon: Router },
  other:        { label: 'Other',      iconName: 'HardDrive',  icon: HardDrive },
};

export function categoryMeta(category: DeviceCategory): CategoryMeta {
  return CATEGORY_META[category] ?? CATEGORY_META.other;
}

/** Icon for the bridge / category-group nodes in the tree. */
export const BridgeIcon = Waypoints;

/* ── Status → design tokens (no hardcoded hex) ──────────────────────── */

export interface StatusToken {
  label: string;
  /** text color utility */
  text: string;
  /** dot / fill background utility */
  dot: string;
  /** soft badge background + text */
  badge: string;
  /** SVG stroke color (currentColor-driven) utility for connectors */
  stroke: string;
  /** whether links to/from this node should animate the flow dash */
  animate: boolean;
}

export const STATUS_TOKENS: Record<DeviceStatus, StatusToken> = {
  online: {
    label: 'Online',
    text: 'text-success',
    dot: 'bg-success',
    badge: 'bg-success/10 text-success',
    stroke: 'text-success',
    animate: true,
  },
  offline: {
    label: 'Offline',
    text: 'text-text-muted',
    dot: 'bg-text-muted',
    badge: 'bg-surface-sunken text-text-secondary',
    stroke: 'text-text-muted',
    animate: false,
  },
  unconfigured: {
    label: 'Unconfigured',
    text: 'text-warning',
    dot: 'bg-warning',
    badge: 'bg-warning/10 text-warning',
    stroke: 'text-warning',
    animate: false,
  },
};

export function statusToken(status: DeviceStatus): StatusToken {
  return STATUS_TOKENS[status] ?? STATUS_TOKENS.unconfigured;
}

/** Coerce an unknown/legacy status string into a known DeviceStatus. */
export function normalizeStatus(s: string | null | undefined): DeviceStatus {
  return s === 'online' || s === 'offline' || s === 'unconfigured' ? s : 'unconfigured';
}
