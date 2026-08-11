# 04 · Database — Stack, Model & Flow

## 1. Stack

- **PostgreSQL 16** (`postgres:16-alpine`), extension `pgcrypto` (for `gen_random_uuid()`).
- Accessed from the backend as a raw `pg` `Pool` (`DATABASE_POOL`); no ORM. Every query is
  hand-written SQL with explicit `tenant_id` predicates.
- Money is stored as `NUMERIC`/`DECIMAL`; timestamps are `TIMESTAMPTZ` (app TZ `Asia/Jakarta`).

## 2. Migration system

- Plain-SQL files in `database/migrations/`, `001_…` … `040_…`, applied in **lexicographic
  filename order** by `database/migrate.ts`.
- Applied versions are tracked in a `schema_migrations (version, filename, applied_at)` table.
  `version` = filename minus `.sql`.
- Each file manages its own `BEGIN/COMMIT`; later migrations lean on idempotent
  `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`.
- **No down-migrations** (`--rollback` is not implemented). Rollback in production = git reset +
  rebuild; ad-hoc migrations are sometimes applied via `psql` with a manual `schema_migrations`
  insert.
- `migrate.ts --status` lists applied/pending.

### Seeding (dev)
- `database/seed.ts` — idempotent demo seed: demo tenant `1111…1111` ("Demo Car Wash"), 2 outlets,
  4 users, 7 services, 3 customers, 2 membership plans, 3 voucher templates, 3 bays. Passwords are
  real bcrypt hashes generated at runtime (login `password123`, admin PIN `1234`).
- `database/seed-users.mjs` — standalone upsert of owner / superadmin / cashier for the demo
  tenant.
- Seeded logins: `owner@demo.com` (tenant_owner), `admin@sudirman.demo.com` (outlet_admin),
  `cashier1@sudirman.demo.com` / `cashier1@demo.com` (cashier), `superadmin@aire.com`
  (platform_super_admin, NULL tenant).

## 3. Tenancy & Row-Level Security

- Every domain table carries `tenant_id` (child tables inherit it via their parent).
- **RLS policies** (`003_rls_policies.sql`) exist: a NOLOGIN role `app_user` with per-table
  policies keyed on session GUCs `app.tenant_id` / `app.role` / `app.outlet_id`. Tenant-isolation
  policies filter by `app.tenant_id`; outlet-scoping policies restrict lower roles to their
  `app.outlet_id`; the `users` policy lets a super-admin see NULL-tenant rows.
- **In practice** the app enforces isolation mostly through explicit query predicates; the
  `RlsContextGuard` (which sets those GUCs per request) is applied by the `settings` and
  `discovery` modules. `004_updated_at_trigger.sql` adds `set_updated_at` triggers.

## 4. Data model by domain

> FK notation: `col`→`table` with delete rule where notable. Status enums are `CHECK` constraints.

### Foundation / SaaS
| Table (mig) | Purpose | Key columns |
|-------------|---------|-------------|
| `tenants` (001) | SaaS tenant | `slug` UNIQUE; `plan`; `status`(active/suspended/cancelled); `settings JSONB` (holds `featureFlags`, `branding`, `payment`, automation, `receipt_template`); `tenant_code CHAR(6)` (034) |
| `outlets` (001) | Branch | `tenant_id`→tenants (RESTRICT); `agent_id` UNIQUE; `settings JSONB` (`service_charge_pct`,`tax_pct`); `legal_entity`,`code` (012); `phone`,`maps_url` (017); `branch_code CHAR(2)` (034) |
| `users` (001) | Login account | `tenant_id`(CASCADE, NULL=super); `outlet_id`(SET NULL); `email` UNIQUE; `password_hash`; `role`(4 roles); `admin_pin_hash`; `custom_role_id`→roles (012) |
| `user_outlets` (012) | Multi-branch staff placement | `(user_id, outlet_id)` |
| `roles` (012) | Custom tenant RBAC roles | `tenant_id`; `base_role`; permission set |
| `payment_methods` (012) | Per-branch POS payment buttons | `outlet_id`; `kind`(cash/qris/edc/cc/transfer); `business_unit`(AIRE/LEAD/NULL); logo/colour |
| `brands`, `product_categories` (012) | Catalog taxonomy | `tenant_id` |
| `platform_config` (019) | Singleton platform config | default plans + feature flags; legacy pricing tiers seeded 026 (fallback for MRR) |
| `platform_plans` (041) | SaaS subscription plans charged to tenants | `code`(=`tenants.plan`),`name`,`price`,`billing_cycle`(monthly/annual),`features JSONB`,`limits JSONB`,`is_active`,`sort_order`; drives Billing MRR. Distinct from `membership_plans`. |
| `audit_logs` (001) | Audit trail | `tenant_id`,`outlet_id`,`user_id`; `operation`,`entity_type`,`entity_id`; before/after/metadata JSONB; `ip_address INET`. Surfaced platform-wide via `GET /admin/audit`. |
| `platform_invoices` (049) | Real platform billing ledger | `tenant_id`,`period`(YYYY-MM, unique per tenant),`plan_code`,`amount`,`status`(draft/sent/paid/overdue/void),`issued_at`/`due_date`/`paid_at`. Background job auto-generates drafts + marks overdue. |
| `platform_announcements` (050) | Broadcast messages to tenants | `title`,`body`,`severity`(info/warning/critical),`audience`(all/plan/tenant)+`target`,`published`,`starts_at`/`ends_at`. Read by tenants via `GET /announcements/feed`. |
| `platform_support_notes` (050) | Internal per-tenant support log | `tenant_id`,`body`,`pinned`,`author_id`. Never shown to the tenant. |

