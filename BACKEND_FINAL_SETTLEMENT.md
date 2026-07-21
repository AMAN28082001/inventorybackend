# Backend handoff — Account Management Final Settlement (Jul 2026)

Frontend: `app/dashboard/account-management/page.tsx` → `submitFinalSettlement`  
API client: `lib/api.ts` → `finalizeSettlement` (persists to DB; throws if nothing saved server-side)

> **DATABASE IS THE ONLY SOURCE OF TRUTH — persistence is mandatory.**
> The frontend has **removed ALL cache / localStorage / sessionStorage** for settlement.
> It no longer remembers settlements on the device. Therefore:
> - If the server does **not** persist the settlement, the UI shows **"Settlement not saved"**
>   and keeps the **Submit final settlement** button visible (nothing is faked).
> - The settled state (net subtotal, `d`, remaining 0, hidden button) appears for **every
>   login on every device ONLY because the backend stored it and returns it on `GET`.**
> - So the backend MUST (a) accept the write without error, (b) persist
>   `finalSettlementApplied` + `finalSettlementAmount` + `discountAmount` + `remaining=0` +
>   `paymentStatus=completed`, and (c) return them on every `GET`. There is no client-side
>   safety net anymore.

**Share this file with backend.** Copy-paste controllers with full logging: **`BACKEND_FINAL_SETTLEMENT.ts`**.

---

## STEP-BY-STEP backend implementation (do these in order)

**Step 1 — DB migration.** Add the settlement columns:

```sql
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS final_settlement_applied BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS final_settlement_amount  NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_settlement_at      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS final_settlement_by      UUID NULL,
  ADD COLUMN IF NOT EXISTS remaining_amount         NUMERIC(12,2) DEFAULT 0;

-- CRITICAL: settlement stores the absolute INR write-off in `discount` too. If that
-- column is NUMERIC(5,2) (legacy percentage, max 999.99), writing e.g. 7000 throws
-- "numeric field overflow" → 500 on submit. Widen it to match the money columns:
ALTER TABLE quotations ALTER COLUMN discount TYPE NUMERIC(12,2);
```

**Step 2 — Model.** Map the columns on the `Quotation` Sequelize model:

```js
finalSettlementApplied: { type: DataTypes.BOOLEAN, defaultValue: false, field: 'final_settlement_applied' },
finalSettlementAmount:  { type: DataTypes.DECIMAL(12,2), defaultValue: 0, field: 'final_settlement_amount' },
finalSettlementAt:      { type: DataTypes.DATE, allowNull: true, field: 'final_settlement_at' },
finalSettlementBy:      { type: DataTypes.UUID, allowNull: true, field: 'final_settlement_by' },
remainingAmount:        { type: DataTypes.DECIMAL(12,2), defaultValue: 0, field: 'remaining_amount' },
discount:               { type: DataTypes.DECIMAL(12,2), defaultValue: 0 }, // widen from (5,2)
```

**Step 3 — Controllers.** Copy the four handlers from `BACKEND_FINAL_SETTLEMENT.ts`
(`postFinalSettlement`, `patchPricingWithSettlement`, `patchPaymentDetailsStatusOnly`,
`patchDiscountAbsolute`). They already include the detailed `logFS` logging.

**Step 4 — Routes.** Register (auth = `account-management` or `admin`):

```js
router.post ('/quotations/:id/final-settlement', authRequired, postFinalSettlement)
router.patch('/quotations/:id/pricing',          authRequired, patchPricingWithSettlement)
router.patch('/quotations/:id/payment-details',  authRequired, patchPaymentDetailsStatusOnly)
router.patch('/quotations/:id/discount',         authRequired, patchDiscountAbsolute)
```

**Step 5 — GET serializer.** In `quotationToApiJson` (used by BOTH `GET /quotations` and
`GET /quotations/:id`) always return: `finalSettlementApplied`, `finalSettlementAmount`,
`discountAmount`, `pricing.discountAmount`, `remaining`, `remainingAmount`, `paymentStatus`,
and the unchanged `installments`. See `extendQuotationJsonForSettlement`.

**Step 6 — Verify with logs.** Click Submit and read the server terminal (see the log
lifecycle below). Confirm `③ DIFF` shows `finalSettlementApplied: false→true` and
`remaining: N→0`, and there are no `⚠ WARN` lines.

