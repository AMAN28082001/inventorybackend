# Backend Changes Required

## Metering — sync and persistence

- Metering tab placement and modal data come **only from the backend** (no local/session storage for metering stage or saved details).
- After **Save details**, **Move to Approved**, or **Move to MCO**, `GET /api/metering/quotations` (and related list/detail) must return updated `installationStatus` / `meteringStatus`, `meteringApprovedAt`, and `mcoAt` so **Approved** and **MCO** tabs match the database after refresh.

## Metering queue vs actions (`WF_003`)

- **Rule:** Do not return rows in `GET /api/metering/quotations` that a metering user cannot legally complete with the documented API, **or** allow the documented approval path from those stages.
- **Processing tab** (`status=processing`): maps to `pending_metering`, `metering_in_progress` only.
- **Approval path:** For rows the metering UI shows, backend supports at least one of:
  - `PATCH .../status` with `{ "action": "approve" }`, or
  - `{ "action": "start" }` then `{ "action": "approve" }`.
- **Pre-metering fallback:** `start` / `approve` are also allowed from `pending_installer` and `installer_in_progress` so a chained `start` → `approve` does not fail with `WF_003` if such rows ever appear in client state.

## Frontend retry contract (backend support)

Preferred order on the client:

1. `PATCH /api/metering/quotations/{id}/status` with `{ "action": "approve" }`.
2. On `409` / `WF_003`: `{ "action": "start" }` then `{ "action": "approve" }` again.
3. On continued failure: **direct status body** (same semantics as approve / send_to_mco):
   - `PATCH /api/metering/quotations/{id}/status` **or**
   - `PATCH /api/quotations/{id}/metering-status`  
   JSON example:
   ```json
   {
     "installationStatus": "metering_approved",
     "meteringStatus": "metering_approved"
   }
   ```
   For MCO:
   ```json
   { "installationStatus": "mco", "meteringStatus": "mco" }
   ```
   Allowed direct targets when `action` is omitted: **`metering_approved`** | **`mco`** (same guards as `approve` / `send_to_mco`).

## Detail save (`POST /api/metering/quotations/{id}/details`)

- Allowed stages include pre-metering workflow states so users can persist S3 + DB without waiting for a later stage.
- If save is not allowed for the current stage, return **`409`** with `WF_003` and a clear message — **no** “save locally and retry later”; the client should show an error until the stage allows save.

## Modal prefill (queue / save response)

Queue and save responses should expose metering fields consistently (camelCase **and** snake_case aliases where listed):

- `discomName`, `meterType`, `meterNo`, `solarMeterNo`, `netMeterNo`
- `meterDocumentImageUrl`, `meterDocumentUrl`, `meter_document_url`
- `meterDocumentName`, `meter_document_name`

## References (frontend)

- Metering dashboard save/status: `app/dashboard/metering/page.tsx`
- Primary metering API: `PATCH /api/metering/quotations/{id}/status`
- Quotation-scoped fallback: `PATCH /api/quotations/{id}/metering-status`

---

## Installer completion upload — §6.4.C (implemented in API)

**Routes (equivalent):**

- `POST /api/installer/quotations/{quotationId}/documents` (multipart)
- `POST /api/quotations/{quotationId}/installer-documents` (multipart) — same handler; use when the client must call a quotation-prefixed URL.

**Auth:** `authorizeInstallerOrAdmin` — quotation **dealer** admins (`req.dealer.role === admin`), inventory **admin** / **super-admin** / **super-admin-manager**, **installer**, and **installation-team** JWTs.

Single-file slot uploads also accept `POST /api/quotations/{quotationId}/installer-documents/upload` (same as installer-prefixed single upload; uses installer multer limits).

### §6.4.C.1 — Admin vs installer file validation

- **Installer / installation-team:** unchanged — at least one of files, URL doc refs, site dimensions (cm/feet), or `extraExpensesJson` is required (`VAL_002` when empty). When `installationStatus=installer_approved`, at least one existing `site_completion_image` doc is required (`WF_002`).
- **Admin:** multipart may contain **no files**. A payload is accepted when it includes any of: files, URL docs, site/feet signals, parsed extra expenses, **or** (metadata-only) `installationStatus`, `installerRemarks`, or `remarks` text fields. When `installationStatus=installer_approved`, **do not** require site completion images (`WF_002` skipped for admin).

### §6.4.C.2 — Leg validation (cm)

