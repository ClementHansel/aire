/**
 * Database Seed Script
 *
 * Populates development database with sample data for testing.
 *
 * Usage:
 *   npx tsx database/seed.ts
 *
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string
 */

import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Client } = pg;

async function seed(): Promise<void> {
  const connectionString =
    process.env.DATABASE_URL ||
    'postgresql://aire:aire_secret@localhost:5432/aire';

  const client = new Client({ connectionString });
  await client.connect();

  try {
    console.log('\nSeeding database...\n');

    // Tenant
    const tenantResult = await client.query(`
      INSERT INTO tenants (id, name, slug, plan, status, settings)
      VALUES (
        '11111111-1111-1111-1111-111111111111',
        'Demo Car Wash',
        'demo-car-wash',
        'standard',
        'active',
        '{"payment_methods": ["cash", "qris", "bank_transfer"]}'::jsonb
      )
      ON CONFLICT (slug) DO NOTHING
      RETURNING id;
    `);
    const tenantId =
      tenantResult.rows[0]?.id || '11111111-1111-1111-1111-111111111111';
    console.log(`  ✓ Tenant: ${tenantId}`);

    // Outlets
    await client.query(`
      INSERT INTO outlets (id, tenant_id, name, agent_id, address, timezone, settings)
      VALUES
        (
          '22222222-2222-2222-2222-222222222201',
          $1,
          'Outlet Sudirman',
          'demo-sudirman',
          'Jl. Jend. Sudirman No. 123, Jakarta',
          'Asia/Jakarta',
          '{"service_charge_pct": 0, "tax_pct": 0, "free_void_window_minutes": 5}'::jsonb
        ),
        (
          '22222222-2222-2222-2222-222222222202',
          $1,
          'Outlet Kemang',
          'demo-kemang',
          'Jl. Kemang Raya No. 45, Jakarta',
          'Asia/Jakarta',
          '{"service_charge_pct": 5, "tax_pct": 11, "free_void_window_minutes": 3}'::jsonb
        )
      ON CONFLICT (agent_id) DO NOTHING;
    `, [tenantId]);
    console.log('  ✓ Outlets created (2)');

    // Users
    // Real bcrypt hashes generated at runtime.
    // Login password: "password123"  |  Admin PIN: "1234"
    const demoPasswordHash = await bcrypt.hash('password123', 10);
    const demoPinHash = await bcrypt.hash('1234', 10);

    await client.query(`
      INSERT INTO users (id, tenant_id, outlet_id, email, password_hash, name, role, admin_pin_hash, is_active)
      VALUES
        (
          '33333333-3333-3333-3333-333333333301',
          $1,
          NULL,
          'owner@demo.com',
          $2,
          'Demo Owner',
          'tenant_owner',
          $3,
          true
        ),
        (
          '33333333-3333-3333-3333-333333333302',
          $1,
          '22222222-2222-2222-2222-222222222201',
          'admin@sudirman.demo.com',
          $2,
          'Admin Sudirman',
          'outlet_admin',
          $3,
          true
        ),
        (
          '33333333-3333-3333-3333-333333333303',
          $1,
          '22222222-2222-2222-2222-222222222201',
          'cashier1@sudirman.demo.com',
          $2,
          'Cashier Budi',
          'cashier',
          NULL,
          true
        ),
        (
          '33333333-3333-3333-3333-333333333304',
          $1,
          NULL,
          'superadmin@aire.com',
          $2,
          'Platform Super Admin',
          'platform_super_admin',
          $3,
          true
        )
      ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = true;
    `, [tenantId, demoPasswordHash, demoPinHash]);
    console.log('  ✓ Users created (4) — owner@demo.com / cashier1@sudirman.demo.com / superadmin@aire.com (all password123)');

    // Services
    await client.query(`
      INSERT INTO services (id, tenant_id, outlet_id, name, category, price, is_active, is_main_service, sort_order)
      VALUES
        ('44444444-4444-4444-4444-444444444401', $1, NULL, 'Express Wash', 'car_wash', 35000, true, true, 1),
        ('44444444-4444-4444-4444-444444444402', $1, NULL, 'Premium Wash', 'car_wash', 55000, true, true, 2),
        ('44444444-4444-4444-4444-444444444403', $1, NULL, 'Super Wash', 'car_wash', 85000, true, true, 3),
        ('44444444-4444-4444-4444-444444444404', $1, NULL, 'Interior Vacuum', 'add_on', 25000, true, false, 4),
        ('44444444-4444-4444-4444-444444444405', $1, NULL, 'Tire Polish', 'add_on', 15000, true, false, 5),
        ('44444444-4444-4444-4444-444444444406', $1, NULL, 'Air Freshener', 'product', 20000, true, false, 6),
        ('44444444-4444-4444-4444-444444444407', $1, NULL, 'Microfiber Cloth', 'product', 35000, true, false, 7)
      ON CONFLICT DO NOTHING;
    `, [tenantId]);
    console.log('  ✓ Services created (7)');

    // Customers
    await client.query(`
      INSERT INTO customers (id, tenant_id, name, phone, phone_normalized)
      VALUES
        ('55555555-5555-5555-5555-555555555501', $1, 'John Doe', '08123456789', '628123456789'),
        ('55555555-5555-5555-5555-555555555502', $1, 'Jane Smith', '08198765432', '628198765432'),
        ('55555555-5555-5555-5555-555555555503', $1, 'Ahmad Rizky', '08111222333', '628111222333')
      ON CONFLICT (tenant_id, phone_normalized) DO NOTHING;
    `, [tenantId]);
    console.log('  ✓ Customers created (3)');

    // Membership Plan
    await client.query(`
      INSERT INTO membership_plans (id, tenant_id, name, duration_months, max_uses, daily_limit, max_plates, price, free_service_ids, is_active)
      VALUES
        (
          '66666666-6666-6666-6666-666666666601',
          $1,
          'Gold Member (30 washes)',
          3,
          30,
          1,
          3,
          500000,
          ARRAY['44444444-4444-4444-4444-444444444401'::uuid, '44444444-4444-4444-4444-444444444402'::uuid],
          true
        ),
        (
          '66666666-6666-6666-6666-666666666602',
          $1,
          'Silver Member (15 washes)',
          1,
          15,
          1,
          2,
          275000,
          ARRAY['44444444-4444-4444-4444-444444444401'::uuid],
          true
        )
      ON CONFLICT DO NOTHING;
    `, [tenantId]);
    console.log('  ✓ Membership plans created (2)');

    // Voucher Templates (sellable packs)
    await client.query(`
      INSERT INTO voucher_templates
        (id, tenant_id, name, type, value, max_uses, sale_price, validity_days, service_ids, min_order_amount, is_active)
      VALUES
        (
          '88888888-8888-8888-8888-888888888801',
          $1,
          '10x Express Wash Pack',
          'service_pack',
          0,
          10,
          300000,
          180,
          ARRAY['44444444-4444-4444-4444-444444444401'::uuid],
          0,
          true
        ),
        (
          '88888888-8888-8888-8888-888888888802',
          $1,
          'Rp 25.000 Discount x5',
          'fixed',
          25000,
          5,
          100000,
          90,
          NULL,
          50000,
          true
        ),
        (
          '88888888-8888-8888-8888-888888888803',
          $1,
          '20% Off x3',
          'percentage',
          20,
          3,
          50000,
          60,
          NULL,
          0,
          true
        )
      ON CONFLICT DO NOTHING;
    `, [tenantId]);
    console.log('  ✓ Voucher templates created (3)');

    // Bays
    await client.query(`
      INSERT INTO bays (id, tenant_id, outlet_id, name, status)
      VALUES
        ('77777777-7777-7777-7777-777777777701', $1, '22222222-2222-2222-2222-222222222201', 'Bay 1', 'available'),
        ('77777777-7777-7777-7777-777777777702', $1, '22222222-2222-2222-2222-222222222201', 'Bay 2', 'available'),
        ('77777777-7777-7777-7777-777777777703', $1, '22222222-2222-2222-2222-222222222201', 'Bay 3', 'maintenance')
      ON CONFLICT DO NOTHING;
    `, [tenantId]);
    console.log('  ✓ Bays created (3)');

    console.log('\n✓ Seed completed successfully.\n');
  } catch (error) {
    console.error('\n✗ Seed failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

seed();
