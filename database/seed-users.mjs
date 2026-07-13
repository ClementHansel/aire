import bcrypt from 'bcryptjs';
import pg from 'pg';

const TENANT = '11111111-1111-1111-1111-111111111111';
const OUTLET = 'cc769334-fb07-4044-be01-7fc4ad5c94bd'; // AIRE Bintaro

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL || 'postgresql://aire:aire_secret@localhost:5432/aire',
});

const pw = await bcrypt.hash('password123', 10);
const pin = await bcrypt.hash('1234', 10);

await client.connect();
const users = [
  ['owner@demo.com', 'Demo Owner', 'tenant_owner', null],
  ['superadmin@aire.com', 'Platform Admin', 'platform_super_admin', null],
  ['cashier1@sudirman.demo.com', 'Cashier Budi', 'cashier', OUTLET],
];
for (const [email, name, role, outlet] of users) {
  await client.query(
    `INSERT INTO users (tenant_id, outlet_id, email, password_hash, name, role, admin_pin_hash, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, is_active = true`,
    [TENANT, outlet, email, pw, name, role, pin],
  );
  console.log('user:', email, role);
}
await client.end();
console.log('done');
