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
| **High** | Payment Management → Installation release | **Done** — §M, HANDOFF §17, `BACKEND_INSTALLATION_RELEASE.md` |
| **High** | Inventory decimal prices + `products.unit` + kg→pieces | **Done** — §N, HANDOFF §18, `BACKEND_CHANGES_DECIMAL_PRICE_KG_TO_PIECES.md` |
| **Medium** | Admin Visitor Reports `GET /api/admin/visits` | **Done** — §Z, HANDOFF §19 |
| **High** | Tata DCR + `tata_530_570` + `VAL_003` fix | **Done** — §X.6, HANDOFF §2.6 |
| **High** | Persist/return `pdf_panel_range_key` on GET | **Done** |
| **High** | HR upload live counts | **Done** — §7.8 |
| **High** | Calling queue `LEAD_004` + remarks | **Done** — §E |
| **High** | In-progress lead stays `currentLead` until Submit | **Done** — §E.1, HANDOFF §4.5.1 |
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

---

## §M — Payment Management → Admin Installation (June 2026)

**Handoff:** `BACKEND_CHANGES_HANDOFF.md` §17. **Status: implemented.**

### M.1 — Release endpoint

`PATCH /api/quotations/{id}/installation-release`

```json
{
  "installationReadyForInstaller": true,
  "installationReleasedAt": "2026-06-05T10:30:00.000Z"
}
```

Sets `installation_ready_for_installer`, `installation_released_at`, and `installation_status = pending_installer`.

### M.2 — List fields (all installation list GETs)

Return on every row: `installationReadyForInstaller`, `installationReleasedAt`, `installationStatus`, plus installation photo URLs after upload.

Endpoints: `GET /api/admin/quotations`, `GET /api/quotations?status=approved`, `GET /api/installer/quotations`.

### M.3 — Installer queue gate

Row visible only when `installation_ready_for_installer = true` **OR** `installation_released_at` is set. Approved-but-never-released quotations must **not** appear.

### M.4 — Installation tab semantics

| Tab | State |
|-----|--------|
| Pending Installation | Released + `pending_installer` / `installer_in_progress` / no photos |
| Approved Installation | Released + `installer_approved` |

### M.5 — No auto-advance to metering

Photo upload with `installationStatus=installer_approved` persists **`installer_approved`**. Advance to metering **only** when admin sends `pending_metering` (e.g. `PATCH /api/admin/quotations/{id}/installation-status`).

`meteringStatus` / `deriveMeteringStatus` must be `null` while still in the installation pipeline — do not derive `pending_metering` from `installer_approved`.

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

**Handoff:** `BACKEND_CHANGES_HANDOFF.md` §3–§4, §4.8. **Status: implemented.**

| Area | Endpoints | Notes |
|------|-----------|--------|
| Claim / assign | `POST …/claim`, `POST …/assign`, `PATCH …/:leadId` | Pool lead → dealer assignment; **LEAD_004** when owned by another dealer |
| Action PATCH | `PATCH …/calling-queue/{leadId}/action` | `start`, outcomes, tagged remarks — see `lib/calling-remark-payload.ts` |
| Queue GET | `GET …/calling-queue/current`, `GET …/calling-queue/next` | Tab buckets: `scheduledLeads`, `dialledActions`, `connectedActions`, etc. |
| HR / Admin history | `GET /api/hr/calling-actions`, `GET /api/admin/calling-actions` | `dealerId`, `range`, `startDate`/`endDate` — see `lib/api.ts` |

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

## File index (May–June 2026 handoff)

| Doc / code | Topics |
|------------|--------|
| `BACKEND_CHANGES_HANDOFF.md` | Sprint checklist, §1 HR counts, §3–§4 calling, **§4.5.1**, §17 installation, §18 products, §19 visits |
| `BACKEND_CHANGES_REQUIRED.md` | §X PDF, §Y priority, §7.9 dashboard, §M/N/Z, **§E / §E.1** calling queue |
| `BACKEND_ADMIN_QUOTATION_STATUS.ts` | HR upload reference, `patchDealerCallingQueueAction` |
| `controllers/callingLeadController.ts` | Calling queue implementation |
