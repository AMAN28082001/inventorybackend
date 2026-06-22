# Backend Changes: Stock Request Dispatch

**Date:** June 2026  
**Frontend:** `components/modals/enhanced-request-approval-modal.tsx`, `lib/api.ts`  
**Status:** Implemented

**Quick ref:** [`BACKEND_TEAM_SUMMARY.md`](./BACKEND_TEAM_SUMMARY.md) (Priority 0) · [`BACKEND_SERIAL_NUMBERS_DISPATCH_FIX.md`](./BACKEND_SERIAL_NUMBERS_DISPATCH_FIX.md) (serial GET vs dispatch)

---

## Critical fix — dispatch quantity per line

```text
dispatch_qty = serial_numbers[product_id]?.length ?? request_line.quantity

if (central_stock < dispatch_qty) return 400 { error, details[] }   // BEFORE any UPDATE

central_stock -= dispatch_qty    // NOT requested_qty
```

**One line deducting `requested_qty` instead of serial count fails the whole dispatch** → PostgreSQL `products_quantity_check` (raw DB error). Validate every line against **`dispatch_qty`** before decrement.

### Multi-item request (partial per line)

| Line | Requested | Serials sent | Must deduct |
|------|-----------|--------------|-------------|
| 6KWP | 2 | 1 | **1** (not 2) |
| 8KWP | 3 | 3 | **3** |
| 10KWP | 2 | 2 | **2** |

Each line is independent in **one transaction** — partial on 6KWP must not block full dispatch on 8KWP/10KWP.

### Dispatch payload example

```json
{
  "serial_numbers": "{\"prod-6kw\":[\"XWS0326L06202N\"],\"prod-8kw\":[\"SN1\",\"SN2\",\"SN3\"],\"prod-10kw\":[\"SN-A\",\"SN-B\"]}"
}
```

No `items` field — frontend sends `serial_numbers` only.

---

## All backend issues (checklist)

| # | Error / issue | Fix | Status |
|---|----------------|-----|--------|
| 1 | Permission to update | No `PUT` before dispatch — Super Admin uses **`POST …/dispatch`** only | [x] |
| 2 | `products_quantity_check` | Deduct **`dispatch_qty`** only; validate before `UPDATE` | [x] |
| 3 | Insufficient stock on partial | Validate against **serial count**, not `requested_qty` | [x] |
| 4 | cannot exceed originally requested | Allow `dispatch_qty < requested`; **no `items`** field | [x] |
| 5 | Invalid serial | Same lookup on GET and POST — `utils/productSerialLookup.ts` | [x] |
| 6 | Multi-item partial | Each line independent in one transaction | [x] |
| 7 | Serials on meters | **Panels & Inverters only** — meters by line qty | [x] |
| 8 | Raw DB errors | Return `{ error, details[] }` with `product_name` | [x] |
| 9 | `serial_numbers` parse | `JSON.parse()` string in JSON body or multipart | [x] |

### Frontend (until backend deploys)

Frontend may **block partial dispatch in the UI** (e.g. 1 of 2 on 6KWP). After backend fix is deployed, partial dispatch works **without** sending `items`.

---

## Handler pseudocode

```text
POST /api/stock-requests/:id/dispatch
  parse serial_numbers (JSON.parse if string)
  snapshot requested_qty per line

  for each product_id in serial_numbers (Panels/Inverters only):
    dispatch_qty = serial_numbers[product_id].length
    assert 1 <= dispatch_qty <= requested_qty
    update stock_request_items.quantity = dispatch_qty

  for each line without serial_numbers entry:
    dispatch_qty = line.quantity   // meters, cables, etc.

  for each line:
    if central_stock < dispatch_qty → collect details[], return 400

  for each Panels/Inverters line:
    validate serials (shared productSerialLookup)
    transfer serials

  for each line:
    products.quantity -= dispatch_qty
    admin_inventory += dispatch_qty (if admin destination)

  status = dispatched
  return updated request + serials
```

**Order matters:** apply serial counts → validate stock → validate serials → decrement (single transaction).

---

## 1. Serial numbers — Panels & Inverters only

