# POS history import (real spreadsheet → database)

`import-pos-history.ts` loads an outlet's **actual** operating spreadsheet — one
sheet per month, one row per transaction — and reconstructs the domain records
that produced it.

This is the counterpart to [`seed-history.ts`](./SEED-HISTORY.md), which invents
plausible data. This one invents nothing: every order's amount, time, plate,
payment method and salesperson comes from a row in the workbook.

## What it builds

| From the sheet | Becomes |
|---|---|
| every transaction row | `orders` + `order_items` + `order_tags` |
| `NAME` / `PHONE` | `customers`, deduplicated by normalized phone |
| `NOTES` = `KWS-1-1506` (member card) | `memberships` + `membership_plates` + `membership_usages` |
| `STATUS` = `RENEWAL (…)` | `membership_renewals` |
| `STATUS` = `BELI PAKET VOU` | `voucher_books` + 10 `voucher_tickets` |
| `NOTES` = `KWS-VRW-08586` (voucher) | the matching ticket, marked `redeemed` |
| `AGENT` | a `users` row per agent, as `salesperson_name` |
| service labels the tenant lacks | new `services` / `membership_plans` / `voucher_templates` |

Existing catalog rows are **never modified or repriced** — the import only adds
what is missing.

## Run it

```bash
# always dry-run first: parses, resolves and reconciles, writes nothing
POS_XLSX="/path/POS Sample 2026 01-02.xlsx" \
DATABASE_URL="postgresql://aire:<pw>@localhost:5432/aire" \
OUTLET_CODE=KWS \
pnpm --filter @aire/database import:pos -- --dry-run

# then for real
POS_XLSX="…" DATABASE_URL="…" OUTLET_CODE=KWS \
pnpm --filter @aire/database import:pos
```

| Var | Default | Meaning |
|-----|---------|---------|
| `POS_XLSX` | — | **required**, path to the workbook |
| `DATABASE_URL` | `…@localhost:5432/aire` | connection string (or standard `PG*` vars) |
| `TENANT_ID` | demo tenant | target tenant |
| `OUTLET_CODE` | `KWS` | outlet the sheet belongs to (matched on `code` or `agent_id`) |
| `DRY_RUN` | off | `1` or `--dry-run` |

No new dependencies: the workbook is unzipped with `node:zlib` and its XML
scanned directly, so real customer names and phone numbers never pass through a
third-party parser — or get committed to this repo.

## The correctness oracle

Each sheet carries its own recap block stating the month's `REVENUE`. The import
reads that figure **independently of its own parsing** and refuses to write if
the transactions it parsed don't sum to it:

```
JAN-26: 3395 rows, Rp 140.425.500  vs recap Rp 140.425.500 ✓
FEB-26: 3585 rows, Rp 151.943.500  vs recap Rp 151.943.500 ✓
```

This is what catches a misread workbook. The recap reuses the transaction
columns for its totals — a recap row holds a transaction *count* in the `DATE`
column and the month's *revenue* in the `PRICE` column — so a parser that
accepts any number as a date silently reads the recap as a sale and doubles the
month. The check fails loudly instead.

After writing, it re-reads the totals back out of the database, grouped the way
the reports group them (`created_at AT TIME ZONE 'Asia/Jakarta'`).

## Judgment calls it makes

These are the places where the spreadsheet is ambiguous and the import had to
decide. Worth reviewing against how the outlet actually operates:

- **Times are Jakarta wall-clock.** Stored as the matching UTC instant, so
  `AT TIME ZONE 'Asia/Jakarta'` reproduces the sheet's clock exactly.
- **`orders.total` is the sheet's `PRICE`, always.** Catalog prices only fill in
  line-level detail; where the lines disagree with the row, a reconciliation
  line closes the gap and the row wins.
- **Coverage is expressed on the line, not the order.** A member or voucher wash
  carries the catalog price and an equal discount, netting zero, so
  `SUM(orders.total)` stays the real cash and nothing double-counts.
- **A created plan is priced from the workbook's most recent sale** of that
  duration. The sheet prices a 1-month card at 349k in January and 299k in
  February, so a fresh import prices it at 299k. This affects future sales only.
- **The 12-month plan is created inactive.** Two cards run on it but it was never
  sold in-window, so the workbook gives no price. Set a price to enable it
  rather than let a zero-rupiah membership be sellable.
- **A card's expiry is clamped to its last recorded use.** The sheet sometimes
  carries a stale expiry, which would otherwise leave a membership whose own
  usages fall outside its validity.
- **A member code is owned by one customer.** 79 codes appear under more than one
  phone (a typo'd digit); the code lands on one customer's
  `membership_number` and the other gets none, because that column is unique.
- **A reused voucher code is redeemed once**, at its first use — a ticket cannot
  be spent twice. Repeat scans are counted and reported.
- **Codes redeemed but never sold in-window** (sold before the window opens) are
  collected into one carry-in book per month, so every redemption still points
  at a real ticket.
- **`order_tags.tag` is a closed vocabulary.** Coating, grooming, warranty
  rewashes and internal tests tag as `regular`; what they were survives in
  `business_unit`, the service line and the order note.

## Re-runnable

Every order it writes is numbered `POS-<OUTLET>-######`. Each run first deletes
its own previous output (orders, then the memberships and customers registered
to that outlet, then its voucher books) and re-inserts. Counts don't balloon:

```
clearing 6980 orders from a previous run
✓ committed
```

The catalog top-up is matched by name, so it is added once and reused.

## Verify

```sql
-- revenue by month, the way the reports see it
SELECT to_char(created_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM') AS month,
       count(*) AS orders, sum(total)::bigint AS revenue
FROM orders WHERE order_number LIKE 'POS-%'
  AND status IN ('paid','confirmed','completed')
GROUP BY 1 ORDER BY 1;

-- invariants that should all be zero
SELECT count(*) FROM (
  SELECT o.id, o.total, COALESCE(sum(i.subtotal),0) lines
  FROM orders o LEFT JOIN order_items i ON i.order_id=o.id GROUP BY o.id,o.total
) x WHERE abs(total - lines) > 0.5;                    -- lines vs total

SELECT count(*) FROM membership_usages u
  JOIN memberships m ON m.id=u.membership_id
 WHERE (u.used_at AT TIME ZONE 'Asia/Jakarta')::date
       NOT BETWEEN m.start_date AND m.end_date;        -- usages outside validity
```

## Remove everything it wrote

```sql
DELETE FROM voucher_books WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE 'POS-%')
   OR buyer_name LIKE 'Voucher terjual sebelum %';
DELETE FROM orders      WHERE order_number LIKE 'POS-%';
DELETE FROM memberships WHERE home_outlet_id = '<outlet id>';
DELETE FROM customers   WHERE registered_outlet_id = '<outlet id>';
```

Catalog rows (services, plans, the voucher template) and the agent users are
left in place — they are configuration, not history.

## Verified against

`POS Sample 2026 01-02.xlsx` (Kota Wisata, Jan–Feb 2026), imported into a clean
migrated database:

- 6,980 orders, 7,247 items — Rp 292,369,000, matching both months' recap exactly
- every payment-method total and transaction count matching the raw sheet
  (QRIS 398 / Rp 49,701,500 in January, and so on across all eight methods)
- 481 customers, 506 memberships (1,080 plates, 4,213 usages, 184 renewals)
- 92 voucher books, 1,723 tickets, 837 redeemed (65 repeat scans ignored)
- order lines reconciling to order totals on every row; no usage outside its
  membership's validity; re-run leaves all counts unchanged
