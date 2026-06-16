# Backend Changes — Quotations + B2C/B2B Sales (June 2026)

## Priority 0.5: Agent Stock-Out UX

Frontend now supports:
- unit-aware stock labels in agent stock-out
- phone-based customer prefill from prior B2B/B2C sales
- multiple PI/sales for the same customer phone

## Backend requirements

### 1) Unit-aware stock fields

Required endpoints must include `unit`:
- `GET /api/products`
- `GET /api/products/:id`
- `GET /api/products/inventory-levels`

`unit` should be normalized and stable (`Meters`, `Quantity`, `Pieces`, etc.) so UI labels are consistent across pages.

### 2) Customer prefill by phone

Add a fast lookup endpoint:

`GET /api/sales/customer-by-phone?phone=<value>`

Expected behavior:
- normalize incoming phone to 10-digit India format
- find recent matching sales regardless of stored formatting (`+91`, spaces, hyphens)
- return:
  - `customer` profile block for stock-out prefill
  - `latest_sale` full payload
  - `recent_sales` (small list for quick reuse)

### 3) Multiple PI/sales per phone

Do not enforce uniqueness on `sales.customer_phone`.

Rules:
- same phone can have multiple sales rows over time
- prefill should use the latest row by sale date
- preserve historical rows for reporting

## Optional performance suggestion

If phone lookup volume grows, add:
- normalized phone column (or generated expression index)
- index for recent-phone searches
