-- seed-demo-full.sql - Comprehensive demo-tenant seed (tenant 11111111-1111-1111-1111-111111111111).
-- Populates every module the base seeds leave empty: HR/payroll, inventory/COGS,
-- procurement, finance/accounting, sales/CRM/marketing, feedback/refunds/tax/broadcast,
-- legal entities, bookings, order status logs, and the voucher system.
-- Run AFTER migrations + seed.ts + seed-history.ts. Idempotent (guards on existing rows).
--   cat database/seed-demo-full.sql | docker exec -i aire-postgres psql -U aire -d aire -v ON_ERROR_STOP=1

BEGIN;

-- =====================  HR / PAYROLL  =====================
-- Links every staff login (cashier/outlet_admin/tenant_owner) to an employees
-- row. WITHOUT THIS, cashier login lands on /employee and GET /me/home 403s
-- ("This login is not linked to an employee record").
INSERT INTO employees (tenant_id, outlet_id, name, role, phone, email, salary, status, hired_at, employment_type, user_id)
SELECT u.tenant_id, u.outlet_id, u.name,
       CASE u.role WHEN 'cashier' THEN 'Cashier' WHEN 'outlet_admin' THEN 'Outlet Admin'
                   WHEN 'tenant_owner' THEN 'Owner' ELSE 'Staff' END,
       '0812' || lpad((row_number() OVER (ORDER BY u.email))::text, 8, '0'),
       u.email,
       CASE u.role WHEN 'cashier' THEN 4500000 WHEN 'outlet_admin' THEN 8000000
                   WHEN 'tenant_owner' THEN 15000000 ELSE 5000000 END,
       'active', DATE '2025-02-01', 'permanent', u.id
FROM users u
WHERE u.tenant_id = '11111111-1111-1111-1111-111111111111'
  AND u.role IN ('cashier','outlet_admin','tenant_owner')
  AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.tenant_id = u.tenant_id AND e.user_id = u.id);

INSERT INTO roles (tenant_id, name, description, base_role, permissions, is_system)
SELECT '11111111-1111-1111-1111-111111111111', v.name, v.description, v.base_role, '[]'::jsonb, false
FROM (VALUES
  ('Kasir', 'Front-desk cashier', 'cashier'),
  ('Supervisor Cabang', 'Branch supervisor', 'outlet_admin'),
  ('Manajer Area', 'Multi-branch area manager', 'outlet_admin')
) AS v(name, description, base_role)
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id = '11111111-1111-1111-1111-111111111111');

INSERT INTO holidays (tenant_id, holiday_date, name, is_paid)
SELECT '11111111-1111-1111-1111-111111111111', v.d::date, v.name, true
FROM (VALUES
  ('2026-01-01','Tahun Baru Masehi'), ('2026-03-19','Hari Raya Nyepi'),
  ('2026-03-20','Idul Fitri'), ('2026-03-21','Idul Fitri (Cuti Bersama)'),
  ('2026-05-01','Hari Buruh'), ('2026-05-27','Idul Adha'),
  ('2026-06-01','Hari Lahir Pancasila'), ('2026-08-17','Hari Kemerdekaan RI'),
  ('2026-12-25','Hari Raya Natal')
) AS v(d, name)
WHERE NOT EXISTS (SELECT 1 FROM holidays WHERE tenant_id = '11111111-1111-1111-1111-111111111111');

INSERT INTO employee_schedules (tenant_id, employee_id, outlet_id, work_date, start_time, end_time)
SELECT e.tenant_id, e.id, e.outlet_id, d::date, TIME '08:00', TIME '17:00'
FROM employees e
CROSS JOIN generate_series(CURRENT_DATE - 1, CURRENT_DATE + 6, INTERVAL '1 day') d
WHERE e.tenant_id = '11111111-1111-1111-1111-111111111111' AND EXTRACT(DOW FROM d) <> 0
  AND NOT EXISTS (SELECT 1 FROM employee_schedules WHERE tenant_id = '11111111-1111-1111-1111-111111111111');

INSERT INTO attendance_records (tenant_id, employee_id, work_date, check_in, check_out, status, hours_worked)
SELECT e.tenant_id, e.id, d::date,
       (d::date + TIME '08:05') AT TIME ZONE 'Asia/Jakarta',
       (d::date + TIME '17:02') AT TIME ZONE 'Asia/Jakarta', 'present', 8.5
FROM employees e
CROSS JOIN generate_series(CURRENT_DATE - 21, CURRENT_DATE - 1, INTERVAL '1 day') d
WHERE e.tenant_id = '11111111-1111-1111-1111-111111111111' AND EXTRACT(DOW FROM d) <> 0
  AND NOT EXISTS (SELECT 1 FROM attendance_records WHERE tenant_id = '11111111-1111-1111-1111-111111111111');

INSERT INTO leave_requests (tenant_id, employee_id, start_date, end_date, type, reason, status, paid, resolved_at)
SELECT '11111111-1111-1111-1111-111111111111', e.id, CURRENT_DATE - 30, CURRENT_DATE - 28, 'annual', 'Family event', 'approved', true, (CURRENT_DATE - 32)::timestamptz
FROM employees e WHERE e.tenant_id = '11111111-1111-1111-1111-111111111111' AND e.role = 'Cashier'
  AND NOT EXISTS (SELECT 1 FROM leave_requests WHERE tenant_id = '11111111-1111-1111-1111-111111111111')
ORDER BY e.email LIMIT 1;

INSERT INTO leave_requests (tenant_id, employee_id, start_date, end_date, type, reason, status, paid)
SELECT '11111111-1111-1111-1111-111111111111', e.id, CURRENT_DATE + 10, CURRENT_DATE + 11, 'sick', 'Medical checkup', 'pending', true
FROM employees e WHERE e.tenant_id = '11111111-1111-1111-1111-111111111111' AND e.role = 'Cashier'
  AND (SELECT count(*) FROM leave_requests WHERE tenant_id = '11111111-1111-1111-1111-111111111111') = 1
ORDER BY e.email OFFSET 1 LIMIT 1;

WITH loan AS (
  INSERT INTO employee_loans (tenant_id, employee_id, principal, balance, monthly_installment, reason, status)
  SELECT '11111111-1111-1111-1111-111111111111', e.id, 3000000, 2500000, 500000, 'Cash advance', 'active'
  FROM employees e WHERE e.tenant_id = '11111111-1111-1111-1111-111111111111' AND e.role = 'Cashier'
    AND NOT EXISTS (SELECT 1 FROM employee_loans WHERE tenant_id = '11111111-1111-1111-1111-111111111111')
  ORDER BY e.email LIMIT 1 RETURNING id
)
INSERT INTO loan_repayments (tenant_id, loan_id, amount, period, method)
SELECT '11111111-1111-1111-1111-111111111111', loan.id, 500000, to_char(CURRENT_DATE - INTERVAL '1 month', 'YYYY-MM'), 'payroll' FROM loan;

WITH run AS (
  INSERT INTO payroll_runs (tenant_id, period, status, working_days, employee_count, total_gross, total_net, finalized_at)
  SELECT '11111111-1111-1111-1111-111111111111', to_char(CURRENT_DATE - INTERVAL '1 month', 'YYYY-MM'), 'finalized', 26,
         (SELECT count(*) FROM employees WHERE tenant_id = '11111111-1111-1111-1111-111111111111'),
         (SELECT COALESCE(sum(salary),0) FROM employees WHERE tenant_id = '11111111-1111-1111-1111-111111111111'),
         (SELECT COALESCE(sum(salary),0) FROM employees WHERE tenant_id = '11111111-1111-1111-1111-111111111111'),
         (CURRENT_DATE - 5)::timestamptz
  WHERE NOT EXISTS (SELECT 1 FROM payroll_runs WHERE tenant_id = '11111111-1111-1111-1111-111111111111')
  RETURNING id
)
INSERT INTO payslips (payroll_run_id, tenant_id, employee_id, employee_name, base_salary,
                      scheduled_days, days_worked, unpaid_leave_days, bonus_total, deduction_total,
                      advance_total, loan_repayment_total, unpaid_leave_deduction, gross_pay, net_pay)
SELECT run.id, e.tenant_id, e.id, e.name, e.salary, 26, 26, 0,
       CASE WHEN e.role = 'Cashier' THEN 250000 ELSE 0 END, 0, 0, 0, 0,
       e.salary + CASE WHEN e.role = 'Cashier' THEN 250000 ELSE 0 END,
       e.salary + CASE WHEN e.role = 'Cashier' THEN 250000 ELSE 0 END
FROM run CROSS JOIN employees e WHERE e.tenant_id = '11111111-1111-1111-1111-111111111111';