---

## Detailed console log lifecycle (what you'll see per request)

Every handler logs a timestamped, staged trace so you can confirm the data end-to-end:

```
[FinalSettlement 2026-07-21T..Z] ▶ IN  POST /final-settlement {"quotationId":"QT-..","user":"..","role":"account-management","body":{"amount":2000,"settlementAmount":2000,"discountAmount":2000,"finalAmount":290000,"paymentStatus":"completed","remaining":0,"finalSettlementApplied":true}}
[FinalSettlement ..Z] ⚙ COMPUTE {"existingDiscount":0,"amountAfterSubsidy":292000,"paid":290000,"discountAmount":2000,"settlementAmount":2000,"finalAmount":290000,"remaining":0,"paymentStatus":"completed"}
[FinalSettlement ..Z] ① BEFORE (db state) {"discountAmount":0,"remaining":2000,"paymentStatus":"partial","finalSettlementApplied":false,"paidSum":290000,...}
[FinalSettlement ..Z] ② AFTER (db state)  {"discountAmount":2000,"remaining":0,"paymentStatus":"completed","finalSettlementApplied":true,"finalSettlementAmount":2000,"paidSum":290000,...}
[FinalSettlement ..Z] ③ DIFF (what changed) {"discountAmount":{"from":0,"to":2000},"remaining":{"from":2000,"to":0},"paymentStatus":{"from":"partial","to":"completed"},"finalSettlementApplied":{"from":false,"to":true},"finalSettlementAmount":{"from":0,"to":2000}}
[FinalSettlement ..Z] ◀ OUT 200 {...quotation returned to client...}
```

Stage legend:
| Tag | Meaning | Use it to check |
|-----|---------|-----------------|
| `▶ IN` | Request received | The body actually arrived with the right fields |
| `⚙ COMPUTE` | Derived numbers | discount/finalAmount math is correct |
| `① BEFORE` | DB row before save | Starting state (partial, remaining > 0) |
| `② AFTER` | DB row after `reload()` | It really persisted (completed, remaining 0) |
| `③ DIFF` | Exact field changes | Only intended fields changed; installments untouched |
| `⚠ WARN` | Persist mismatch | Column not mapped → fix model/migration |
| `◀ OUT` | Response payload | Client receives the settled fields |
| `✖ ERROR` | Crash + stack | Exact line that caused a 500 |

If `③ DIFF` is empty or `⚠ WARN` appears, the columns aren't mapped (redo Steps 1–2).
If `✖ ERROR` appears, paste its `stack` — that's the 500 root cause.

---

## What Final Settlement means

| Field | Meaning |
|-------|---------|
| **Settlement amount** | = **Remaining** only (Account Management installment math) |
| **Discount `d`** | That settlement amount (e.g. **₹2,000**) |
| **Paid** | Unchanged (installment rows are **not** rewritten) |
| **Remaining after** | **₹0** |
| **paymentStatus** | **`completed`** |

### Example — JITENDRA (production error case)

| | Before | After Submit final settlement |
|--|--------|-------------------------------|
| Subtotal / AM payment cap | ₹292,000 | ₹292,000 (unchanged) |
| Paid (sum of installments) | ₹290,000 | ₹290,000 (unchanged) |
| Remaining | ₹2,000 | **₹0** |
| Settlement / discount `d` | — | **₹2,000** |
| paymentStatus | `partial` | **`completed`** |

Hover after settle:

```
i1: ₹…
i2: ₹…
i3: ₹…
d: ₹2,000
```

---

## Frontend call order (current — `finalizeSettlement`)

The client tries up to **4 DB writes**, in order, until one succeeds:

