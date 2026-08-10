# Backend — Account Management Cost of site + Profit (required for hard refresh)

**Frontend:** Account Management → Payment Management  
- Manage modal: Cost of site → Profit = Subtotal − Cost of site  
- Grid columns: Cost of site + Profit  
- Save: blur / close / Submit  

**Critical:** FE currently keeps a **temporary browser cache** so refresh works on one device.  
**Backend must persist + echo `siteCost`** so all users/devices stay in sync and the cache can be removed.

**Code:** `BACKEND_ADMIN_QUOTATION_STATUS.ts` · HANDOFF **§30–§31**

---

## Must ship

| # | Deliverable | If missing |
|---|-------------|------------|
| **A** | Column `site_cost` on `quotations` | Cannot store |
| **B** | `PATCH …/payment-details` saves `siteCost` without wiping installments | Blur/Submit fails or clears phases |
| **C** | GET list + detail return `siteCost` / `site_cost` | Hard refresh shows ₹0 for other sessions |
| **D** | Installment paid cap = AM `subtotal − discount` | “payable after discount” reject |

Profit is **FE-only** — do **not** store.

---

## A) DB

```sql
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS site_cost NUMERIC(14,2);
-- MySQL:
-- ALTER TABLE quotations ADD COLUMN site_cost DECIMAL(14,2) NULL;
```

```js
siteCost: { type: DataTypes.DECIMAL(14, 2), allowNull: true, field: "site_cost" }
```

---

## B) PATCH — save Cost of site

### Blur / modal close

`PATCH /api/quotations/:id/payment-details`  
Also tried by FE: `…/site-cost`, `/admin/quotations/:id/payment-details`, `/admin/quotations/:id/site-cost`

```json
{
  "siteCost": 200000,
  "site_cost": 200000,
  "costOfSite": 200000,
  "cost_of_site": 200000,
  "replaceInstallments": false
}
```

| Rule | Detail |
|------|--------|
| Persist | Write `site_cost` |
| Clear | `0` clears |
| Installments | **Do not** replace/delete when `phases` absent or `replaceInstallments: false` |
| Auth | `account-management` \| `admin` |
| Response | `200` + body including `siteCost` / `site_cost` |

### Manage → Submit

```json
{
  "replaceInstallments": true,
  "siteCost": 200000,
  "site_cost": 200000,
  "paymentStatus": "partial",
  "phases": [ /* … */ ]
}
```

Persist **phases and `siteCost`**.

---

## C) GET — required after refresh

`GET /api/quotations?status=approved…`  
`GET /api/quotations/:id`

```json
{
  "id": "…",
  "subtotal": 270000,
  "siteCost": 200000,
  "site_cost": 200000
}
```

Example: subtotal ₹2,70,000 − site cost ₹2,00,000 → FE Profit ₹70,000.

Use `quotationToApiJson` in `BACKEND_ADMIN_QUOTATION_STATUS.ts`.

---

## D) Installment paid cap

Do **not** return:

> Total paid (X) cannot exceed payable after discount (Y)

Use:

```text
paymentCap = max(0, round(subtotal) - round(discountAmount))
```

Error: `Total paid (X) cannot exceed subtotal (Y)`  
Helper: `pickQuotationSubtotalForPayments`.

Site-cost-only PATCH: skip paid-vs-cap; do not wipe phases.

---

## FE call map

| UI | API |
|----|-----|
| Cost of site blur / close | `PATCH …/payment-details` `{ siteCost, replaceInstallments: false }` |
| Manage Submit | `PATCH …/payment-details` with `phases` + `siteCost` |
| Grid after hard refresh | `GET …?status=approved` **must** include `siteCost` |

---

## QA (backend acceptance)

1. PATCH siteCost `200000` → **200**, DB `site_cost = 200000`.  
2. GET approved list → same quotation has `"siteCost": 200000`.  
3. Hard refresh FE → grid Cost of site ₹2,00,000, Profit = subtotal − 200000.  
4. Site-cost-only PATCH does not clear installments.  
5. Submit installments with paid ≤ AM subtotal → **200**.

---

## Related

| Doc | Topic |
|-----|--------|
| `BACKEND_SITE_COST.md` | Short site-cost note |
| `BACKEND_CHANGES_HANDOFF.md` | **§30** / **§31** |
| `BACKEND_ADMIN_QUOTATION_STATUS.ts` | Copy-paste handlers |
| `BACKEND_INSTALLMENT_REPLACE.ts` | Replace phases |
| `BACKEND_FINAL_SETTLEMENT.md` | Status-only settlement |
