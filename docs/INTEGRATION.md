# AIRE Operations Platform — Integration Guide

Everything below is configured **through the UI** — tenants add their own credentials and the
system works without code changes. This guide covers WhatsApp, the AI/LLM, payments, and the
catalog/branches.

---

## 1. WhatsApp (customer channel)

The business talks to customers over WhatsApp. Two providers are supported; **WAHA** (self-hosted,
unofficial) is the default.

### Option A — WAHA (default)
1. The `waha` container runs alongside the stack (`docker compose up -d waha`), bound to `127.0.0.1:3001`.
   The backend reaches it via `WAHA_URL` (default `http://waha:3000`).
2. In the dashboard go to **Agentic AI** (`/dashboard/ai-agent`).
3. Set provider = **WAHA**, give the session a name, and click connect — a **QR code** appears.
4. Scan it with the business phone's WhatsApp (Linked Devices). Status turns to `WORKING`.
5. Inbound messages hit `POST /api/whatsapp/webhook` and are handled by the agent runtime.

### Option B — Kapso (cloud)
- Set provider = **Kapso**, paste the **API key** and WhatsApp number. The key is stored masked.
- Outbound/inbound go through Kapso's API instead of WAHA.

### Reply behaviour
- **Master switch:** `agent_configs.ai_reply_enabled` (Agentic AI page) — whether agents auto-reply at all.
- **Per conversation:** each chat can pause/resume AI from the **Conversations** page.
- **Daily cap:** `max_messages_per_day` per customer; exceeding it escalates to a human.
- **Escalation number:** complaints / "talk to human" / unknown questions are forwarded here.

---

## 2. AI / LLM (rigid vs fluid replies)

The same agents answer in one of two styles, decided by tenant **Settings**:

| Setting | Effect |
|---------|--------|
| `ai_enabled = false` | **Rigid** — deterministic templated replies (no LLM, no API cost). |
| `ai_enabled = true` + provider configured | **Fluid** — the LLM writes natural replies grounded in the same data. |

### Connecting an LLM (per tenant)
1. Go to **Settings** → AI section.
2. Choose **provider**:
   - **OpenRouter** — paste your **API key** (stored encrypted). Default model `openai/gpt-4o-mini`
     (any OpenRouter model id works). This is the recommended path; the customer brings their own key.
   - **Local (Ollama / Hermes)** — point `HERMES_AI_ENDPOINT` at a running Ollama; no key needed.
3. Toggle **AI enabled** on. Use **Test connection** to verify (a one-line ping to the provider).
4. If the LLM is unreachable or the key is missing, replies automatically **fall back to rigid** — the
   customer always gets an answer.

### Agent knowledge & personas
- **Agentic AI** page: base prompt, **product knowledge** (hours, SOP, FAQs), skills, escalation number.
- **Agent Workflow** page (`/dashboard/agents`): the named agents (Oline, Ersa, CS1, Tirta, Bayu, Nadia,
  Reza, Dimas …), each with a role and its own prompt. The runtime picks an agent by message intent and uses
  its persona in fluid mode.

> **Data safety:** an agent only ever sees the data of the customer who sent the message (resolved from the
> phone number). It cannot reveal other customers' data or company financials. See
> [`TECHNICAL.md`](TECHNICAL.md#whatsapp-agent-runtime).

---

## 3. Payments

Per-branch payment buttons are configured under **Payment Methods** (`/dashboard/payment-methods`) —
name, kind (cash / QRIS / EDC / card / transfer), logo, colour, and business unit. The POS renders these
buttons dynamically.

Online gateway charges (QRIS dynamic, etc.) are handled by the `payment` module; provider webhooks land at
`POST /api/payments/webhook/:provider` (Xendit / Midtrans / Stripe) with per-provider signature validation.
Gateway credentials are supplied via environment variables.

Supported payment methods: `cash`, `qris_static`, `qris_dynamic`, `edc`, `cc` (credit card), `transfer`.

---

## 4. Branches, catalog & pricing

- **Branches** (`/dashboard/branches`): name, 3-letter code (used in voucher codes), legal entity (PT),
  address, phone, Google Maps link.
- **Services** (`/dashboard/services`) + **Catalog** (categories/brands): each service has a business unit
  (AIRE/LEAD) and can be scoped to specific branches (region pricing) or all branches.
- **Memberships** (`/dashboard/memberships`): plans with included free washes, branch availability, and
  1/3/6/12-month durations.
- **Service Packs** (Vouchers page): sellable voucher templates (e.g. 10× wash). **Promotions**: buy → free
  product/voucher/discount with quota.
- **Public eMenu:** `/menu/{tenantId}` renders the active catalog + plans for sharing (no login).

---

## 5. Webhooks & endpoints (reference)

| Purpose | Endpoint |
|---------|----------|
| WhatsApp inbound (WAHA/Kapso) | `POST /api/whatsapp/webhook` |
| Payment gateway callbacks | `POST /api/payments/webhook/:provider` |
| Public eMenu | `GET /api/kiosk/menu?tenantId=&outletId=` |
| Kiosk queue status | `GET /api/kiosk/queue-status?orderNumber=` |

All other endpoints require a Bearer JWT from `POST /api/auth/login`.