```
1) POST /api/quotations/{id}/final-settlement          ← PREFERRED (atomic, one DB write)
      { amount: 2000, settlementAmount: 2000,
        discountAmount: <existing + 2000>, finalAmount,
        paymentStatus: "completed", remaining: 0, remainingAmount: 0,
        finalSettlementApplied: true }

   If 404/405/501 (missing) OR "already cleared" (see below), falls back to:

2) PATCH /api/quotations/{id}/pricing
      { discountAmount: existingDiscount + settlementAmount, totalAmount, finalAmount }
   then PATCH /api/quotations/{id}/payment-details      ← NO phases / NO installments
      { paymentStatus: "completed", remaining: 0, remainingAmount: 0,
        finalSettlementAmount: 2000, finalSettlementApplied: true,
        replaceInstallments: false }

3) PATCH /api/quotations/{id}/discount                 { discount: <INR> }

4) PATCH /api/quotations/{id}/payment-details          ← FLAG-ONLY (no discount)
      { paymentStatus: "completed", remaining: 0, remainingAmount: 0,
        finalSettlementAmount: 2000, finalSettlementApplied: true,
        replaceInstallments: false }
   ^ This is the GLOBAL fallback for the subtotal>amountAfterSubsidy mismatch: when the
     server refuses a discount because it thinks the file is already paid, it must still
     accept this flag write so EVERY login sees remaining 0 + hidden button.

5) GET /api/quotations?status=approved                 ← must reflect settled state
```

**"Already cleared" responses** (message containing `cannot exceed remaining`,
`remaining (0)`, `already settled`, `already completed`, `nothing to settle`, or
`paid … exceed`) are NOT treated as fatal — the client keeps trying the next write and,
if the server still reports the file cleared, marks it settled. So the backend should
prefer to **accept and persist the flag** rather than 400 on these.

**Only if all 4 writes fail (and the server does not report it cleared)** does the client
show "Settlement not saved". So at least one endpoint MUST persist `finalSettlementApplied`.

### Critical: do **not** require installment rewrite

Frontend **no longer** sends `phases` / `installments` on Final Settlement.

**Bug that must stay fixed on backend:** if payment-details still runs  
`sum(paid) ≤ payableAfterDiscount` when body has **no** phases, or if an old client resends phases, this fails:

> Total paid (290000) cannot exceed payable after discount (212000)

AM payment cap (₹292,000) can differ from pricing “payable after discount” (₹212,000).  
Settlement is only **₹2,000** — do not reject status-only updates because of that mismatch.

**Rules for `PATCH /payment-details`:**

| Body | Behaviour |
|------|-----------|
| Has `phases` / `installments` + replace | Replace rows; may validate paid vs **AM payment cap** (see below) |
| **No** phases; only `paymentStatus` / `remaining` / `finalSettlementAmount` | Update status + remaining + settlement fields only; **do not** validate paid vs pricing payable; **do not** delete installments |

---

## Required API behaviour

### A) `PATCH /api/quotations/{id}/pricing`

**Example (JITENDRA — settlement ₹2,000):**

```json
{
  "discountAmount": 2000,
  "totalAmount": 290000,
  "finalAmount": 290000
}
```

If quotation already had a pricing discount of ₹5,000, frontend sends `discountAmount: 7000` (existing + settlement).

**Must:**

- Treat `discountAmount` as **absolute INR** (do not overwrite from %)
- **Not** require `subtotal` in body
- Validate `finalAmount` against **stored** `amountAfterSubsidy` (not a rewritten subtotal)
- Allow role **`account-management`** on approved quotations
- After save, optionally set `remaining = max(0, amCap - discountAmount - sum(paid))`  
  For settlement of full Remaining → **0**

**Must not:**

- Recalculate discount as percentage when `discountAmount` is present
- Reject INR values &gt; 100 as “invalid percent”

### B) `PATCH /api/quotations/{id}/discount` (fallback)

```json
{ "discount": 2000 }
```

| Value | Meaning |
|-------|---------|
| `0 < discount ≤ 100` | Percentage (legacy) |
| `discount > 100` | **Absolute INR** (Final Settlement uses this) |

### C) `PATCH /api/quotations/{id}/payment-details` — status / settlement only

**Body (no phases):**

```json
{
  "paymentStatus": "completed",
  "replaceInstallments": false,
  "finalSettlementAmount": 2000,
  "finalSettlementApplied": true,
  "remaining": 0,
  "remainingAmount": 0,
  "paymentType": "cash",
  "paymentMode": "cash"
}
```

**Must:**

1. Set `payment_status = 'completed'`.
2. Set `remaining` / `remaining_amount = 0`.
3. Persist settlement write-off:
   - `discount_amount += finalSettlementAmount` **or** use amount already set by pricing PATCH
   - Prefer idempotent: if pricing already added ₹2,000, do not double-add
