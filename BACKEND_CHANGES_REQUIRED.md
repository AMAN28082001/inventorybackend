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

### §6.4.C.3 — Partial Approved + multi PI (Jul 2026)

**Handoff:** `BACKEND_INSTALLATION_PARTIAL_AND_METERING.md`.

- `installationStatus=installer_partial_approved` (or flags `installationPartialApproved=true`) — partial photo set; **not** Approved Installation; **Send to Metering blocked**.
- Full approve clears partial flags and sets `installer_approved` + `installerApprovedAt`.
- Optional text: `existingInstallationImageUrlsJson`, `existingPiUploadUrl`, `existingPiUploadUrlsJson`; merge with new `installerCompletionImages` / repeated `piUpload`.
- GET returns `piUploadUrls[]` (keep singular `piUploadUrl`).
- Metering details POST/GET: `remarks` + `authorizedRepresentative` / `authorized_representative`.

### Meter Installation Pending + WCC (Jul 2026)

**Handoff:** `BACKEND_METER_INSTALLATION_PENDING.md`.

- Status `meter_installation_pending` from `metering_approved`; GET returns it as `meteringStatus`.
- To MCO: `meter_installation_pending` → `mco` (legacy from `metering_approved` still allowed).
- Details POST accepts `meterInstallationPhoto` / `plantLivePhoto` (+ snake_case), `discomLocation`, WCC fields; echoes browsable URLs + names.

---

## §X — Quotation PDF display (panel range keys, May 2026)

**Handoff summary:** `BACKEND_CHANGES_HANDOFF.md` §2, §2.5, §2.6, §2.7. **Status: implemented** (incl. Tata DCR `tata_530_570`, commercial PDF flag, proposal PDF dates + refetch-before-download contract). See also **§X.9** (unchanged PDF flags).

### X.1 — Persist on `quotation_products`

| Field | Scope |
|-------|--------|
| `pdfPanelRangeKey` | Single / DCR / Non-DCR panel line |
| `pdfDcrPanelRangeKey` | BOTH — DCR |
| `pdfNonDcrPanelRangeKey` | BOTH — Non-DCR |
| `pdfCommercialSet` | Commercial set — hide page 3 T&C subsidy rows (Central/State Subsidy, disclaimer, consent; “subsidy” stripped from agreement text). App pricing unchanged. Boolean; snake_case `pdf_commercial_set`. **Implemented** — checkbox persists via GET `products`. |

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

**PATCH clear:** send `pdfPanelRangeKey: ""` / `null` — `buildQuotationProductPdfPersistFieldsForUpdate` clears DB values; omitted keys unchanged on partial PATCH. For `pdfCommercialSet`, send `false` or explicit field to clear (defaults `false` on create).

**Migration:** `20260607120000-add-pdf-commercial-set-to-quotation-products.js`.

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

**Migration:** `20260521120000-add-pdf-panel-range-keys-to-quotation-products.js`, `20260607120000-add-pdf-commercial-set-to-quotation-products.js`.

**Code:** `utils/quotationProductPdfDisplay.ts`, `utils/quotationTataDcrValidation.ts`, `controllers/quotationController.ts`.

### X.8 — Proposal PDF dates (`updatedAt`, `validUntil`) (Jun 2026)

**Handoff:** `BACKEND_CHANGES_HANDOFF.md` §2.7. **Status: implemented.**

**Frontend:** `lib/quotation-proposal-document.ts` (`normalizeQuotationTimestamps`, `resolveProposalQuotationDates`), `components/quotation-details-dialog.tsx` (refetches `GET /quotations/{id}` before Download PDF), `components/quotation-proposal-pdf.tsx`.

**Frontend → PDF field mapping** (`PROPOSAL_VALIDITY_DAYS = 7`):

| PDF field | Frontend resolves from |
|-----------|-------------------------|
| **Updated** | `updatedAt` → else `createdAt` → else `validUntil − 7 days` |
| **Valid Until** | Updated date + 7 days |

**Backend must** return accurate timestamps on `GET /api/quotations/{id}` (the download path refetches by id, not list cache).

| Field | When set / returned |
|-------|---------------------|
| `createdAt` / `created_at` | Always on GET list, GET by id, create response |
| `updatedAt` / `updated_at` | GET list + GET by id; bumped on products/pricing/discount PATCH |
| `validUntil` / `valid_until` | `updatedAt + 7 days` on create and on products/pricing/discount update |

**PATCH handlers that bump `updated_at`:**

| Method | Path |
|--------|------|
| `PATCH` | `/api/quotations/{id}/products` |
| `PATCH` | `/api/quotations/{id}/pricing` |
| `PATCH` | `/api/quotations/{id}/discount` (if still used) |

Each PATCH response includes the new `updatedAt` (and `validUntil` when recomputed).

**Helpers:** `utils/quotationApiJson.ts` — `QUOTATION_PROPOSAL_VALIDITY_DAYS` (7), `computeQuotationValidUntil`, `quotationProposalDateApiFields`, `touchQuotationProposalValidity`.