INSERT INTO employee_shifts (tenant_id, outlet_id, user_id, clock_in, clock_out, scheduled_start, scheduled_end)
SELECT e.tenant_id, e.outlet_id, e.user_id,
       (d::date + TIME '08:03') AT TIME ZONE 'Asia/Jakarta', (d::date + TIME '17:01') AT TIME ZONE 'Asia/Jakarta',
       (d::date + TIME '08:00') AT TIME ZONE 'Asia/Jakarta', (d::date + TIME '17:00') AT TIME ZONE 'Asia/Jakarta'
FROM employees e
CROSS JOIN generate_series(CURRENT_DATE - 3, CURRENT_DATE - 1, INTERVAL '1 day') d
WHERE e.tenant_id = '11111111-1111-1111-1111-111111111111' AND e.role = 'Cashier' AND e.outlet_id IS NOT NULL
  AND EXTRACT(DOW FROM d) <> 0
  AND NOT EXISTS (SELECT 1 FROM employee_shifts WHERE tenant_id = '11111111-1111-1111-1111-111111111111');

-- ===== INVENTORY / COGS =====
-- 1. product_categories
INSERT INTO product_categories (tenant_id, name, sort_order, is_active, applies_to)
SELECT '11111111-1111-1111-1111-111111111111', v.name, v.sort_order, true, 'product'
FROM (VALUES
  ('Chemicals', 1),
  ('Cloths & Towels', 2),
  ('Consumables', 3),
  ('Coating Supplies', 4),
  ('Equipment', 5)
) AS v(name, sort_order)
ON CONFLICT (tenant_id, name) DO NOTHING;

-- 2. inventory_items (stocked at Outlet Sudirman)
INSERT INTO inventory_items (tenant_id, outlet_id, sku, name, category, unit, quantity, reorder_level, unit_cost)
SELECT '11111111-1111-1111-1111-111111111111', o.id,
       v.sku, v.name, v.category, v.unit, v.quantity, v.reorder_level, v.unit_cost
FROM (VALUES
  ('CHM-SHMP-01', 'Car Shampoo (Snow Foam)', 'Chemicals',        'liter', 120.00,  20.00, 45000.00),
  ('CHM-WAX-01',  'Carnauba Liquid Wax',      'Chemicals',        'liter',  40.00,  10.00, 85000.00),
  ('CHM-TIRE-01', 'Tire Foam / Tire Shine',   'Chemicals',        'liter',  30.00,   8.00, 60000.00),
  ('CHM-GLAS-01', 'Glass Cleaner',            'Chemicals',        'liter',  50.00,  10.00, 35000.00),
  ('CHM-INT-01',  'Interior Cleaner',         'Chemicals',        'liter',  35.00,   8.00, 40000.00),
  ('CHM-DEG-01',  'Engine Degreaser',         'Chemicals',        'liter',  25.00,   6.00, 55000.00),
  ('CLT-MICRO-01','Microfiber Cloth',         'Cloths & Towels',  'pcs',   300.00,  50.00, 15000.00),
  ('CLT-DRY-01',  'Drying Towel (Large)',     'Cloths & Towels',  'pcs',   150.00,  30.00, 25000.00),
  ('CON-AIR-01',  'Air Freshener',            'Consumables',      'pcs',   200.00,  40.00,  8000.00),
  ('CON-APRON-01','Applicator Sponge',        'Consumables',      'pcs',   180.00,  40.00,  5000.00),
  ('COT-CER9H-01','Ceramic Coating 9H',       'Coating Supplies', 'ml',   5000.00,1000.00,  1200.00)
) AS v(sku, name, category, unit, quantity, reorder_level, unit_cost)
CROSS JOIN (SELECT id FROM outlets WHERE tenant_id = '11111111-1111-1111-1111-111111111111' AND name = 'Outlet Sudirman') o
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE tenant_id = '11111111-1111-1111-1111-111111111111');

-- 3. uom_conversions
INSERT INTO uom_conversions (tenant_id, inventory_item_id, from_unit, to_unit, factor)
SELECT '11111111-1111-1111-1111-111111111111', ii.id, v.from_unit, v.to_unit, v.factor
FROM (VALUES
  ('Car Shampoo (Snow Foam)', 'drum',    'liter', 200.000000),
  ('Car Shampoo (Snow Foam)', 'ml',      'liter',   0.001000),
  ('Carnauba Liquid Wax',     'carton',  'liter',  12.000000),
  ('Tire Foam / Tire Shine',  'carton',  'liter',  12.000000),
  ('Glass Cleaner',           'carton',  'liter',  12.000000),
  ('Microfiber Cloth',        'box',     'pcs',    50.000000),
  ('Drying Towel (Large)',    'box',     'pcs',    20.000000),
  ('Ceramic Coating 9H',      'bottle',  'ml',     50.000000)
) AS v(item_name, from_unit, to_unit, factor)
JOIN inventory_items ii ON ii.tenant_id = '11111111-1111-1111-1111-111111111111' AND ii.name = v.item_name
ON CONFLICT (inventory_item_id, from_unit, to_unit) DO NOTHING;

-- 4. inventory_movements
INSERT INTO inventory_movements (tenant_id, item_id, type, quantity, reason, reference, actor)
SELECT '11111111-1111-1111-1111-111111111111', ii.id, v.type, v.quantity, v.reason, v.reference, v.actor
FROM (VALUES
  ('Car Shampoo (Snow Foam)', 'in',  150.00, 'Opening purchase from supplier', 'PO-2026-0012', 'Demo Owner'),
  ('Car Shampoo (Snow Foam)', 'out',  30.00, 'Consumed by wash operations',    'USAGE-2026-06', 'Kasir Outlet Sudirman'),
  ('Carnauba Liquid Wax',     'in',   48.00, 'Purchase - 4 cartons',           'PO-2026-0012', 'Demo Owner'),
  ('Carnauba Liquid Wax',     'out',   8.00, 'Consumed by premium washes',     'USAGE-2026-06', 'Kasir Outlet Sudirman'),
  ('Microfiber Cloth',        'in',  350.00, 'Purchase - 7 boxes',             'PO-2026-0013', 'Demo Owner'),
  ('Microfiber Cloth',        'out',  50.00, 'Worn out / replaced',            'USAGE-2026-06', 'Kasir Outlet Sudirman'),
  ('Glass Cleaner',           'in',   60.00, 'Purchase - 5 cartons',           'PO-2026-0013', 'Demo Owner'),
  ('Tire Foam / Tire Shine',  'in',   36.00, 'Purchase - 3 cartons',           'PO-2026-0013', 'Demo Owner'),
  ('Ceramic Coating 9H',      'in', 5000.00, 'Purchase - 100 bottles',         'PO-2026-0014', 'Demo Owner'),
  ('Ceramic Coating 9H',      'adjustment', -50.00, 'Spillage during coating job', 'ADJ-2026-06', 'Demo Owner')
) AS v(item_name, type, quantity, reason, reference, actor)
JOIN inventory_items ii ON ii.tenant_id = '11111111-1111-1111-1111-111111111111' AND ii.name = v.item_name
WHERE NOT EXISTS (SELECT 1 FROM inventory_movements WHERE tenant_id = '11111111-1111-1111-1111-111111111111');

-- 5. cost_component_types
INSERT INTO cost_component_types (tenant_id, name, kind, is_active)
SELECT '11111111-1111-1111-1111-111111111111', v.name, v.kind, true
FROM (VALUES
  ('Labor',                   'fixed'),
  ('Electricity',             'fixed'),
  ('Water',                   'fixed'),
  ('Rent Allocation',         'fixed'),
  ('Payment Processing Fee',  'percentage')
) AS v(name, kind)
WHERE NOT EXISTS (SELECT 1 FROM cost_component_types WHERE tenant_id = '11111111-1111-1111-1111-111111111111');

-- 6. service_cost_components
INSERT INTO service_cost_components (tenant_id, service_id, component_type_id, value)
SELECT '11111111-1111-1111-1111-111111111111', s.id, cct.id, v.value
FROM (VALUES
  ('Labor',                  15000.0000),
  ('Electricity',             2500.0000),
  ('Water',                   3500.0000),
  ('Rent Allocation',         5000.0000),
  ('Payment Processing Fee',     2.0000)
) AS v(cname, value)
JOIN cost_component_types cct
  ON cct.tenant_id = '11111111-1111-1111-1111-111111111111' AND cct.name = v.cname
JOIN services s
  ON s.tenant_id = '11111111-1111-1111-1111-111111111111'
 AND s.category = 'car_wash'
 AND s.is_main_service = true
ON CONFLICT (service_id, component_type_id) DO NOTHING;