### Catalog / Commerce
| Table (mig) | Purpose | Key columns |
|-------------|---------|-------------|
| `services` (001) | Service + product catalog (products = services) | `outlet_id` (NULL=all); `category`(car_wash/product/add_on); `price`; `is_main_service`; `business_unit` (011); `category_id`,`brand_id`,`outlet_ids UUID[]` (012) |
| `orders` (001) | POS transaction | `outlet_id`(RESTRICT); `operator_id`→users; `customer_id`; `order_number`; `status`(ordered/paid/confirmed/completed/cancelled); money fields; `payment_method/reference/amount_received/change_amount`; `membership_id`; void fields; `shift_id`(009); `business_unit`,`payment_channel`,`salesperson_name`(011); `channel`(pos/kiosk/customer)(033) |
| `order_items` (001) | Line items | `order_id`(CASCADE); `service_id`(RESTRICT); `unit_price`,`discount`,`subtotal`; member-pricing fields; `cost_snapshot`(032, frozen COGS) |
| `order_tags` (001) | Labels | `tag`(regular/member/voucher/new_member/renewal/buy_voucher_pack) |
| `order_status_logs` (005) | Status history | `from_status`,`to_status`,`operator_id` |
| `voucher_templates` (001) | Voucher/pack definitions | `type`(fixed/percentage/service_pack); `value`,`max_uses`; scopes; `sale_price`,`validity_days`(006) |
| `voucher_packs` (001) | Sold pack (hashed parent code) | `template_id`; `parent_code_hash`; `status`(active/fully_redeemed/expired/cancelled); `expiry_date`(006) |
| `voucher_codes` (001) | Redeemable child codes | `pack_id`(CASCADE); `code_hash` UNIQUE; `status`(active/redeemed/expired/cancelled) |
| `voucher_books` (013) | Shareable digital voucher book | `benefit_type`(service/fixed/percentage); format `BRANCH-MMYYYY-NNNNNN` |
| `voucher_tickets` (013) | Individual plaintext tickets | `book_id`(CASCADE); `status`(active/redeemed/expired/void) |
| `voucher_counters` (013) | Per branch+MMYYYY sequence | `(outlet_id, period)` |
| `promotions` (013) | Promotion engine | `reward_type`(discount_fixed/percentage/free_product/free_voucher/future_discount); `max_quota` |
| `promotion_grants` (013) | Redemptions | `promotion_id`(CASCADE); `order_id` |
| `campaigns` / `campaign_grants` (001) | Plan+bonus campaigns | `plan_id`,`bonus_template_id`; per-customer grants |
| `expenses` (008) | Finance expenses | `tenant_id`,`outlet_id` |
| `sales_targets` (008) | Monthly targets | `period` YYYY-MM |
| `sales_leads` (008) | Sales pipeline | `status`(new/contacted/won/lost) |
| `settlement_entries` (013) | Inter-branch ledger | `owing_outlet_id`/`serving_outlet_id`; `amount`; `status`(pending/paid/void) |
| `settlement_payouts` (013) | Payout batch | pair + `amount`,`entry_count` |

