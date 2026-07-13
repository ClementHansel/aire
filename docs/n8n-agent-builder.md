# n8n Agent Builder — architecture & deployment

Drag-and-drop agent flows, n8n-style. n8n is hosted on the VPS and is where the
**platform admin** builds flows; tenants only **select** a flow, name their
agents, and use their own LLM key. This keeps a single free n8n instance and
respects its Sustainable Use License (tenants never get n8n logins).

## How it fits together

```
Admin (flows.useairin.id, super-admin only) ── builds ──► n8n template flows
Tenant dashboard (choose + name + own key)  ── selects ─► agent_configs pointer
Inbound WA ─► WhatsappService.handleInbound
              routing_mode='n8n'? POST message + persona + bridge token ─► n8n flow
                 n8n calls back ─► /api/bridge/{context,llm,tool,whatsapp/send}
              else ─► built-in AgentRuntimeService  (also the fallback on failure)
```

The n8n flow is a **template** with `{{ … }}` placeholders; AIRE injects each
tenant's persona/prompt/knowledge + their bridge token per message, so ONE flow
serves every tenant. All guardrails (customer scoping, tool toggle/approval
gating, tenant LLM keys + monitoring) stay server-side in the bridge — the flow
only orchestrates.

## Backend pieces

- **Migration `038_n8n_agent_flows.sql`** — `agent_flows` catalog + routing
  columns on `agent_configs` (`routing_mode`, `n8n_flow_id`,
  `n8n_automation_flow_id`, `bridge_token`).
- **`modules/agent-bridge`** — `BridgeTokenGuard` (per-tenant token auth) + the
  four bridge endpoints; `AgentFlowService` (catalog CRUD + tenant selection +
  token mint + persona snapshot); admin & tenant controllers.
- **`WhatsappService`** — `dispatchToN8n()` seam in `handleInbound` +
  `agentSend()` (used by the bridge to send + log replies).

## API surface

| Endpoint | Auth | Who |
|---|---|---|
| `POST /api/bridge/context\|llm\|tool\|whatsapp/send\|escalate` | bridge token | n8n |
| `GET/POST/PUT/PATCH/DELETE /api/agent-flows` | JWT, super-admin | admin catalog |
| `GET /api/agent-flow-selection[/available]`, `PUT`, `POST /token` | JWT, tenant owner | tenant |

`POST /api/bridge/escalate` (`{ fromPhone, reason? }`) lets a flow hand a chat to a
human exactly like the built-in runtime does: it marks the conversation escalated,
acknowledges the customer, and notifies the tenant's escalation number. The
`whatsapp/send` body also accepts an optional `persona` so replies are attributed
to the right agent in the Conversation Log.

The reference flow (`aire-whatsapp-assistant.json`) now demonstrates a **Run Tool**
node (live queue snapshot via the gated tool API) and an **escalation branch**: the
prompt instructs the model to emit `[[ESCALATE]]` when it can't help, an IF node
routes that to the **Escalate** operation, everything else to **Send WhatsApp**.

## Deploy steps (VPS)

1. **.env** — add `N8N_ENCRYPTION_KEY` (random 32+ chars), `N8N_PUBLIC_URL=https://flows.useairin.id`.
   `BRIDGE_CALLBACK_BASE` defaults to `http://backend:4000` (fine on the compose network).
2. **Apply migration 038** the usual way (psql + `schema_migrations` row — see
   the deploy recipe; migrate.ts is not used on this box).
3. **Build the node package**: `cd integrations/n8n-nodes-aire && npm i && npm run build`.
4. **DNS**: point `flows.useairin.id` → the VPS IP.
5. **TLS**: `certbot certonly … -d flows.useairin.id`, then drop
   `infrastructure/nginx/conf.d/n8n.conf.example` → `n8n.conf` and reload nginx.
6. **Bring up**: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d n8n`
   then rebuild `backend` + `frontend`.
7. **First run**: open `flows.useairin.id`, create the n8n owner account
   immediately (lock it down), import `integrations/n8n-nodes-aire/workflows/aire-whatsapp-assistant.json`.
8. **Register** the flow's Production Webhook URL in **Admin → Agent Flows**.

## Tenant setup

Dashboard → **Agent Workflow**: switch engine to **n8n flow**, pick the flow,
click **Generate** to mint a bridge token, paste it into the AIRE node fields in
n8n (or leave the node defaults, which read it from the injected payload). Name
the personas — those names/prompts are what the flow injects.

## Safety notes

- **Injection, not access**: n8n only ever gets data via the scoped bridge
  endpoints; it holds no DB access and no provider keys.
- **Fallback**: any n8n failure (unreachable, disabled flow, non-2xx) falls
  through to the built-in assistant, so WhatsApp never goes dark.
- **License**: stays free only while tenants don't get n8n editor logins. The
  admin-builds / tenant-selects model is what keeps it within internal use.
