# Backend — Revert Final Settlement (Undo) — Jul 2026

## Goal

Undo a previously persisted **Final Settlement** so the quotation returns to its pre-settlement pricing/payment aggregates.

This endpoint must:
1. Clear settlement flags/audit fields.
2. Recompute and persist payment aggregates (`discountAmount`, `finalAmount`, `remaining/remainingAmount`, `paymentStatus`) based on **existing paid installments**.
3. Keep `installments/paymentPhases` unchanged (do not delete or rewrite paid rows).
4. Return the updated quotation slice, and ensure subsequent `GET` reflects the cleared settlement state.

## Endpoints

### Preferred (atomic)

`POST /api/quotations/:id/revert-final-settlement`

### Fallback (same behavior)

`DELETE /api/quotations/:id/final-settlement`

Auth must allow:
- `account-management`
- `admin` (quotation admin = dealer `role: admin` is also allowed by handler)

## Request body (payload)

The handler is server-computed; the body is optional.

```json
{}
```

Any extra fields should be ignored.

## Required behavior

### A) Clear settlement audit flags

Persist:
- `finalSettlementApplied = false`
- `finalSettlementAmount = 0`
- `finalSettlementAt = null`
- `finalSettlementBy = null`

### B) Recompute + persist payment values (installments unchanged)

Let:
- `paid = sum(installments[].paidAmount)` (or fallback to `quotation.paidAmount`)
- `amountAfterSubsidy = quotation.amountAfterSubsidy` (preferred) or `subtotal - totalSubsidy`

1. Revert `discountAmount` by removing the impact of the settlement.
   - The repo implementation derives the pre-settlement discount in a way that
     tolerates **subtotal vs amountAfterSubsidy** mismatches, using:
     - stored `finalSettlementAmount` (audit write-off amount)
     - `quotation.subtotal` as the AM-visible cap.
2. Persist:
   - `discountAmount` and `discount` (INR)
   - `finalAmount` and `totalAmount`
3. Recompute:
   - `remainingAmount = max(0, amountAfterSubsidy - discountAmount - paid)`
   - `paymentStatus` from `remainingAmount` + `paid`:
     - `remainingAmount > 0` and `paid > 0` → `partial`
     - `remainingAmount > 0` and `paid = 0` → `pending`
     - `remainingAmount = 0` and (`paid > 0` OR `discountAmount > 0`) → `completed`

### C) Keep installments unchanged

Do **not**:
- rewrite `quotation_payment_phases`
- delete installments
- adjust phase paid amounts

Only quotation aggregate columns are updated.

## Response

Return a payload that includes at least:
- cleared settlement fields (`finalSettlementApplied: false`, `finalSettlementAmount: 0`, `finalSettlementAt/by: null`)
- recomputed `discountAmount`, `remaining/remainingAmount`, and `paymentStatus`
- unchanged `installments/paymentPhases`

## Handler sketch (implementation outline)

1. Authorize (`account-management`/`admin`).
2. Load approved quotation + products + payment phases.
3. Compute:
   - paid sum
   - amountAfterSubsidy
   - derived pre-settlement discountAmount
4. `quotation.update()`:
   - clear finalSettlement* fields
   - persist discount/finalAmount/remainingAmount/paymentStatus
5. Reload quotation and respond (installments untouched).

## QA

1. Pick an approved quotation where `finalSettlementApplied` is currently `true`.
2. Call revert:

```bash
curl -s -X POST "$BASE/api/quotations/$QID/revert-final-settlement" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

3. Verify:
- response has `finalSettlementApplied: false`
- response has `finalSettlementAmount: 0`
- `paymentStatus` is no longer `completed` unless `remainingAmount` becomes 0 again

4. Verify subsequent GET:

```bash
curl -s "$BASE/api/quotations/$QID" \
  -H "Authorization: Bearer $TOKEN"
```

5. Fallback check (same behavior):

```bash
curl -s -X DELETE "$BASE/api/quotations/$QID/final-settlement" \
  -H "Authorization: Bearer $TOKEN"
```