**Does not affect:** subsidy amounts, `centralSubsidy` / `stateSubsidy`, or catalog pricing — dates are PDF-display only.

**No new endpoints** — existing quotation routes only.

**Example GET by id** (used immediately before PDF download):

```json
{
  "id": "QT-HTIV24",
  "createdAt": "2026-04-20T10:00:00.000Z",
  "updatedAt": "2026-04-27T09:30:00.000Z",
  "validUntil": "2026-05-04T09:30:00.000Z",
  "products": {
    "pdfCommercialSet": false,
    "pdf_commercial_set": false
  }
}
```

### X.9 — Existing PDF flags (unchanged, still required)

| Item | Status |
|------|--------|
| `pdfPanelRangeKey`, `pdfDcrPanelRangeKey`, `pdfNonDcrPanelRangeKey` | Persist + GET echo |
| `PATCH …/products` after `POST` create | Required for PDF keys |
| Clear range keys on `""` / `null` | `buildQuotationProductPdfPersistFieldsForUpdate` |
| `dealer` on GET by id | List + detail |
| Do not strip unknown products keys on partial PATCH | Same as range keys |

---

## §Y — Quick handoff (May 2026)

| Priority | Topic | Status |
|----------|--------|--------|
| **High** | Payment Management → Installation release | **Done** — §M.0, HANDOFF §17, `BACKEND_INSTALLATION_RELEASE.md` |
| **High** | Final confirmation document uploads | **Done** — §M, HANDOFF §20 |
| **High** | Quotations tab → Send to Metering (`pending_metering`) | **Done** — §L.1, HANDOFF §21 |
| **High** | Inventory decimal prices + `products.unit` + kg→pieces | **Done** — §N, HANDOFF §18, `BACKEND_CHANGES_DECIMAL_PRICE_KG_TO_PIECES.md` |
| **Medium** | Admin Visitor Reports `GET /api/admin/visits` | **Done** — §Z, HANDOFF §19 |
| **High** | Tata DCR + `tata_530_570` + `VAL_003` fix | **Done** — §X.6, HANDOFF §2.6 |
| **Medium** | Commercial PDF flag `pdfCommercialSet` | **Done** — §X.1, HANDOFF §2.5 |
| **Medium** | Proposal PDF dates (`updatedAt`, `validUntil` +7d) | **Done** — §X.8, HANDOFF §2.7 |
| **High** | Persist/return `pdf_panel_range_key` on GET | **Done** |
| **High** | HR upload live counts | **Done** — §7.8 |
| **High** | Calling queue `LEAD_004` + remarks | **Done** — §E |
| **High** | In-progress lead stays `currentLead` until Submit | **Done** — §E.1, HANDOFF §4.5.1 |
| **High** | Reschedule / Decision Pending Submit (no 500) | **Done** — §E.2, HANDOFF §4.5.2 |
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

---

## §AB — Installment replace on save (Account Management)

**Status:** Implemented — `utils/quotationPaymentPhases.ts`, `updateQuotationPaymentDetails`  
**Reference:** `BACKEND_INSTALLMENT_REPLACE.ts`

### Problem

Removing installments and submitting caused deleted rows to return on refresh (upsert-by-`phase_number` left orphans).

### Fix

| Trigger | Behavior |
|---------|----------|
| `PUT /api/quotations/{id}/installments` | Always replace (delete all + insert body) |
| `PATCH …/installments` | Always replace |
| `PATCH …/payment-details` + `replaceInstallments: true` or `replace: true` | Replace |
| `PATCH …/payment-details` without replace flags | Legacy upsert |
| `PATCH …/installation-release` only | Does **not** touch installments |

`phases: []` clears all installment rows.

### QA

| # | Action | Expected |
|---|--------|----------|
| 1 | 3 phases → save 2 | GET returns 2 rows |
| 2 | Save `phases: []` | GET returns 0 rows |
| 3 | Hard refresh | Count unchanged |
| 4 | Release-only PATCH | Installments unchanged |

---

| 4 | Release-only PATCH | Installments unchanged |

---

## §AC — Payment Excel Customer Journey columns (Account Management)

**Status:** Implemented — `utils/paymentExcelJourneyStatus.ts`  
**Reference:** `BACKEND_PAYMENT_EXCEL_JOURNEY_STATUS.ts`  
**No new endpoint** — CSV export is client-side.

### Required on `GET /api/quotations?status=approved`

| Field | Purpose |
|-------|---------|
| `status` | Admin Approval stage |
| `installationStatus` / `installation_status` | Installation stage + File Status derivation |
| `meteringStatus` / `meteringStage` / `mcoStatus` | Metering stage |
| `installments` / `paymentPhases` | Installment count |

Missing `installationStatus` → Excel shows **Workflow Pending** for all rows after refresh.

### Optional pre-computed labels

