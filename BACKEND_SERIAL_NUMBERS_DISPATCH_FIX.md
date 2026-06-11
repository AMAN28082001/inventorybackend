# Backend Fix: Product Serial Numbers for Dispatch UI

**Date:** June 2026  
**Symptom:** Dispatch approval modal shows **"Available serial numbers: 0"** despite central stock.  
**Frontend:** `components/modals/enhanced-request-approval-modal.tsx`  
**Status:** Implemented

---

## Problem

`GET /api/products/:id/serial-numbers?status=available` returned serials across **all owners** (including admin-mapped stock), or missed central pool serials when `product_id` on serial rows did not match. Super Admin dispatch needs **central / super-admin-owned** available serials only.

---

## Fix

### `GET /api/products/:id/serial-numbers`

**Query params:**

| Param | Values | Purpose |
|-------|--------|---------|
| `status` | `available` (recommended) | Excludes `dispatched`, `acknowledged`, `sold` |
| `scope` | `central` | Limits to dispatchable central inventory |

**`scope=central` filter** — serials where:

- `owner_id` IS NULL and `owner_type` IS NULL, **or**
- `owner_type = 'super-admin'`, **or**
- `owner_id = current super-admin user` and `owner_type = 'super-admin'`

**Fallback:** If no rows match `product_id`, query by `product_name` (case-insensitive) with same filters — handles legacy rows with mismatched `product_id`.

**Response additions:**

```json
{
  "product_id": "PANEL-001",
  "total_serial_numbers": 12,
  "available_count": 12,
  "serial_numbers": [ ... ]
}
```

`available_count` is set when `status=available`.

---

## Frontend usage

```http
GET /api/products/{productId}/serial-numbers?status=available&scope=central
Authorization: Bearer <super-admin-token>
```

Use dispatched **quantity** from `POST …/dispatch` `items` (after approver reduction) when validating serial picker count.

---

## Implementation

`controllers/productController.ts` → `getProductSerialNumbers`

---

## Test plan

1. Product with 10 central available serials → `scope=central` returns 10.
2. Serials owned by admin only → excluded with `scope=central`.
3. Serial rows linked by `product_name` only → still returned after fallback.
4. Without `scope=central` → previous behavior (all matching `product_id` / name).
