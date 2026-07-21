# Backend handoff — Account Management Final Settlement (Jul 2026)

Frontend: `app/dashboard/account-management/page.tsx` → `submitFinalSettlement`  
API client: `lib/api.ts` → `api.quotations.finalizeSettlement` (`updatePricing`, `updatePaymentDetails`, `updateDiscount`, `POST /final-settlement`)

**Copy-paste controllers:** [`BACKEND_FINAL_SETTLEMENT.ts`](./BACKEND_FINAL_SETTLEMENT.ts) — `postFinalSettlement`, `patchPricingWithSettlement`, `patchPaymentDetailsStatusOnly`, `patchDiscountAbsolute`, `extendQuotationJsonForSettlement` (+ route/migration snippets, QA).

**Settlement rule:** settlement amount = **Remaining only** (e.g. ₹2,000 → discount `d` on hover). **Do not** rewrite installments.

**Persistence is mandatory:** the client no longer falls back to localStorage when the API is on — if the backend does not persist, the user sees "Settlement not saved" and the button stays. GET must return `finalSettlementApplied: true` (and/or `finalSettlementAmount > 0`) so the button stays hidden after refresh on any device/role.

---

## ⛔ Errors the backend must STOP returning

These messages are the actual blockers. Remove the validations that produce them.

