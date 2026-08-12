/**
 * Historical Data Seed — 6 months of per-branch customer & sales history.
 *
 * Generates realistic, tenant-wide operating history for the demo tenant so that
 * every branch-scoped view lights up with live-looking data:
 *   • customers (with join dates spread across the window → CRM + growth chart)
 *   • orders + order_items + order_tags (per branch → revenue, reports, breakdowns)
 *   • memberships + plates + usages for a subset of customers (member metrics, CRM)
 *   • one cashier user per branch (order operator / salesperson attribution)
 *
 * Data is scoped correctly per outlet (branch): each order carries the branch's
 * outlet_id, and services are chosen from those actually available to that branch
 * (regional AIRE pricing via services.outlet_ids, plus tenant-wide fallbacks).
 *
 * Idempotent: everything it creates is tagged (order_number 'SEED-…', customer
 * phone '0899…', cashier email '@seed.aire.local'). Re-running first removes the
 * previous history, so counts never balloon. `0899` is a prefix no Indonesian
 * carrier issues, so it can never collide with a real customer — safe to run
 * against a live database — while still being a NORMAL number, which is what
 * keeps seeded customers findable by phone at the POS.
 *
 * Usage:
 *   pnpm --filter @aire/database seed:history
 *   (or from repo root)  pnpm db:seed:history
 *
 * Tunables (env):
 *   DATABASE_URL              PostgreSQL connection string
 *   TENANT_ID                 target tenant (default demo tenant)
 *   SEED_MONTHS               history window in months          (default 6)
 *   SEED_CUSTOMERS_PER_BRANCH customers created per branch       (default 45)
 *   SEED_MEMBER_RATE          fraction of customers who are members (default 0.25)
 *   SEED_LEAD_RATE            fraction of orders that are LEAD detailing (default 0.06)
 */

import pg from 'pg';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

const { Client } = pg;

const DEMO_TENANT = '11111111-1111-1111-1111-111111111111';
const TENANT_ID = process.env.TENANT_ID || DEMO_TENANT;
const MONTHS = Number(process.env.SEED_MONTHS || 6);
const CUSTOMERS_PER_BRANCH = Number(process.env.SEED_CUSTOMERS_PER_BRANCH || 45);
const MEMBER_RATE = Number(process.env.SEED_MEMBER_RATE || 0.25);
const LEAD_RATE = Number(process.env.SEED_LEAD_RATE || 0.06);
// Every seeded customer's phone starts with this. No Indonesian carrier issues
// 0899, so the idempotent cleanup below can only ever delete rows this seed
// made (this matters when running against a live VPS database) — and unlike the
// old 'SEEDH' marker parked in phone_normalized, it leaves the row a genuinely
// searchable phone number (AIRIN-154).
const SEED_PHONE_PREFIX = '0899';
/** Legacy marker (pre-AIRIN-154 seeds) — still cleaned up so re-runs are safe. */
const SEED_NORM_PREFIX = 'SEEDH';

// ── small helpers ───────────────────────────────────────────────────────────
const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(arr: T[]): T => arr[rand(arr.length)]!;
const chance = (p: number) => Math.random() < p;
const between = (a: number, b: number) => a + rand(b - a + 1);

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function randomDateBetween(start: Date, end: Date): Date {
  const t = start.getTime() + Math.random() * (end.getTime() - start.getTime());
  const d = new Date(t);
  // business hours 08:00–20:00
  d.setHours(between(8, 20), rand(60), rand(60), 0);
  return d;
}