```json
{
  "journeyStageProgress": {
    "adminApproval": "completed",
    "installation": "in_progress",
    "metering": "not_started",
    "finalConfirmation": "not_started"
  },
  "fileStatus": "Pending Metering",
  "adminApprovalStatus": "Approved",
  "installationStatusLabel": "Pending Metering",
  "meteringStatusLabel": "Pending",
  "finalConfirmationStatusLabel": "Approved"
}
```

### QA

| # | Check |
|---|--------|
| 1 | Approved list row includes `installationStatus` + `meteringStatus` |
| 2 | After workflow PATCH, GET reflects new `installationStatus` |
| 3 | `installments.length` matches saved phase count |
| 4 | `fileStatus` not always `Workflow Pending` when installation progressed |

---

## §AD — Super Admin on Quotation Admin Login + Inventory data (Jul 2026)

**Status:** Implemented — `utils/inventoryRole.ts`, `quotationAuthController.login`, `authorizeAdmin`, inventory `authenticate`  
**Reference:** `BACKEND_SUPER_ADMIN_QUOTATION_LOGIN.ts`  
**Frontend:** `/login` → Admin Panel → Accounts → Open Inventory (`/dashboard/inventory`)

### Requirements

| # | Requirement |
|---|-------------|
| 1 | `POST /api/auth/login` accepts inventory `users` with super-admin credentials |
| 2 | Response `user.role` is canonical **`super-admin`** (normalize `superadmin` / `super_admin`) |
| 3 | JWT access + refresh claims use the same canonical role |
| 4 | `/api/admin/*` allows `super-admin` the same as admin — **do not** require `username === "admin"` |
| 5 | Same Bearer from `/auth/login` works on inventory routes (`middleware/auth.ts`) — no separate inventory-only login for this SPA |
| 6 | Super-admin inventory scope is **full** (all products, admins, stock-requests, sales, stock-returns) |

### Inventory endpoints (super-admin full scope)

| Method | Path |
|--------|------|
| GET | `/api/products`, `/api/users?role=admin`, `/api/users` (agents), `/api/stock-requests`, `/api/sales`, `/api/stock-returns` |
| POST/PATCH | create product / add stock / create+dispatch stock-request / approve sale / process return (existing role gates) |

### Auth notes

- Quotation admin JWT (`req.dealer.role === 'admin'`) remains valid for `/admin/*`.
- Inventory super-admin JWT is accepted via `authorizeAdmin` → `isInventoryAdminLikeRole`.
- Shared secret: `JWT_SECRET` (same for quotation + inventory).

### QA

| # | Check |
|---|--------|
| 1 | Login as `superadmin` → `data.user.role === "super-admin"` |
| 2 | Decode JWT → `role: "super-admin"` |
| 3 | `GET /api/admin/quotations` with that token → 200 |
| 4 | `GET /api/products` + `GET /api/users?role=admin` with same token → non-empty (full scope) |
| 5 | No 403 solely because username is not `"admin"` |

### AD.5.1 — Known SPA error: `Invalid token or user inactive` on `GET /users`

**Status:** Fixed — `tryAuthenticateQuotationAdminForInventory` in `middleware/auth.ts`

| Item | Detail |
|------|--------|
| Symptom | Accounts → Open Inventory shows red banner; `GET /users` → 401 `Invalid token or user inactive` while `GET /products` works |
| Why products work | `GET /api/products` is public (no auth middleware) |
| Why /users failed | Inventory `authenticate` only loaded `users` by JWT `id`. Quotation Admin JWT `id` is a **Dealer** id |
| Fix | Accept Dealer JWT with `role: "admin"` + `isActive` → inventory session with **`req.user.role = "super-admin"`**, `authSource: "quotation-admin"` |
| Allow-list | Inventory `super-admin` **and** quotation Admin (Dealer) — same inventory capabilities |
| Scope | Quotation Admin ≡ Super Admin on `/users`, `/products`, `/stock-requests`, `/sales`, `/stock-returns`, `/admin-inventory`, etc. |

**QA:** Quotation Admin token → `GET /api/users` and `GET /api/users/agents` → **200** (not 401).  
**No second login:** Same token → `GET /api/inventory-auth/me` → 200 with `requiresInventoryLogin: false` (do not force `/inventory-auth/login`).

---

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

---

## §L.1 — Quotations tab → Send to Metering (`pending_metering`)

**Handoff:** `BACKEND_CHANGES_HANDOFF.md` §21 (frontend pack may label §11). **Status: implemented.** **No new route.**

### L.1.1 — Endpoint (existing)

`PATCH /api/admin/quotations/{quotationId}/installation-status`

Alias: `PATCH /api/admin/quotations/{quotationId}/workflow-status`

**Body (camelCase + snake_case):**

```json
{
  "installationStatus": "pending_metering",
  "installation_status": "pending_metering",
  "meteringStatus": "pending_metering",
  "metering_status": "pending_metering"
}
```

