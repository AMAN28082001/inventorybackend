# Backend handoff — Meter in Discom → WCC Pending → Meter Installation Pending (Jul 2026)

**Status in this repo: IMPLEMENTED** (ops status + `meteringWccAfterDiscom` server flag + admin list row fields §8).

Frontend Admin → **Metering** flow uses **server fields only** (no `localStorage` for Discom → WCC).

---

## Product flow (Admin UI)

```
Meter Pending
  → To Discom
Meter in Discom
  → To WCC Pending   (only if Installation is approved / upload complete)
WCC Pending
  → Save WCC details
Meter Installation Pending
  → To Final Step (MCO)
```

**Gate:** From Meter in Discom, the row may move to WCC Pending **only** when customer installation is completed and approved (`installer_approved` / upload-complete). If not approved, UI blocks with a toast (no API call).

**Also still valid (entry path):**

```
Installation → Approved
  → Metering → WCC Pending (fill Discom name + Assigned person)
  → Save → Meter Pending (pending_metering)
```

**Meter Pending tab rule:** Rows appear when Send to Metering was done (`pending_metering` / `metering_in_progress`) and no further Discom/WCC action yet. They do **not** appear in WCC Pending solely because installation is approved.

---

## Summary

| Area | Frontend behaviour | Backend |
|------|--------------------|---------|
| **New stage** | Meter Installation Pending tab | Accept + persist `meter_installation_pending` |
| **Discom → WCC** | `api.admin.quotations.setMeteringWccAfterDiscom(id, true)` | Persist `meteringWccAfterDiscom` |
| **WCC save (post-Discom)** | `PATCH` → `meter_installation_pending` (+ clear flag) | Accept transition; clear flag |
| **WCC save (entry)** | `PATCH` → `pending_metering` | Unchanged |
| **GET lists** | Tabs read stage + flag from API | Echo statuses + `meteringWccAfterDiscom` + §8 row fields |
| **Final Step** | From Meter Installation Pending → `mco` | Allow `meter_installation_pending` → `mco` |

---

## 1. New operational status: `meter_installation_pending`

Implemented on same ops PATCH routes as §L.1. Idempotent re-PATCH → **200**.

---

## 2. Allowed transitions

```
metering_approved
  -- set meteringWccAfterDiscom=true --> WCC Pending (UI)
  -- PATCH meter_installation_pending --> meter_installation_pending (clear flag)

meter_installation_pending
  -- send_to_mco / force MCO --> mco
```

---

## 3. Server flag: `meteringWccAfterDiscom` (required)

| Field | Type |
|-------|------|
| `meteringWccAfterDiscom` / `metering_wcc_after_discom` | boolean |
| `meteringWccAfterDiscomAt` / `metering_wcc_after_discom_at` | timestamp |

**Endpoints:**

```http
PATCH /api/admin/quotations/{id}/metering-wcc-after-discom
{ "meteringWccAfterDiscom": true }
```

Fallback on `installation-status` / `workflow-status` with same flag while stage stays `metering_approved`.

**Validation:** Reject `true` unless stage is `metering_approved` **and** installation fully approved (not `installer_partial_approved`).

**Clear** on `meter_installation_pending`, `mco`, `pending_metering`, and earlier stages.

---

## 4. WCC details save outcomes

| Path | Status after save |
|------|-------------------|
| Entry (Installation Approved → WCC) | `pending_metering` |
| Post-Discom (Meter in Discom → WCC) | `meter_installation_pending` (+ clear flag) |

---

## 5. GET / list requirements

Echo on `GET /api/admin/quotations`:

- `installationStatus` / `meteringStatus` (incl. `meter_installation_pending`)
- `meteringWccAfterDiscom` / `metering_wcc_after_discom`
- Discom / remarks / assigned person (see §8)

**Tab mapping:**

| UI tab | Stage / flag |
|--------|----------------|
| Meter Pending | `pending_metering` / `metering_in_progress` |
| Meter in Discom | `metering_approved` and **not** `meteringWccAfterDiscom` |
| WCC Pending | Entry (install approved, not yet sent to metering) **or** `meteringWccAfterDiscom` |
| Meter Installation Pending | `meter_installation_pending` |
| Final Step | `mco` |

---

## 6. Final Step

`meter_installation_pending` → `mco` allowed (admin PATCH + `send_to_mco`; no false `WF_003`).

---

## 7. Backend QA checklist

- [x] `PATCH` flag `meteringWccAfterDiscom: true` from `metering_approved` → **200**; GET echoes flag
- [x] Admin WCC Pending shows row after refresh (no localStorage)
- [x] Post-Discom WCC save → `meter_installation_pending`; flag cleared
- [x] Entry WCC save → `pending_metering`
- [x] `meter_installation_pending` → `mco`
- [x] Partial installation cannot set post-Discom WCC flag
- [x] Admin list columns populated (§8)

---

## 8. Admin Metering list — complete row payload

**Problem:** Address / Remarks / Assigned person showed **N/A** when list GET omitted metering/location fields.

**Implemented on `GET /api/admin/quotations`:**

| UI column | API fields |
|-----------|------------|
| Customer | `customer` with `email`, `address.{street,city,state,pincode}` |
| Dealer | nested `dealer` |
| Amount | `subtotal`, nested `pricing.subtotal`, `loanAmount`/`cashAmount` (derived from phases when `filePaymentType` set) |
| Date | `statusUpdatedAt`, `meteringApprovedAt`, `installationScheduledAt`, `createdAt` |
| Phase | `products.phase` |
| Address | `visitLocation` (primary visit) **or** formatted `customer.address` |
| Discom / Remarks / Assigned | `discomName`, `remarks`/`meteringRemarks`, `authorizedRepresentative`/`assignedPersonName` |
| Tab routing | `meteringWccAfterDiscom` |

**Code:** `utils/adminQuotationListApi.ts`, `controllers/adminController.ts` → `getAllQuotations`, `meteringDetailsEchoFields`.

---

## Implementation notes

| Piece | Location |
|-------|----------|
| Migration | `database/migrations/20260720120000-metering-wcc-after-discom.js` |
| Flag PATCH | `PATCH /api/admin/quotations/:id/metering-wcc-after-discom` |
| Status PATCH | `updateQuotationInstallationStatus` |
| List row fields | `utils/adminQuotationListApi.ts` |

---

## Frontend references

- `app/dashboard/admin/page.tsx` — `moveAdminMeteringFromDiscomToWcc`, `saveAdminWccMeteringDetails`, `setAdminMeteringStage`
- `lib/api.ts` — `setMeteringWccAfterDiscom`, `updateOperationalStatus`
- Living doc: `BACKEND_CHANGES_REQUIRED.md` **§L.2**
