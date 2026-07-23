# Backend One-Pass Handoff (Jul 2026)

Use this for a single backend implementation pass. It combines Final Settlement + Admin Send to Metering.

## 1) Routes To Implement

### Final Settlement
- `POST /api/quotations/:id/final-settlement` (preferred)
- `PATCH /api/quotations/:id/pricing`
- `PATCH /api/quotations/:id/discount`
- `PATCH /api/quotations/:id/payment-details` (status-only; no phases)

### Send To Metering (Admin)
- `PATCH /api/admin/quotations/:id/send-to-metering` (preferred)
- `POST /api/admin/quotations/:id/send-to-metering` (alias)
- Fallback: `PATCH /api/admin/quotations/:id/installation-status`

Reference implementations:
- `BACKEND_FINAL_SETTLEMENT.ts`
- `BACKEND_SEND_TO_METERING.ts`

---

## 2) DB + Model Changes

Run SQL (idempotent):

```sql
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS final_settlement_applied BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS final_settlement_amount  NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_settlement_at      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS final_settlement_by      UUID NULL,
  ADD COLUMN IF NOT EXISTS remaining_amount         NUMERIC(12,2) DEFAULT 0;

-- Critical: settlement writes absolute INR into discount.
ALTER TABLE quotations
  ALTER COLUMN discount TYPE NUMERIC(12,2);
```

Sequelize mapping:

```js
finalSettlementApplied: { type: DataTypes.BOOLEAN, defaultValue: false, field: 'final_settlement_applied' },
finalSettlementAmount:  { type: DataTypes.DECIMAL(12,2), defaultValue: 0, field: 'final_settlement_amount' },
finalSettlementAt:      { type: DataTypes.DATE, allowNull: true, field: 'final_settlement_at' },
finalSettlementBy:      { type: DataTypes.UUID, allowNull: true, field: 'final_settlement_by' },
remainingAmount:        { type: DataTypes.DECIMAL(12,2), defaultValue: 0, field: 'remaining_amount' },
discount:               { type: DataTypes.DECIMAL(12,2), defaultValue: 0 },
```

---

## 3) Mandatory Final Settlement Behavior

When settlement succeeds, persist:
- `finalSettlementApplied = true`
- `finalSettlementAmount = <requested settlement>`
- `discountAmount = <absolute INR>`
- `remaining = 0`
- `remainingAmount = 0`
- `paymentStatus = "completed"`

Hard rules:
- Do not rewrite installment rows during settlement.
- Do not block status-only settlement with paid-vs-payable validation.
- Do not reject with:
  - `cannot exceed remaining (0)`
  - `paid exceeds payable` (for no-phases status-only settlement)
- Optional: reject loan-only (`paymentType`/`paymentMode` === `loan`) with 400
  `Final settlement is only for Cash and Cash + loan` (allowed: `cash`, `mix`)

Idempotency:
- Repeated settlement calls must not double-add discount.

---

## 4) Mandatory Send-to-Metering Behavior

Admin must be allowed to send:
- `pending_installer -> pending_metering`

For dedicated send route and admin status patch, persist and return:
- `installationStatus = "pending_metering"`
- `meteringStatus = "pending_metering"` (derived from installation status)

Still reject:
- `installer_partial_approved`
- terminal/past stages such as `metering_approved`, `mco`, `completed`

---

## 5) GET Contract (Must Reflect Persisted State)

Both:
- `GET /api/quotations`
- `GET /api/quotations/:id`

must return settlement fields after save:
- `discountAmount`
- `remaining`, `remainingAmount`
- `paymentStatus`
- `finalSettlementApplied`
- `finalSettlementAmount`
- `pricing.discountAmount`
- `pricing.finalAmount`

Admin/metering views must return:
- `installationStatus`
- `meteringStatus`

Without this, cross-login/device state will look unsaved.

---

## 6) Logging (Keep Enabled)

Use staged logs already in references:
- `▶ IN`
- `⚙ COMPUTE`
- `① BEFORE`
- `② AFTER`
- `③ DIFF`
- `◀ OUT`
- `✖ ERROR`

These logs are required to quickly diagnose DB-persist failures.

---

## 7) Acceptance Tests

### Final Settlement
1. Start with paid < cap and non-zero remaining.
2. Submit settlement.
3. Expect 200 from one of the write routes.
4. Verify DB-backed GET shows:
   - `finalSettlementApplied: true`
   - `finalSettlementAmount > 0`
   - `discountAmount` increased
   - `remaining: 0`, `paymentStatus: completed`
5. Refresh and login from another role/device; state remains settled.
6. Re-submit settlement; no double-add.

### Send To Metering
1. Pick quotation at `pending_installer`.
2. Call `PATCH/POST /admin/quotations/:id/send-to-metering`.
3. Expect 200 and:
   - `installationStatus: pending_metering`
   - `meteringStatus: pending_metering`
4. Verify row appears in:
   - Admin Metering tab
   - Metering queue (`status=processing`)
5. Verify partial-approved still 400.

---

## 8) Quick Checklist

- [ ] Settlement routes implemented
- [ ] Metering send routes implemented
- [ ] SQL + model mapping applied
- [ ] `discount` widened to `NUMERIC(12,2)`
- [ ] GET serializers include all required fields
- [ ] Logs enabled
- [ ] Acceptance tests passed