Frontend fallback: `lib/api.ts` → `patchOperationalWorkflowStatus` (metering status PATCH aliases).

### L.1.2 — Backend requirements

| # | Requirement | Implementation |
|---|-------------|----------------|
| 1 | Admin JWT can PATCH `pending_metering` | `authorizeAdmin` + `hasAdminQuotationAccess()` (quotation dealer admin **or** inventory admin) |
| 2 | Persist stage | `quotations.installation_status = pending_metering`; GET derives `meteringStatus` via `deriveMeteringStatus()` |
| 3 | GET `/admin/quotations` reflects save | `meteringWorkflowApiFields()` on list rows |
| 4 | GET `/metering/quotations` includes row | `getMeteringQueue` — `?status=processing` → `pending_metering,metering_in_progress`; **no** release gate on metering pipeline |
| 5 | Leaves Installation lists | `INSTALLER_RELEASE_STATUSES` excludes `pending_metering` |
| 6 | No auto-advance on photo upload | Installer upload sets `installer_approved` only |
| 7 | Idempotent re-send | Already `pending_metering` → **200** with current state |

### L.1.3 — Transition rules (admin Send to Metering)

| From | Allowed |
|------|---------|
| `installer_approved` | **Yes** (required minimum) |
| `pending_baldev`, `baldev_*` | Yes |
| `metering_in_progress` | Yes — reset to `pending_metering` |
| `pending_metering` | Yes — idempotent **200** |
| `pending_installer`, `installer_in_progress` | **No** — complete installer first |
| `installer_partial_approved` | **No** — Complete & Mark as Approved first |
| `metering_approved`, `mco`, `completed` | **400** `VAL_001` with clear message |

**Quotation `status`:** Admin may send while quotation is still `pending` (no block).

**Release gate:** Admin override — PATCH does **not** require `installationReadyForInstaller` / `installationReleasedAt`.

See also `BACKEND_INSTALLATION_PARTIAL_AND_METERING.md`.

### L.1.4 — Response (200)

```json
{
  "success": true,
  "data": {
    "id": "…",
    "installationStatus": "pending_metering",
    "installation_status": "pending_metering",
    "meteringStatus": "pending_metering",
    "metering_status": "pending_metering",
    "updatedAt": "2026-06-06T12:00:00.000Z"
  }
}
```

### L.1.5 — Errors

| Case | Status | Code |
|------|--------|------|
| Non-admin JWT | 403 | `AUTH_004` |
| Invalid transition | 400 | `VAL_001` |
| Quotation not found | 404 | `RES_001` |

### L.1.6 — QA

1. Admin PATCH from `pending_installer` → **200**; GET admin list shows `pending_metering`.
2. `GET /api/metering/quotations?status=processing` includes the row (even without PM release).
3. Row absent from `GET /api/admin/quotations?scope=installer_queue`.
4. Re-send PATCH → **200**, same state.
5. Installer photo upload alone → `installer_approved`, not `pending_metering`.

**Code:** `controllers/adminController.ts` → `updateQuotationInstallationStatus`; `controllers/workflowController.ts` → `getMeteringQueue`; `utils/meteringWorkflowApi.ts`.

---

## §M — Final confirmation document uploads (June 2026)

**Handoff:** `BACKEND_CHANGES_HANDOFF.md` §20. **Reference:** `BACKEND_ADMIN_QUOTATION_STATUS.ts` → `postAdminFinalConfirmationDocuments`. **Status: implemented.**

### M.1 — Root cause (do not use KYC PATCH)

`PATCH /api/quotations/{id}/documents` is the **KYC** route. When a dealer JWT is used, missing `phoneNumber` / `emailId` / `electricityKno` returns **400** `Invalid quotation document payload` even if only final-confirmation files are sent.

**Use the dedicated final-confirmation route** (below). KYC PATCH remains unchanged for dealer KYC uploads.

### M.2 — Preferred endpoint

`POST /api/admin/quotations/{quotationId}/final-confirmation-documents`

| Item | Detail |
|------|--------|
| Content-Type | `multipart/form-data` |
| Roles | `admin`, `super-admin`, `super-admin-manager`, `baldev`, `confirmation` |
| Partial saves | One or more files per request OK |

**Baldev alias:** `POST /api/baldev/quotations/{quotationId}/final-confirmation-documents`

**Shared fallback:** `POST /api/quotations/{quotationId}/final-confirmation-documents`

### M.3 — Multipart field names

| Multipart key | DB column | GET alias |
|---------------|-----------|-----------|
| `customerFinalBillFile` | `customerFinalBillFile` | `customerFinalBillFileUrl` |
| `panelWarrantyFile` | `panelWarrantyFile` | `panelWarrantyFileUrl` |
| `inverterWarrantyFile` | `inverterWarrantyFile` | `inverterWarrantyFileUrl` |
| `workCompletionWarrantyFile` | `workCompletionWarrantyFile` | `workCompletionWarrantyFileUrl` |