| Category | Serial required? | `serial_numbers` in body? |
|----------|------------------|---------------------------|
| **Panels** | ✅ | Yes |
| **Inverters** | ✅ | Yes |
| **Meters** | ❌ | Omitted — line qty |
| Cables, etc. | ❌ | Omitted |

---

## 2. Permissions

| Role | `PUT …/:id` | `POST …/:id/dispatch` |
|------|-------------|------------------------|
| Requester (admin) | ✅ | ✅ |
| Super Admin / Manager | ❌ | ✅ |

---

## 3. `POST /api/stock-requests/:id/dispatch`

| Field | Required | Notes |
|-------|----------|-------|
| `serial_numbers` | Panels/Inverters | JSON object or **stringified** JSON |
| `serial_number_ranges` | No | Super-admin only |
| `rejection_reason` | No | Reject path |
| `dispatch_image` | No | Multipart |
| `items` | **No** | Legacy — do not send |

---

## 4. Errors

### Insufficient stock

```json
{
  "error": "Insufficient stock in central inventory",
  "details": [{
    "product_id": "prod-6kw",
    "product_name": "6KWP-GTI-1PH",
    "dispatch_qty": 1,
    "requested_qty": 2,
    "available": 0,
    "short_by": 1,
    "message": "Insufficient stock for product 6KWP-GTI-1PH in central inventory"
  }]
}
```

### Serial errors

| Case | HTTP | Message |
|------|------|---------|
| Missing serials | 400 | `Serial numbers required for {name}` |
| Bad serial | 400 | `Serial number {sn} is not available` + `details[]` |

---

## 5. APIs

| Endpoint | Purpose |
|----------|---------|
| `GET /api/products/:id/serial-numbers?status=available&scope=central` | Serial picker (Panels/Inverters) |
| `GET /api/stock-requests/:id` | `dispatch_qty`, `requested_qty`, serials |
| `GET /api/admin-inventory/admin/:adminId` | `[]` when admin not found |

---

## 6. Implementation

| Area | File |
|------|------|
| Partial qty from serials | `applyDispatchQuantityFromSerialNumbers` |
| Stock `details[]` | `validateCentralInventoryForDispatch` |
| Shared serial lookup | `utils/productSerialLookup.ts` |
| Stringified JSON | `parseJsonBodyField` |
| Dispatch handler | `controllers/stockRequestController.ts` |

---

## 7. Test plan (14 cases)

1. **Partial 6KWP** — Requested 2, 1 serial → **200**; deduct **1**; line qty 1.
2. **`products_quantity_check`** — Insufficient stock returns **400 + details[]**, not raw PostgreSQL text.
3. **Multi-item partial** — 6KWP (1 of 2) + 8KWP (3 of 3) + 10KWP (2 of 2) → deduct 1, 3, 2 in one transaction.
4. **Allow partial** — `dispatch_qty < requested` succeeds; no `items` field; no “cannot exceed” error.
5. **Stock vs serial count** — Central stock 1, requested 3, 1 serial → **200** (not fail on 3).
6. **Meter qty** — No `serial_numbers` for meter → full line qty, no serial error.
7. **Mixed request** — Inverters + meter omitted from `serial_numbers`.
8. **Missing serials** — Panel/Inverter without serials → 400 `Serial numbers required for {name}`.
9. **Bad serial** — 400 with product **name** in `details[]`.
10. **Insufficient one line** — `details[]` with `dispatch_qty`, `requested_qty`, `short_by`.
11. **Multi-line stock fail** — Two products short → `details` length 2.
12. **Serial parse** — JSON body `{ "serial_numbers": "{\"prod-id\":[...]}" }` → parses.
13. **Multipart** — `dispatch_image` + stringified `serial_numbers`.
14. **GET = dispatch** — Serial in picker must succeed on dispatch (`productSerialLookup`).

---

## Related

- [`BACKEND_TEAM_SUMMARY.md`](./BACKEND_TEAM_SUMMARY.md)
- [`BACKEND_SERIAL_NUMBERS_DISPATCH_FIX.md`](./BACKEND_SERIAL_NUMBERS_DISPATCH_FIX.md)
- `API_DOCUMENTATION.md` §5.4