| Error message | Cause | Fix |
|---------------|-------|-----|
| `Total paid (290000) cannot exceed payable after discount (212000)` (VAL_012) | Payment update re-sent full installment array during settlement | **Status-only body: no paid-vs-payable check; don't require phases.** Skip the check entirely when no `phases`/`installments` array is present, and never rewrite installment rows on settle. |
| `Final amount must be between 0 and amount after subsidy` | `PATCH /pricing` recomputed the base and/or required `subtotal` | Treat `discountAmount` as **absolute INR**, do **not** require `subtotal`, validate `finalAmount` against the **stored** `amountAfterSubsidy`. |
| `Settlement amount (1000) cannot exceed remaining (0)` (VAL_014 — **removed**) | Server stored `remaining = 0` because its `amountAfterSubsidy` (₹189,000) < AM subtotal (₹190,000); AM still showed Remaining ₹1,000 | **Do NOT validate `settlementAmount` against stored `remaining`.** Treat settlement as "mark completed, remaining 0". Grow discount only up to `amountAfterSubsidy − paid` so payable never drops below paid (here that's `0`, so just mark completed). Still return `finalSettlementApplied: true` and store `finalSettlementAmount` (the requested amount) for audit. |

### The subtotal vs amountAfterSubsidy mismatch (SUSHILA / JITENDRA)

`"Settlement amount (1000) cannot exceed remaining (0)"` comes from the backend. For **SUSHILA DEVI BARI**, the server stores `amountAfterSubsidy = ₹189,000` (fully paid → remaining 0), but Account Management shows `subtotal ₹190,000` → remaining ₹1,000. The server rejects a write-off it thinks is unnecessary. That's the mismatch.

Rules to make this settle durably:

- **Never hard-reject** a settle because the server considers the balance cleared. Settlement always means **mark completed, `remaining = 0`, `finalSettlementApplied = true`**.
- Grow `discountAmount` only up to `amountAfterSubsidy − paid` (floored at 0). If that's `0` (server already fully paid), apply no extra discount but still complete the file — the AM-side ₹1,000 gap is reconciled on the frontend cache.
- Persist `finalSettlementAmount` = the **requested** amount (₹1,000) for audit, even if the applied discount was capped lower.
- Idempotent: a second settle returns 200 with the same state, no double-add.

> Frontend already degrades gracefully: when the server replies with `cannot exceed remaining` / `remaining (0)` / `already settled` / `already completed` / `nothing to settle`, the app treats it as **settled** (writes cache, marks completed, hides button, shows `d`). Only network/other errors show "Settlement not saved". Once the backend adopts the rules above, it persists server-side too (cross-device).

---

## Frontend call order (current)

1. **`PATCH /api/quotations/{id}/pricing`** — absolute `discountAmount` (= remaining), **no `subtotal` required**
2. **`PATCH /api/quotations/{id}/payment-details`** — **without phases** (status-only):

```json
{
  "paymentStatus": "completed",
  "remaining": 0,
  "finalSettlementAmount": 2000,
  "finalSettlementApplied": true,
  "replaceInstallments": false
}
```

3. Refresh approved list

**Do not** re-PUT / re-PATCH installments with full phase arrays for settlement — that caused:

`Total paid (290000) cannot exceed payable after discount (212000)` (VAL_012).

### Optional convenience

`POST /api/quotations/{id}/final-settlement` with `{ "amount": 2000 }`  
(Frontend does not require this if the two-step flow above works.)

---

## Must support

### `PATCH /pricing`

| Requirement | Detail |
|-------------|--------|
| Absolute `discountAmount` | Persist INR (e.g. +2000 remaining write-off); do not overwrite from % |
| `subtotal` optional | Keep stored package `subtotal` when omitted |
| Validate `finalAmount` | Against stored/computed `amountAfterSubsidy` when sent |

### `PATCH /payment-details` without phases

| Requirement | Detail |
|-------------|--------|
| Status-only body | Accept `paymentStatus`, `remaining`, `finalSettlement*` **without** `phases` / `installments` |
| Skip VAL_012 | **Do not** run “paid cannot exceed payable after discount” when phases are omitted |
| Leave installments alone | No delete/replace of `quotation_payment_phases` |
| `paymentStatus: completed` + `remaining: 0` | Allowed **only** when remaining formula is already ~0 (discount applied in step 1) |

### Remaining formula

```text
remaining = amountAfterSubsidy − discountAmount − sum(paid)
```

After settlement → **0**.

### Never fake completion

Do **not** return `remaining: 0` / `paymentStatus: completed` when an unpaid gap still exists **without** discount covering it.

Example: paid 150000 of 185000 → remaining **35000**, status **partial** (not completed).

### GET after settle

| Field | Expected |
|-------|----------|
| `discountAmount` | Includes settlement (e.g. 2000) |
| `remaining` / `remainingAmount` | `0` |
| `paymentStatus` | `completed` |
| `installments` / `paymentPhases` | Unchanged |

### Permissions

`account-management` allowed on **`/pricing`**, **`/payment-details`**, **`/discount`**, and optional **`/final-settlement`** for approved quotations.

---

## Pricing body example

```json
{
  "discountAmount": 2000,
  "totalAmount": 183000,
  "finalAmount": 183000
}
```

(`subtotal` omitted.)

---

## Optional DB columns (implemented)

| Column | Purpose |
|--------|---------|
| `finalSettlementAmount` | Amount written off |
| `finalSettlementApplied` | Audit flag (FE hides the button when true) |
| `finalSettlementAt` | Timestamp |
| `finalSettlementBy` | Actor id (account manager / admin) |

Migration: `20260720140000-final-settlement-fields.js` — run `yarn migrate`.

---

## Implementation status

| # | Behavior | Status |
|---|----------|--------|
| 1 | Pricing: absolute `discountAmount`, no `subtotal` required | Done |
| 2 | Payment-details status-only (no phases) → skip VAL_012 | Done |
| 3 | Never return completed/remaining 0 while unpaid gap without discount | Done |
| 4 | GET returns discountAmount + remaining + paymentStatus + installments | Done |
| 5 | AM on pricing + payment-details | Done |
| 6 | Optional `POST …/final-settlement` | Done |
| 7 | Audit columns `finalSettlement*` (+ `finalSettlementBy`) | Done |
| 8 | Removed VAL_014 `cannot exceed remaining`; cap discount at `amountAfterSubsidy − paid` | Done |

---

## QA

- [ ] Remaining ₹2,000 → settle → hover **d** shows 2000, remaining 0, status completed
- [ ] Installments unchanged (same i1, i2, …)
- [ ] Status-only payment-details does **not** return VAL_012 (290000 vs 212000)
- [ ] Paid 150k of 185k without discount → GET remaining 35000, **partial** (not completed / 0)
- [ ] `PATCH /pricing` with only `{ discountAmount: 2000 }` → 200
- [ ] **SUSHILA case:** server `amountAfterSubsidy` 189000, paid 189000 (remaining 0), settle amount 1000 → **200**, no `cannot exceed remaining`; `finalSettlementApplied: true`, `finalSettlementAmount: 1000`, `remaining: 0`, `completed`
- [ ] Second settle on the same quotation → 200, no double-add (idempotent)

---

## Code touchpoints

| File | Change |
|------|--------|
| `validations/quotationValidations.ts` | Status-only payment schema; `finalSettlementSchema` |
| `controllers/quotationController.ts` | Pricing / payment / reconcile / `submitQuotationFinalSettlement` |
| `routes/quotationRoutes.ts` | `POST …/final-settlement` |
| `models/Quotation.ts` + migration | `finalSettlement*` columns |
| `utils/quotationApiJson.ts` | Echo `discountAmount` |

Living docs: `BACKEND_CHANGES_REQUIRED.md` §AD, `BACKEND_CHANGES_HANDOFF.md` (Final Settlement pointer).