const FIRST = ['Budi', 'Siti', 'Ahmad', 'Dewi', 'Rizky', 'Putri', 'Andi', 'Nur', 'Agus', 'Ratna', 'Eko', 'Maya', 'Fajar', 'Indah', 'Yusuf', 'Lestari', 'Hendra', 'Wati', 'Doni', 'Sari', 'Bayu', 'Fitri', 'Reza', 'Ayu', 'Dimas', 'Rina', 'Arif', 'Mega', 'Teguh', 'Citra'];
const LAST = ['Santoso', 'Wijaya', 'Kusuma', 'Pratama', 'Nugroho', 'Halim', 'Saputra', 'Hidayat', 'Gunawan', 'Permana', 'Utomo', 'Suryadi', 'Wibowo', 'Anggraini', 'Setiawan', 'Maulana', 'Firmansyah', 'Puspita', 'Ramadhan', 'Kurniawan'];
const CAR_BRANDS = ['Toyota', 'Honda', 'Daihatsu', 'Mitsubishi', 'Suzuki', 'Nissan', 'Mazda', 'Hyundai', 'Wuling', 'BMW'];
const CAR_MODELS: Record<string, string[]> = {
  Toyota: ['Avanza', 'Innova', 'Fortuner', 'Rush', 'Yaris'],
  Honda: ['Brio', 'HR-V', 'CR-V', 'Jazz', 'Civic'],
  Daihatsu: ['Xenia', 'Terios', 'Sigra', 'Ayla'],
  Mitsubishi: ['Xpander', 'Pajero', 'Triton'],
  Suzuki: ['Ertiga', 'XL7', 'Ignis'],
  Nissan: ['Livina', 'X-Trail'],
  Mazda: ['CX-5', 'Mazda2'],
  Hyundai: ['Creta', 'Stargazer'],
  Wuling: ['Almaz', 'Confero'],
  BMW: ['320i', 'X3'],
};
const PLATE_LETTERS = 'ABCDEFGHJKLMNPRSTVWXYZ';
function randomPlate(): string {
  const suffix = PLATE_LETTERS[rand(PLATE_LETTERS.length)]! + PLATE_LETTERS[rand(PLATE_LETTERS.length)]! + PLATE_LETTERS[rand(PLATE_LETTERS.length)]!;
  return `B ${between(1, 9999)} ${suffix}`;
}
const PAYMENT_METHODS = ['cash', 'qris', 'bank_transfer'];

interface OutletRow { id: string; name: string; code: string | null; agent_id: string; }
interface ServiceRow { id: string; name: string; price: number; category: string; is_main_service: boolean; }
interface PlanRow { id: string; name: string; max_uses: number; daily_limit: number; duration_months: number; }

// Chunked multi-row insert. columns → array of value-arrays.
async function bulkInsert(client: pg.Client, table: string, columns: string[], rows: unknown[][]): Promise<void> {
  if (rows.length === 0) return;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const tuples = slice.map((r) => {
      const ph = r.map((v) => { params.push(v); return `$${params.length}`; });
      return `(${ph.join(',')})`;
    });
    await client.query(
      `INSERT INTO ${table} (${columns.join(',')}) VALUES ${tuples.join(',')}`,
      params,
    );
  }
}

