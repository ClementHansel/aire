# n8n-nodes-aire

Custom n8n node that turns AIRE into a drag-and-drop agent builder. The hosted
n8n instance is where the **platform admin** builds agent flows; tenants only
**select** a published flow, name their agents, and use their own API key.

## What it provides

A single **AIRE** node with these operations, all authenticated by a per-tenant
bridge token and scoped server-side by AIRE:

| Operation | Bridge endpoint | Purpose |
|---|---|---|
| Get Customer Context | `POST /api/bridge/context` | Scoped customer data + public info + tenant persona |
| LLM Reply | `POST /api/bridge/llm` | Chat completion via the tenant's provider + their key |
| Run Customer Tool | `POST /api/bridge/whatsapp/tool` | Customer-scoped tool (my data, prices, **booking**, escalate) — **use this in conversation flows** |
| Run Tool | `POST /api/bridge/tool` | Full-business tool — **back-office AUTOMATION flows only** (exposes whole-business data; toggle/approval gated) |
| Send WhatsApp | `POST /api/bridge/whatsapp/send` | Send a reply + log it to the Conversation Log |
| Escalate to Human | `POST /api/bridge/escalate` | Mark escalated, ack the customer, notify the tenant |

> **Customer-facing flows must use _Run Customer Tool_, not _Run Tool_.** The
> customer tool is bound to the sender (resolved server-side from their phone) and
> can only ever read/act for that one customer; _Run Tool_ can read the whole
> business and is meant for internal automation flows.

**Base URL** and **Bridge Token** default to `{{ $json.callbackBaseUrl }}` and
`{{ $json.bridgeToken }}` — the values AIRE injects into the trigger payload — so
one flow serves every tenant without hardcoding secrets.

## How a flow is triggered

AIRE forwards each inbound WhatsApp message to the flow's **Production Webhook
URL** with this payload:

```json
{
  "event": "whatsapp.inbound",
  "tenantId": "…",
  "bridgeToken": "…",
  "callbackBaseUrl": "http://backend:4000",
  "conversationId": "…",
  "message": { "from": "628…", "name": "…", "text": "Halo, jam buka berapa?" }
}
```

The flow reads context, builds a prompt, calls the LLM, and sends the reply —
all through the AIRE node.

### Reference flows (import from `workflows/`)

- [`aire-whatsapp-assistant.json`](workflows/aire-whatsapp-assistant.json) — FAQ / info assistant (context → LLM → send, with escalation).
- [`aire-whatsapp-booking-agent.json`](workflows/aire-whatsapp-booking-agent.json) — **booking agent** that drives one tool round: the model may call a **customer tool** (prices, my-data, or `create_booking`), the result is fed back, and the reply is sent.

### Booking = two-sided WhatsApp approval (handled by AIRE, not the flow)

`create_booking` never writes directly. The flow only PROPOSES; AIRE runs the
approval on WhatsApp so **both the customer and the staff acknowledge**:

1. Model calls `create_booking` → AIRE stores a proposal and the flow asks the
   customer to reply **YA** (or taps a YA/BATAL reply button).
2. Customer **YA** → AIRE creates the booking as `booked` and messages the
   tenant's **escalation number** with **TERIMA / TOLAK** buttons.
3. Staff **TERIMA** → booking becomes `confirmed` and the customer is notified;
   **TOLAK** → `cancelled` + customer notified.

Steps 1–3 run **server-side in AIRE** (ahead of the n8n dispatch), so the flow
never has to implement the confirmation state machine — it just proposes.
Interactive buttons render on the official WhatsApp Business API (Kapso); on WAHA
they fall back to a text prompt (`reply YA`), which resolves identically.

## Install into the hosted n8n

```bash
# build the node package
cd integrations/n8n-nodes-aire
npm install && npm run build

# make it visible to n8n (community node)
#   Option A: mount into the n8n container's custom extensions dir
#     N8N_CUSTOM_EXTENSIONS=/home/node/.n8n/custom
#   Option B: install it via the n8n UI (Settings → Community nodes → n8n-nodes-aire)
```

Then in n8n: **Import** `workflows/aire-whatsapp-assistant.json`, copy the
Webhook (Production) URL, and register it in AIRE at **Admin → Agent Flows**.

## Setup checklist

1. Admin registers the flow's webhook URL in **Admin → Agent Flows**.
2. Tenant opens **Dashboard → Agent Workflow**, switches the engine to **n8n
   flow**, selects the flow, and clicks **Generate** to mint a bridge token.
3. Tenant names their agent personas (these are injected into the flow).
4. Done — inbound WhatsApp messages now run through the n8n flow, with a safe
   fallback to the built-in assistant if the flow is unreachable.
