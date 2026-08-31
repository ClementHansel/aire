-- Migration: 097_vehicle_catalog_defaults
-- Description: Make the starter vehicle catalog available to tenants created
--   AFTER migrations 035/036 ran.
--
--   035 and 036 seeded vehicle_brands/vehicle_types with `SELECT ... FROM
--   tenants`, i.e. a one-shot back-fill of whatever tenants existed on
--   2026-07-10. Nothing in tenant provisioning ever seeded the catalog, so
--   every tenant created since then opened Vehicle Catalog / the POS vehicle
--   pickers and found them EMPTY. It reads as "our brand and model data
--   disappeared"; in truth it was never inserted for that tenant.
--
--   The list is therefore lifted out of the one-shot migration into a
--   tenant-agnostic template table, so it has ONE home that both this
--   back-fill and the runtime provisioning seed (vehicle-catalog.defaults.ts)
--   read from. Adding a brand here gives it to new tenants without touching
--   anyone's existing catalog.
--
--   The back-fill only touches tenants whose catalog is completely empty. A
--   tenant that pruned brands down to the two they actually wash must not have
--   35 of them resurrected.
-- Created at: 2026-08-31

BEGIN;

-- Template, not tenant data: no tenant_id, no RLS. Every tenant reads the same
-- rows and only the copies in vehicle_brands/vehicle_types are editable.
CREATE TABLE IF NOT EXISTS vehicle_catalog_defaults (
  brand       VARCHAR(80) NOT NULL,
  brand_order INT         NOT NULL DEFAULT 0,
  model       VARCHAR(80) NOT NULL,
  model_order INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (brand, model)
);

COMMENT ON TABLE vehicle_catalog_defaults IS
  'Tenant-agnostic starter vehicle catalog. Copied into vehicle_brands/vehicle_types when a tenant is provisioned (or by the 097 back-fill) and never read at runtime - a tenant edits their own copy. Migration 097.';

