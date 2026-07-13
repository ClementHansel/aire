'use client';

/**
 * Global Topology — the animated network map of every branch's edge devices.
 *   GET /api/topology            (whole tenant, branches collapsed to counts)
 *   GET /api/topology?outletId=  (one branch, expanded to devices)
 *
 * Rendering is a hand-rolled SVG tiered tree (Tenant → Branch → Bridge →
 * Category groups → Device leaves). Connectors are cubic-bezier <path>s whose
 * stroke-dashoffset animates so a dash "flows" parent→child on ONLINE links;
 * offline/unconfigured links are dim + static. Nodes are HTML cards layered
 * over the SVG so they inherit Tailwind tokens (theme-aware). Pan by dragging
 * the canvas, zoom with the wheel / +/- buttons. Respects reduced-motion.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Waypoints, Building2, Store, Plus, Minus, Maximize2, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { OutletOption } from '../settings/DeviceDiscoverySection';
import {
  type TopologyTree, type TopologyBranch, type TopologyDevice, type DeviceCategory,
  type DeviceStatus, categoryMeta, statusToken, normalizeStatus,
} from '@/lib/topology';
import { DeviceDetailModal } from '@/components/dashboard/DeviceDetailModal';

/* ── Layout constants (content coordinate space) ────────────────────── */

const NODE_W = 194;
const NODE_H = 58;
const COL_GAP = 68;
const ROW = 74;
const PAD = 36;

type NodeKind = 'tenant' | 'branch' | 'bridge' | 'category' | 'device';
const TIER: Record<NodeKind, number> = { tenant: 0, branch: 1, bridge: 2, category: 3, device: 4 };
const colX = (kind: NodeKind) => PAD + TIER[kind] * (NODE_W + COL_GAP);

interface GNode {
  key: string;
  kind: NodeKind;
  label: string;
  sub?: string;
  status?: DeviceStatus;
  online: boolean;
  category?: DeviceCategory;
  device?: TopologyDevice;
  outletId?: string;
  action: 'expand' | 'device' | null;
  children: GNode[];
  x: number;
  y: number;
}

interface GEdge { id: string; x1: number; y1: number; x2: number; y2: number; online: boolean }

/* ── Build the visible tree from the topology JSON + expansion state ── */

function buildGraph(tree: TopologyTree, expanded: Set<string>) {
  const deviceNode = (d: TopologyDevice): GNode => ({
    key: `dev-${d.id}`,
    kind: 'device',
    label: d.name,
    sub: d.ipAddress ?? undefined,
    status: normalizeStatus(d.status),
    online: d.status === 'online',
    category: d.category,
    device: d,
    action: 'device',
    children: [],
    x: 0, y: 0,
  });

  const branchNodes: GNode[] = tree.branches.map((b: TopologyBranch) => {
    const oid = b.outlet.id;
    const isOpen = expanded.has(oid);

    const catNodes: GNode[] = b.categories
      .filter((c) => c.devices.length > 0)
      .map((c) => {
        const meta = categoryMeta(c.category);
        const onlineCount = c.devices.filter((d) => d.status === 'online').length;
        return {
          key: `cat-${oid}-${c.category}`,
          kind: 'category' as const,
          label: meta.label,
          sub: isOpen ? undefined : `${onlineCount}/${c.devices.length} online`,
          online: onlineCount > 0,
          category: c.category,
          outletId: oid,
          action: 'expand' as const,
          children: isOpen ? c.devices.map(deviceNode) : [],
          x: 0, y: 0,
        };
      });

    const bridgeOnline = b.bridge?.live ?? false;
    let midChildren: GNode[];
    if (b.bridge) {
      midChildren = [{
        key: `bridge-${b.bridge.id}`,
        kind: 'bridge' as const,
        label: 'Bridge',
        sub: bridgeOnline ? 'Online' : 'Offline',
        online: bridgeOnline,
        status: bridgeOnline ? 'online' : 'offline',
        outletId: oid,
        action: 'expand' as const,
        children: catNodes,
        x: 0, y: 0,
      }];
    } else {
      midChildren = catNodes;
    }

    return {
      key: `branch-${oid}`,
      kind: 'branch' as const,
      label: b.outlet.name,
      sub: b.outlet.code ? `${b.outlet.code} · ${b.counts.online}/${b.counts.total} online` : `${b.counts.online}/${b.counts.total} online`,
      online: bridgeOnline || b.counts.online > 0,
      status: bridgeOnline ? 'online' : b.bridge ? 'offline' : 'unconfigured',
      outletId: oid,
      action: 'expand' as const,
      children: midChildren,
      x: 0, y: 0,
    };
  });

  const tenant: GNode = {
    key: 'tenant',
    kind: 'tenant',
    label: tree.tenant.name,
    sub: `${tree.branches.length} branch${tree.branches.length === 1 ? '' : 'es'}`,
    online: branchNodes.some((n) => n.online),
    action: null,
    children: branchNodes,
    x: 0, y: 0,
  };

  // Assign x by kind-tier, y by DFS leaf-slot allocation.
  let slot = 0;
  const assign = (node: GNode) => {
    node.x = colX(node.kind);
    if (node.children.length === 0) {
      node.y = PAD + slot * ROW + NODE_H / 2;
      slot += 1;
    } else {
      node.children.forEach(assign);
      const first = node.children[0]!;
      const last = node.children[node.children.length - 1]!;
      node.y = (first.y + last.y) / 2;
    }
  };
  assign(tenant);

  // Flatten + collect edges.
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const walk = (node: GNode) => {
    nodes.push(node);
    for (const c of node.children) {
      edges.push({
        id: `${node.key}->${c.key}`,
        x1: node.x + NODE_W, y1: node.y,
        x2: c.x, y2: c.y,
        online: c.online,
      });
      walk(c);
    }
  };
  walk(tenant);

  const width = colX(nodes.reduce<NodeKind>((m, n) => (TIER[n.kind] > TIER[m] ? n.kind : m), 'tenant')) + NODE_W + PAD;
  const height = PAD * 2 + Math.max(1, slot) * ROW;
  return { nodes, edges, width, height };
}

