# Backend handoff — Cash + loan amounts & installment payment modes — Aug 2026

**Frontend (already shipped):**
- Admin Approve → enter **loanAmount** + **cashAmount** for `paymentType: "mix"`
- Admin Approved list / CSV → show Loan & Cash separately
- Account Payment Management → Loan vs Cash installment sides; remaining deducted per side
- Account Excel → Loan Amount / Cash Amount / Loan Paid / Cash Paid / Loan Remaining / Cash Remaining

**Related:** `BACKEND_ADMIN_QUOTATION_STATUS.ts`, `BACKEND_INSTALLMENT_REPLACE.ts`, HANDOFF **§28**  
**Helpers:** `BACKEND_CASH_LOAN_AMOUNTS.ts`

---

## Product rules

| `paymentType` | UI label | Amounts at approve | Installment `paymentMode` values allowed |
|---------------|----------|--------------------|------------------------------------------|
| `loan` | Loan | `loanAmount` (= quotation total usually) | **`loan` only** |
| `cash` | Cash | none (full subtotal is cash) | **`cash` / `upi` / `cheque`** (not `loan`) |
| `mix` | Cash + loan | **`loanAmount` + `cashAmount`** must equal quotation subtotal | **Both:** loan side = `loan`; cash side = `cash` / `upi` / `cheque` |

Bank + IFSC required for `loan` and `mix` (unchanged).

---

## Checklist — backend must deliver

| # | Item |
|---|------|
| 1 | On approve (`PATCH …/status` with `status: approved`), persist **`loanAmount` / `loan_amount`** and **`cashAmount` / `cash_amount`** |
| 2 | For `mix`: require both amounts; **`loanAmount + cashAmount === subtotal`** (rupees, integer) |
| 3 | For `loan`: persist `loanAmount`; clear `cashAmount` |
| 4 | For `cash`: clear both loan/cash amount fields (or leave null) |
| 5 | Echo on every GET list/detail: `paymentType`/`paymentMode`, `loanAmount`, `cashAmount`, `bankName`, `bankIfsc` |
| 6 | Installment phases: persist per-phase **`paymentMode`** (`loan` \| `cash` \| `upi` \| `cheque` \| …) on replace |
| 7 | Do not strip `loanAmount`/`cashAmount` on installment PATCH |
| 8 | Optional: reject invalid mode for type (loan→only loan; cash→no loan; mix→either) |

---

## A) Approve body (Admin)

```json
{
  "status": "approved",
  "paymentType": "mix",
  "paymentMode": "mix",
  "loanAmount": 200000,
  "cashAmount": 70000,
  "bankName": "Bank of Baroda",
  "bankIfsc": "BARB0KALWAR",
  "statusApprovedAt": "2026-07-31T05:52:00.000Z"
}
```

Aliases accepted: `loan_amount`, `cash_amount`, `bank_ifsc`.

**Bug this fixes:** Admin approved Cash + loan as loan ₹2,00,000 + cash ₹70,000 (total ₹2,70,000), but GET still returned full ₹2,70,000 as loan (or omitted cash). Persist both amounts; never replace the split with subtotal.

### Validation

```ts
if (paymentType === "mix") {
  require loanAmount > 0 && cashAmount > 0
  require loanAmount + cashAmount === quotationSubtotal
}
if (paymentType === "loan") {
  require loanAmount > 0  // typically === subtotal
  cashAmount = null
}
if (paymentType === "cash") {
  loanAmount = null
  cashAmount = null
}
```

Also on approve:
- Set `paymentType` = `paymentMode` = body type (`loan` | `cash` | `mix`)
- Sync `filePaymentType` to the same value (so list UIs don’t keep showing old file-login “loan”)
- Echo `loanAmount` / `cashAmount` on the PATCH response and every GET list/detail
---

## B) GET quotation / admin list / account list

Return (camelCase + snake_case ok):

```json
{
  "id": "QT-…",
  "status": "approved",
  "paymentType": "mix",
  "paymentMode": "mix",
  "loanAmount": 200000,
  "cashAmount": 99000,
  "bankName": "RMGB Bank",
  "bankIfsc": "RMGB0000457",
  "subtotal": 299000,
  "installments": [
    {
      "phaseNumber": 1,
      "amount": 100000,
      "paidAmount": 100000,
      "status": "completed",
      "paymentMode": "loan"
    },
    {
      "phaseNumber": 2,
      "amount": 50000,
      "paidAmount": 50000,
      "status": "completed",
      "paymentMode": "upi"
    }
  ]
}
```

Frontend Account UI:
- **Loan remaining** = `loanAmount − sum(paidAmount where paymentMode === "loan")`
- **Cash remaining** = `cashAmount − sum(paidAmount where paymentMode ∈ cash/upi/cheque/…)`
- Overall remaining = subtotal (net discount) − all paid (unchanged)

---

## C) Installment replace (`payment-details` / `installments`)

Same as `BACKEND_INSTALLMENT_REPLACE.ts`, plus:

1. Keep **`loanAmount` / `cashAmount`** on the quotation row when saving phases.
2. Persist each phase’s **`paymentMode`** (do not overwrite all phases to quotation-level `paymentMode`).
3. Quotation-level `paymentMode` stays `loan` | `cash` | `mix` (payment **type**). Phase-level `paymentMode` is the collection channel.

### Phase paymentMode allowlist by type

| Quotation `paymentType` | Allowed phase `paymentMode` |
|-------------------------|-----------------------------|
| `loan` | `loan` |
| `cash` | `cash`, `upi`, `cheque`, `netbanking`, `bank_transfer`, `card` |
| `mix` | all of the above |

---

## D) Columns / Excel (frontend-computed; backend only needs fields)

Account Excel reads from GET fields above. No dedicated Excel API required if list GET is complete.

Admin filtered CSV also needs `loanAmount` / `cashAmount` on list rows.

---

## QA

1. Approve as **Cash + loan** with loan 2,00,000 + cash 70,000 on subtotal 2,70,000 → GET echoes both amounts + `paymentType: mix` (not `Loan ₹2,70,000`).
2. Approve as **Loan** → `loanAmount` set, `cashAmount` null.
3. Approve as **Cash** → both amounts null; no bank required.
4. Account Manage: add loan installment (`paymentMode: loan`) → loan remaining drops; cash remaining unchanged.
5. Add cash/UPI/cheque installment → cash remaining drops.
6. Refresh Account list → loan/cash paid & remaining still correct.
7. Excel export includes Loan Amount / Cash Amount / Loan Paid / Cash Paid / Loan Remaining / Cash Remaining.
8. Reject mix approve when loan+cash ≠ subtotal (**400**).
9. Re-approve existing wrong row (e.g. QT showing full total as loan) with correct split → GET updates to loan + cash.
**Reference:** `BACKEND_CASH_LOAN_AMOUNTS.ts`, `BACKEND_ADMIN_QUOTATION_STATUS.ts`, `BACKEND_INSTALLMENT_REPLACE.ts`