Image or PDF per file (max **30 MB** each). S3 path: `quotation-documents/{quotationId}/{field}-{timestamp}.{ext}`.

### M.4 — Fallback single-file upload

If batch route missing (**404**), frontend retries:

`POST /api/admin/quotations/{id}/final-confirmation-documents/upload`  
`POST /api/quotations/{id}/documents/upload`

Body: `field` = one of the four keys above + single `file` part. Persists to `quotation_documents` for operational roles.

### M.5 — Persistence & GET

- Upsert `quotation_documents` row (partial update — other KYC columns untouched).
- `GET /api/admin/quotations`, `GET /api/quotations/{id}` → `documents` object includes presigned/browsable URLs + `*FileUrl` aliases via `resolveQuotationDocumentUrls()`.

### M.6 — Success response (200)

```json
{
  "success": true,
  "data": {
    "quotationId": "…",
    "documents": { "customerFinalBillFile": "https://…", "customerFinalBillFileUrl": "https://…", "…": "…" },
    "customerFinalBillFile": "https://…",
    "customerFinalBillFileUrl": "https://…"
  }
}
```

### M.7 — Errors

| Case | Status | Code |
|------|--------|------|
| No files in request | 400 | `VALIDATION_ERROR` |
| Wrong multipart field name | 400 | `VALIDATION_ERROR` |
| File too large | 413 | `VALIDATION_ERROR` |
| Quotation not found | 404 | `RES_001` |
| Wrong role | 403 | `AUTH_004` |

### M.8 — QA (curl sketch)

```bash
curl -X POST "$API/api/admin/quotations/$QT_ID/final-confirmation-documents" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -F "customerFinalBillFile=@bill.pdf" \
  -F "panelWarrantyFile=@panel.pdf"
```

1. Partial upload (one file) → **200**, other slots unchanged on GET.
2. Second upload adds another slot → **200**.
3. KYC PATCH with only final-confirmation files + dealer JWT → **200** (no KYC text required) — but prefer dedicated POST.
4. Baldev JWT on `/api/baldev/…/final-confirmation-documents` → **200**.

**Code:** `controllers/quotationController.ts` → `saveFinalConfirmationDocuments`, `uploadQuotationDocument`; `routes/adminRoutes.ts`, `routes/baldevRoutes.ts`, `utils/finalConfirmationDocuments.ts`.

---

## §M.0 — Payment Management → Admin Installation (June 2026)

**Handoff:** `BACKEND_CHANGES_HANDOFF.md` §17, `BACKEND_INSTALLATION_RELEASE.md`. **Status: implemented.**

### M.0.1 — Release endpoint

`PATCH /api/quotations/{id}/installation-release` — sets `installation_ready_for_installer`, `installation_released_at`, `installation_status = pending_installer`.

### M.0.2 — Installer queue gate

Row visible only when released flag or `installation_released_at` is set.

### M.0.3 — No auto-advance to metering

Photo upload stays `installer_approved` until admin explicitly advances.

---

## §N — Decimal prices & kg → pieces inventory (June 2025)

**Full spec:** `BACKEND_CHANGES_DECIMAL_PRICE_KG_TO_PIECES.md`. **Status: implemented.**

| Topic | Backend action |
|-------|----------------|
| Decimal prices | `DECIMAL` columns; `roundProductPrice()`; accept `85.45`, `153.00` (per-piece) |
| Product `unit` | `products.unit` VARCHAR(50); POST/PUT all products; GET returns unit (Meters, Quantity, Pieces, …) |
| Kg products | Frontend converts weight **and** price; API gets integer pieces + per-piece `unit_price` |
| Unit validation | Display names + codes; Pieces for ex-KGS; omit `unit` on update → unchanged |
| Stock | `stock_to_add` adds integer pieces; structural/KGS items — no serials |
| GET | `formatProductForApi` — 2dp prices + `unit` on every row |
| No backend conversion | Store final values only unless audit columns added later |

**Endpoints:** `POST /api/products`, `PUT /api/products/:id`, `GET /api/products`, `GET /api/products/:id`

---

## §6 — Meter products — serial numbers optional (June 2026)

**Full spec:** [`BACKEND_CHANGES_METER_SERIAL_OPTIONAL.md`](./BACKEND_CHANGES_METER_SERIAL_OPTIONAL.md). **Status: implemented.**

| Topic | Rule |
|-------|------|
| Panels / Inverters | Serials required on create (qty > 0), add stock, dispatch |
| Meters | Never require serials — create, edit, add stock, dispatch by quantity |
| Others | Serials optional |
| Helper | `requiresSerialNumbers(category, productName)` in `utils/productSerialLookup.ts` |
| Error copy | `Serial numbers are required for Panels and Inverters.` |

**Dispatch:** Omit meter lines from `serial_numbers` map — see [`BACKEND_CHANGES_STOCK_REQUEST_DISPATCH.md`](./BACKEND_CHANGES_STOCK_REQUEST_DISPATCH.md) §5.

---

