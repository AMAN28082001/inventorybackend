# Meter products — serial numbers optional

**Last updated:** June 2026  
**Frontend:** Already updated; backend must deploy these rules to stop validation errors on Meter create/edit/add-stock.

---

## Core rule

Serial numbers are **required only for Panels and Inverters**. Meters never use serials. All other categories (cables, structures, etc.) treat serials as optional.

| Category | Create | Edit | Add stock | Dispatch |
|----------|--------|------|-----------|----------|
| Panels / Inverters | Serials required | Serials required if adding stock | Serials required | Serials required |
| Meters | No serials | No serials | No serials | No serials |
| Others (cables, etc.) | Optional | Optional | Optional | Optional |

---

## Shared helper

**File:** `utils/productSerialLookup.ts` → `requiresSerialNumbers(category, productName)`

```ts
export const requiresSerialNumbers = (category, productName) => {
  const c = (category || '').toLowerCase().trim();
  if (c === 'meter' || c === 'meters') return false;
  if (['panels', 'panel', 'inverter', 'inverters'].includes(c)) return true;
  if (c.includes('panel') || c.includes('inverter')) return true;
  const name = (productName || '').toLowerCase();
  return name.includes('inverter') || name.includes('kwp') || name.includes('panel');
};
```

**Do not** require serials because the product name contains `"meter"`.  
`productRequiresSerialOnDispatch()` delegates to the same helper (dispatch + GET serial-numbers).

Replace any hardcoded `['panels', 'inverters', 'meter', 'meters']` lists with `requiresSerialNumbers()`.

| Old message | New message |
|-------------|-------------|
| Serial numbers are required for Panels, Inverters, and Meter categories | Serial numbers are required for Panels and Inverters. |
| Serial numbers are required for this category (on Meter edit) | Allow update — no serial check |

---

## 1. POST `/api/products` — create

Allow Meter create with `quantity > 0` and no `serial_numbers`.

```http
POST /api/products
```

```json
{
  "name": "SCHNEIDER 3 PHASE SOLAR METER",
  "category": "Meters",
  "quantity": 30,
  "unit": "MTR",
  "unit_price": 2900
}
```

**Expected:** `201` (not `400`).

Panels/Inverters with `quantity > 0` and no serials → `400` with message above.

---

## 2. PUT `/api/products/:id` — metadata-only edit

Metadata-only updates must **not** re-validate serials.

```http
PUT /api/products/:id
```

```json
{
  "name": "L&T 3 PHASE SOLAR METER",
  "model": "L&T 3 PHASE SOLAR METER",
  "category": "Meters",
  "unit": "Quantity"
}
```

No `quantity`, no `stock_to_add`, no `serial_numbers` → **200**.

Do not require serial rows when the product already has stock but no serials.

---

## 3. PUT `/api/products/:id` — add stock

For Meters, allow `stock_to_add` without `serial_numbers`:

```json
{ "stock_to_add": 10 }
```

Quantity increases by 10 only; no `product_serial_numbers` rows created.

---

## 4. POST `/api/stock-requests/:id/dispatch`

Meters dispatch by **line quantity only** — omit meter `product_id` from the `serial_numbers` map.

Full dispatch contract: [`BACKEND_CHANGES_STOCK_REQUEST_DISPATCH.md`](./BACKEND_CHANGES_STOCK_REQUEST_DISPATCH.md) §5.

---

## Quick test checklist

| Test | Expected |
|------|----------|
| Create Meter, qty 30, no serials | `201` |
| Edit Meter (name/unit only) | `200` |
| Add stock to Meter, `stock_to_add: 5`, no serials | `200` |
| Create Panel, qty 2, no serials | `400` |
| Dispatch request with meter line, no meter serials | `200` |

---

## Code touchpoints

| File | Change |
|------|--------|
| `utils/productSerialLookup.ts` | `requiresSerialNumbers()` + dispatch alias |
| `controllers/productController.ts` | Create, update, add-stock serial gates |
| `controllers/stockRequestController.ts` | Pass `productName` into serial-required checks |

---

## Related docs

| File | Purpose |
|------|---------|
| [`BACKEND_TEAM_SUMMARY.md`](./BACKEND_TEAM_SUMMARY.md) | Priority 0.6 summary |
| [`BACKEND_CHANGES_STOCK_REQUEST_DISPATCH.md`](./BACKEND_CHANGES_STOCK_REQUEST_DISPATCH.md) | Dispatch rule |
| [`BACKEND_SERIAL_NUMBERS_DISPATCH_FIX.md`](./BACKEND_SERIAL_NUMBERS_DISPATCH_FIX.md) | GET vs POST serial lookup parity |
