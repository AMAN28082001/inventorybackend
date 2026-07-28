# Backend — Metering dual track (Meter process + Bank process) — Jul 2026

**Frontend surfaces (same APIs):**
- Admin → Quotations → **Metering**
- `/dashboard/metering` (metering login)
- Installer dashboard → **Metering** tab (`role: installer` / `installation-team`)

**Related:** `BACKEND_METERING_DISCOM_WCC_METER_INSTALL.md` (left track stages), `BACKEND_SEND_TO_METERING.ts`, `BACKEND_ROLE_DASHBOARD_SYNC.md`.

---

## Product UI (two separate tracks)

```
LEFT — Meter process (sequential)
  Meter Pending → To Discom → Meter in Discom → To WCC Pending
  → WCC Pending → Save WCC → Meter Installation Pending → To Final Step → mco
  → To Confirmation (pending_baldev)

RIGHT — Bank process (parallel; loan / mix only)
  Bank Process     ← bank_process_done !== true
  Pending Payment  ← bank_process_done === true
```

A loan/mix row can appear in **both** a Meter tab and a Bank tab at once. Marking bank done does **not** change metering stage.

---

## Checklist

| # | Item | Status |
|---|------|--------|
| 1 | Persist + echo metering stages (`pending_metering` … `mco`) | Done (existing) |
| 2 | Persist + echo `meteringWccAfterDiscom` | Done (existing) |
| 3 | Discom → WCC → MIP → mco transitions | Done (existing) |
| 4 | Persist + echo `bankProcessDone` / `bank_process_done` (+ `At`) | **Done** |
| 5 | `PATCH …/bank-process` (+ payment-details fallbacks) | **Done** |
| 6 | Authorize `installer` (+ installation-team) on metering/bank/WCC routes | **Done** |
| 7 | Echo `paymentType` / `payment_type` on queue rows | **Done** |

---

## A) Meter process (left)

See `BACKEND_METERING_DISCOM_WCC_METER_INSTALL.md`.

| UI tab | Backend signal |
|--------|----------------|
| Meter Pending | `pending_metering` / `metering_in_progress`, not WCC-after-discom |
| Meter in Discom | `metering_approved` and `meteringWccAfterDiscom !== true` |
| WCC Pending | `meteringWccAfterDiscom === true` (or entry path) |
| Meter Installation Pending | `meter_installation_pending` |
| Final Step | `mco` (+ `mcoAt`) |

---

## B) Bank process (right)

### B.1 Columns

```sql
-- Applied via migration 20260725120000-bank-process-done.js
-- Sequelize attribute names (camelCase) on `quotations`:
--   bankProcessDone BOOLEAN NOT NULL DEFAULT FALSE
--   bankProcessDoneAt TIMESTAMP NULL
```

### B.2 Tab filters (frontend)

| UI tab | Filter |
|--------|--------|
| Bank Process | metering-visible **and** payment ∈ `{loan, mix}` **and** `bankProcessDone !== true` |
| Pending Payment | metering-visible **and** payment ∈ `{loan, mix}` **and** `bankProcessDone === true` |

Accept payment aliases: `cash_loan`, `cash+loan` → treat as `mix` (API normalizes on echo).

### B.3 GET echo (`quotationPaymentApiFields`)

Every admin / metering / installer queue row includes:

```json
{
  "paymentType": "loan",
  "payment_type": "loan",
  "paymentMode": "loan",
  "payment_mode": "loan",
  "bankProcessDone": false,
  "bank_process_done": false,
  "bankProcessDoneAt": null,
  "bank_process_done_at": null,
  "bankName": "…",
  "bankIfsc": "…"
}
```

### B.4 Save bank details + move to Pending Payment

**Preferred:**

```http
PATCH /api/admin/quotations/{id}/bank-process
Authorization: Bearer <ADMIN_or_METERING_or_INSTALLER_JWT>
Content-Type: application/json

{
  "bankName": "…",
  "bankIfsc": "…",
  "paymentType": "loan",
  "bankProcessDone": true,
  "moveToPendingPayment": true
}
```

**Also implemented:**

| Method / path | Auth |
|---------------|------|
| `PATCH /api/admin/quotations/:id/payment-details` | metering dual-track (`authorizeMeteringOrAdmin`) |
| `PATCH /api/quotations/:id/bank-process` | same |
| `PATCH /api/metering/quotations/:id/bank-process` | `authorizeMetering` (includes installer) |
| `PATCH /api/metering/quotations/:id/payment-details` | same |
| `PATCH /api/admin/quotations/:id/installation-status` | admin; body may include `bankProcessDone` without changing stage when status omitted |

**On `bankProcessDone: true` / `moveToPendingPayment: true`:**
1. Persist bank fields (`bankName`, `bankIfsc`, optional `paymentType`)
2. Set `bankProcessDone = true`, `bankProcessDoneAt = NOW()` (keep existing At if already set)
3. Do **not** change metering stage
4. Return updated JSON including `bankProcessDone: true`

**Idempotent:** Re-PATCH when already done → **200**.

### B.5 Auth

| Role | Access |
|------|--------|
| `admin` / `super-admin` | Full |
| `installer` / `installation-team` | Metering queues + status/details/WCC/bank |
| `metering` / `meter` / `mco` | Meter pipeline + bank |

---

## C) Installer → Metering (no AUTH_004)

`authorizeMetering` / `authorizeMeteringOrAdmin` allow `installer` and installation-team JWT roles.

| Area | Routes |
|------|--------|
| Queue | `GET /api/metering/quotations` |
| Status | `PATCH /api/metering/quotations/:id/status` (+ quotation metering-status fallbacks) |
| Details / MCO | `POST …/details`, `…/mco-documents` |
| WCC | `PATCH /api/admin/quotations/:id/metering-wcc-after-discom` (before admin-only gate) |
| Bank | §B.4 |
| Optional aliases | `PATCH\|POST /api/installer/quotations/:id/send-to-metering` (+ `metering-handoff`) |

---

## D) Minimum GET shape after refresh

```json
{
  "id": "…",
  "installationStatus": "metering_approved",
  "meteringStatus": "metering_approved",
  "meteringWccAfterDiscom": false,
  "mcoAt": null,
  "paymentType": "loan",
  "bankProcessDone": false,
  "bankName": "…",
  "bankIfsc": "…"
}
```

No `localStorage` for Discom→WCC or Bank tabs — flags come from API.

---

## E) QA curls

```bash
# Mark bank done (does not move meter stage)
curl -s -X PATCH "$BASE/api/admin/quotations/$QID/bank-process" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"bankName":"SBI","bankIfsc":"SBIN0001234","bankProcessDone":true}'

# WCC after Discom
curl -s -X PATCH "$BASE/api/admin/quotations/$QID/metering-wcc-after-discom" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"meteringWccAfterDiscom":true}'

# Installer metering queue (expect 200, not AUTH_004)
curl -s "$BASE/api/metering/quotations" -H "Authorization: Bearer $INSTALLER_JWT"
```

### QA checklist

1. Loan row in Meter Pending also under Bank Process.
2. Save bank + move → Pending Payment; still in same Meter tab; survives refresh.
3. Cash-only never in Bank tabs.
4. Discom → WCC → GET `meteringWccAfterDiscom: true`.
5. Installer Metering tab loads queue without AUTH_004.

---

## Migration

```bash
yarn migrate
# 20260725120000-bank-process-done.js
```