## §Z — Admin Visitor Reports (`GET /api/admin/visits`)

**Handoff:** `BACKEND_CHANGES_HANDOFF.md` §19. **Status: implemented.**

### Z.1 — Endpoint

`GET /api/admin/visits` — admin / super-admin only (`authorizeAdmin`).

Fallback: `GET /api/visits` when quotation dealer JWT has `role=admin` (delegates to same handler).

### Z.2 — Auth

| Role | `/api/admin/visits` | `/api/visits` |
|------|---------------------|---------------|
| Quotation admin / inventory admin | 200 | 200 (admin fallback) |
| Dealer (non-admin) | 403 | Own `dealerId` rows |
| Visitor | 403 | 403 |

### Z.3 — Query: `status`

Values: `pending`, `approved`, `completed`, `incomplete`, `rejected`, `rescheduled`, `all` (default all when omitted). Aliases `approve`/`complete`/`reject`/`reschedule` map to DB variants.

### Z.4 — Query: `visitorId`

Filters visits that have a `visit_assignments` row for that visitor.

### Z.5 — Query: `startDate` / `endDate`

Inclusive filter on `visits.visitDate` (`DATE`), format `YYYY-MM-DD`.

### Z.6 — Query: `search`

Case-insensitive match on: visit id, quotation id, location, customer name/mobile, dealer name, visitor name.

### Z.7 — Query: `page` / `limit`

Default `page=1`, `limit=20`, max `limit=2000`. Frontend loads `limit=2000&status=all` for client-side tab filters.

### Z.8 — Response shape

```json
{
  "success": true,
  "data": {
    "visits": [
      {
        "id": "visit-uuid",
        "quotationId": "QT-XXXX",
        "dealerId": "dealer-uuid",
        "visitDate": "2026-06-05",
        "visitTime": "10:00 - 11:00",
        "location": "Jaipur",
        "status": "pending",
        "visitors": [{ "visitorId": "…", "visitorName": "Rahul Kumar" }],
        "customer": { "firstName": "Amit", "lastName": "Sharma", "mobile": "9876543210" },
        "dealer": { "id": "…", "firstName": "JAGDISH", "lastName": "YADAV" },
        "rejectionReason": null,
        "notes": null
      }
    ],
    "pagination": { "page": 1, "limit": 2000, "total": 42, "totalPages": 1, "hasNext": false, "hasPrev": false }
  }
}
```

### Z.9 — Includes / joins

`visit_assignments` + `visitors`, `quotations` + `customers` + `dealers`. Media URLs presigned via `resolveBrowsableMediaUrl(s)` when present.

### Z.10 — Caching

`Cache-Control: no-store` on list responses.

### Z.11 — Details modal: `GET /quotations/{id}/visits`

**No separate completion endpoint.** Admin Details modal uses per-quotation visits (same as frontend fallback today).

**Auth:** `authorizeDealerAdminOrVisitor` — quotation **admin** sees any quotation; dealer sees own.

**Each visit must include (completion + names):**

| Field | Notes |
|-------|--------|
| `notes`, `length`, `width`, `height`, `unit` | Site / completion |
| `backLegFeet`, `midLegFeet`, `frontLegFeet` | + snake_case aliases |
| `images`, `rowDiagramImage`, `meterImage` | Presigned/browsable URLs (§U pattern) |
| `visitors[]` | `visitorId`, **`visitorName`**, `firstName`, `lastName` |
| `customer` | `firstName`, `lastName`, `mobile`, `fullName` |
| `quotationId`, `dealerId`, `status` | Top-level ids |

**Code:** `formatVisitCompletionPayload()` in `utils/visitApiFormat.ts`; called from `getVisitsForQuotation`.

### Z.12 — Admin list performance

- `GET /admin/visits` default: **no** completion images on list rows (names only).
- Optional `?includeMedia=true` if list needs thumbnails.
- Modal loads media via `GET /quotations/{id}/visits`.

### Z.13 — Test plan

1. Admin `GET /admin/visits?limit=2000&status=all` → visits with `visitorName` + customer names (not UUID-only / N/A)
2. Dealer JWT → 403 on `/admin/visits`
3. `GET /quotations/{qtId}/visits` → `notes`, dimensions, presigned `rowDiagramImage` / `images`
4. `visitorId` filter → subset only
5. `search` matches customer or dealer name
6. Quotation admin `GET /visits?limit=2000` → same list shape as `/admin/visits`

**Code:** `controllers/visitController.ts` → `getAdminVisits`, `getVisitsForQuotation`; `routes/adminRoutes.ts`; `utils/visitApiFormat.ts`

---

## §E — Dealer calling queue (remarks, tabs, LEAD_004)

**Handoff:** `BACKEND_CHANGES_HANDOFF.md` §3–§4, §4.8. **Quick ref:** `BACKEND_TEAM_SUMMARY.md` (Priority 1). **Status: implemented.**

### Problem