async function seed(): Promise<void> {
  // Prefer DATABASE_URL. Otherwise fall back to the standard PG* env vars
  // (PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT) — this avoids URL-encoding
  // problems when the DB password contains characters like % : @ / that would
  // corrupt a connection string. Final fallback is the local dev default.
  const client =
    process.env.DATABASE_URL
      ? new Client({ connectionString: process.env.DATABASE_URL })
      : process.env.PGHOST || process.env.PGUSER
        ? new Client()
        : new Client({ connectionString: 'postgresql://aire:aire_secret@localhost:5432/aire' });
  await client.connect();

  try {
    console.log(`\nSeeding ${MONTHS} months of per-branch history for tenant ${TENANT_ID}…\n`);
    const windowStart = daysAgo(MONTHS * 30);
    const now = new Date();

    // ── target branches (all active outlets in the tenant) ──────────────────
    const outlets = (await client.query<OutletRow>(
      `SELECT id, name, code, agent_id FROM outlets WHERE tenant_id = $1 AND is_active = true ORDER BY name`,
      [TENANT_ID],
    )).rows;
    if (outlets.length === 0) throw new Error('No active outlets for tenant — run migrations + seed first.');
    console.log(`  Branches: ${outlets.length} (${outlets.map((o) => o.code || o.name).join(', ')})`);

    // ── idempotent cleanup of any prior seeded history ──────────────────────
    // Order matters: orders first (releases orders.membership_id RESTRICT), then
    // memberships (cascades plates + usages), then customers.
    await client.query(`DELETE FROM orders WHERE tenant_id = $1 AND order_number LIKE 'SEED-%'`, [TENANT_ID]);
    // Matches BOTH markers: the phone prefix used now, and the legacy
    // phone_normalized marker left by seeds that ran before AIRIN-154.
    const seededCustomers = `SELECT id FROM customers WHERE tenant_id = $1 AND (phone LIKE $2 OR phone_normalized LIKE $3)`;
    const seedKeys: [string, string, string] = [
      TENANT_ID, `${SEED_PHONE_PREFIX}%`, `${SEED_NORM_PREFIX}%`,
    ];
    await client.query(
      `DELETE FROM memberships WHERE tenant_id = $1 AND customer_id IN (${seededCustomers})`,
      seedKeys,
    );
    await client.query(
      `DELETE FROM customers WHERE tenant_id = $1 AND (phone LIKE $2 OR phone_normalized LIKE $3)`,
      seedKeys,
    );
    console.log('  ✓ Cleared previous seeded history (if any)');

    // ── one cashier user per branch (order operator / salesperson) ──────────
    const pw = await bcrypt.hash('password123', 10);
    const operatorByOutlet: Record<string, { id: string; name: string }> = {};
    for (const o of outlets) {
      const email = `cashier.${o.agent_id}@seed.aire.local`;
      const name = `Kasir ${o.name}`;
      const res = await client.query<{ id: string }>(
        `INSERT INTO users (tenant_id, outlet_id, email, password_hash, name, role, is_active)
         VALUES ($1, $2, $3, $4, $5, 'cashier', true)
         ON CONFLICT (email) DO UPDATE SET outlet_id = EXCLUDED.outlet_id, name = EXCLUDED.name, is_active = true
         RETURNING id`,
        [TENANT_ID, o.id, email, pw, name],
      );
      operatorByOutlet[o.id] = { id: res.rows[0]!.id, name };
    }
    console.log(`  ✓ Cashier per branch ensured (${outlets.length})`);

    // ── LEAD (detailing) services — tenant-wide, used for a slice of orders ──
    const leadMains = (await client.query<ServiceRow>(
      `SELECT id, name, price::float AS price, category, is_main_service FROM services
       WHERE tenant_id = $1 AND business_unit = 'LEAD' AND is_main_service = true AND is_active = true`,
      [TENANT_ID],
    )).rows;

    let phoneSeq = 0;
    let orderSeq = 0;
    // A REAL normalized phone, matching what normalizePhone() would produce for
    // the display number. The marker used to live in phone_normalized itself,
    // which made every seeded customer invisible to the POS "find by phone"
    // search — the cashier could see a grace/revoked member on screen and still
    // be told "Customer not found" when typing their number (AIRIN-154). The
    // seed's own identity now rides on the reserved `0899` display prefix (see
    // SEED_PHONE_PREFIX), which cleanup keys on instead.
    const nextPhone = () => {
      const n = String(phoneSeq++).padStart(7, '0');
      const display = `${SEED_PHONE_PREFIX}${n}`;
      return { normalized: `62${display.slice(1)}`, display };
    };

    let totalCustomers = 0, totalOrders = 0, totalMembers = 0, grandRevenue = 0;

    for (const o of outlets) {
      // Services available to THIS branch (regional pricing via outlet_ids;
      // tenant-wide services have both outlet_id and outlet_ids NULL).
      const svc = (await client.query<ServiceRow>(
        `SELECT id, name, price::float AS price, category, is_main_service FROM services
         WHERE tenant_id = $1 AND business_unit = 'AIRE' AND is_active = true
           AND outlet_id IS NULL
           AND (outlet_ids IS NULL OR $2 = ANY(outlet_ids))`,
        [TENANT_ID, o.id],
      )).rows;
      const mains = svc.filter((s) => s.is_main_service && s.category === 'car_wash');
      const addons = svc.filter((s) => !s.is_main_service);
      if (mains.length === 0) { console.log(`  ! ${o.name}: no main services available — skipped`); continue; }

      // Membership plans available to this branch.
      const plans = (await client.query<PlanRow>(
        `SELECT id, name, max_uses, daily_limit, duration_months FROM membership_plans
         WHERE tenant_id = $1 AND is_active = true
           AND (outlet_ids IS NULL OR $2 = ANY(outlet_ids))`,
        [TENANT_ID, o.id],
      )).rows;

      const customerRows: unknown[][] = [];
      const membershipRows: unknown[][] = [];
      const plateRows: unknown[][] = [];
      const usageRows: unknown[][] = [];
      const orderRows: unknown[][] = [];
      const itemRows: unknown[][] = [];
      const tagRows: unknown[][] = [];

      for (let c = 0; c < CUSTOMERS_PER_BRANCH; c++) {
        const custId = randomUUID();
        const custName = `${pick(FIRST)} ${pick(LAST)}`;
        const { normalized: phoneNorm, display: phoneDisp } = nextPhone();
        const join = randomDateBetween(windowStart, now);
        customerRows.push([custId, TENANT_ID, custName, phoneDisp, phoneNorm, join, join]);
        totalCustomers++;

        const brand = pick(CAR_BRANDS);
        const model = pick(CAR_MODELS[brand]!);
        const plate = randomPlate();

        // Membership? (only if a plan exists for this branch)
        const isMember = plans.length > 0 && chance(MEMBER_RATE);
        let membership: { id: string; plan: PlanRow } | null = null;
        if (isMember) {
          const plan = pick(plans);
          const memId = randomUUID();
          const startDate = new Date(join);
          const endDate = new Date(join);
          endDate.setMonth(endDate.getMonth() + plan.duration_months);
          const active = endDate > now;
          membership = { id: memId, plan };
          membershipRows.push([
            memId, TENANT_ID, custId, plan.id, active ? 'active' : 'expired',
            startDate.toISOString().slice(0, 10), endDate.toISOString().slice(0, 10),
            0, plan.max_uses, plan.daily_limit, o.id, join, join,
          ]);
          plateRows.push([randomUUID(), memId, plate, plate.replace(/\s/g, ''), brand, model, join]);
          totalMembers++;
        }

        // Visit count grows with tenure; members visit more often.
        const monthsTenure = Math.max(0.5, (now.getTime() - join.getTime()) / (1000 * 60 * 60 * 24 * 30));
        const base = isMember ? 3.2 : 1.4; // visits per month
        let visits = Math.max(1, Math.round(monthsTenure * base * (0.6 + Math.random() * 0.8)));
        visits = Math.min(visits, 60);
        let memberUses = 0;

        for (let v = 0; v < visits; v++) {
          const when = randomDateBetween(join, now);
          const orderId = randomUUID();
          const isLead = leadMains.length > 0 && chance(LEAD_RATE);
          const useMembership =
            membership != null && !isLead && membership.plan.max_uses > memberUses && chance(0.75);

          let subtotal = 0;
          const items: unknown[][] = [];

          if (isLead) {
            const main = pick(leadMains);
            subtotal += main.price;
            items.push([randomUUID(), orderId, main.id, 1, main.price, 0, main.price, false, null, 0]);
          } else {
            const main = pick(mains);
            if (useMembership) {
              // Free member wash: full price discounted to 0.
              items.push([randomUUID(), orderId, main.id, 1, main.price, main.price, 0, true, membership!.id, 0]);
              memberUses++;
            } else {
              subtotal += main.price;
              items.push([randomUUID(), orderId, main.id, 1, main.price, 0, main.price, false, null, 0]);
            }
            // 0–2 add-ons
            const nAdd = between(0, Math.min(2, addons.length));
            const chosen = [...addons].sort(() => Math.random() - 0.5).slice(0, nAdd);
            chosen.forEach((a, idx) => {
              subtotal += a.price;
              items.push([randomUUID(), orderId, a.id, 1, a.price, 0, a.price, false, null, idx + 1]);
            });
          }

          const total = subtotal; // AIRE prices are tax-inclusive; no service charge
          const bu = isLead ? 'LEAD' : 'AIRE';
          const pm = pick(PAYMENT_METHODS);
          const op = operatorByOutlet[o.id]!;
          orderSeq++;
          const orderNumber = `SEED-${o.code || o.agent_id.slice(-3).toUpperCase()}-${String(orderSeq).padStart(6, '0')}`;

          orderRows.push([
            orderId, TENANT_ID, o.id, op.id, custId, orderNumber, 'completed',
            custName, phoneDisp, plate, brand, model,
            subtotal, 0, 0, 0, 0, total, pm, bu, bu, op.name,
            useMembership ? membership!.id : null, '[seed-history]', when, when, when, when,
          ]);
          itemRows.push(...items);
          tagRows.push([randomUUID(), orderId, useMembership ? 'member' : 'regular']);
          if (useMembership) usageRows.push([randomUUID(), membership!.id, plate.replace(/\s/g, ''), orderId, when]);

          totalOrders++;
          grandRevenue += total;
        }

        // Reflect actual uses on the membership row.
        if (membership && memberUses > 0) {
          const idx = membershipRows.findIndex((r) => r[0] === membership!.id);
          if (idx >= 0) membershipRows[idx]![7] = Math.min(memberUses, membership.plan.max_uses);
        }
      }

      // Guarantee "today" is populated for this branch (default dashboard view).
      const op = operatorByOutlet[o.id]!;
      const todayN = between(2, 5);
      for (let k = 0; k < todayN && customerRows.length > 0; k++) {
        const cust = pick(customerRows);
        const orderId = randomUUID();
        const main = pick(mains);
        const when = new Date();
        when.setHours(between(8, Math.max(9, now.getHours())), rand(60), 0, 0);
        orderSeq++;
        const orderNumber = `SEED-${o.code || o.agent_id.slice(-3).toUpperCase()}-${String(orderSeq).padStart(6, '0')}`;
        orderRows.push([
          orderId, TENANT_ID, o.id, op.id, cust[0], orderNumber, 'completed',
          cust[2], cust[3], randomPlate(), pick(CAR_BRANDS), '—',
          main.price, 0, 0, 0, 0, main.price, pick(PAYMENT_METHODS), 'AIRE', 'AIRE', op.name,
          null, '[seed-history]', when, when, when, when,
        ]);
        itemRows.push([randomUUID(), orderId, main.id, 1, main.price, 0, main.price, false, null, 0]);
        tagRows.push([randomUUID(), orderId, 'regular']);
        totalOrders++;
        grandRevenue += main.price;
      }

      // Persist this branch in one transaction.
      await client.query('BEGIN');
      try {
        await bulkInsert(client, 'customers', ['id', 'tenant_id', 'name', 'phone', 'phone_normalized', 'created_at', 'updated_at'], customerRows);
        await bulkInsert(client, 'memberships', ['id', 'tenant_id', 'customer_id', 'plan_id', 'status', 'start_date', 'end_date', 'uses_count', 'max_uses', 'daily_limit', 'home_outlet_id', 'created_at', 'updated_at'], membershipRows);
        await bulkInsert(client, 'membership_plates', ['id', 'membership_id', 'plate', 'plate_normalized', 'brand', 'model', 'created_at'], plateRows);
        await bulkInsert(client, 'orders', ['id', 'tenant_id', 'outlet_id', 'operator_id', 'customer_id', 'order_number', 'status', 'customer_name', 'customer_phone', 'license_plate', 'vehicle_brand', 'vehicle_model', 'subtotal', 'service_charge', 'tax', 'voucher_discount', 'promo_discount', 'total', 'payment_method', 'business_unit', 'payment_channel', 'salesperson_name', 'membership_id', 'note', 'created_at', 'paid_at', 'completed_at', 'updated_at'], orderRows);
        await bulkInsert(client, 'order_items', ['id', 'order_id', 'service_id', 'quantity', 'unit_price', 'discount', 'subtotal', 'is_member_pricing', 'membership_id', 'sort_order'], itemRows);
        await bulkInsert(client, 'order_tags', ['id', 'order_id', 'tag'], tagRows);
        await bulkInsert(client, 'membership_usages', ['id', 'membership_id', 'plate_normalized', 'order_id', 'used_at'], usageRows);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
      console.log(`  ✓ ${o.name}: ${customerRows.length} customers, ${orderRows.length} orders, ${membershipRows.length} members`);
    }

    console.log(`\n✓ History seed complete.`);
    console.log(`  Customers: ${totalCustomers}  |  Orders: ${totalOrders}  |  Members: ${totalMembers}`);
    console.log(`  Total revenue seeded: Rp ${Math.round(grandRevenue).toLocaleString('id-ID')}`);
    console.log(`  Window: ${windowStart.toISOString().slice(0, 10)} → ${now.toISOString().slice(0, 10)}\n`);
  } catch (error) {
    console.error('\n✗ History seed failed:', error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

seed();