### Membership
| Table (mig) | Purpose | Key columns |
|-------------|---------|-------------|
| `membership_plans` (001) | Plan | `duration_months`,`max_uses`,`daily_limit`,`max_plates`,`price`; `outlet_ids[]`,`free_service_ids[]`,`discounted_services JSONB`; `whatsapp_welcome_enabled`; `settlement_amount`(013) |
| `memberships` (001) | Subscription | `customer_id`,`plan_id`(RESTRICT); `status`; `start_date`,`end_date`; `uses_count`,`max_uses`,`daily_limit`; `order_id`; `home_outlet_id`(013); `suspended_at/reason`(027); `grace_until`,`revoked_at`(031). **Status evolves:** 001 active/expired/pending/cancelled → 027 +suspended → 031 +grace/+revoked |
| `membership_plates` (001) | Registered plates | `membership_id`(CASCADE); `plate_normalized`,`brand`,`model` |
| `membership_usages` (001) | Per-wash quota tracking | `plate_normalized`,`order_id`,`reversed`; `outlet_id`(013, settlement) |
| `membership_events` (031) | Lifecycle history | `event_type`,`payload JSONB`,`actor` |
| `membership_renewals` (037) | Pending renewal vs fee order | `order_id`(CASCADE, UNIQUE); `membership_id`,`plan_id`; `applied`,`applied_at` |
| `customers` (001) | Customer directory | `phone`,`phone_normalized` UNIQUE per tenant; `email`(039); identity `customer_code CHAR(4)`,`registered_outlet_id`,`membership_number CHAR(12)`(034) |

**Membership identity (034):** 12-char base-36 number = `tenant_code(6) + branch_code(2) +
customer_code(4)`, via nullable columns + partial-unique indexes so legacy rows don't collide.

### Queue / Kiosk / Bookings
| Table (mig) | Purpose | Key columns |
|-------------|---------|-------------|
| `bays` (001) | Physical wash bay (IoT) | `status`(available/occupied/maintenance); `controller_id`,`current_order_id`,`sensor_data JSONB`,`last_heartbeat` |
| `queue_entries` (001) | Order-linked queue (kiosk `join-queue`) | `order_id`(CASCADE); `position`,`priority`,`bay_id`; `status`(waiting/in_progress/completed) |
| `vehicle_queue` (014) | Arrival board (decoupled from orders) | plate/brand/type; `business_unit`; `status`(waiting/serving/done/cancelled); `order_id`(SET NULL, linked later) |
| `kiosk_devices` (030) | Self-service kiosk auth | `token VARCHAR(64)` UNIQUE; `is_active`,`last_seen_at` |
| `bookings` (021) | Appointments | `service_id`,`scheduled_at`; `status`(booked/confirmed/done/cancelled); `customer_id`,`confirmation_token`,`queue_entry_id`,`source`(040) |
| `vehicle_brands` / `vehicle_types` (035, seeded 036) | POS/queue dropdowns | brand→type; 036 seeds ~35 ID-market brands/models |
| ~~`alpr_detections`~~ (029) | **Dropped** — ALPR removed (manual plate entry unaffected) | — |

### Inventory / COGS / Procurement
| Table (mig) | Purpose | Key columns |
|-------------|---------|-------------|
| `inventory_items` (008) | Stock master | `outlet_id`; `unit_cost`,`unit`,`quantity`,`reorder_level` |
| `inventory_movements` (008) | Stock ledger | `type`: 001 in/out/adjustment → **032 +sale/+sale_return**; `reference` |
| `suppliers` / `purchase_orders` / `purchase_order_items` (008) | Procurement | PO `status`(draft/ordered/received/cancelled) |
| `service_recipe_components` (032) | Recipe / BOM per unit | `service_id`(CASCADE)+`inventory_item_id`(RESTRICT); `quantity`,`unit` |
| `cost_component_types` (032) | Reusable non-physical cost types | `kind`(fixed/percentage) |
| `service_cost_components` (032) | Per-product cost values | `component_type_id`(RESTRICT); `value` |
| `uom_conversions` (032) | Per-item unit conversions | `from_unit`,`to_unit`,`factor` |
| `stock_opname` / `stock_opname_items` (032) | Physical count + variance | header `status`(draft/counting/closed); item `expected/counted/variance/variance_value` |

### Shifts / HR / Payroll
| Table (mig) | Purpose | Key columns |
|-------------|---------|-------------|
| `pos_shifts` (009) | Register open/close + cash reconciliation | `operator_id`,`outlet_id`; `status`(open/closed); floats/counted |
| `petty_cash_movements` (009) | Petty cash per shift | `type`(in/out) |
| `shift_issues` (009) | Incident log | `severity`(low/medium/high) |
| `employee_shifts` (001) | Early clock model | `user_id` |
| `employees` (008) | HR records | `outlet_id`; `status`(active/inactive); `user_id`(028, 1:1 login link) |
| `attendance_records` (008) | Attendance | `status`(present/absent/leave/late); `hours_worked`(010) |
| `leave_requests` (008) | Leave | `status`(pending/approved/rejected); `paid`(010) |
| `employee_schedules` (010) | Roster (one/employee/day) | `work_date`,`start/end_time` |
| `holidays` (010) | Holidays | `is_paid` |
| `payroll_adjustments` (010) | Bonus/deduction/advance | `type`; `effective_period`; `status`(pending/applied) |
| `employee_loans` / `loan_repayments` (010) | Loans | loan `status`(active/paid/cancelled) |
| `payroll_runs` / `payslips` (010) | Payroll | run `status`(draft/finalized) |