-- 7. service_recipe_components
INSERT INTO service_recipe_components (tenant_id, service_id, inventory_item_id, quantity, unit)
SELECT '11111111-1111-1111-1111-111111111111', s.id, ii.id, v.quantity, v.unit
FROM (VALUES
  ('Express Wash', 'Car Shampoo (Snow Foam)', 0.1500, 'liter'),
  ('Express Wash', 'Microfiber Cloth',        1.0000, 'pcs'),
  ('Premium Wash', 'Car Shampoo (Snow Foam)', 0.2500, 'liter'),
  ('Premium Wash', 'Tire Foam / Tire Shine',  0.0500, 'liter'),
  ('Premium Wash', 'Microfiber Cloth',        2.0000, 'pcs'),
  ('Super Wash',   'Car Shampoo (Snow Foam)', 0.3000, 'liter'),
  ('Super Wash',   'Carnauba Liquid Wax',     0.0500, 'liter'),
  ('Super Wash',   'Glass Cleaner',           0.0500, 'liter'),
  ('Super Wash',   'Microfiber Cloth',        2.0000, 'pcs'),
  ('Standard',     'Car Shampoo (Snow Foam)', 0.2000, 'liter'),
  ('Standard',     'Microfiber Cloth',        1.0000, 'pcs'),
  ('Exterior',     'Car Shampoo (Snow Foam)', 0.1800, 'liter'),
  ('Exterior',     'Tire Foam / Tire Shine',  0.0500, 'liter'),
  ('Complete',     'Car Shampoo (Snow Foam)', 0.3000, 'liter'),
  ('Complete',     'Interior Cleaner',        0.1000, 'liter'),
  ('Complete',     'Glass Cleaner',           0.0500, 'liter'),
  ('Complete',     'Microfiber Cloth',        2.0000, 'pcs'),
  ('Premium',      'Car Shampoo (Snow Foam)', 0.2500, 'liter'),
  ('Premium',      'Carnauba Liquid Wax',     0.0400, 'liter'),
  ('Premium',      'Microfiber Cloth',        2.0000, 'pcs')
) AS v(service_name, item_name, quantity, unit)
JOIN services s
  ON s.tenant_id = '11111111-1111-1111-1111-111111111111'
 AND s.category = 'car_wash'
 AND s.name = v.service_name
JOIN inventory_items ii
  ON ii.tenant_id = '11111111-1111-1111-1111-111111111111' AND ii.name = v.item_name
ON CONFLICT (service_id, inventory_item_id) DO NOTHING;

-- 8. stock_opname + stock_opname_items
WITH new_op AS (
  INSERT INTO stock_opname (tenant_id, outlet_id, status, note, created_by, closed_at)
  SELECT '11111111-1111-1111-1111-111111111111', o.id, 'closed',
         'Monthly physical stock count - June 2026', emp.id, now() - interval '2 days'
  FROM (SELECT id FROM outlets WHERE tenant_id = '11111111-1111-1111-1111-111111111111' AND name = 'Outlet Sudirman') o
  CROSS JOIN (SELECT id FROM employees WHERE tenant_id = '11111111-1111-1111-1111-111111111111' AND name = 'Demo Owner') emp
  WHERE NOT EXISTS (SELECT 1 FROM stock_opname WHERE tenant_id = '11111111-1111-1111-1111-111111111111')
  RETURNING id
)
INSERT INTO stock_opname_items (opname_id, inventory_item_id, expected_qty, counted_qty, unit_cost, variance, variance_value)
SELECT op.id, ii.id, v.expected_qty, v.counted_qty, ii.unit_cost,
       (v.counted_qty - v.expected_qty),
       (v.counted_qty - v.expected_qty) * ii.unit_cost
FROM new_op op
CROSS JOIN (VALUES
  ('Car Shampoo (Snow Foam)', 120.0000, 118.0000),
  ('Carnauba Liquid Wax',      40.0000,  40.0000),
  ('Tire Foam / Tire Shine',   30.0000,  29.0000),
  ('Glass Cleaner',            50.0000,  51.0000),
  ('Microfiber Cloth',        300.0000, 292.0000),
  ('Drying Towel (Large)',    150.0000, 150.0000),
  ('Ceramic Coating 9H',     5000.0000,4950.0000)
) AS v(item_name, expected_qty, counted_qty)
JOIN inventory_items ii
  ON ii.tenant_id = '11111111-1111-1111-1111-111111111111' AND ii.name = v.item_name;

-- ===== PROCUREMENT =====
-- brands (product-label taxonomy; applies_to='product')
INSERT INTO brands (tenant_id, code, name, color, applies_to, is_active)
SELECT '11111111-1111-1111-1111-111111111111', v.code, v.name, v.color, 'product', true
FROM (VALUES
  ('CHEM',  'ChemPro Wash',   '#1652F0'),
  ('MICRO', 'MicroFiber Co',  '#0EA5E9'),
  ('EQUIP', 'AquaEquip',      '#F59E0B')
) AS v(code, name, color)
WHERE NOT EXISTS (
  SELECT 1 FROM brands b
  WHERE b.tenant_id = '11111111-1111-1111-1111-111111111111' AND b.code = v.code
);

-- suppliers
INSERT INTO suppliers (tenant_id, name, contact_name, phone, email, address, is_active)
SELECT '11111111-1111-1111-1111-111111111111', v.name, v.contact_name, v.phone, v.email, v.address, true
FROM (VALUES
  ('PT Kimia Bersih Nusantara', 'Budi Santoso',  '+62215550101', 'sales@kimiabersih.co.id',   'Jl. Industri Raya No. 12, Bekasi'),
  ('CV Lap Microfiber Jaya',    'Siti Rahayu',   '+62215550202', 'order@microfiberjaya.co.id','Jl. Tekstil No. 8, Bandung'),
  ('PT Alat Cuci Mandiri',      'Andi Wijaya',   '+62215550303', 'info@alatcuci.co.id',       'Jl. Mesin No. 45, Surabaya'),
  ('UD Sabun Kilat',            'Rina Kartika',  '+62215550404', 'cs@sabunkilat.co.id',       'Jl. Kimia No. 3, Tangerang')
) AS v(name, contact_name, phone, email, address)
WHERE NOT EXISTS (
  SELECT 1 FROM suppliers s
  WHERE s.tenant_id = '11111111-1111-1111-1111-111111111111' AND s.name = v.name
);

-- purchase_orders (PO-1 received, PO-2 ordered, PO-3 draft)
INSERT INTO purchase_orders (tenant_id, supplier_id, po_number, status, total, notes, received_at)
SELECT '11111111-1111-1111-1111-111111111111',
       (SELECT id FROM suppliers WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND name='PT Kimia Bersih Nusantara'),
       'PO-2026-0001', 'received', 7500000.00, 'Restok sabun & shampoo bulanan', now() - interval '5 days'
WHERE NOT EXISTS (SELECT 1 FROM purchase_orders WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND po_number='PO-2026-0001');

INSERT INTO purchase_orders (tenant_id, supplier_id, po_number, status, total, notes)
SELECT '11111111-1111-1111-1111-111111111111',
       (SELECT id FROM suppliers WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND name='CV Lap Microfiber Jaya'),
       'PO-2026-0002', 'ordered', 3200000.00, 'Order kain microfiber & handuk'
WHERE NOT EXISTS (SELECT 1 FROM purchase_orders WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND po_number='PO-2026-0002');

INSERT INTO purchase_orders (tenant_id, supplier_id, po_number, status, total, notes)
SELECT '11111111-1111-1111-1111-111111111111',
       (SELECT id FROM suppliers WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND name='PT Alat Cuci Mandiri'),
       'PO-2026-0003', 'draft', 12500000.00, 'Draft pengadaan mesin high-pressure'
WHERE NOT EXISTS (SELECT 1 FROM purchase_orders WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND po_number='PO-2026-0003');

-- purchase_order_items (item_id NULL; free-text description)
INSERT INTO purchase_order_items (po_id, item_id, description, quantity, unit_cost, subtotal, received_quantity)
SELECT po.id, NULL, v.description, v.quantity, v.unit_cost, v.subtotal, v.received_quantity
FROM (SELECT id FROM purchase_orders WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND po_number='PO-2026-0001') po
CROSS JOIN (VALUES
  ('Shampoo mobil 20L',        50::numeric, 90000::numeric, 4500000::numeric, 50::numeric),
  ('Sabun busa foam 5L',       40::numeric, 50000::numeric, 2000000::numeric, 40::numeric),
  ('Cairan pengkilap ban 1L',  50::numeric, 20000::numeric, 1000000::numeric, 50::numeric)
) AS v(description, quantity, unit_cost, subtotal, received_quantity)
WHERE NOT EXISTS (SELECT 1 FROM purchase_order_items i WHERE i.po_id = po.id);

INSERT INTO purchase_order_items (po_id, item_id, description, quantity, unit_cost, subtotal, received_quantity)
SELECT po.id, NULL, v.description, v.quantity, v.unit_cost, v.subtotal, 0
FROM (SELECT id FROM purchase_orders WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND po_number='PO-2026-0002') po
CROSS JOIN (VALUES
  ('Kain microfiber 40x40cm', 200::numeric, 12000::numeric, 2400000::numeric),
  ('Handuk chamois besar',     40::numeric, 20000::numeric,  800000::numeric)
) AS v(description, quantity, unit_cost, subtotal)
WHERE NOT EXISTS (SELECT 1 FROM purchase_order_items i WHERE i.po_id = po.id);