- **Installer / installation-team:** if any cm leg field is non-empty, **both** back and front legs must be positive numbers; optional mid must be positive when provided (existing behavior).
- **Admin:** empty `siteLength` / `siteHeight` / `siteWidth` (and `*LegCm` aliases) are treated as omitted — no `400` for “missing legs” when all are empty. When a leg field **is** provided, that value alone must be a positive number (partial updates).

### Audit / FK note

- On admin-driven `installer_approved`, `installerId` on the quotation is **not** overwritten with the admin user id (preserves the real installer when present).
- `QuotationInstallationDoc.uploadedBy*` uses `req.user?.id` / `req.dealer?.id` and matching role for attribution.

---

## §X — Quotation PDF display (panel range keys, May 2026)

**Handoff summary:** `BACKEND_CHANGES_HANDOFF.md` §2, §2.6. **Status: implemented** (incl. Tata DCR `tata_530_570`).

### X.1 — Persist on `quotation_products`

| Field | Scope |
|-------|--------|
| `pdfPanelRangeKey` | Single / DCR / Non-DCR panel line |
| `pdfDcrPanelRangeKey` | BOTH — DCR |
| `pdfNonDcrPanelRangeKey` | BOTH — Non-DCR |

**Allowed keys** (`PDF_PANEL_RANGE_KEYS`):

| Key | PDF label |
|-----|-----------|
| `waaree_540_560_bifacial` | 540-560W Bifacial |
| `waaree_580_700_bifacial_topcon` | 580-700W Bifacial Topcon |
| `adani_540_580_bifacial` | 540-580W Bifacial |
| `adani_610_625_bifacial_topcon` | 610-625W Bifacial Topcon |
| `premier_600_625_bifacial_topcon` | 600-625W Bifacial Topcon |
| **`tata_530_570`** | **530W - 570W** (Tata DCR only) |

Snake_case: `pdf_panel_range_key`, `pdf_dcr_panel_range_key`, `pdf_non_dcr_panel_range_key`.

**PATCH clear:** send `pdfPanelRangeKey: ""` / `null` — `buildQuotationProductPdfPersistFieldsForUpdate` clears DB values; omitted keys unchanged on partial PATCH.

**Endpoints:** `POST /api/quotations`, `PATCH /api/quotations/{id}/products`, `GET` list/detail — echo camelCase + snake_case via `quotationProductPdfDisplayApiFields`.

### X.2 — PDF display semantics (client-generated; keys must round-trip)

- Range key set → panel line uses **range label**, not “As per the set” for wattage.
- **Tata DCR** + `tata_530_570` → inverter PDF line = **“As per the set”** (package BOM) regardless of stored catalog inverter fields.
- TOPCon technology note when key contains `topcon`.

### X.3 — Combined brand strings

- `inverterBrand`: `Vsole/Xwatt/Saatvik`, `Vsole/Xwatt` (+ catalog brands)
- `meterBrand`: `L&T/HPL/Genus/Secure` (+ catalog brands)

### X.4 — Panel quantity

`panelQuantity` / `dcrPanelQuantity` / `nonDcrPanelQuantity` may be **0** when matching `pdf*PanelRangeKey` is set (`hasPdfPanelRangeKey` in Zod). Tata DCR package sets also bypass strict qty when `isTataDcrPackageSet`.

### X.5 — Not used in pricing

PDF keys are **not** passed into `calculatePricing` or catalog SKU pricing validation.

### X.6 — `VAL_003` exceptions (Tata DCR package sets)

When `systemType === 'dcr'` and `panelBrand === 'Tata'`, `validateProductSelection` delegates to `validateTataDcrProductSelection` (`utils/quotationTataDcrValidation.ts`):

```typescript
// Pseudocode — see utils/quotationTataDcrValidation.ts
if (isTataDcrPackageSet(products)) {
  // Allow: As per the set / As per Set, 530W, qty 0 with tata_530_570,
  // structure 3.1kW / 5.1kW / 3–10kW, Vsole/Xwatt inverter placeholders
  return validateTataDcrProductSelection(products, catalog);
}
```

**Example persisted `products` after Tata 5.1kW save:**

```json
{
  "systemType": "dcr",
  "phase": "1-Phase",
  "panelBrand": "Tata",
  "panelSize": "530W",
  "panelQuantity": 10,
  "inverterBrand": "Vsole/Xwatt",
  "inverterSize": "5kW",
  "structureSize": "5kW",
  "systemPrice": 310000,
  "pdfPanelRangeKey": "tata_530_570",
  "pdf_panel_range_key": "tata_530_570"
}
```