function bezier(e: GEdge): string {
  const dx = Math.max(40, (e.x2 - e.x1) / 2);
  return `M ${e.x1} ${e.y1} C ${e.x1 + dx} ${e.y1}, ${e.x2 - dx} ${e.y2}, ${e.x2} ${e.y2}`;
}

/* ── Page ───────────────────────────────────────────────────────────── */

export default function TopologyPage() {
  const { t } = useI18n();
  const [outlets, setOutlets] = useState<OutletOption[]>([]);
  const [outletId, setOutletId] = useState('');
  const [tree, setTree] = useState<TopologyTree | null>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<TopologyDevice | null>(null);

  // Restore last branch selection.
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('topology.outletId') : null;
    if (saved) setOutletId(saved);
    api.get<OutletOption[]>('/outlets').then(setOutlets).catch(() => setOutlets([]));
  }, []);

  useEffect(() => {
    setTree(null);
    setError('');
    const path = outletId ? `/topology?outletId=${encodeURIComponent(outletId)}` : '/topology';
    api.get<TopologyTree>(path)
      .then((tr) => {
        setTree(tr);
        // Single-branch view is fully expanded; global view starts collapsed.
        setExpanded(outletId && tr.branches[0] ? new Set([tr.branches[0].outlet.id]) : new Set());
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load topology'));
    if (typeof window !== 'undefined') window.localStorage.setItem('topology.outletId', outletId);
  }, [outletId]);

  const graph = useMemo(() => (tree ? buildGraph(tree, expanded) : null), [tree, expanded]);

  const toggleExpand = useCallback((oid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(oid)) next.delete(oid); else next.add(oid);
      return next;
    });
  }, []);

  return (
    <div className="max-w-none">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-text-primary">
            <Waypoints className="h-6 w-6" strokeWidth={1.75} />{t('dash.topology.title', 'Topology')}
          </h1>
          <p className="text-sm text-text-secondary">
            {t('dash.topology.subtitle', 'Live map of every branch bridge and its edge devices. Flowing links are online.')}
          </p>
        </div>
        <select
          className="input-field w-auto"
          value={outletId}
          onChange={(e) => setOutletId(e.target.value)}
          data-testid="topology-outlet-select"
        >
          <option value="">{t('dash.topology.allBranches', 'All branches')}</option>
          {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {!tree && !error ? (
        <div className="card flex h-[60vh] items-center justify-center text-sm text-text-muted">
          {t('common.loading', 'Loading…')}
        </div>
      ) : graph && (
        <TopologyCanvas
          graph={graph}
          onNode={(n) => {
            if (n.action === 'device' && n.device) setSelected(n.device);
            else if (n.action === 'expand' && n.outletId) toggleExpand(n.outletId);
          }}
        />
      )}

      {selected && <DeviceDetailModal device={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/* ── Canvas (pan + zoom + nodes + edges) ────────────────────────────── */

function TopologyCanvas({
  graph, onNode,
}: {
  graph: { nodes: GNode[]; edges: GEdge[]; width: number; height: number };
  onNode: (n: GNode) => void;
}) {
  const { t } = useI18n();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(PAD);
  const [ty, setTy] = useState(PAD);
  const pan = useRef<{ active: boolean; sx: number; sy: number; ox: number; oy: number }>({ active: false, sx: 0, sy: 0, ox: 0, oy: 0 });

  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setScale((s) => {
      const ns = clamp(s * factor, 0.35, 2.2);
      const k = ns / s;
      setTx((x) => cx - (cx - x) * k);
      setTy((y) => cy - (cy - y) * k);
      return ns;
    });
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect();
    const cx = rect ? e.clientX - rect.left : 0;
    const cy = rect ? e.clientY - rect.top : 0;
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, cx, cy);
  }, [zoomAt]);

  const zoomBtn = (factor: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    zoomAt(factor, rect ? rect.width / 2 : 0, rect ? rect.height / 2 : 0);
  };
  const reset = () => { setScale(1); setTx(PAD); setTy(PAD); };

  const onMouseDown = (e: React.MouseEvent) => {
    // Only start a pan from empty canvas (nodes stop propagation).
    pan.current = { active: true, sx: e.clientX, sy: e.clientY, ox: tx, oy: ty };
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!pan.current.active) return;
      setTx(pan.current.ox + (e.clientX - pan.current.sx));
      setTy(pan.current.oy + (e.clientY - pan.current.sy));
    };
    const up = () => { pan.current.active = false; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  return (
    <div
      ref={stageRef}
      className="relative h-[70vh] min-h-[420px] w-full cursor-grab overflow-hidden rounded-xl border border-border bg-surface-sunken/30 active:cursor-grabbing"
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      data-testid="topology-canvas"
    >
      {/* Flow animation — global keyframes; disabled under reduced-motion. */}
      <style jsx global>{`
        @keyframes topo-flow { to { stroke-dashoffset: -28; } }
        .topo-link { fill: none; stroke: currentColor; stroke-width: 2; }
        .topo-link--flow { stroke-dasharray: 6 8; animation: topo-flow 0.9s linear infinite; opacity: 0.9; }
        .topo-link--dim { stroke-dasharray: 2 6; opacity: 0.4; }
        @media (prefers-reduced-motion: reduce) {
          .topo-link--flow { animation: none; }
        }
      `}</style>

      {/* Transformed content: edges (SVG) + node cards (HTML) share one space. */}
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}>
        <svg width={graph.width} height={graph.height} className="pointer-events-none block overflow-visible">
          {graph.edges.map((e) => {
            const st = statusToken(e.online ? 'online' : 'offline');
            return (
              <path
                key={e.id}
                d={bezier(e)}
                className={cn('topo-link', st.stroke, e.online ? 'topo-link--flow' : 'topo-link--dim')}
              />
            );
          })}
        </svg>

        {graph.nodes.map((n) => (
          <NodeCard key={n.key} node={n} onClick={() => onNode(n)} />
        ))}
      </div>

      {/* Zoom controls */}
      <div className="absolute right-3 top-3 flex flex-col gap-1 rounded-lg border border-border bg-surface-raised p-1 shadow-sm">
        <button className="rounded-md p-1.5 text-text-secondary hover:bg-surface-sunken" onClick={() => zoomBtn(1.2)} aria-label={t('dash.topology.zoomIn', 'Zoom in')}><Plus className="h-4 w-4" /></button>
        <button className="rounded-md p-1.5 text-text-secondary hover:bg-surface-sunken" onClick={() => zoomBtn(1 / 1.2)} aria-label={t('dash.topology.zoomOut', 'Zoom out')}><Minus className="h-4 w-4" /></button>
        <button className="rounded-md p-1.5 text-text-secondary hover:bg-surface-sunken" onClick={reset} aria-label={t('dash.topology.reset', 'Reset view')}><Maximize2 className="h-4 w-4" /></button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-raised/90 px-3 py-2 text-xs text-text-secondary backdrop-blur">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" />{t('dash.topology.online', 'Online')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-text-muted" />{t('dash.topology.offline', 'Offline')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-warning" />{t('dash.topology.unconfigured', 'Unconfigured')}</span>
      </div>
    </div>
  );
}

function NodeCard({ node, onClick }: { node: GNode; onClick: () => void }) {
  const status: DeviceStatus = node.status ?? (node.online ? 'online' : 'offline');
  const st = statusToken(status);

  let Icon = Waypoints;
  if (node.kind === 'tenant') Icon = Building2;
  else if (node.kind === 'branch') Icon = Store;
  else if (node.kind === 'bridge') Icon = Waypoints;
  else if (node.category) Icon = categoryMeta(node.category).icon;

  const clickable = node.action !== null;

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); if (clickable) onClick(); }}
      onKeyDown={(e) => { if (clickable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(); } }}
      style={{ left: node.x, top: node.y - NODE_H / 2, width: NODE_W, height: NODE_H }}
      className={cn(
        'absolute flex items-center gap-2.5 rounded-lg border bg-surface-raised px-3 shadow-sm transition-all',
        clickable && 'hover:-translate-y-0.5 hover:shadow-luxury',
        node.action === 'device' ? 'cursor-pointer' : node.action === 'expand' ? 'cursor-pointer' : 'cursor-default',
        node.online ? 'border-border' : 'border-border/70 opacity-90',
      )}
      data-testid={`topo-node-${node.key}`}
    >
      <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-sunken', st.text)}>
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium leading-tight text-text-primary">{node.label}</p>
        {node.sub && <p className="truncate font-mono text-[11px] leading-tight text-text-muted">{node.sub}</p>}
      </div>
      {node.action === 'expand' ? (
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" />
      ) : (
        <span className={cn('h-2 w-2 shrink-0 rounded-full', st.dot)} />
      )}
    </div>
  );
}
