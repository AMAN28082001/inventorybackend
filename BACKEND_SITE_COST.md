# Backend — Account Management Cost of site (`siteCost`)

**Why:** After Submit, Cost of site shows in the grid, but **hard refresh resets to ₹0** until GET echoes `siteCost` from DB.  
**Full pack:** **`BACKEND_ACCOUNT_PAYMENT_MANAGEMENT.md`**  
**Code:** `BACKEND_ADMIN_QUOTATION_STATUS.ts` · HANDOFF **§30**

---

## Product

| Field | Meaning |
|-------|---------|
| `siteCost` | Manual INR cost (blur / close / Submit) |
| Profit | FE only: `subtotal − siteCost` |

---

## DB

```sql
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS site_cost NUMERIC(14,2);
-- MySQL: ALTER TABLE quotations ADD COLUMN site_cost DECIMAL(14,2) NULL;
```

```js
siteCost: { type: DataTypes.DECIMAL(14, 2), allowNull: true, field: "site_cost" }
```

---

## PATCH

`PATCH /api/quotations/:id/payment-details`

```json
{
  "siteCost": 200000,
  "site_cost": 200000,
  "costOfSite": 200000,
  "cost_of_site": 200000,
  "replaceInstallments": false
}
```

1. Persist `site_cost`.  
2. Do **not** wipe installments.  
3. `0` clears.  
4. Response includes `siteCost` / `site_cost`.  
5. Also accept `siteCost` with `phases` on Submit.

---

## GET (required)

```json
{ "siteCost": 200000, "site_cost": 200000 }
```

List + detail for approved quotations.

---

## QA

1. Save ₹2,00,000 → DB has `site_cost`.  
2. GET returns `siteCost: 200000`.  
3. Hard refresh FE → grid still shows ₹2,00,000 + correct Profit.