### X.7 — Pricing tables API (optional)

`GET /api/quotations/pricing-tables` — when DB `dcr` empty, defaults include Tata DCR rows (`utils/defaultPricingTables.ts`, 3.1/5.1/6/8/10 kW; 5.1kW 1-Phase = ₹3,10,000).

**Legacy:** `pdfUsePanelSizeRange`, `pdfUseInverterBrandOptions` — old rows only.

**validUntil:** `POST /api/quotations` → `createdAt + 7 days`.

**Migration:** `20260521120000-add-pdf-panel-range-keys-to-quotation-products.js`.

**Code:** `utils/quotationProductPdfDisplay.ts`, `utils/quotationTataDcrValidation.ts`, `controllers/quotationController.ts`.

---

## §Y — Quick handoff (May 2026)

| Priority | Topic | Status |
|----------|--------|--------|
| **High** | Tata DCR + `tata_530_570` + `VAL_003` fix | **Done** — §X.6, HANDOFF §2.6 |
| **High** | Persist/return `pdf_panel_range_key` on GET | **Done** |
| **High** | HR upload live counts | **Done** — §7.8 |
| **High** | Calling queue `LEAD_004` + remarks | **Done** |
| **Medium** | Tata pricing in `GET /pricing-tables` | **Done** (defaults) |

Until GET echoes `pdf_panel_range_key`, frontend overview/PDF may show wrong panel text after full reload despite client-side inference.

---

## §7.9 — Dealer dashboard Total Value (approved quotations)

**Handoff:** `BACKEND_CHANGES_HANDOFF.md` §6.

- `GET /api/quotations` (dealer): each row has `status`, `finalAmount`, `totalAmount`, `pricing.*` amounts.
- `GET /api/dealers/me/dashboard-stats`: `approvedQuotationCount`, `approvedQuotationValue` (approved rows only).
- Admin approve sets `status: approved` (existing `updateQuotationStatus`).

---

## Visitor complete visit + quotation documents (implemented)

| Feature | Path | Notes |
|---------|------|--------|
| Complete visit | `PATCH /api/visits/{id}/complete` | S3 multipart, presigned URLs on GET |
| KYC documents | `PATCH /api/quotations/{id}/documents` | Partial multipart, allowlisted fields |
| Documents ZIP | `GET /api/quotations/{id}/documents/zip` | Server-side S3 fetch |
| Presign | `GET /api/quotations/{id}/documents/view-url` | Private bucket browse |

---

## Payment Management — installment count filter (client-side)

**No new API work** is required for the Account Management **installment count** dropdown. The SPA filters loaded rows by `phases.length` (aliases: `installments`, `paymentPhases`, `payment_phases`).

### What the backend must already return

- **`GET /api/quotations?status=approved`** (account-management JWT): each quotation includes the current installment/phase array under all three keys above.
- After **`PATCH` / `PUT` `/api/quotations/{quotationId}/installments`** (or `payment-details` / `payment-mode` aliases), the next **GET** must reflect saved phases (read-after-write).

### Troubleshooting wrong counts in UI

- Usually **missing or stale `installments[]`** on list/detail GET, not frontend filter logic.
- Verify `quotation_payment_phases` (or equivalent) rows exist for that `quotationId`.

### Optional (performance only)

- `GET /api/quotations?status=approved&installmentCount=2` — server-side filter if approved list grows very large.

### Related (optional, separate features)

| Area | Note |
|------|------|
| Dealers by Revenue | `statusApprovedAt` / `approved_at` when admin approves |
| Active dealers | `GET /api/dealers?isActive=true` |
| Duplicate customer search | Return `dealer` / `dealerName` on quotation rows |
| Compliant senior | When `isCompliantSenior=true`, require contact + 4 compliant images only (text bank/PAN fields optional) — **implemented** |

**Handoff:** `BACKEND_CHANGES_HANDOFF.md` §12.

---

## §6.5 — Account Management list fields (Payment Management + Overview)

**Handoff:** `BACKEND_CHANGES_HANDOFF.md` §12, §13.

### Payment Management (`GET /api/quotations?status=approved`, account-management JWT)

Each row must include:

| Field | Notes |
|-------|--------|
| `dealerId`, `dealer_id`, `dealer` | Client-side dealer filter |
| `statusApprovedAt`, `fileLoginAt` | Date-range filters |
| `paymentType`, `paymentStatus`, `paymentMode`, `bankName`, `bankIfsc` | Payment filters |
| `installments`, `paymentPhases`, `payment_phases` | Installment count = array length |
| `subtotal`, `remaining`, `remainingAmount` | Amounts |