INSERT INTO purchase_order_items (po_id, item_id, description, quantity, unit_cost, subtotal, received_quantity)
SELECT po.id, NULL, v.description, v.quantity, v.unit_cost, v.subtotal, 0
FROM (SELECT id FROM purchase_orders WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND po_number='PO-2026-0003') po
CROSS JOIN (VALUES
  ('Mesin steam high-pressure',   2::numeric, 5000000::numeric, 10000000::numeric),
  ('Vacuum cleaner basah-kering', 5::numeric,  500000::numeric,  2500000::numeric)
) AS v(description, quantity, unit_cost, subtotal)
WHERE NOT EXISTS (SELECT 1 FROM purchase_order_items i WHERE i.po_id = po.id);

-- goods_receipts (fulfilling PO-2026-0001)
INSERT INTO goods_receipts (tenant_id, po_id, grn_number, notes, received_at)
SELECT '11111111-1111-1111-1111-111111111111',
       (SELECT id FROM purchase_orders WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND po_number='PO-2026-0001'),
       'GRN-2026-0001', 'Penerimaan penuh untuk PO-2026-0001', now() - interval '5 days'
WHERE NOT EXISTS (SELECT 1 FROM goods_receipts WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND grn_number='GRN-2026-0001');

-- goods_receipt_items
INSERT INTO goods_receipt_items (grn_id, po_item_id, quantity, unit_cost)
SELECT grn.id, poi.id, poi.quantity, poi.unit_cost
FROM (SELECT id FROM goods_receipts WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND grn_number='GRN-2026-0001') grn
JOIN purchase_order_items poi
  ON poi.po_id = (SELECT id FROM purchase_orders WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND po_number='PO-2026-0001')
WHERE NOT EXISTS (SELECT 1 FROM goods_receipt_items gi WHERE gi.grn_id = grn.id);

-- ===== FINANCE / ACCOUNTING =====
-- 1) chart_of_accounts
INSERT INTO chart_of_accounts (tenant_id, code, name, type, normal_balance, is_system, is_active) VALUES
  ('11111111-1111-1111-1111-111111111111','1000','Kas','asset','debit',true,true),
  ('11111111-1111-1111-1111-111111111111','1010','Bank','asset','debit',true,true),
  ('11111111-1111-1111-1111-111111111111','1100','Piutang Usaha','asset','debit',false,true),
  ('11111111-1111-1111-1111-111111111111','1300','Persediaan','asset','debit',true,true),
  ('11111111-1111-1111-1111-111111111111','1400','Piutang Antar-Cabang','asset','debit',true,true),
  ('11111111-1111-1111-1111-111111111111','2000','Utang Usaha','liability','credit',true,true),
  ('11111111-1111-1111-1111-111111111111','2100','Utang Antar-Cabang','liability','credit',true,true),
  ('11111111-1111-1111-1111-111111111111','2200','Utang Gaji','liability','credit',true,true),
  ('11111111-1111-1111-1111-111111111111','2300','Utang Pajak (PPN)','liability','credit',true,true),
  ('11111111-1111-1111-1111-111111111111','3000','Modal Pemilik','equity','credit',true,true),
  ('11111111-1111-1111-1111-111111111111','3900','Laba Ditahan','equity','credit',true,true),
  ('11111111-1111-1111-1111-111111111111','4000','Pendapatan Jasa','revenue','credit',true,true),
  ('11111111-1111-1111-1111-111111111111','4800','Pendapatan Antar-Cabang','revenue','credit',true,true),
  ('11111111-1111-1111-1111-111111111111','4900','Pendapatan Lain-lain','revenue','credit',true,true),
  ('11111111-1111-1111-1111-111111111111','5000','Harga Pokok Penjualan (HPP)','expense','debit',true,true),
  ('11111111-1111-1111-1111-111111111111','6000','Beban Operasional','expense','debit',true,true),
  ('11111111-1111-1111-1111-111111111111','6100','Beban Gaji','expense','debit',true,true),
  ('11111111-1111-1111-1111-111111111111','6110','Beban Listrik','expense','debit',false,true),
  ('11111111-1111-1111-1111-111111111111','6120','Beban Air','expense','debit',false,true),
  ('11111111-1111-1111-1111-111111111111','6130','Beban Sewa','expense','debit',false,true),
  ('11111111-1111-1111-1111-111111111111','6140','Beban Perlengkapan','expense','debit',false,true),
  ('11111111-1111-1111-1111-111111111111','6300','Beban Antar-Cabang','expense','debit',true,true)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- 2) accounting_periods
INSERT INTO accounting_periods (tenant_id, period, status, closed_at, closed_by) VALUES
  ('11111111-1111-1111-1111-111111111111','2026-06','closed','2026-07-03 09:00:00+07','33333333-3333-3333-3333-333333333301'),
  ('11111111-1111-1111-1111-111111111111','2026-07','open',NULL,NULL)
ON CONFLICT (tenant_id, period) DO NOTHING;

-- 3) tenant_finance_settings
INSERT INTO tenant_finance_settings
  (tenant_id, payroll_working_days, payroll_pay_day, auto_run_payroll, auto_close_books,
   tax_enabled, tax_rate, opening_balances_posted, provisioned_at)
VALUES
  ('11111111-1111-1111-1111-111111111111', 26, 25, false, false, true, 11.00, true, NOW())
ON CONFLICT (tenant_id) DO NOTHING;

-- 4) journal_entries
INSERT INTO journal_entries (id, tenant_id, outlet_id, entry_date, memo, source_type, source_id, status, created_by) VALUES
  ('e1111111-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','2026-07-10','POS sale','order','f0000000-0000-0000-0000-000000000001','posted','33333333-3333-3333-3333-333333333301'),
  ('e1111111-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',NULL,'2026-06-01','Payroll 2026-06','payroll','f0000000-0000-0000-0000-000000000002','posted','33333333-3333-3333-3333-333333333301'),
  ('e1111111-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111',NULL,'2026-06-01','Setoran modal awal','manual','f0000000-0000-0000-0000-000000000003','posted','33333333-3333-3333-3333-333333333301'),
  ('e1111111-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','2026-07-01','Expense: Sewa','expense','d0000000-0000-0000-0000-000000000001','posted','33333333-3333-3333-3333-333333333301'),
  ('e1111111-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','2026-07-05','Expense: Listrik','expense','d0000000-0000-0000-0000-000000000002','posted','33333333-3333-3333-3333-333333333301'),
  ('e1111111-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','2026-07-05','Expense: Air','expense','d0000000-0000-0000-0000-000000000003','posted','33333333-3333-3333-3333-333333333301'),
  ('e1111111-0000-0000-0000-000000000007','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222202','2026-07-08','Expense: Perlengkapan','expense','d0000000-0000-0000-0000-000000000004','posted','33333333-3333-3333-3333-333333333301'),
  ('e1111111-0000-0000-0000-000000000008','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','2026-06-20','Expense: Listrik','expense','d0000000-0000-0000-0000-000000000005','posted','33333333-3333-3333-3333-333333333301'),
  ('e1111111-0000-0000-0000-000000000009','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222202','2026-07-12','Inter-branch settlement (earned)','settle_accrue_r','a0000000-0000-0000-0000-000000000001','posted','33333333-3333-3333-3333-333333333301'),
  ('e1111111-0000-0000-0000-000000000010','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','2026-07-12','Inter-branch settlement (owed)','settle_accrue_p','a0000000-0000-0000-0000-000000000001','posted','33333333-3333-3333-3333-333333333301'),
  ('e1111111-0000-0000-0000-000000000011','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222202','2026-07-12','Inter-branch settlement (earned)','settle_accrue_r','a0000000-0000-0000-0000-000000000002','posted','33333333-3333-3333-3333-333333333301'),
  ('e1111111-0000-0000-0000-000000000012','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','2026-07-12','Inter-branch settlement (owed)','settle_accrue_p','a0000000-0000-0000-0000-000000000002','posted','33333333-3333-3333-3333-333333333301'),
  ('e1111111-0000-0000-0000-000000000013','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222202','2026-07-12','Inter-branch settlement (earned)','settle_accrue_r','a0000000-0000-0000-0000-000000000003','posted','33333333-3333-3333-3333-333333333301'),
  ('e1111111-0000-0000-0000-000000000014','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','2026-07-12','Inter-branch settlement (owed)','settle_accrue_p','a0000000-0000-0000-0000-000000000003','posted','33333333-3333-3333-3333-333333333301'),
  ('e1111111-0000-0000-0000-000000000015','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','2026-07-15','Inter-branch settlement payout','settle_payout_a','b0000000-0000-0000-0000-000000000001','posted','33333333-3333-3333-3333-333333333301'),
  ('e1111111-0000-0000-0000-000000000016','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222202','2026-07-15','Inter-branch settlement payout','settle_payout_b','b0000000-0000-0000-0000-000000000001','posted','33333333-3333-3333-3333-333333333301')