4. Leave installment rows **unchanged**.
5. **Skip** “total paid cannot exceed payable after discount” when `phases` are absent.
6. Auth: `account-management` or `admin`; quotation `status = approved`.

### D) Optional preferred — atomic endpoint

```http
POST /api/quotations/{id}/final-settlement
Content-Type: application/json

{ "amount": 2000 }
```

Atomic steps:

1. `discount_amount = discount_amount + amount` (INR).
2. `remaining = 0`, `payment_status = 'completed'`.
3. Set audit fields (below).
4. **Do not** modify installment rows.
5. Return quotation payment + pricing slice.

Frontend already tries this path when payment-details is missing (404/405/501).

---

## Remaining + paymentStatus formula (GET and writes)

```text
amCap      = Account Management payment cap
             (prefer amountAfterSubsidy, else subtotal used on Payment Management)
paid       = sum(installment.paid_amount)
discount   = discount_amount          -- includes final settlement `d`
remaining  = max(0, amCap - discount - paid)

payment_status =
  remaining <= 0 && (paid > 0 || discount > 0)  →  completed
  paid > 0                                      →  partial
  else                                          →  pending
```

### Never return completed / remaining 0 too early

Wrong (Ram lal): paid 150000, discount 0, cap 185000 → must be `remaining: 35000`, `partial`.  
Right after settle ₹35000: `discountAmount: 35000`, `remaining: 0`, `completed`.

### Installment paid vs pricing payable

When validating installment saves (normal Submit with phases):

- Prefer validate `sum(paid) ≤ amCap` (Payment Management subtotal / amount after subsidy used by AM),
- **Not** a lower “payable after unrelated pricing discount” that breaks AM (290000 vs 212000).

Or: on Final Settlement status-only, never run that check.

---

## Keeping the button hidden after refresh (important)

After a successful settle + `GET`, the frontend hides **Submit final settlement** when it sees
`isFinalSettlementApplied` = true. That is derived from persisted data in this order:

1. `finalSettlementApplied === true` (or `final_settlement_applied`, or `pricing.finalSettlementApplied`), **or**
2. `finalSettlementAmount > 0` (or `final_settlement_amount`), **or**
3. `discountAmount > 0` AND it covers the unpaid gap `(originalSubtotal − paid) ≤ discountAmount`.

**Backend MUST persist and return at least one of these** (ideally the explicit
`finalSettlementApplied` flag **plus** `discountAmount`). If none come back, the button
reappears on refresh even though the amount was settled.

## GET list / detail (after refresh)

`GET /api/quotations?status=approved` must return:

| Field | Example after ₹2,000 settle |
|-------|------------------------------|
| `subtotal` / `pricing.amountAfterSubsidy` | 292000 |
| `discountAmount` / `pricing.discountAmount` | **2000** (or prior + 2000) |
| `remaining` / `remainingAmount` | **0** |
| `paymentStatus` | **`completed`** |
| `installments` | same paid rows as before (e.g. total paid 290000) |
| `finalSettlementAmount` (optional) | **2000** |
| `finalSettlementApplied` (optional) | **true** |

**Correct GET after JITENDRA settle:**

```json
{
  "id": "QT-…",
  "status": "approved",
  "subtotal": 292000,
  "discountAmount": 2000,
  "paymentStatus": "completed",
  "remaining": 0,
  "remainingAmount": 0,
  "finalSettlementApplied": true,
  "finalSettlementAmount": 2000,
  "pricing": {
    "amountAfterSubsidy": 292000,
    "discountAmount": 2000,
    "totalAmount": 290000,
    "finalAmount": 290000
  },
  "installments": [
    { "phaseNumber": 1, "paidAmount": 100000, "status": "completed" },
    { "phaseNumber": 2, "paidAmount": 130000, "status": "completed" },
    { "phaseNumber": 3, "paidAmount": 60000, "status": "partial" }
  ]
}
```

---

## Optional DB columns

```sql
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS final_settlement_applied BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS final_settlement_amount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_settlement_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS final_settlement_by UUID NULL;
```

---

## Errors backend must stop returning for this flow

