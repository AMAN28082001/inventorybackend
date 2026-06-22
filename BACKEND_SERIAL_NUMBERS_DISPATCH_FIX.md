# Backend Fix: Product Serial Numbers for Dispatch UI

**Date:** June 2026  
**Symptom:** Serial shows as available in picker but dispatch fails with `Serial number {sn} is not available`.  
**Frontend:** `components/modals/enhanced-request-approval-modal.tsx`  
**Status:** Implemented

**See also:** [`BACKEND_TEAM_SUMMARY.md`](./BACKEND_TEAM_SUMMARY.md) (Priority 0) · [`BACKEND_CHANGES_STOCK_REQUEST_DISPATCH.md`](./BACKEND_CHANGES_STOCK_REQUEST_DISPATCH.md) (full dispatch spec — checklist #5, 14 tests)

**Related checklist item:** #5 Invalid serial — same `product_id` OR `product_name` lookup on GET and POST; if GET lists a serial, dispatch must accept it.

---

## Critical bug: GET vs dispatch mismatch

### Symptom

`GET /api/products/:id/serial-numbers?status=available&scope=central` lists serial `2602420290`, but `POST /api/stock-requests/:id/dispatch` rejects the same serial.

### Cause

GET and dispatch used **different lookup logic**:

| Path | Old behavior |
|------|----------------|
| **GET** | `product_id` first, fallback `product_name` (iLike); central owner scope; `status NOT IN (dispatched, acknowledged, sold)` |
| **Dispatch** | `product_id` **only**; `status = 'available'` only; **no** central owner filter |

Legacy rows with mismatched `product_id` appeared in GET but failed dispatch.

### Fix

**One shared module** — `utils/productSerialLookup.ts` — used by both:

```sql
-- Logical match (Sequelize)
WHERE status NOT IN ('dispatched', 'acknowledged', 'sold')
  AND (product_id = :productId OR product_name ILIKE :productName)
  AND (central owner scope when scope=central)
```

**Rule:** If GET returns a serial, dispatch **must** accept it.

### Debug

```sql
SELECT product_id, product_name, serial_number, status, owner_id, owner_type
FROM product_serial_numbers
WHERE serial_number = '2602420290';
```

If `product_id` ≠ request line id but `product_name` matches → shared lookup fixes it.

---

## `GET /api/products/:id/serial-numbers`

**Panels & Inverters only** — meters/cables return `serial_numbers: []` (200).

**Query params:**

| Param | Values | Purpose |
|-------|--------|---------|
| `status` | `available` (recommended) | Excludes `dispatched`, `acknowledged`, `sold` |
| `scope` | `central` | Limits to dispatchable central inventory |

**`scope=central` filter** — serials where:

- `owner_id` IS NULL and `owner_type` IS NULL, **or**
- `owner_type = 'super-admin'`, **or**
- `owner_id = current super-admin user` and `owner_type = 'super-admin'`

**Response:**

```json
{
  "product_id": "prod-inverter-54",
  "total_serial_numbers": 12,
  "available_count": 12,
  "serial_numbers": [ ... ]
}
```

---

## Frontend usage

```http
GET /api/products/{productId}/serial-numbers?status=available&scope=central
Authorization: Bearer <super-admin-token>
```

Use dispatched **quantity** from `POST …/dispatch` (after serial count resolution) when validating serial picker count.

---

## Parse `serial_numbers` on dispatch

Frontend may send JSON body with **stringified** `serial_numbers`:

```json
{
  "serial_numbers": "{\"prod-inverter-54\":[\"2602420290\"]}"
}
```

Multipart FormData also sends a JSON **string**. Backend `parseJsonBodyField()` runs `JSON.parse()` (supports one level of double-stringify).

---

## Implementation

| File | Role |
|------|------|
| `utils/productSerialLookup.ts` | Shared identity match, available status, central scope |
| `controllers/productController.ts` | `getProductSerialNumbers` |
| `controllers/stockRequestController.ts` | `findDispatchableCentralSerials`, `parseJsonBodyField` |

---

## Test plan

1. Product with 10 central available serials → `scope=central` returns 10.
2. Serials owned by admin only → excluded with `scope=central`.
3. Serial rows linked by `product_name` only → GET **and** dispatch both succeed.
4. **Regression:** Serial in GET list → dispatch accepts it (same shared lookup).
5. Meter product GET → `serial_numbers: []` (Panels/Inverters only).
6. **Serial parse** — JSON body with stringified `serial_numbers` → parses and dispatches.
7. **Multipart** — dispatch with image + stringified `serial_numbers` → parses correctly.