ON CONFLICT (tenant_id, source_type, source_id) DO NOTHING;

-- 4b) journal_lines (resolve account_id by code; per-entry guard)
INSERT INTO journal_lines (tenant_id, entry_id, account_id, debit, credit, memo)
SELECT v.tenant_id::uuid, v.entry_id::uuid, a.id, v.debit::numeric, v.credit::numeric, v.memo
FROM (VALUES
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000001','1000',1110000,0,'Sale (tunai)'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000001','4000',0,1000000,'Pendapatan jasa cuci'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000001','2300',0,110000,'PPN dipungut'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000001','5000',150000,0,'HPP'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000001','1300',0,150000,'Persediaan terpakai'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000002','6100',45000000,0,'Gaji Juni'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000002','1000',0,45000000,'Pembayaran gaji Juni'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000003','1010',100000000,0,'Setoran modal ke bank'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000003','3000',0,100000000,'Modal pemilik'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000004','6130',15000000,0,'Sewa Juli'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000004','1010',0,15000000,'Sewa Juli'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000005','6110',3500000,0,'Listrik Juli'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000005','1010',0,3500000,'Listrik Juli'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000006','6120',1200000,0,'Air Juli'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000006','1010',0,1200000,'Air Juli'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000007','6140',2000000,0,'Perlengkapan cuci'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000007','1000',0,2000000,'Perlengkapan cuci (tunai)'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000008','6110',3300000,0,'Listrik Juni'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000008','1010',0,3300000,'Listrik Juni'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000009','1400',50000,0,'Piutang dari cabang asal'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000009','4800',0,50000,'Pendapatan antar-cabang'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000010','6300',50000,0,'Beban antar-cabang'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000010','2100',0,50000,'Utang ke cabang pelayan'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000011','1400',50000,0,'Piutang dari cabang asal'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000011','4800',0,50000,'Pendapatan antar-cabang'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000012','6300',50000,0,'Beban antar-cabang'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000012','2100',0,50000,'Utang ke cabang pelayan'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000013','1400',50000,0,'Piutang dari cabang asal'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000013','4800',0,50000,'Pendapatan antar-cabang'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000014','6300',50000,0,'Beban antar-cabang'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000014','2100',0,50000,'Utang ke cabang pelayan'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000015','2100',100000,0,'Lunasi utang antar-cabang'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000015','1000',0,100000,'Kas keluar settlement'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000016','1000',100000,0,'Kas masuk settlement'),
  ('11111111-1111-1111-1111-111111111111','e1111111-0000-0000-0000-000000000016','1400',0,100000,'Lunasi piutang antar-cabang')
) AS v(tenant_id, entry_id, account_code, debit, credit, memo)
JOIN chart_of_accounts a ON a.tenant_id = v.tenant_id::uuid AND a.code = v.account_code
WHERE NOT EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.entry_id = v.entry_id::uuid);

-- 5) expenses
INSERT INTO expenses (id, tenant_id, outlet_id, category, description, amount, expense_date, payment_method, created_by) VALUES
  ('d0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','Sewa','Sewa tempat cabang bulan Juli',15000000,'2026-07-01','bank_transfer','33333333-3333-3333-3333-333333333301'),
  ('d0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','Listrik','Tagihan listrik PLN Juli',3500000,'2026-07-05','bank_transfer','33333333-3333-3333-3333-333333333301'),
  ('d0000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','Air','Tagihan air PDAM Juli',1200000,'2026-07-05','bank_transfer','33333333-3333-3333-3333-333333333301'),
  ('d0000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222202','Perlengkapan','Sabun, shampoo & lap microfiber',2000000,'2026-07-08','cash','33333333-3333-3333-3333-333333333301'),
  ('d0000000-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','Listrik','Tagihan listrik PLN Juni',3300000,'2026-06-20','bank_transfer','33333333-3333-3333-3333-333333333301')
ON CONFLICT (id) DO NOTHING;

-- 6) settlement_payouts
INSERT INTO settlement_payouts (id, tenant_id, owing_outlet_id, serving_outlet_id, amount, entry_count, note, created_by, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','22222222-2222-2222-2222-222222222202',100000,2,'Pelunasan settlement antar-cabang','33333333-3333-3333-3333-333333333301','2026-07-15 16:00:00+07')
ON CONFLICT (id) DO NOTHING;

-- 7) settlement_entries
INSERT INTO settlement_entries (id, tenant_id, owing_outlet_id, serving_outlet_id, amount, status, payout_id, created_at) VALUES
  ('a0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','22222222-2222-2222-2222-222222222202',50000,'paid','b0000000-0000-0000-0000-000000000001','2026-07-12 11:00:00+07'),
  ('a0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','22222222-2222-2222-2222-222222222202',50000,'paid','b0000000-0000-0000-0000-000000000001','2026-07-12 14:30:00+07'),
  ('a0000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','22222222-2222-2222-2222-222222222202',50000,'pending',NULL,'2026-07-14 10:15:00+07')
ON CONFLICT (id) DO NOTHING;

-- 8) petty_cash_movements (add to existing demo shift)
INSERT INTO petty_cash_movements (id, tenant_id, shift_id, type, amount, category, reason, actor) VALUES
  ('c0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','29f077ed-6acf-4026-9162-67fa8f834395','out',150000,'Perlengkapan','Beli sabun & shampoo mobil','33333333-3333-3333-3333-333333333301'),
  ('c0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','29f077ed-6acf-4026-9162-67fa8f834395','out',80000,'Konsumsi','Makan siang tim operasional','33333333-3333-3333-3333-333333333301'),
  ('c0000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','29f077ed-6acf-4026-9162-67fa8f834395','in',500000,'Top-up','Tambahan modal kas kecil','33333333-3333-3333-3333-333333333301')
ON CONFLICT (id) DO NOTHING;

-- ===== SALES / CRM / MARKETING =====
-- 1) sales_targets: per-outlet, current + last month
INSERT INTO sales_targets (id, tenant_id, outlet_id, period, target_amount)
SELECT gen_random_uuid(), o.tenant_id, o.id, p.period,
       round((p.base + (('x'||substr(md5(o.id::text),1,6))::bit(24)::bigint % 40) * 1000000) * p.factor, 2)
FROM outlets o
CROSS JOIN (VALUES ('2026-07', 60000000::numeric, 1.00), ('2026-06', 60000000::numeric, 0.90)) AS p(period, base, factor)
WHERE o.tenant_id = '11111111-1111-1111-1111-111111111111'
ON CONFLICT DO NOTHING;

-- 2) commission_accruals: 3 recent completed orders per cashier, 3% rate
WITH cashiers AS (
  SELECT id AS employee_id, outlet_id
  FROM employees
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
    AND role = 'Cashier' AND outlet_id IS NOT NULL AND status = 'active'
)
INSERT INTO commission_accruals (id, tenant_id, outlet_id, order_id, employee_id, period, type, basis, amount, status)
SELECT gen_random_uuid(), '11111111-1111-1111-1111-111111111111', c.outlet_id, o.id, c.employee_id,
       to_char(COALESCE(o.completed_at, o.created_at, now()), 'YYYY-MM'), 'commission',
       jsonb_build_object('rate', 0.03, 'order_total', o.total, 'source', 'demo_seed'),
       round(o.total * 0.03, 2), 'accrued'
FROM cashiers c
CROSS JOIN LATERAL (
  SELECT id, total, completed_at, created_at
  FROM orders
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
    AND outlet_id = c.outlet_id AND status = 'completed'
  ORDER BY completed_at DESC NULLS LAST
  LIMIT 3
) o
WHERE NOT EXISTS (
  SELECT 1 FROM commission_accruals WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
);

-- 3) sales_leads
INSERT INTO sales_leads (id, tenant_id, name, phone, source, status, notes)
SELECT gen_random_uuid(), '11111111-1111-1111-1111-111111111111', v.name, v.phone, v.source, v.status, v.notes
FROM (VALUES
  ('PT Sinar Jaya Fleet', '081298765432', 'referral', 'contacted', 'Fleet of 12 operational cars; interested in monthly LEAD detailing package.'),
  ('Bapak Andi (Showroom Mobil)', '081377712345', 'walk_in', 'new', 'Used-car showroom, wants recon detailing quote for 5-8 units/week.')
) AS v(name, phone, source, status, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM sales_leads WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
);