Dealer sees lead from `GET /dealers/me/calling-queue/next` but `PATCH …/action` returned **403 `LEAD_004`** when `assigned_dealer_id` was null, pool sentinel, or another dealer. Frontend may hide the error; **reports still need a real DB assignment**.

### Required fix (Option A — primary)

| `action` | Backend |
|----------|---------|
| `start` | Pool/unassigned + dealer in HR `dealerIds` → assignee = JWT dealer, `in_progress` |
| Outcomes | Auto-claim if needed → persist remark → close → `nextLead` |
| Any | Another dealer’s lead → **403 `LEAD_004`** |

Also: Option B (`POST …/claim`, `POST …/assign`, `PATCH …/:leadId`) · Option C (promote on `GET …/next`).

| Area | Endpoints | Notes |
|------|-----------|--------|
| Claim / assign | `POST …/claim`, `POST …/assign`, `PATCH …/:leadId` | Pool lead → dealer assignment; **LEAD_004** when owned by another dealer |
| Action PATCH | `PATCH …/calling-queue/{leadId}/action` | `start`, outcomes, tagged remarks — `part_1_call_and_lead` → `call_connectivity` |
| Queue GET | `GET …/calling-queue/current`, `GET …/calling-queue/next` | Don’t return leads this dealer can’t PATCH; `assignedDealerName` on every row |
| HR / Admin history | `GET /api/hr/calling-actions`, `GET /api/admin/calling-actions` | `dealerId`, `range`, `startDate`/`endDate` |

**Lead fields:** `assignedDealerId` = calling assignee · `dealerId` = null on queue (HR/uploader only).

**Reference:** `BACKEND_ADMIN_QUOTATION_STATUS.ts` (`patchDealerCallingQueueAction`, `callingActionToApiJson`).

---

## §E.1 — Active lead until Submit (`in_progress` must not disappear)

**Handoff:** `BACKEND_CHANGES_HANDOFF.md` **§4.5.1**. **Status: implemented.**

Fixes dealer UI bug: after **Start Call**, the active row vanished because `GET /current` returned FIFO queue head (`assigned`) instead of the open `in_progress` assignment.

### E.1.1 — Endpoint contract

| Endpoint | When dealer has open `in_progress` | When no open call |
|----------|-------------------------------------|-------------------|
| `PATCH …/action` `start` | `lead` + `currentLead` (same, `in_progress`), `counts` — **no** `nextLead` | Same; claim via LEAD_004 if pool lead |
| `GET …/current` | `currentLead` = open `in_progress` row; `nextLead: null` | `currentLead` / `nextLead` = callable FIFO head |
| `GET …/next` | Same as `/current` (alias) — **no** different head | Callable FIFO head |
| `PATCH …/action` outcome | Close row → promote → full snapshot; `nextLead` = new head | Same |

### E.1.2 — Response shapes

**`start` (200):**

```json
{
  "success": true,
  "data": {
    "lead": { "leadId": "…", "status": "in_progress" },
    "currentLead": { "leadId": "…", "status": "in_progress" },
    "pendingCount": 1,
    "counts": { "pending": 1, "queued": 0, "scheduled": 0, "completed": 12 }
  }
}
```

**`GET /current` while call open:**

```json
{
  "success": true,
  "data": {
    "currentLead": { "leadId": "…", "status": "in_progress" },
    "nextLead": null,
    "queue": [ "... includes in_progress and other callable rows ..." ]
  }
}
```

**Outcome Submit (200):**

```json
{
  "success": true,
  "data": {
    "leadId": "…",
    "status": "called",
    "assignmentStatus": "completed",
    "currentLead": { "leadId": "next-…", "status": "assigned" },
    "nextLead": { "leadId": "next-…", "status": "assigned" }
  }
}
```

### E.1.3 — Concurrency

- **Recommended:** one open `in_progress` per dealer.
- `promoteQueuedLeadIfSlotAvailable` returns early when any `in_progress` exists for that dealer (prevents queue skip during active call).

### E.1.4 — Checklist

| # | Item | Status |
|---|------|--------|
| 1 | `start` omits `nextLead` | Done |
| 2 | `GET /current` prefers `in_progress` over FIFO head | Done — `resolveDealerQueueHead()` |
| 3 | `GET /next` does not peek past open call | Done — `nextLead: null` |
| 4 | Completion returns `nextLead` after close + promote | Done |
| 5 | Pool claim on `start` (LEAD_004) | Done — §3 |
| 6 | No promote while `in_progress` open | Done |

### E.1.5 — QA

1. Assign leads A (earlier `assignedAt`) and B to same dealer; **Start** B → UI keeps B until Submit.
2. `GET /current` after Start → `currentLead.status === "in_progress"`, `nextLead === null`.
3. Submit **called** on B → `nextLead` is A or next callable row; B not in pending queue.
4. Dealer B cannot steal dealer A’s `in_progress` lead (`LEAD_004`).
5. Double **Start** on same lead → idempotent `in_progress`, same `currentLead`.

