# Backend Changes: Stock Request Dispatch (Permission Fix)

**Date:** June 2026  
**Frontend:** `components/modals/enhanced-request-approval-modal.tsx`, `lib/api.ts`  
**Status:** Implemented

---

## 1. Permission fix

Super Admin saw **"You do not have permission to update this request"** because the frontend called **`PUT /api/stock-requests/:id`** before dispatch. That endpoint is **requester-only** (`requested_by_id === current user`).

| Method | Path | Who |
|--------|------|-----|
| `PUT` | `/api/stock-requests/:id` | **Requester only** |
| `POST` | `/api/stock-requests/:id/dispatch` | **super-admin**, **admin** |

**Fix:** Send final line quantities on **`POST /api/stock-requests/:id/dispatch`** via optional `items` — **no prior PUT required**.

---

## 1.2 Insufficient central stock error

After the permission fix, dispatch may return:

```json
{
  "error": "Insufficient stock",
  "details": [
    {
      "product_id": "INV-001",
      "product_name": "3.6KWP-GTI-1PH-XWATT",
      "path": "items.INV-001.quantity",
      "message": "Insufficient stock for product 3.6KWP-GTI-1PH-XWATT in central inventory (available: 5, requested: 10)",
      "requested_quantity": 10,
      "central_stock": 5
    }
  ]
}
```

| Rule | Behavior |
|------|----------|
| Valid error | `central_stock < requested quantity` for any line |
| Multi-line | **All** failing lines returned in `details[]` (not only the first product) |
| Admin source | Same shape with `available_stock` instead of `central_stock` |
| Atomic | Stock check → serial validation → deduction in **one transaction** (rollback on any failure) |

**Dispatch order (recommended — implemented):**

1. Resolve final quantity per line (`items` override or request line quantity).
2. **Check stock** for every line (central or source-admin inventory).
3. **Validate serials** (meter / serial-tracked products).
4. **Deduct** inventory and mark request `dispatched`.

---

## 2. Stock API alignment

`GET /api/products` and `GET /api/products/:id` must expose stock that matches dispatch validation.

| Field | Source | Used by |
|-------|--------|---------|
| `quantity` | `products.quantity` | Central warehouse on-hand |
| `central_stock` | Same as `quantity` | Dispatch modal display (explicit alias) |

Dispatch checks **`products.quantity`** for super-admin (`requested_from_role === 'super-admin'`). If the modal shows **50** but dispatch fails, the API was reading a different field — both `quantity` and `central_stock` now mirror `products.quantity` via `formatProductForApi`.

---

## 3. `POST /api/stock-requests/:id/dispatch`

**Content-Type:** `multipart/form-data` (when `dispatch_image` present) or `application/json`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `rejection_reason` | string | No | If set → reject (no dispatch) |
| `dispatch_image` | file | No | Stored in S3 |
| `items` | JSON array **or** string | No | `[{ "product_id", "quantity" }]` — approver-reduced qty |
| `serial_numbers` | JSON object **or** string | No | `{ "<product_id>": ["SN1", …] }` |
| `serial_number_ranges` | JSON object **or** string | No | Super-admin only |

**Multipart:** `items`, `serial_numbers`, `serial_number_ranges` arrive as **JSON strings** when using FormData.

**Example:**

```http
POST /api/stock-requests/42/dispatch
Content-Type: multipart/form-data

items=[{"product_id":"PANEL-001","quantity":8}]
serial_numbers={"PANEL-001":["SN1001","SN1002"]}
```

### Line quantity validation (`items`)

| Rule | Error |
|------|-------|
| `items` is JSON array when sent | `items must be a JSON array` |
| Each entry has `product_id` | `Each items entry must include product_id` |
| `quantity >= 1` | `Quantity for product … must be at least 1` |
| `product_id` on request | `Product … is not on this stock request` |
| `quantity <=` originally requested | `cannot exceed originally requested quantity` |
| Omitted lines | Keep original requested quantity |

Persisted on `stock_request_items` in the same transaction as dispatch.

---

## 4. Serial numbers (still required for meter products)

Meter / serial-tracked products require serial selection on super-admin dispatch.

| Requirement | Endpoint / rule |
|-------------|-----------------|
| List available central serials | `GET /api/products/:id/serial-numbers?status=available&scope=central` |
| Serial count = dispatched qty | Per line when `serial_numbers` or `serial_number_ranges` sent |
| Tracked products | Any row in `product_serial_numbers` for `product_id` |

See **`BACKEND_SERIAL_NUMBERS_DISPATCH_FIX.md`**.

---

## 5. Error responses

| HTTP | When | Body |
|------|------|------|
| **200** | Success | Updated stock request + optional `serial_numbers` |
| **400** | Validation / insufficient stock / serial mismatch | `{ "error": "…" }` or `{ "error": "Insufficient stock", "details": […] }` |
| **403** | Not allowed to dispatch / update | `{ "error": "…" }` |
| **404** | Request not found | `{ "error": "…" }` |

**Single-line insufficient stock (legacy message still in `details[0].message`):**

```text
Insufficient stock for product 3.6KWP-GTI-1PH-XWATT in central inventory (available: 5, requested: 10)
```

---

## 6. Implementation

| Area | File |
|------|------|
| Dispatch + `items` + stock `details[]` | `controllers/stockRequestController.ts` |
| `quantity` / `central_stock` alignment | `utils/productApiFormat.ts` → `formatProductForApi` |
| Central serial list | `controllers/productController.ts` → `getProductSerialNumbers` |
| Route + auth | `routes/stockRequestRoutes.ts` |

---

## 7. Backend checklist

- [x] Super Admin dispatch without prior `PUT`
- [x] Optional `items` on `POST …/dispatch`
- [x] Central stock check before serial validation and deduction
- [x] Atomic transaction (rollback on failure)
- [x] Multi-item `details[]` for insufficient stock
- [x] `GET /api/products` returns `quantity` + `central_stock` (same source as dispatch)
- [x] Serial numbers for meter products (`scope=central`)
- [ ] QA: insufficient stock single-line + multi-line failure cases in staging

---

## 8. Test plan

1. **Dispatch without PUT** — Super Admin reduces qty → `POST …/dispatch` with `items` → 200.
2. **Insufficient stock (one line)** — Request 10, central has 5 → 400, `details` length 1, `central_stock: 5`.
3. **Insufficient stock (multi-line)** — Two products short → 400, `details` length 2 (both lines).
4. **Stock alignment** — `GET /products/:id` `central_stock` equals value used in dispatch error.
5. **Serial count** — 8 serials for qty 8 → OK; mismatch → 400.
6. **Reject** — `rejection_reason` only → `rejected`, no inventory change.
7. **Serial picker** — `GET …/serial-numbers?status=available&scope=central` > 0 when central stock exists.

---

## Related

- `BACKEND_SERIAL_NUMBERS_DISPATCH_FIX.md`
- `API_DOCUMENTATION.md` §5.4
