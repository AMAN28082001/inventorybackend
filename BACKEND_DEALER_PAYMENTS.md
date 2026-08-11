# Backend — Dealer Payments tab (read-only)

**Frontend:** Dealer nav → **Payments** (`/dashboard/payments`)  
**Code:** `app/dashboard/payments/page.tsx` · `lib/dealer-payment-summary.ts`  
**Related:** Account Management payment-details (`BACKEND_ACCOUNT_PAYMENT_MANAGEMENT.md`)

Dealers must see **approved** quotations only, with **paid**, **remaining**, installment hover, and **Cash + loan** loan/cash amounts.  
This is **read-only** — dealers must **not** be allowed to PATCH payment-details.

---

## Must ship

| # | Deliverable | If missing |
|---|-------------|------------|
| **A** | `GET /api/quotations?status=approved` returns **only that dealer’s** approved rows | Dealer sees others’ data or empty list |
| **B** | List payload includes payment fields below (same shape AM uses) | Paid stays ₹0 / Remaining = full amount / Type = — |
| **C** | `installments` / `paymentPhases` array with `paidAmount` + `paymentMode` | Paid hover shows “No installments yet” |
| **D** | For `paymentType=mix`: `loanAmount` + `cashAmount` on the quotation | Cash + loan row has no L/C numbers |
| **E** | Auth: dealer JWT can **read** own payment fields; **cannot** write payment-details | Security |

Profit / Cost of site are **not** required on this tab.

---

## A) Endpoint

```http
GET /api/quotations?status=approved&page=1&limit=1000
Authorization: Bearer <dealer token>
```

### Scope rules

1. Filter `status = 'approved'` (case-insensitive).
2. Filter `dealer_id = auth.dealer.id` (or equivalent).
3. Do **not** return draft / pending / rejected quotations.
4. Prefer including payment fields on the **list** response so FE does not N+1 `GET /quotations/:id`.

Aliases FE already uses elsewhere: list may be `{ quotations: [...] }` or a bare array.

---

## B) Required fields per quotation (list item)

Return **camelCase** (snake_case aliases accepted by FE):

| Field | Purpose |
|-------|---------|
| `id` | Quotation ID |
| `status` | `"approved"` |
| `dealerId` / `dealer_id` | Owner dealer |
| `customer` | `{ firstName, lastName, mobile }` |
| `createdAt` | Sort / date column |
| `statusApprovedAt` / `status_approved_at` | Prefer for date column |
| `subtotal` (or `pricing.subtotal`) | Payable amount before settlement discount |
| `discount` / `discountAmount` / `pricing.discountAmount` | Settlement / other discount (INR) |
| `paymentType` / `payment_type` | `"loan"` \| `"cash"` \| `"mix"` |
| `paymentMode` / `payment_mode` | Same values when type omitted |
| `paymentStatus` / `payment_status` | `"pending"` \| `"partial"` \| `"completed"` (optional; FE recomputes from amounts) |
| `loanAmount` / `loan_amount` | Mix / loan bucket (INR) |
| `cashAmount` / `cash_amount` | Mix / cash bucket (INR) |
| `remaining` / `remainingAmount` | Fallback when installments empty |
| `installments` **or** `paymentPhases` **or** `payment_phases` | Installment rows (see C) |
| `finalSettlementApplied` / `final_settlement_applied` | If true, remaining displays as 0 |

### Example list item

```json
{
  "id": "QT-1V77MB",
  "status": "approved",
  "dealerId": "dealer-uuid",
  "statusApprovedAt": "2026-08-08T10:00:00.000Z",
  "createdAt": "2026-08-07T09:00:00.000Z",
  "customer": {
    "firstName": "Gayatri",
    "lastName": "Devi",
    "mobile": "9828155630"
  },
  "subtotal": 200000,
  "discountAmount": 0,
  "paymentType": "mix",
  "paymentStatus": "partial",
  "loanAmount": 189000,
  "cashAmount": 11000,
  "remaining": 68000,
  "remainingAmount": 68000,
  "installments": [
    {
      "phaseNumber": 1,
      "phaseName": "Installment 1",
      "amount": 189000,
      "paidAmount": 132000,
      "status": "partial",
      "paymentMode": "loan",
      "dueDate": "2026-08-06",
      "transactionId": "BY TRANSFER …"
    },
    {
      "phaseNumber": 2,
      "phaseName": "Installment 2",
      "amount": 11000,
      "paidAmount": 0,
      "status": "pending",
      "paymentMode": "cash"
    }
  ],
  "paymentPhases": []
}
```

> FE accepts `installments` **or** `paymentPhases` / `payment_phases`. Prefer sending the same array on both keys (AM already does this).

---

## C) Installment row shape

Each phase must include:

| Field | Required | Notes |
|-------|----------|-------|
| `phaseNumber` | yes | 1-based |
| `phaseName` | recommended | e.g. `Installment 1` |
| `paidAmount` / `paid_amount` | yes | Used for Paid total + hover |
| `amount` | recommended | Cap for that installment |
| `paymentMode` / `payment_mode` | **yes for mix** | `"loan"` vs `"cash"` / `"upi"` / `"cheque"` — drives L vs C split |
| `status` | optional | `pending` \| `partial` \| `completed` |

### FE display rules (for backend awareness)

- **Paid** = Σ `paidAmount`
- **Paid hover** = each installment line: `i1 (loan): ₹…`
- **Cash + loan Paid subline** = loan-mode paid vs non-loan paid
- **Remaining** = `max(0, (subtotal − discount) − paid)` (API `remaining` used only if installments array is empty)
- **Cash + loan Remaining subline** =
  - Loan rem = `max(0, loanAmount − loanPaid)`
  - Cash rem = `max(0, cashAmount − cashPaid)`
- **Type** shows `Cash + loan` with `L ₹loanAmount · C ₹cashAmount`

---

## D) Auth / security

| Role | `GET /quotations?status=approved` | `PATCH …/payment-details` |
|------|-----------------------------------|---------------------------|
| Dealer | Own approved quotations + payment fields | **403** |
| Account Management / Admin | As today | Allowed |

Do not strip `installments` / `loanAmount` / `cashAmount` / `paymentType` from dealer list responses — that is what broke Paid/Remaining historically.

---

## E) Acceptance tests

1. Dealer A login → Payments tab → only A’s **approved** quotations (no pending).
2. Mix quotation with loan ₹1,89,000 + cash ₹11,000 and one loan installment paid ₹1,32,000:
   - Type: `Cash + loan` with `L ₹1,89,000 · C ₹11,000`
   - Paid hover lists installment(s)
   - Remaining shows `L ₹57,000 · C ₹11,000` (example)
3. Dealer A cannot PATCH another dealer’s payment-details (403).
4. After AM records a new installment and dealer refreshes Payments, Paid/Remaining update without FE localStorage.

---

## Checklist

- [x] Dealer-scoped `GET /quotations?status=approved`
- [x] List echoes `paymentType`, `loanAmount` / `cashAmount`, `remaining`, `installments` / `paymentPhases` (`paidAmount` + `paymentMode`)
- [x] Regular dealer **403** on `PATCH …/payment-details` (AM / admin only)
- [x] No new write API — reuses AM-saved data
- [ ] Smoke: dealer Payments tab Paid / Remaining / Cash+loan after AM installment Save