**Code:** `controllers/callingLeadController.ts` — `resolveDealerQueueHead`, `buildDealerQueueSnapshot`, `updateDealerCallingQueueAction`, `promoteQueuedLeadIfSlotAvailable`.

---

## §E.2 — Reschedule / Decision Pending Submit (no 500)

**Handoff:** `BACKEND_CHANGES_HANDOFF.md` **§4.5.2**. **Status: implemented.**

Fixes **500** when dealer submits **Connected → Decision Pending → Callback Scheduled** with a datetime on `PATCH /api/dealers/me/calling-queue/{leadId}/action`.

### E.2.1 — Request contract

| Field | Aliases | Required |
|-------|---------|----------|
| `action` | — | `rescheduled` (preferred) or `follow_up` when `nextFollowUpAt` set |
| `nextFollowUpAt` | `next_follow_up_at` | Yes for reschedule (ISO UTC) |
| `statusCategory` | `status_category`, `statusCategoryKey` | `schedule` for Callback Scheduled |
| `statusText` | `status_text`, `statusLabel` | e.g. `Callback Scheduled` |
| `callRemark` | `call_remark` | `[schedule] Callback Scheduled \| free text` |

**Example body:**

```json
{
  "action": "rescheduled",
  "callRemark": "[schedule] Callback Scheduled | 6 kw panels",
  "statusCategory": "schedule",
  "statusText": "Callback Scheduled",
  "nextFollowUpAt": "2026-06-11T05:07:00.000Z",
  "next_follow_up_at": "2026-06-11T05:07:00.000Z"
}
```

### E.2.2 — Backend behavior

| Rule | Implementation |
|------|----------------|
| `follow_up` + datetime | Normalized to `rescheduled` in Zod + controller |
| Assignment status | `rescheduled` (not `completed`) |
| `call_remark` | **Replace** via `buildTaggedCallRemark()` — no nested tag append |
| Column type | `callRemark` TEXT — migration `20260606120000-ensure-calling-remark-text-columns.js` |
| Missing datetime | **400** `VAL_001` |
| Bad transition | **409** `LEAD_005` |
| DB string overflow | **400** `VAL_001` (not 500) |
| Transition | `in_progress` → `rescheduled` for assignee |
| Response | Full queue snapshot: `lead`, `nextLead`, `scheduledLeads` includes row when follow-up is future |

### E.2.3 — Common 500 causes (addressed)

1. `rescheduled` missing from action enum — Zod + Sequelize ENUM include it.
2. Ignoring camelCase `nextFollowUpAt` / snake_case `next_follow_up_at` — resolved in validation transform.
3. `call_remark` VARCHAR overflow from appended history — TEXT migration + replace semantics.
4. Uncaught exception in transition validator — explicit `LEAD_005` / `VAL_001`; Sequelize length errors mapped to 400.

### E.2.4 — Checklist

| # | Item | Status |
|---|------|--------|
| 1 | Accept `rescheduled` + `follow_up` alias with datetime | Done |
| 2 | Read `nextFollowUpAt` + `next_follow_up_at` | Done |
| 3 | Set assignment `status: rescheduled` | Done |
| 4 | Persist `schedule` / Callback Scheduled remarks | Done |
| 5 | Replace `call_remark` (no append) | Done |
| 6 | TEXT columns for remarks | Done (+ migrate) |
| 7 | VAL_001 / LEAD_005 instead of 500 | Done |
| 8 | Response includes `scheduledLeads` | Done |

### E.2.5 — QA

1. Submit reschedule from `in_progress` → **200**, not **500**.
2. `GET /current` → lead in `scheduledLeads`, not `currentLead`.
3. Only `next_follow_up_at` in body → **200**.
4. `follow_up` + datetime (frontend retry) → same as `rescheduled`.
5. Missing datetime → **400** `VAL_001`.
6. Long remark (≤ 4000 chars) → **200** after migrate.

**Code:** `validations/callingLeadValidations.ts`, `controllers/callingLeadController.ts` (`buildTaggedCallRemark`, `resolveNextFollowUpAtFromRequest`).

---

## File index (May–June 2026 handoff)

| Doc / code | Topics |
|------------|--------|
| `BACKEND_CHANGES_HANDOFF.md` | Sprint checklist, §1 HR counts, §3–§4 calling, **§4.5.1**, §17 installation, §18 products, §19 visits |
| `BACKEND_CHANGES_REQUIRED.md` | §X PDF, §Y priority, **§L.1** send to metering, **§M** final confirmation, §M.0 install, §N/**§6** meter serials, §Z, **§E** calling queue |
| `BACKEND_CHANGES_METER_SERIAL_OPTIONAL.md` | Meter create/edit/add-stock; `requiresSerialNumbers()` |
| `BACKEND_ADMIN_QUOTATION_STATUS.ts` | HR upload reference, `patchDealerCallingQueueAction` |
| `controllers/callingLeadController.ts` | Calling queue implementation |
