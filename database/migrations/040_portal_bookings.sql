-- Portal bookings: link to the customer, a WhatsApp confirm token, and the queue
-- entry created once a cashier confirms.
BEGIN;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS confirmation_token TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS queue_entry_id UUID REFERENCES vehicle_queue(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'staff';

CREATE INDEX IF NOT EXISTS idx_bookings_confirmation_token ON bookings(confirmation_token);

COMMIT;