-- 4) promotions + promotion_grants
WITH new_promos AS (
  INSERT INTO promotions (id, tenant_id, name, description, start_date, end_date, is_active,
                          outlet_ids, reward_type, reward_value, max_quota, used_quota)
  SELECT gen_random_uuid(), '11111111-1111-1111-1111-111111111111', v.name, v.descr,
         '2026-07-01'::date, '2026-07-31'::date, true,
         (SELECT array_agg(id) FROM outlets WHERE tenant_id = '11111111-1111-1111-1111-111111111111'),
         v.reward_type, v.reward_value, v.max_quota, 0
  FROM (VALUES
    ('Weekday 20% Off', 'Diskon 20% untuk cuci di hari kerja (Senin-Jumat).', 'discount_percentage', 20::numeric, 500),
    ('Member Bonus Rp25.000', 'Potongan Rp25.000 untuk member aktif.', 'discount_fixed', 25000::numeric, 300),
    ('Weekend Free Voucher', 'Gratis voucher cuci berikutnya untuk transaksi akhir pekan.', 'free_voucher', 0::numeric, 200)
  ) AS v(name, descr, reward_type, reward_value, max_quota)
  WHERE NOT EXISTS (
    SELECT 1 FROM promotions WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
  )
  RETURNING id, reward_type
)
INSERT INTO promotion_grants (id, promotion_id, order_id, outlet_id, amount)
SELECT gen_random_uuid(), np.id, o.id, o.outlet_id,
       CASE np.reward_type
         WHEN 'discount_percentage' THEN round(o.total * 0.20, 2)
         WHEN 'discount_fixed' THEN 25000::numeric
         ELSE 0::numeric
       END
FROM new_promos np
CROSS JOIN LATERAL (
  SELECT id, outlet_id, total
  FROM orders
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111' AND status = 'completed'
  ORDER BY completed_at DESC NULLS LAST
  LIMIT 2
) o;

-- 5) campaigns: 1 active membership-bonus campaign
INSERT INTO campaigns (id, tenant_id, name, plan_id, bonus_template_id, start_date, end_date,
                       cap, per_customer_limit, grants_count, status)
SELECT gen_random_uuid(), '11111111-1111-1111-1111-111111111111',
       'Unlimited Wash Launch Bonus',
       'c77c769f-da98-43f1-9609-01add41558b2',
       '88888888-8888-8888-8888-888888888801',
       '2026-07-01'::date, '2026-08-31'::date, 200, 1, 0, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM campaigns WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
);

-- ===== CUSTOMER ENGAGEMENT / REVENUE-OPS =====
-- 1) Feedback SETUP: config in tenants.settings.feedback (migration 065)
UPDATE tenants
SET settings = jsonb_set(
      COALESCE(settings, '{}'::jsonb),
      '{feedback}',
      '{
         "enabled": true,
         "npsEnabled": true,
         "sendDelayMinutes": 60,
         "linkExpiryHours": 72,
         "channel": "whatsapp",
         "lowRatingThreshold": 3,
         "detractorThreshold": 6,
         "questions": [
           {"id": "rating", "type": "stars", "label": "Seberapa puas Anda dengan layanan hari ini?", "required": true},
           {"id": "nps", "type": "nps", "label": "Seberapa besar kemungkinan Anda merekomendasikan kami?", "required": true},
           {"id": "comment", "type": "text", "label": "Ada masukan untuk kami?", "required": false}
         ]
       }'::jsonb,
      true)
WHERE id = '11111111-1111-1111-1111-111111111111'
  AND NOT (COALESCE(settings, '{}'::jsonb) ? 'feedback');

-- 2) Feedback requests + responses for ~40 recent completed orders.
WITH picked AS (
  SELECT o.id AS order_id, o.outlet_id, o.customer_id, o.customer_phone,
         o.created_at,
         row_number() OVER (ORDER BY o.created_at DESC) AS rn
  FROM orders o
  WHERE o.tenant_id = '11111111-1111-1111-1111-111111111111'
    AND o.status = 'completed'
    AND o.customer_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM feedback_requests fr
                    WHERE fr.tenant_id = '11111111-1111-1111-1111-111111111111')
  ORDER BY o.created_at DESC
  LIMIT 40
),
ins_req AS (
  INSERT INTO feedback_requests
    (tenant_id, outlet_id, order_id, customer_id, customer_phone,
     channel, status, sent_at, expires_at, created_at, updated_at)
  SELECT '11111111-1111-1111-1111-111111111111',
         p.outlet_id, p.order_id, p.customer_id, p.customer_phone,
         'whatsapp', 'completed',
         p.created_at + interval '1 hour',
         p.created_at + interval '73 hours',
         p.created_at + interval '1 hour',
         p.created_at + interval '2 hours'
  FROM picked p
  RETURNING id, order_id
)
INSERT INTO feedback_responses
  (tenant_id, outlet_id, request_id, rating, nps, comment, service_id, created_at, answers)
SELECT '11111111-1111-1111-1111-111111111111',
       o.outlet_id,
       r.id,
       CASE p.rn % 10 WHEN 0 THEN 2 WHEN 7 THEN 3 WHEN 4 THEN 4 ELSE 5 END AS rating,
       CASE p.rn % 10 WHEN 0 THEN 4 WHEN 7 THEN 6 WHEN 4 THEN 8 ELSE (9 + (p.rn % 2)) END AS nps,
       CASE
         WHEN p.rn % 10 = 0 THEN 'Antrian terlalu lama, mohon ditingkatkan.'
         WHEN p.rn % 5 = 0  THEN 'Hasil cucian bersih, tapi bisa lebih cepat.'
         WHEN p.rn % 3 = 0  THEN 'Pelayanan ramah dan memuaskan!'
         ELSE NULL
       END AS comment,
       (SELECT oi.service_id FROM order_items oi
        WHERE oi.order_id = p.order_id ORDER BY oi.sort_order LIMIT 1) AS service_id,
       o.created_at + interval '3 hours',
       jsonb_build_object(
         'rating', CASE p.rn % 10 WHEN 0 THEN 2 WHEN 7 THEN 3 WHEN 4 THEN 4 ELSE 5 END,
         'nps',    CASE p.rn % 10 WHEN 0 THEN 4 WHEN 7 THEN 6 WHEN 4 THEN 8 ELSE (9 + (p.rn % 2)) END
       )
FROM ins_req r
JOIN picked p ON p.order_id = r.order_id
JOIN orders o ON o.id = r.order_id;

-- 3) Refunds + refund_items against 3 real completed orders.
WITH picked AS (
  SELECT o.id AS order_id, o.outlet_id, o.total, o.tax, o.created_at,
         row_number() OVER (ORDER BY o.created_at DESC) AS rn
  FROM orders o
  WHERE o.tenant_id = '11111111-1111-1111-1111-111111111111'
    AND o.status = 'completed'
    AND o.customer_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM refunds r
                    WHERE r.tenant_id = '11111111-1111-1111-1111-111111111111')
  ORDER BY o.created_at DESC
  LIMIT 3
),
ins AS (
  INSERT INTO refunds
    (tenant_id, outlet_id, order_id, refund_number, status, reason,
     refund_method, total, tax_reversed, pin_used, created_at, updated_at)
  SELECT '11111111-1111-1111-1111-111111111111',
         p.outlet_id, p.order_id,
         'RF-DEMO-' || lpad(p.rn::text, 4, '0'),
         'completed',
         CASE p.rn
           WHEN 1 THEN 'Cucian tidak sesuai standar, dilakukan pengembalian dana.'
           WHEN 2 THEN 'Pelanggan membatalkan layanan tambahan setelah pembayaran.'
           ELSE 'Kesalahan input kasir pada nominal transaksi.'
         END,
         'cash',
         p.total,
         COALESCE(p.tax, 0),
         true,
         p.created_at + interval '4 hours',
         p.created_at + interval '4 hours'
  FROM picked p
  RETURNING id, order_id
)
INSERT INTO refund_items (refund_id, order_item_id, quantity, amount)
SELECT ins.id, oi.id, oi.quantity, oi.subtotal
FROM ins
JOIN order_items oi ON oi.order_id = ins.order_id;

-- 4) Tax invoices (e-Faktur) for 4 recent orders. PPN at 11% of subtotal.
WITH picked AS (
  SELECT o.id AS order_id, o.outlet_id, o.subtotal, o.customer_id,
         o.created_at, c.name AS cname, c.tax_name, c.npwp, c.nik, c.tax_address,
         row_number() OVER (ORDER BY o.created_at DESC) AS rn
  FROM orders o
  LEFT JOIN customers c ON c.id = o.customer_id
  WHERE o.tenant_id = '11111111-1111-1111-1111-111111111111'
    AND o.status = 'completed'
    AND o.customer_id IS NOT NULL
    AND o.subtotal > 0
    AND NOT EXISTS (SELECT 1 FROM tax_invoices ti
                    WHERE ti.tenant_id = '11111111-1111-1111-1111-111111111111')
  ORDER BY o.created_at DESC
  LIMIT 4
)
INSERT INTO tax_invoices
  (tenant_id, outlet_id, order_id, faktur_number, kode_transaksi,
   buyer_npwp, buyer_nik, buyer_name, buyer_address,
   dpp, ppn, status, issued_at, created_at, updated_at)