| Error | When it appeared | Fix |
|-------|------------------|-----|
| `numeric field overflow` (500) | Settlement wrote absolute INR into `discount` while it was `NUMERIC(5,2)` (legacy percentage column, max 999.99) | Widen `discount` to `NUMERIC(12,2)` (Step 1). Already applied in this repo via migration `20260721170000-widen-discount-column.js` |
| `Final amount must be between 0 and amount after subsidy` | Pricing PATCH sent AM subtotal as `subtotal` | Accept discount/finalAmount **without** requiring `subtotal`; validate vs stored AAS |
| `Total paid (290000) cannot exceed payable after discount (212000)` | Payment update re-sent installments | Status-only body: **no** paid-vs-payable check; don’t require phases |
| `Settlement amount (1000) cannot exceed remaining (0)` | Server stored `remaining = 0` because its `amountAfterSubsidy` (189,000) < AM subtotal (190,000); AM still showed Remaining 1,000 | **Do NOT validate `settlementAmount` against stored `remaining`.** Treat settlement as "mark completed, remaining 0". Set discount only up to `amountAfterSubsidy − paid` so payable never drops below paid (here that's `0`, so just mark completed). Return `finalSettlementApplied: true`, `finalSettlementAmount` for audit. |

### The subtotal vs amountAfterSubsidy mismatch (SUSHILA / JITENDRA)

Account Management computes Remaining from its **subtotal** (e.g. 190,000). The server may
store a lower **amountAfterSubsidy** (e.g. 189,000), so it thinks remaining is already 0.

- **Never reject** the settlement in this case.
- Settlement = "close this file": `payment_status='completed'`, `remaining=0`, `final_settlement_applied=true`, `final_settlement_amount=<what AM sent>`.
- Add to `discount_amount` only up to `max(0, amountAfterSubsidy − paid)` so you never create `paid > payable`. If that is 0, add nothing — just set the flags.
- On GET, return `finalSettlementApplied: true` (+ `finalSettlementAmount`) so the SPA hides the button; AM reconciles the small subtotal gap on its side.

---

## Checklist for backend

- [ ] Settlement amount = Remaining only; persist as INR `discountAmount` / `finalSettlementAmount`
- [ ] `discount` column widened to `NUMERIC(12,2)` (else settlement 500s with "numeric field overflow")
- [ ] `PATCH /pricing` accepts absolute `discountAmount`; no `subtotal` required
- [ ] `account-management` allowed on `/pricing`, `/discount`, `/payment-details`
- [ ] `PATCH /payment-details` without phases: set completed + remaining 0; leave installments alone
- [ ] No “paid exceeds payable” when phases omitted
- [ ] GET returns `discountAmount`, `remaining=0`, `paymentStatus=completed` after settle
- [ ] GET never returns `completed`/`remaining=0` when unpaid gap exists and discount doesn’t cover it
- [ ] (Now preferred) `POST /final-settlement` atomic — client calls this FIRST
- [ ] GET returns `finalSettlementApplied: true` (and/or `finalSettlementAmount > 0`) so the button stays hidden after refresh
- [ ] (Recommended) `final_settlement_*` columns

---

## Test plan

1. **JITENDRA:** paid 290000, remaining 2000 → Submit final settlement.
2. Expect 200 on pricing + status-only payment-details (or POST final-settlement).
3. GET → `discountAmount` includes **2000**, `remaining: 0`, `paymentStatus: completed`, installments still sum to 290000.
4. UI hover → `d: ₹2,000`.
5. Must **not** return paid-exceeds-payable for status-only call.
6. **Ram lal:** paid 150000 / cap 185000 / discount 0 → GET remaining **35000**, partial; after settle 35000 → completed, d=35000.
7. Normal installment Submit with phases still replaces rows (§AB) and validates against AM cap.

---

## Frontend reference

| Item | Location |
|------|----------|
| Submit | `submitFinalSettlement` in `app/dashboard/account-management/page.tsx` |
| Status-only payment API | `lib/api.ts` → `updatePaymentDetails` when `phases` omitted |
| Remaining math | `getDisplayRemaining` / `getEffectivePaymentStatus` |
| Spec | **`BACKEND_FINAL_SETTLEMENT.md`** (this file) |
| Handoff pointer | `BACKEND_CHANGES_HANDOFF.md` |
