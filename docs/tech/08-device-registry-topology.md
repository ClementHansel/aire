# Device Registry + Global Topology

Turns the branch-bridge into a **branch edge controller**: every LAN device
(camera, bay controller, printer, kiosk, POS terminal, router) is registered
once and then permanently managed + monitored from the cloud — globally and
per-branch. Builds on [07-branch-bridge-protocol.md](07-branch-bridge-protocol.md).

## Data model — migration `054_branch_devices.sql`

`branch_devices` = the unified registry (single source of truth for the registry
UI + topology). Specialized tables (`cameras`, `pos_devices`, `kiosk_devices`)
keep their type-specific columns and are linked via `ref_id`.

```
branch_devices(
  id uuid pk,
  tenant_id uuid not null -> tenants,
  outlet_id uuid not null -> outlets,
  bridge_id uuid -> branch_bridges (null ok; some devices are cloud-direct),
  category varchar(24) not null,   -- camera|controller|printer|kiosk|pos_terminal|router|other
  name     varchar(160) not null,
  vendor   varchar(120), model varchar(120),
  ip_address varchar(64), mac_address varchar(64),
  ref_id   uuid,                   -- link to cameras.id / pos_devices.id / kiosk_devices.id
  connection_params jsonb default '{}',
  status   varchar(16) not null default 'unconfigured',  -- online|offline|unconfigured
  metadata jsonb default '{}',
  last_seen_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
-- indexes: (outlet_id, category), (tenant_id, created_at desc),
--          unique partial (bridge_id, ip_address) where ip_address is not null
```

### Registration sources (who writes branch_devices)
- **Discovery confirm** (`DiscoveryService.confirmDevice`): upsert a row —
  `iot_controller→controller`, `camera→camera` (ref_id = the `cameras.id` it
  created), `router→router`.
- **Heartbeat / bridge:offline**: the bridge gateway marks a branch's devices
  `online` on heartbeat and `offline` on `bridge:offline` (reuse the existing
  event). Cameras also flip via their stream state.
- **POS terminals / kiosks**: the topology + registry read these from the
  existing `pos_devices` / `kiosk_devices` tables (UNION into the tree) so they
  appear without a data migration; a later pass can mirror them into
  branch_devices for uniform status.

## Backend — `modules/device-registry`

- `DeviceRegistryService`: `upsert(device)`, `listByOutlet(tenantId,{outletId?,category?})`,
  `get(tenantId,id)`, `setStatusForBridge(bridgeId,status)`, `remove(tenantId,id)`,
  `upsertFromDiscovery(tenantId, device, {bridgeId, refId?})`.
- `TopologyService.build(tenantId, outletId?)` → nested tree (below).
- `DeviceController` (JWT + tenant-scoped from JWT):
  - `GET /api/topology`            → whole tenant tree
  - `GET /api/topology?outletId=`  → one branch subtree
  - `GET /api/devices?outletId=&category=` → flat registry list
  - `GET /api/devices/:id`         → one device (+ camera stream refs when category=camera)
- Installer download (Phase 1): `GET /api/bridges/:id/installer` streams the
  prebuilt package zip from `process.env.BRANCH_BRIDGE_PACKAGE` (a mounted path).
  If unset → 503 with `{ needsPackage: true }` so the UI falls back to showing
  the copy-paste command. (Token is shown in the modal regardless.)

### Topology JSON (the contract the frontend renders)
```jsonc
{
  "tenant": { "id": "...", "name": "Airin Demo" },
  "generatedAt": "2026-07-12T...Z",
  "branches": [
    {
      "outlet": { "id": "...", "name": "AIRE Bintaro", "code": "BTR" },
      "bridge": { "id": "...", "status": "online", "live": true, "lastSeenAt": "..." } | null,
      "counts": { "online": 3, "offline": 1, "total": 4 },
      "categories": [
        { "category": "camera",
          "devices": [ { "id","name","category","status","ipAddress","refId","vendor","model","lastSeenAt" } ] },
        { "category": "controller", "devices": [ ... ] }
        // printer | kiosk | pos_terminal | router | other
      ]
    }
  ]
}
```
Global view = all branches; branch view = one branch (still an array of length 1).