### AI / Agents
| Table (mig) | Purpose | Key columns |
|-------------|---------|-------------|
| `agent_configs` (015) | Per-tenant WhatsApp/AI config (PK=tenant_id) | `wa_provider`(waha/kapso); `routing_mode`(builtin/n8n),`n8n_flow_id`,`bridge_token`(038) |
| `agents` (022) | Named agent personas registry | `role`(personal_assistant/customer_service/sales/supervisor),`prompt`,`position` |
| `agent_flows` (038) | Platform catalog of published n8n flows | `kind`(whatsapp/automation),`webhook_url`,`enabled` |
| `action_proposals` (007) | AI approval queue | `status`(pending/approved/rejected/expired) |
| `scheduled_analysis_runs` (007) | Scheduled AI analysis | `status`(running/completed/failed) |
| `domain_events` (007) | Domain event store | `tenant_id`-scoped |
| `agent_invocations` (007) | Every tool/llm/chat/analysis call (telemetry) | `kind`,`status`,`duration`,`tokens`; `outlet_id`(025) |
| `agent_chat_sessions` / `agent_chat_messages` (007, 093) | In-app chat threads, both consoles | message `role`(user/assistant/tool/system); session `scope`(tenant/platform) — a CHECK ties `scope` to `tenant_id` (tenant ⇒ set, platform ⇒ NULL); `archived_at` soft-deletes, `auto_titled` stops the titler overwriting a rename |
| `wa_whitelist_numbers` (093) | WhatsApp numbers routed to the FULL business agent | `access_level`(full/read_only); `phone` = bare international digits, unique per tenant; RLS by tenant |
| `wa_conversations` / `wa_messages` (016, 093) | WhatsApp threads | conv `status`(open/escalated/closed); msg `direction`(inbound/outbound); `chat_session_id` binds a whitelisted staff thread to its chat session |

### Portal
| Table (mig) | Purpose | Key columns |
|-------------|---------|-------------|
| `customer_otps` (039) | WhatsApp-OTP login store | `phone_normalized`,`code_hash`,`expires_at`,`attempts`,`last_sent_at`; UNIQUE(tenant,phone) |

## 5. Notable data-flow facts

- **Order = the source of truth for payment.** The queue's paid/unpaid badge is derived from the
  linked order, never duplicated.
- **COGS is frozen at sale** in `order_items.cost_snapshot`; margin reports read the snapshot, not
  the live recipe.
- **Membership status has two writers of truth** that agree: the read-time
  `MembershipLifecycleService.derive()` and the 6-hourly transition job — plus the hard
  benefit guard `status='active' AND end_date >= CURRENT_DATE`.
- **Renewal is two-phase**: a pending `membership_renewals` row is written with the fee order and
  only applied once that order is paid (idempotent).
- **Cross-branch membership washes** write `settlement_entries`; `settlement_payouts` net them.
- **Naming quirks:** `023_rename_agents` only updates data values (not a table rename); `actor`
  (membership_events) and `created_by` (stock_opname) are FK-less UUIDs; the only `DROP TABLE` is
  `alpr_detections` (029).

## 6. `@aire/shared` (shared domain package)

Re-exported from `packages/shared/src/index.ts`:
- **Enums** — `Role`, `OrderStatus`, `PaymentMethod`, `BusinessUnit`, `VoucherType`, `BayStatus`,
  `MembershipStatus`, `ServiceCategory`, `MachineStatus`; `MEMBERSHIP_GRACE_DAYS = 14`.
- **Constants** — validation limits, token expiries (access 900 s / refresh 604800 s),
  `ROLE_HIERARCHY`, `OUTLET_SCOPED_ROLES`, `ORDER_STATUS_TRANSITIONS`, pagination defaults.
- **`modules.ts`** — the `TENANT_MODULES` feature-flag registry + `resolveTenantModules` /
  `isModuleEnabled`.
- **`error-codes.ts`** — ~70 `ERR_*` codes.
- **Interfaces/DTOs** — order, member, payment (incl. the `PaymentProvider` gateway interface),
  auth (`JWTPayload`), bay, service, voucher, report.
- **Pure domain logic** (unit-tested, shared front+back) — cart calculator, customer tagging,
  voucher evaluation + code gen, membership quota, void authorization, payment, campaign
  eligibility, report aggregation, employee commission, queue priority/bay assignment.
</content>