**Installment count filter:** frontend-only — no `?installmentCount=` unless list performance requires it.

### Admin Overview kW — verify list payload (no new endpoint)

**Frontend computes kW client-side** from the admin quotation list (`GET /api/admin/quotations`). No mandatory new API unless you add optional server aggregates or a stored `system_kw` column.

**Confirm each approved row includes one of:**

- **`products`** with `systemType`, panel size/qty (DCR, BOTH, or `customPanels[]`), optional `inverterSize` — **preferred; implemented** via `quotationProductsApiFields()`
- Flat root fields (`panel_size`, …) — not on `quotations` table; rely on `products`
- Precomputed `systemKw` / `system_kw` — **implemented** on list + detail; persisted in `quotations.system_kw` on product save / approve

**Also on list rows (revenue + filters):** `status`, `statusApprovedAt` / `approved_at`, `dealerId`, `dealer`, `subtotal`.

| Verification | Status |
|--------------|--------|
| Full `products` on admin list | ✅ |
| `statusApprovedAt` on approve | ✅ |
| Root `dealerId` + nested `dealer` | ✅ |
| `system_kw` column + backfill | ✅ `database/migrations/add_system_kw_to_quotations.sql` |

**kW still 0 after frontend fix?** Check API row: `products.panelSize` / `panelQuantity` (or BOTH/customize fields) — usually missing product data, not a missing endpoint.

**Handoff:** `BACKEND_CHANGES_HANDOFF.md` §13.

---

## §6.5.1 — Admin Overview dealer capacity (kW sum)

**Handoff:** `BACKEND_CHANGES_HANDOFF.md` §13.

**Feature:** Admin **Overview → Dealers by Revenue** shows per-dealer **total kW** = sum of system size from **approved** quotations in the selected date range. **No new endpoint** if `GET /api/admin/quotations` rows include product/size data.

**Frontend:** `lib/merge-quotation-products.ts`, `lib/quotation-system-kw.ts`, `app/dashboard/admin/page.tsx`.

### Required on `GET /api/admin/quotations` (each row)

| Field | Purpose |
|-------|---------|
| `status` | Must be `approved` for kW to count |
| `statusApprovedAt` / `status_approved_at` / `approvedAt` | Approval-date filter |
| `dealerId` / `dealer_id` | Group by dealer |
| Product / size data | See sources below |
| `subtotal` | Revenue |

### Product data — at least one source populated

Frontend merges (priority order handled in `lib/merge-quotation-products.ts`):

| Source | Example | Backend |
|--------|---------|---------|
| `products` | `{ "systemType": "non-dcr", "panelSize": "550W", "panelQuantity": 12 }` | ✅ |
| `quotationProduct` | Same as joined row | ✅ alias of `products` |
| `quotationProducts[]` | First row used | ✅ `[merged]` |
| Flat root fields | `panel_size`, `panel_quantity`, … | ❌ not on quotations table |
| Precomputed | `systemKw: 6.6` or `systemSize: "6.6kW"` | ✅ computed on list |

**Anti-pattern:** `products: {}` with no panel fields anywhere → **0 kW** while revenue works.

### Fields by system type

| `systemType` | Fields for kW |
|--------------|---------------|
| `dcr` / `non-dcr` | `panelSize`, `panelQuantity` |
| `both` | `dcrPanelSize`, `dcrPanelQuantity`, `nonDcrPanelSize`, `nonDcrPanelQuantity` |
| `customize` | `customPanels[]` `{ size, quantity }` |
| Fallback | `inverterSize`, `structureSize` |

### kW calculation

```
kW = (parseW(panelSize) × panelQuantity) / 1000
```

BOTH: sum DCR + Non-DCR. CUSTOMIZE: sum all custom panel rows.

### Backend checklist

| Item | Status |
|------|--------|
| List includes product data (`products` / `quotationProduct`) | ✅ |
| Empty `products: {}` only when no `quotation_products` row | Verify data |
| `statusApprovedAt` on approve | ✅ |
| Return `systemKw` / `system_kw` on list | ✅ |
| Persist `system_kw` DB column | Optional |
| `GET /admin/overview/dealer-stats` | Optional |

### Optional SQL

```sql
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS system_kw NUMERIC(10,2) NULL;
```

Set on create/update from products; return as `systemKw` / `system_kw` on list (frontend uses first when present).
