# Backend Changes: Decimal Prices, Product Unit & Kg → Pieces

**Last Updated:** June 2025  
**Status:** Implemented in this repo  
**Frontend:** `components/modals/product-modal.tsx`, `lib/utils.ts`, `PRODUCT_CATALOG_REFERENCE.json`

---

## Bottom line

Backend **stores what the frontend sends** — decimal per-piece prices, integer piece quantities, and **`unit` on every product**. No kg conversion logic on the server unless you add audit columns later.

---

## 1. Decimal prices

Store `unit_price`, `selling_price`, `default_price`, `cost_price` as `DECIMAL(10, 2)` (products table may use `DECIMAL(12, 2)` — equivalent for values like `85.45`, `153.00`).

**Validation:** reject negatives only; do not require integer prices.

```sql
ALTER TABLE products ALTER COLUMN unit_price TYPE DECIMAL(10, 2);
ALTER TABLE products ALTER COLUMN selling_price TYPE DECIMAL(10, 2);
ALTER TABLE product_serial_numbers ALTER COLUMN cost_price TYPE DECIMAL(10, 2);
ALTER TABLE product_serial_numbers ALTER COLUMN price TYPE DECIMAL(10, 2);
```

**Code:** `roundProductPrice()` in `utils/productUnit.ts`; `validations/productValidations.ts`

---

## 2. Product `unit` column (required for catalog)

Frontend sends `unit` on create/update for **all** products (catalog picks and manually typed names).

```sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit VARCHAR(50);
```

| Operation | Behavior |
|-----------|----------|
| `POST /api/products` | Accept `unit` e.g. `"Meters"`, `"Quantity"`, `"Pieces"`, `"Kilograms"` |
| `PUT /api/products/:id` | Accept `unit`; user can edit/fix unit later (`PUT` body `{ "unit": "Quantity" }` only) |
| `GET /api/products` | Return `unit` on **every** product (e.g. stock UI: `900 Meters`, `69 Quantity`) |

Codes normalized to display names on save: `PCS`→`Pieces`, `KGS`→`Kilograms`, `MTR`→`Meters`, `NOS`→`Quantity`.

**Migration:** `database/migrations/20260605120000-add-unit-column-to-products.js`  
**Bootstrap:** `config/sequelizeBootstrap.ts` → `ensureProductUnitColumn`

---

## 3. Kg → pieces (frontend converts; backend stores final values)

| User enters | API receives |
|-------------|--------------|
| 10.5 kg | `quantity: 23` (pieces) |
| ₹340/kg at 0.45 kg/piece | `unit_price: 153.00` (per piece) |
| Catalog unit KGS | `unit: "Pieces"` |

**Not sent:** `total_weight_kg`, `weight_per_piece_kg`, `price_per_kg`

```json
{
  "quantity": 23,
  "unit": "Pieces",
  "unit_price": 153.00
}
```

---

## 4. Unit validation (fixes 400 errors)

| Display | Code |
|---------|------|
| Pieces | PCS |
| Kilograms | KGS |
| Meters | MTR |
| Quantity | NOS |

Also: `Watts`/`W`, `Pack`/`PAC`, `Fixed`, `Pillar`.

- Do **not** require `unit: "KGS"` for catalog kg items after conversion — store as `Pieces`.
- If `unit` is **omitted** on update, leave existing unit unchanged.
- No catalog-unit mismatch validation.

**Code:** `utils/productUnit.ts` → `isAllowedProductUnit`, `normalizeProductUnit`

---

## 5. Stock rules

| Rule | Detail |
|------|--------|
| `stock_to_add` | Integer **pieces** (not kg) |
| Additive | `new_quantity = current_quantity + stock_to_add` |
| KGS structural items | Nut bolts, J hooks — serial numbers **optional** (not Panels/Inverters/Meter) |

---

## 6. Endpoints checklist

| Endpoint | Must support | Status |
|----------|--------------|--------|
| `POST /api/products` | Decimal prices, `unit`, integer `quantity` for kg products | ✅ |
| `PUT /api/products/:id` | `stock_to_add` as pieces, optional `unit`, decimal prices | ✅ |
| `GET /api/products` | Return `unit`, `unit_price`, `selling_price` as decimals | ✅ |
| `GET /api/products/:id` | Same + serial `cost_price` as decimal | ✅ |

**Code:** `controllers/productController.ts`, `utils/productApiFormat.ts`

---

## 7. Optional later (not required)

| Column / API | Purpose |
|--------------|---------|
| `weight_per_piece_kg` | Store piece weight on product |
| `last_stock_weight_kg` | Audit trail of weight entered |
| Catalog API | Replace static JSON for piece weights |

---

## 8. Quick test plan

1. Create with `unit_price: 85.45` → GET returns `85.45`
2. Create kg product with `quantity: 23`, `unit: "Pieces"`, `unit_price: 153.00` → no 400
3. Add stock with `stock_to_add: 11` → quantity increases by **11 pieces**
4. Create custom name with `unit: "Meters"` → GET returns `unit: "Meters"`
5. `PUT` only `{ "unit": "Quantity" }` on edit → unit updates

### curl examples

```bash
API="http://localhost:3050/api"
TOKEN="<jwt>"

# Custom product with unit
curl -sS -X POST "$API/products" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Custom Cable","model":"10mm","category":"Accessories","quantity":900,"unit":"Meters","unit_price":12.50}'

# Kg→pieces create
curl -sS -X POST "$API/products" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Nut Bolt 5inch 4suit","model":"Nut Bolt 5inch 4suit","category":"Structural Components","quantity":23,"unit":"Pieces","unit_price":153.00}'

# Fix unit only
curl -sS -X PUT "$API/products/{id}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"unit":"Quantity"}'
```

---

## Deploy

```bash
yarn migrate   # products.unit column
yarn build
# restart API
```

---

## Related

- `BACKEND_CHANGES_REQUIRED.md` §N — sprint checklist
- Frontend: `convertKgWeightToPieces()`, `resolveInventoryForSave()` in product modal