SELECT '11111111-1111-1111-1111-111111111111',
       p.outlet_id, p.order_id,
       '010.000-26.' || lpad((99000000 + p.rn)::text, 8, '0'),
       '04',
       p.npwp, p.nik,
       COALESCE(p.tax_name, p.cname),
       p.tax_address,
       p.subtotal,
       round(p.subtotal * 0.11, 2),
       'issued',
       p.created_at + interval '5 hours',
       p.created_at + interval '5 hours',
       p.created_at + interval '5 hours'
FROM picked p;

-- 5) One broadcast campaign + ~20 recipients from real customers.
WITH camp AS (
  INSERT INTO broadcast_campaigns
    (tenant_id, name, message, status, throttle_per_min,
     total_recipients, sent_count, failed_count, skipped_count,
     started_at, completed_at, created_at, updated_at)
  SELECT '11111111-1111-1111-1111-111111111111',
         'Promo Kilat Akhir Pekan',
         'Halo {{name}}! Nikmati diskon 20% untuk cuci mobil + poles di akhir pekan ini. Tunjukkan pesan ini di kasir. Berlaku Sabtu-Minggu.',
         'completed', 20,
         20, 20, 0, 0,
         now() - interval '2 days',
         now() - interval '2 days' + interval '15 minutes',
         now() - interval '2 days',
         now() - interval '2 days'
  WHERE NOT EXISTS (SELECT 1 FROM broadcast_campaigns bc
                    WHERE bc.tenant_id = '11111111-1111-1111-1111-111111111111')
  RETURNING id
),
cust AS (
  SELECT id, name, phone,
         row_number() OVER (ORDER BY created_at DESC) AS rn
  FROM customers
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
  ORDER BY created_at DESC
  LIMIT 20
)
INSERT INTO broadcast_recipients
  (campaign_id, tenant_id, customer_id, name, phone, status, sent_at, created_at)
SELECT camp.id, '11111111-1111-1111-1111-111111111111',
       cust.id, cust.name, cust.phone, 'sent',
       now() - interval '2 days' + (cust.rn || ' minutes')::interval,
       now() - interval '2 days'
FROM camp CROSS JOIN cust;

-- ===== OPS / LEGAL / VOUCHERS =====
-- legal_entities (2 PT, assigned to outlets)
INSERT INTO legal_entities (id, tenant_id, name, npwp, address, phone)
SELECT gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid, v.name, v.npwp, v.address, v.phone
FROM (VALUES
  ('PT Aire Bersih Nusantara', '01.234.567.8-012.000', 'Jl. Jenderal Sudirman Kav. 52-53, Jakarta Selatan 12190', '0215551000'),
  ('PT Lead Auto Detailing',   '02.345.678.9-013.000', 'Jl. Mayjend Sungkono No. 89, Surabaya 60256',            '0315552000')
) AS v(name, npwp, address, phone)
WHERE NOT EXISTS (SELECT 1 FROM legal_entities WHERE tenant_id = '11111111-1111-1111-1111-111111111111');

UPDATE outlets SET legal_entity_id = (
    SELECT id FROM legal_entities
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111' AND name = 'PT Aire Bersih Nusantara')
WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
  AND legal_entity_id IS NULL
  AND name IN ('AIRE BSD','AIRE Bintaro','Outlet Sudirman','Outlet Kemang','AIRE Kencana Loka',
               'AIRE Kota Wisata','AIRE Jati Asih','AIRE Kranggan');

UPDATE outlets SET legal_entity_id = (
    SELECT id FROM legal_entities
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111' AND name = 'PT Lead Auto Detailing')
WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
  AND legal_entity_id IS NULL
  AND name IN ('AIRE Citraland (SBY)','AIRE Wiyung (SBY)');

-- bookings (mix of upcoming + past)
INSERT INTO bookings (id, tenant_id, outlet_id, customer_id, customer_name, customer_phone,
                      license_plate, service_id, service_name, scheduled_at, status, source, notes)
SELECT v.id, v.tenant_id, v.outlet_id, v.customer_id, v.customer_name, v.customer_phone,
       v.license_plate, v.service_id, v.service_name, v.scheduled_at, v.status, v.source, v.notes
FROM (
  SELECT gen_random_uuid() AS id, '11111111-1111-1111-1111-111111111111'::uuid AS tenant_id,
    'b5f88086-5e9b-4f7a-90b5-5447d034d5b5'::uuid AS outlet_id,
    (SELECT id FROM customers WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND phone='08990000192' LIMIT 1) AS customer_id,
    'Arif Kurniawan'::varchar AS customer_name, '08990000192'::varchar AS customer_phone, 'B 1024 ARF'::varchar AS license_plate,
    (SELECT id FROM services WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND name='Air Freshener' LIMIT 1) AS service_id,
    'Air Freshener'::varchar AS service_name, (now() + interval '1 day')::timestamptz AS scheduled_at,
    'booked'::varchar AS status, 'portal'::varchar AS source, 'Demo upcoming booking (portal)'::text AS notes
  UNION ALL
  SELECT gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
    '22222222-2222-2222-2222-222222222201'::uuid,
    (SELECT id FROM customers WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND phone='08990000287' LIMIT 1),
    'Fitri Wijaya', '08990000287', 'B 2287 FTR',
    (SELECT id FROM services WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND name='+ Spray Wax' LIMIT 1),
    '+ Spray Wax', (now() + interval '2 days' + interval '3 hours')::timestamptz,
    'confirmed', 'staff', 'Demo upcoming booking (confirmed)'
  UNION ALL
  SELECT gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
    '22222222-2222-2222-2222-222222222202'::uuid,
    (SELECT id FROM customers WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND phone='08990000023' LIMIT 1),
    'Teguh Saputra', '08990000023', 'B 3023 TGH',
    (SELECT id FROM services WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND name='+ Polymer Coating' LIMIT 1),
    '+ Polymer Coating', (now() - interval '3 days')::timestamptz,
    'done', 'staff', 'Demo past booking (fulfilled)'
  UNION ALL
  SELECT gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
    'ced2a260-46a7-447f-9885-e58d3ca1fba1'::uuid,
    (SELECT id FROM customers WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND phone='08990000136' LIMIT 1),
    'Nur Anggraini', '08990000136', 'B 4136 NUR',
    (SELECT id FROM services WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND name='Air Freshener' LIMIT 1),
    'Air Freshener', (now() - interval '5 days')::timestamptz,
    'cancelled', 'portal', 'Demo past booking (cancelled by customer)'
  UNION ALL
  SELECT gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
    '9e3674b0-76eb-436f-a8c0-70b0e7824ff2'::uuid,
    (SELECT id FROM customers WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND phone='08990000407' LIMIT 1),
    'Sari Setiawan', '08990000407', 'B 5407 SRI',
    (SELECT id FROM services WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND name='+ Spray Wax' LIMIT 1),
    '+ Spray Wax', (now() + interval '4 days')::timestamptz,
    'booked', 'portal', 'Demo upcoming booking (portal)'
) AS v
WHERE NOT EXISTS (SELECT 1 FROM bookings WHERE tenant_id = '11111111-1111-1111-1111-111111111111');

-- order_status_logs (synthesized for recent completed orders)
INSERT INTO order_status_logs (id, order_id, from_status, to_status, operator_id, created_at)
SELECT gen_random_uuid(), o.id, t.from_status, t.to_status, o.operator_id,
       CASE t.to_status
         WHEN 'ordered'   THEN o.created_at
         WHEN 'paid'      THEN o.paid_at
         WHEN 'completed' THEN o.completed_at
       END
FROM (
  SELECT id, operator_id, created_at, paid_at, completed_at
  FROM orders
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
    AND status = 'completed' AND paid_at IS NOT NULL AND completed_at IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 8
) o
CROSS JOIN (VALUES
  (NULL::varchar, 'ordered'::varchar),
  ('ordered'::varchar, 'paid'::varchar),
  ('paid'::varchar, 'completed'::varchar)
) AS t(from_status, to_status)
WHERE NOT EXISTS (
  SELECT 1 FROM order_status_logs osl
  JOIN orders o2 ON o2.id = osl.order_id
  WHERE o2.tenant_id = '11111111-1111-1111-1111-111111111111'
);

-- voucher_packs + voucher_codes (from template: 10x Express Wash Pack)
WITH ins_pack AS (
  INSERT INTO voucher_packs (id, tenant_id, template_id, customer_id, parent_code_hash,
                             parent_code_prefix, total_uses, uses_count, status, expiry_date)
  SELECT gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
         '88888888-8888-8888-8888-888888888801'::uuid,
         (SELECT id FROM customers WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND phone='08990000192' LIMIT 1),
         'demo-pack-hash-express-001', 'AIRE-EXP', 10, 3, 'active', DATE '2026-12-31'
  WHERE NOT EXISTS (SELECT 1 FROM voucher_packs WHERE tenant_id='11111111-1111-1111-1111-111111111111')
  RETURNING id
)
INSERT INTO voucher_codes (id, pack_id, code_hash, code_index, status, redeemed_at, order_id)
SELECT gen_random_uuid(), p.id, 'demo-vc-' || lpad(g::text, 3, '0'), g,
       CASE WHEN g <= 3 THEN 'redeemed' ELSE 'active' END,
       CASE WHEN g <= 3 THEN TIMESTAMPTZ '2026-07-10 10:00:00+00' ELSE NULL END,
       CASE WHEN g <= 3 THEN (SELECT id FROM orders WHERE tenant_id='11111111-1111-1111-1111-111111111111'
                              AND status='completed' ORDER BY created_at DESC LIMIT 1) ELSE NULL END
FROM ins_pack p CROSS JOIN generate_series(1, 10) AS g;

-- voucher_books + voucher_tickets (outlet-issued booklet)
WITH ins_book AS (
  INSERT INTO voucher_books (id, tenant_id, outlet_id, buyer_name, buyer_phone, quantity,
                             benefit_type, benefit_service_id, benefit_value, unit_price, expiry_date)
  SELECT gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
         '22222222-2222-2222-2222-222222222201'::uuid,
         'Budi Santoso', '08990000999', 5, 'service',
         (SELECT id FROM services WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND name='Air Freshener' LIMIT 1),
         0, 250000, DATE '2026-12-31'
  WHERE NOT EXISTS (SELECT 1 FROM voucher_books WHERE tenant_id='11111111-1111-1111-1111-111111111111')
  RETURNING id, outlet_id
)
INSERT INTO voucher_tickets (id, tenant_id, book_id, outlet_id, code, status,
                             redeemed_at, redeemed_order_id, redeemed_outlet_id, expiry_date)
SELECT gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid, b.id, b.outlet_id,
       'VB-SDR-' || lpad(g::text, 3, '0'),
       CASE WHEN g <= 2 THEN 'redeemed' ELSE 'active' END,
       CASE WHEN g <= 2 THEN TIMESTAMPTZ '2026-07-11 09:00:00+00' ELSE NULL END,
       CASE WHEN g <= 2 THEN (SELECT id FROM orders WHERE tenant_id='11111111-1111-1111-1111-111111111111'
                              AND outlet_id = b.outlet_id AND status='completed' ORDER BY created_at DESC LIMIT 1) ELSE NULL END,
       CASE WHEN g <= 2 THEN b.outlet_id ELSE NULL END,
       DATE '2026-12-31'
FROM ins_book b CROSS JOIN generate_series(1, 5) AS g;

-- voucher_counters (per-outlet issuance counter for current period)
INSERT INTO voucher_counters (outlet_id, period, last_number) VALUES
  ('22222222-2222-2222-2222-222222222201', '202607', 5),
  ('b5f88086-5e9b-4f7a-90b5-5447d034d5b5', '202607', 2)
ON CONFLICT (outlet_id, period) DO NOTHING;


-- ===== REMAINING BUSINESS TABLES (staging completeness) =====

-- 1) campaign_grants: grant the seeded campaign's bonus to the seeded voucher_pack's owner
INSERT INTO campaign_grants (campaign_id, customer_id, voucher_pack_id, granted_at)
SELECT c.id, vp.customer_id, vp.id, now() - interval '1 day'
FROM (SELECT id FROM campaigns WHERE tenant_id='11111111-1111-1111-1111-111111111111' LIMIT 1) c
CROSS JOIN (SELECT id, customer_id FROM voucher_packs WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND customer_id IS NOT NULL LIMIT 1) vp
WHERE NOT EXISTS (
  SELECT 1 FROM campaign_grants cg JOIN campaigns ca ON ca.id=cg.campaign_id
  WHERE ca.tenant_id='11111111-1111-1111-1111-111111111111');

UPDATE campaigns SET grants_count = 1
WHERE tenant_id='11111111-1111-1111-1111-111111111111'
  AND id IN (SELECT campaign_id FROM campaign_grants cg JOIN campaigns ca ON ca.id=cg.campaign_id WHERE ca.tenant_id='11111111-1111-1111-1111-111111111111')
  AND grants_count = 0;

-- 2) membership_renewals: one applied renewal against a real membership + order
INSERT INTO membership_renewals (tenant_id, order_id, membership_id, plan_id, applied, applied_at)
SELECT '11111111-1111-1111-1111-111111111111', o.id, m.id, m.plan_id, true, now() - interval '10 days'
FROM (SELECT id, plan_id FROM memberships WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND status='active' LIMIT 1) m
CROSS JOIN (SELECT id FROM orders WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND status='completed' ORDER BY created_at DESC LIMIT 1) o
WHERE NOT EXISTS (SELECT 1 FROM membership_renewals WHERE tenant_id='11111111-1111-1111-1111-111111111111');