## Frontend

### Topology page `/dashboard/topology` (the centerpiece)
- **Branch dropdown** (top-right, same pattern as other pages): "All branches" →
  global tree; select one → that branch's subtree. Persist selection.
- **Animated tree**, left→right hierarchy:
  `Tenant → Branch(es) → Bridge → Category groups → Device leaves`.
  Global view collapses each branch to its bridge + category counts (expandable);
  branch view expands fully to individual devices.
- **Rendering**: custom **SVG** (no heavy graph dep). Compute node positions with
  a simple tiered layout; draw connectors as SVG paths (cubic béziers between
  tiers). **Animated flow**: connector lines use an animated `stroke-dashoffset`
  (CSS `@keyframes`) so a dash "flows" from parent→child on *online* links; static
  dim line for offline. Respect `prefers-reduced-motion`.
- **Status colors** (use existing design tokens, not hardcoded hex): online =
  success/green, offline = muted/gray, unconfigured = warning/amber. Node cards
  show an icon per category (lucide: Cctv, Cpu, Printer, Monitor, Smartphone,
  Router), name, ip, status dot.
- **Interaction**: click a device node → the shared **DeviceDetailModal**. Pan
  (drag) + zoom (wheel/buttons) for large trees. Legend. Responsive (horizontal
  scroll container; never break page layout). Theme-aware (light/dark).
- Nav: add **Topology** under Operations (lucide `Waypoints` or `Network`).

### Devices registry page `/dashboard/devices`
- Branch dropdown + a category segmented control / grouped sections: Cameras,
  Controllers, Printers, Kiosks, Terminals, Routers, Other.
- Device cards (name, category icon, ip, status, branch). Click → DeviceDetailModal.
- Empty states per category with a hint ("Run Search devices to add …").

### Shared `DeviceDetailModal`
- Generic detail (category, ip/mac, vendor/model, status, last seen, connection
  params, branch/bridge).
- **When category = camera**: embed the **live HlsPlayer** + a **recordings
  (history) list** for that camera (reuse existing `/api/cctv/...`). This is the
  "see one + history" requirement.

### CCTV page `/dashboard/cctv` (enhance)
- Keep the **Live grid** ("see all") + **History** tab. Add **"see one"**:
  clicking a camera tile opens a focused large single-camera view (bigger player
  + that camera's recordings), or routes into DeviceDetailModal. Record toggle stays.

### Branch install flow (Phase 1) — `BridgeInstallWizard`
- Entry: an **"Install branch agent"** button in the branch context (Branch
  Bridges section and/or the topology branch view) shown when the branch has no
  online bridge.
- Wizard/steps modal:
  1. Ensure a bridge exists for the branch (create if needed → token).
  2. **Download installer** button → `GET /api/bridges/:id/installer` (falls back
     to showing the copy-paste `installCommand` if the package isn't hosted).
  3. Instructions: extract → run as Administrator (Windows) / sudo (Linux) →
     approve the OS prompt.
  4. **Auto-detect**: poll `GET /api/bridges` every ~3s; when this bridge flips
     to `live/online`, advance to "Connected ✓" and offer "Scan devices now".
- After connect, the branch view exposes a **permanent "Scan devices"** action
  (device registration stays open forever — rescan/add anytime).

## Phasing
1. Install-from-branch button + steps modal + auto-detect (Phase 1).
2. `branch_devices` registry + wiring + `/api/devices` + registry page (Phase 2).
3. `/api/topology` + the animated topology page + DeviceDetailModal + CCTV
   single-view (Phase 3 — the visualization).

## Conventions
- camelCase DTOs; keep types in `frontend/src/lib` (do NOT touch `@aire/shared`).
- Tenant scope always from the JWT, never the request body.
- New nav items via the existing `t('nav.*', 'Fallback')` pattern + `id.ts` keys.