INSERT INTO vehicle_catalog_defaults (brand, brand_order, model, model_order)
SELECT b.name, b.ord, ty.name, ty.ord
FROM (VALUES
  ('Toyota',1),('Honda',2),('Daihatsu',3),('Suzuki',4),('Mitsubishi',5),
  ('Nissan',6),('Hyundai',7),('Wuling',8),('Mazda',9),('Kia',10),
  ('Isuzu',11),('MG',12),('Chery',13),('BYD',14),('DFSK',15),
  ('Datsun',16),('Subaru',17),('Ford',18),('Chevrolet',19),('Volkswagen',20),
  ('BMW',21),('Mercedes-Benz',22),('Audi',23),('Lexus',24),('Mini',25),
  ('Peugeot',26),('Renault',27),('Volvo',28),('Land Rover',29),('Jeep',30),
  ('Porsche',31),('Neta',32),('Seres',33),('Hino',34),('Tesla',35)
) AS b(name, ord)
JOIN (VALUES
  ('Toyota','Agya',1),('Toyota','Calya',2),('Toyota','Raize',3),('Toyota','Yaris',4),('Toyota','Yaris Cross',5),
  ('Toyota','Avanza',6),('Toyota','Veloz',7),('Toyota','Rush',8),('Toyota','Innova',9),('Toyota','Innova Zenix',10),
  ('Toyota','Fortuner',11),('Toyota','Corolla Altis',12),('Toyota','Corolla Cross',13),('Toyota','Camry',14),
  ('Toyota','Vios',15),('Toyota','Sienta',16),('Toyota','Voxy',17),('Toyota','Alphard',18),('Toyota','Vellfire',19),
  ('Toyota','Hilux',20),('Toyota','Hiace',21),('Toyota','Land Cruiser',22),('Toyota','C-HR',23),('Toyota','bZ4X',24),
  ('Honda','Brio',1),('Honda','Jazz',2),('Honda','City',3),('Honda','City Hatchback',4),('Honda','Civic',5),
  ('Honda','Mobilio',6),('Honda','BR-V',7),('Honda','HR-V',8),('Honda','WR-V',9),('Honda','CR-V',10),
  ('Honda','Accord',11),('Honda','Odyssey',12),('Honda','Elevate',13),('Honda','e:N1',14),
  ('Daihatsu','Ayla',1),('Daihatsu','Sigra',2),('Daihatsu','Sirion',3),('Daihatsu','Xenia',4),('Daihatsu','Terios',5),
  ('Daihatsu','Rocky',6),('Daihatsu','Gran Max',7),('Daihatsu','Luxio',8),
  ('Suzuki','Ignis',1),('Suzuki','Baleno',2),('Suzuki','Swift',3),('Suzuki','Ertiga',4),('Suzuki','XL7',5),
  ('Suzuki','Carry',6),('Suzuki','APV',7),('Suzuki','Jimny',8),('Suzuki','S-Presso',9),('Suzuki','Grand Vitara',10),
  ('Mitsubishi','Xpander',1),('Mitsubishi','Xpander Cross',2),('Mitsubishi','Pajero Sport',3),('Mitsubishi','Triton',4),
  ('Mitsubishi','Outlander PHEV',5),('Mitsubishi','Eclipse Cross',6),('Mitsubishi','Mirage',7),('Mitsubishi','L300',8),
  ('Nissan','Magnite',1),('Nissan','Kicks',2),('Nissan','Livina',3),('Nissan','Serena',4),('Nissan','X-Trail',5),('Nissan','Terra',6),('Nissan','Leaf',7),
  ('Hyundai','Creta',1),('Hyundai','Stargazer',2),('Hyundai','Santa Fe',3),('Hyundai','Palisade',4),
  ('Hyundai','Ioniq 5',5),('Hyundai','Ioniq 6',6),('Hyundai','Staria',7),('Hyundai','Kona',8),
  ('Wuling','Confero',1),('Wuling','Cortez',2),('Wuling','Almaz',3),('Wuling','Alvez',4),('Wuling','Air ev',5),('Wuling','BinguoEV',6),
  ('Mazda','Mazda2',1),('Mazda','Mazda3',2),('Mazda','CX-3',3),('Mazda','CX-30',4),('Mazda','CX-5',5),('Mazda','CX-8',6),('Mazda','CX-9',7),('Mazda','CX-60',8),
  ('Kia','Picanto',1),('Kia','Sonet',2),('Kia','Seltos',3),('Kia','Carens',4),('Kia','Carnival',5),('Kia','Sportage',6),('Kia','EV6',7),
  ('Isuzu','Panther',1),('Isuzu','D-Max',2),('Isuzu','MU-X',3),('Isuzu','Traga',4),('Isuzu','Elf',5),
  ('MG','MG3',1),('MG','MG4 EV',2),('MG','MG5',3),('MG','ZS',4),('MG','HS',5),('MG','VS HEV',6),
  ('Chery','Omoda 5',1),('Chery','Tiggo 4 Pro',2),('Chery','Tiggo 7 Pro',3),('Chery','Tiggo 8 Pro',4),('Chery','Omoda E5',5),
  ('BYD','Atto 3',1),('BYD','Dolphin',2),('BYD','Seal',3),('BYD','M6',4),
  ('DFSK','Gelora',1),('DFSK','Super Cab',2),('DFSK','Seres E1',3),
  ('Datsun','Go',1),('Datsun','Go+',2),('Datsun','Cross',3),
  ('Subaru','XV',1),('Subaru','Forester',2),('Subaru','WRX',3),('Subaru','BRZ',4),
  ('Ford','Ranger',1),('Ford','Everest',2),('Ford','Raptor',3),
  ('Chevrolet','Spin',1),('Chevrolet','Trailblazer',2),('Chevrolet','Captiva',3),
  ('Volkswagen','Polo',1),('Volkswagen','Tiguan',2),('Volkswagen','T-Cross',3),('Volkswagen','Golf',4),
  ('BMW','Seri 2',1),('BMW','Seri 3',2),('BMW','Seri 5',3),('BMW','Seri 7',4),('BMW','X1',5),('BMW','X3',6),('BMW','X5',7),('BMW','iX',8),
  ('Mercedes-Benz','A-Class',1),('Mercedes-Benz','C-Class',2),('Mercedes-Benz','E-Class',3),('Mercedes-Benz','S-Class',4),
  ('Mercedes-Benz','GLA',5),('Mercedes-Benz','GLC',6),('Mercedes-Benz','GLE',7),('Mercedes-Benz','EQ',8),
  ('Audi','A3',1),('Audi','A4',2),('Audi','A6',3),('Audi','Q3',4),('Audi','Q5',5),('Audi','Q7',6),('Audi','e-tron',7),
  ('Lexus','UX',1),('Lexus','NX',2),('Lexus','RX',3),('Lexus','ES',4),('Lexus','LM',5),('Lexus','LX',6),
  ('Mini','Cooper',1),('Mini','Countryman',2),
  ('Peugeot','2008',1),('Peugeot','3008',2),('Peugeot','5008',3),
  ('Renault','Kwid',1),('Renault','Triber',2),('Renault','Kiger',3),
  ('Volvo','XC40',1),('Volvo','XC60',2),('Volvo','XC90',3),('Volvo','S90',4),
  ('Land Rover','Defender',1),('Land Rover','Discovery',2),('Land Rover','Range Rover',3),('Land Rover','Range Rover Evoque',4),
  ('Jeep','Wrangler',1),('Jeep','Compass',2),('Jeep','Gladiator',3),
  ('Porsche','Macan',1),('Porsche','Cayenne',2),('Porsche','911',3),('Porsche','Panamera',4),('Porsche','Taycan',5),
  ('Neta','V',1),('Neta','V-II',2),
  ('Seres','E1',1),
  ('Hino','Dutro',1),('Hino','Ranger',2),
  ('Tesla','Model 3',1),('Tesla','Model Y',2),('Tesla','Model S',3),('Tesla','Model X',4)
) AS ty(brand, name, ord) ON ty.brand = b.name
ON CONFLICT (brand, model) DO NOTHING;

-- Back-fill ONLY tenants whose catalog is entirely empty (see header).
INSERT INTO vehicle_brands (tenant_id, name, sort_order)
SELECT t.id, d.brand, MIN(d.brand_order)
FROM tenants t
CROSS JOIN vehicle_catalog_defaults d
WHERE NOT EXISTS (SELECT 1 FROM vehicle_brands vb WHERE vb.tenant_id = t.id)
GROUP BY t.id, d.brand
ON CONFLICT (tenant_id, name) DO NOTHING;

-- Models for any brand that has none. Scoped by "brand has an empty type list"
-- so a tenant who deliberately deleted 'Avanza' does not get it back, while a
-- brand row just created above is filled in.
INSERT INTO vehicle_types (tenant_id, brand_id, name, sort_order)
SELECT vb.tenant_id, vb.id, d.model, d.model_order
FROM vehicle_brands vb
JOIN vehicle_catalog_defaults d ON d.brand = vb.name
WHERE NOT EXISTS (SELECT 1 FROM vehicle_types vt WHERE vt.brand_id = vb.id)
ON CONFLICT (brand_id, name) DO NOTHING;

COMMIT;