-- 3) payroll_adjustments (+ applications) applied to the finalized payroll run
WITH run AS (SELECT id, period FROM payroll_runs WHERE tenant_id='11111111-1111-1111-1111-111111111111' ORDER BY created_at LIMIT 1),
emp AS (SELECT id FROM employees WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND role='Cashier' ORDER BY email LIMIT 1),
adj AS (
  INSERT INTO payroll_adjustments (tenant_id, employee_id, type, amount, reason, effective_period, status, applied_run_id, created_by)
  SELECT '11111111-1111-1111-1111-111111111111', (SELECT id FROM emp), x.type, x.amount, x.reason,
         (SELECT period FROM run), 'applied', (SELECT id FROM run), '33333333-3333-3333-3333-333333333301'
  FROM (VALUES ('bonus',500000::numeric,'Bonus kinerja bulanan'),
               ('deduction',100000::numeric,'Potongan keterlambatan')) AS x(type,amount,reason)
  WHERE NOT EXISTS (SELECT 1 FROM payroll_adjustments WHERE tenant_id='11111111-1111-1111-1111-111111111111')
  RETURNING id, amount, effective_period
)
INSERT INTO payroll_adjustment_applications (tenant_id, adjustment_id, run_id, period, amount)
SELECT '11111111-1111-1111-1111-111111111111', adj.id, (SELECT id FROM run), adj.effective_period, adj.amount FROM adj;

-- 4) platform_announcements (global; super-admin authored)
INSERT INTO platform_announcements (title, body, severity, audience, published, starts_at, created_by)
SELECT v.title, v.body, v.severity, 'all', true, now() - interval '3 days', '33333333-3333-3333-3333-333333333304'
FROM (VALUES
  ('Selamat datang di Airin', 'Platform manajemen car wash Anda kini aktif. Hubungi tim kami untuk bantuan onboarding.', 'info'),
  ('Pemeliharaan terjadwal', 'Pemeliharaan sistem Minggu 02:00-04:00 WIB. Layanan mungkin terganggu sesaat.', 'warning')
) AS v(title, body, severity)
WHERE NOT EXISTS (SELECT 1 FROM platform_announcements);

-- 5) platform_support_notes (super-admin internal notes on the demo tenant)
INSERT INTO platform_support_notes (tenant_id, body, pinned, author_id)
SELECT '11111111-1111-1111-1111-111111111111', v.body, v.pinned, '33333333-3333-3333-3333-333333333304'
FROM (VALUES
  ('Tenant demo untuk showcase — data di-seed penuh (HR, keuangan, inventori, dll).', true),
  ('Owner menanyakan integrasi gateway pembayaran; follow up minggu depan.', false)
) AS v(body, pinned)
WHERE NOT EXISTS (SELECT 1 FROM platform_support_notes WHERE tenant_id='11111111-1111-1111-1111-111111111111');

-- 6) shift_issues (cash variance flagged on the most recent shift)
INSERT INTO shift_issues (tenant_id, shift_id, severity, description, reported_by)
SELECT '11111111-1111-1111-1111-111111111111', s.id, 'medium',
       'Selisih kas Rp50.000 saat tutup shift; kemungkinan salah kembalian.', '33333333-3333-3333-3333-333333333302'
FROM (SELECT id FROM pos_shifts WHERE tenant_id='11111111-1111-1111-1111-111111111111' ORDER BY opened_at DESC LIMIT 1) s
WHERE NOT EXISTS (SELECT 1 FROM shift_issues WHERE tenant_id='11111111-1111-1111-1111-111111111111');

COMMIT;
