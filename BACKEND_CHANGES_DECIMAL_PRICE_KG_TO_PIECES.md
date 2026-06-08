# Backend Changes: Decimal Prices & Kg → Pieces Inventory

**Last Updated:** June 2025  
**Status:** Implemented in this repo  
**Frontend:** `components/modals/product-modal.tsx`, `lib/utils.ts`, `PRODUCT_CATALOG_REFERENCE.json`

---

## Overview

Product Manager / Super Admin **Add Product** and **Add Stock** flows:

1. **Decimal prices** — e.g. `85.45` for unit/cost/selling price.
2. **Kg → pieces** — user may enter decimal weight in the UI (e.g. `10.5` kg); **frontend** converts to whole pieces before the API call.

**Important:** All **kg → piece conversion** (weight **and** price) happens on the **frontend**. The backend only stores final values — integer pieces and **per-piece** `unit_price`. It does **not** receive `total_weight_kg`, `weight_per_piece_kg`, or `price_per_kg`. Optional audit columns are not required now.

---

## Required backend changes (checklist)

| # | Requirement | Status |
|---|-------------|--------|
| 1 | `DECIMAL(10,2)` (or equivalent) on all price columns | ✅ |
| 2 | Accept `unit_price: 85.45` / `153.00` per-piece (reject negatives only) | ✅ |
| 3 | Accept `unit: "Pieces"` for ex-KGS catalog products | ✅ |
| 4 | Stop catalog-unit mismatch validation (no forced `KGS`) | ✅ |
| 5 | `stock_to_add` adds **pieces**, not kg (`current + stock_to_add`) | ✅ |
| 6 | GET returns decimal prices without truncation | ✅ |
| 7 | KGS structural items (nut bolts, J hooks) — no serials required | ✅ (existing category rules) |
| 8 | Omit `unit` on update → leave existing unit unchanged | ✅ |

---

## 1. Decimal prices

### Database

```sql
-- products (already DECIMAL in migrations; verify on deploy)
ALTER TABLE products ALTER COLUMN unit_price TYPE DECIMAL(12, 2);
ALTER TABLE products ALTER COLUMN selling_price TYPE DECIMAL(12, 2);

-- product_serial_numbers
ALTER TABLE product_serial_numbers ALTER COLUMN cost_price TYPE DECIMAL(10, 2);
ALTER TABLE product_serial_numbers ALTER COLUMN price TYPE DECIMAL(10, 2);
```

| Field | Where |
|-------|--------|
| `unit_price` | Product create/update |
| `selling_price` | Super Admin selling price |
| `default_price` | Bulk cost when adding stock with serials |
| `serial_number_prices` | Per-serial cost map |
| `cost_price` | `product_serial_numbers` |

### Validation

- Accept decimals up to 2 places (`85.45`, `134.29`).
- Reject **negative** only — do not require integers for prices.
- `roundProductPrice()` in `utils/productUnit.ts` rounds on save.

---

## 2. Kg → pieces & per-piece price (frontend → backend contract)

### Frontend formulas (client only — no backend math)

```
pieces = Math.round(total_weight_kg / weight_per_piece_kg)
unit_price = round(price_per_kg * weight_per_piece_kg, 2)   // per piece, not per kg
```

### What the user enters vs what the API receives

| User enters | Backend receives |
|-------------|------------------|
| 10.5 kg total weight | `quantity: 23` (whole pieces) |
| ₹340/kg at 0.45 kg/piece | `unit_price: 153.00` (per piece) |
| Catalog unit KGS | `unit: "Pieces"` |

**Not sent:** `total_weight_kg`, `weight_per_piece_kg`, `price_per_kg`.

### POST `/api/products` (create)

```json
{
  "name": "Nut Bolt 5inch 4suit",
  "model": "Nut Bolt 5inch 4suit",
  "category": "Structural Components",
  "quantity": 23,
  "unit": "Pieces",
  "unit_price": 153.00
}
```

### PUT `/api/products/:id` (add stock)

User adds **5 kg**; **0.45 kg/piece** → **11 pieces**.

```json
{
  "stock_to_add": 11,
  "unit": "Pieces",
  "quantity": 34
}
```

- `stock_to_add` = integer **pieces** (additive).
- `quantity` (optional) = `current + stock_to_add` when frontend sends both.

---

## 3. Unit validation (fixes 400 errors)

### Accept display names and codes

| Display (frontend) | Code (also accept) |
|--------------------|--------------------|
| Pieces | PCS |
| Kilograms | KGS |
| Meters | MTR |
| Quantity | NOS |
| Watts | W |
| Pack | PAC |

Also: `Fixed`, `Pillar`.

### Rules

- After kg conversion, persist **`Pieces`** (normalize `PCS` → `Pieces`).
- **Do not** require `unit: "KGS"` because catalog lists KGS.
- If `unit` is **omitted** on update, leave existing unit unchanged.
- No catalog-unit mismatch checks.

**Code:** `utils/productUnit.ts`, `validations/productValidations.ts`  
**DB:** `products.unit` — `database/migrations/20260605120000-add-unit-column-to-products.js`, bootstrap `ensureProductUnitColumn`

---

## 4. Stock rules

| Rule | Detail |
|------|--------|
| Integer stock | `quantity` and `stock_to_add` are whole numbers after kg conversion |
| Additive stock | `new_qty = current + stock_to_add` |
| No serials for KGS items | Nut bolts / J hooks — not Panels/Inverters/Meter |
| Decimal qty (other units) | Meters may send decimals from frontend; kg→pieces path uses integers |

---

## 5. Endpoints

### `POST /api/products`

- [x] `unit_price` with 2 decimal places
- [x] `unit: "Pieces"` + integer `quantity` for converted kg products
- [x] Display unit names

### `PUT /api/products/:id`

- [x] `stock_to_add` as integer pieces
- [x] Optional `unit: "Pieces"` when adding kg-based stock
- [x] Decimal `default_price` / `unit_price`
- [x] No failure when `unit` changes Kilograms → Pieces

### `GET /api/products` / `GET /api/products/:id`

- [x] `unit_price`, `selling_price` as decimal numbers
- [x] Stored `unit` (e.g. `"Pieces"`)

**Code:** `controllers/productController.ts`, `utils/productApiFormat.ts`

---

## 6. Test plan

1. **Decimal price** — Create with `unit_price: 153.00`; GET returns `153` (JSON number; DB stores `153.00`).
2. **Kg create** — POST `quantity: 23`, `unit: "Pieces"` for Nut Bolt; no 400.
3. **Kg add stock** — PUT `stock_to_add: 11`, `unit: "Pieces"`; quantity increases by 11 pieces.
4. **Unit codes** — Accept `"PCS"`; stored as `"Pieces"`.
5. **Update without unit** — Change name/price only; no unit validation error.

---

## 7. Optional later (not required)

| Column / API | Purpose |
|--------------|---------|
| `weight_per_piece_kg` on `products` | Server-side piece weight |
| `last_stock_weight_kg` | Audit of weight entered |
| Catalog API with `weight_per_piece_kg` | Replace static JSON |

---

## 8. Deploy

```bash
yarn migrate   # products.unit column
yarn build
# restart API
```

---

## Related

- `BACKEND_CHANGES_REQUIRED.md` §N — sprint checklist
- Frontend: `convertKgWeightToPieces()` in `lib/utils.ts`; `resolveInventoryForSave()` in `product-modal.tsx`
