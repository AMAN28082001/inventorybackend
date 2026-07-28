# Backend changes handoff (May 2026)

**Single handoff doc for the API team.** Full specs: `BACKEND_CHANGES_REQUIRED.md` (§7.8–§7.9, dealer queue **§E.1 / §E.2** / §E–§H, §J, §M–§N, §X, §Y). **Quotation PDF (Jun 2026):** **§2.5** (`pdfCommercialSet`), **§2.7** (`updatedAt` / `validUntil` +7d, refetch before Download PDF). **Calling queue:** **§4.5.1** / **§E.1** (active lead until Submit); **§4.5.2** / **§E.2** (reschedule / Decision Pending — no 500). Reference contracts: `BACKEND_ADMIN_QUOTATION_STATUS.ts`, `BACKEND_INSTALLATION_RELEASE.md`, `BACKEND_CHANGES_DECIMAL_PRICE_KG_TO_PIECES.md`. Implementation: `controllers/callingLeadController.ts`, `controllers/quotationController.ts`, `controllers/productController.ts`, `controllers/visitController.ts`, `controllers/customerController.ts`, `utils/quotationProductPdfDisplay.ts`, `utils/quotationApiJson.ts`, `utils/productUnit.ts`, `utils/s3Service.ts`.

## Sprint checklist (copy for tracking)

| # | Priority | Area | Status | Handoff § |
|---|----------|------|--------|-----------|
| 1 | High | HR upload GET live counts | **Done** | §1 |
| 2 | High | PATCH calling action + remarks | **Done** | §4.1 |
| 3 | High | Queue GET tab buckets | **Done** | §4.4 |
| 4 | High | `start` without `nextLead` | **Done** | §4.5 |
| 4b | High | In-progress lead stays `currentLead` until Submit | **Done** | §4.5.1 / §E.1 |
| 4c | High | Reschedule / Decision Pending Submit (no 500) | **Done** | §4.5.2 / §E.2 |
| 5 | High | Claim on `start` / `LEAD_004` | **Done** | §3 |
| 6 | High | HR + Admin calling-actions GET | **Done** | §4.8 / §J |
| 7 | Medium | Customer note on lead PATCH | **Done** | §4.2 |
| 8 | Medium | `POST /customers` `notes` / `remarks` | **Done** | §4.3 |
| 9 | Medium | PDF panel range keys on products (not in validation) | **Done** | §2 |
| 10 | Medium | Quotation create stability | **Done** | §5 |
| 11 | High | Visitor complete visit (S3 + presigned URLs) | **Done** | §6 |
| 12 | High | Quotation documents PATCH + ZIP | **Done** | §7 |
| 13 | Medium | `meterBrand` combined label + `validUntil` +7d | **Done** | §2 |
| 14 | Medium | Dealer dashboard **Total Value** (approved only) | **Done** | §6 |
| 15 | High | HR Dealer Actions summary buckets (`statusText`) | **Done** | §7 / §J.1 |
| 16 | High | Dealer Customer Journey fields on `GET /quotations` | **Done** | §9 |
| 17 | Medium | HEIC/HEIF on multipart uploads | **Done** | §9 |
| 18 | Medium | Manual approve / file-login timestamps | **Done** | §10 |
| 19 | Medium | Admin dealers `includeInactive` + pagination | **Done** | §10 |
| 20 | Medium | Payment Management list fields (dealer, phases, dates) | **Done** | §12 |
| 21 | Medium | Admin Overview kW — `products` + `systemKw` on list | **Done** | §13 |
| 22 | Medium | `GET /api/quotations/pricing-tables` (June 2026 defaults) | **Done** | §2 |
| 22b | Medium | Commercial PDF flag `pdfCommercialSet` | **Done** | §2.5 |
| 22c | Medium | Proposal PDF dates (`updatedAt`, `validUntil` +7d) | **Done** | §2.7 |
| 23 | High | Payment Management → Admin Installation release gate | **Done** | §17 |
| 24 | High | Inventory — decimal prices + `products.unit` + kg→pieces contract | **Done** | §18 |
| 25 | Medium | Admin Visitor Reports — `GET /api/admin/visits` | **Done** | §19 |
| 26 | High | Final confirmation document uploads | **Done** | §20 / §M |
| 27 | High | Quotations tab → Send to Metering | **Done** | §21 / §L.1 |
| 28 | High | Admin Overview → Product Needed (installation-pending brands) | **Done** | §13 / `BACKEND_ADMIN_PRODUCT_NEEDED.ts` |
| 29 | High | Inventory Tally import — `POST /products` without serials + clear errors | **Done** | §14 |
| 30 | High | Calling FCFS + `/current` never 500 + assign-unassigned (Unassigned→0) | **Done** | §15 / `BACKEND_ASSIGN_UNASSIGNED.ts` |
| 31 | High | Metering dual track — Bank process + installer auth | **Done** | §17 / `BACKEND_METERING_DUAL_TRACK.md` |
| 32 | High | Document Submission — Property Documents PDF optional | **Done** | §18 / `BACKEND_PROPERTY_DOCUMENT_OPTIONAL.md` |
| 33 | High | Non-DCR 80kW set — Renew Energy / Waaree / Adani | **Done** | §19 / `BACKEND_NON_DCR_80KW.md` |

**Deploy before QA:**

```bash
yarn migrate
```

| Migration | Purpose |
|-----------|---------|
| `20260519120000-add-pdf-display-flags-to-quotation-products.js` | Legacy booleans (old quotations) |
| `20260521120000-add-pdf-panel-range-keys-to-quotation-products.js` | `pdfPanelRangeKey`, `pdfDcrPanelRangeKey`, `pdfNonDcrPanelRangeKey` |
| `20260520120000-add-notes-to-customers.js` | `customers.notes` for calling → quotation prefill |
| `database/migrations/add_system_kw_to_quotations.sql` (or bootstrap) | `quotations.system_kw` for admin kW + list `systemKw` |
| `20260415100000-add-installation-release-fields-to-quotations.js` | `installationReadyForInstaller`, `installationReleasedAt` (bootstrap also ensures) |
| `20260605120000-add-unit-column-to-products.js` | `products.unit` for stock display (Meters, Quantity, Pieces; bootstrap also ensures) |
| `20260606120000-ensure-calling-remark-text-columns.js` | `callRemark` TEXT on assignments + action history (§E.2) |
| `20260725120000-bank-process-done.js` | `bankProcessDone` / `bankProcessDoneAt` for Metering dual track (§17) |

After migrate, optional backfill: `npx ts-node scripts/backfill-system-kw.ts`

Optional: `TZ=Asia/Kolkata` if weekly HR reports must match SPA Mon–Sun in IST.

**Not required on backend:** logout console noise (frontend); dealer analytics date filter (client-side on queue `recentActions`); **Payment Management installment-count filter** (client-side on loaded `phases` — see §12); account-management hooks / infinite scroll (see §14).

### Backend ticket checklist (Account Management + Admin Overview)

| Item | Status |
|------|--------|
| Approved list: `dealerId`, `dealer_id`, `dealer`, payment fields, full `installments` / `paymentPhases` | ✅ `getQuotations` |
| `statusApprovedAt`, `fileLoginAt` on approved rows | ✅ `quotationAdminMetadataFields` |
| `statusApprovedAt` set on approve transition | ✅ `PATCH /api/admin/quotations/:id/status` |
| Admin list: `products` / `quotationProduct` + `systemKw` | ✅ `quotationProductListApiFields` |
| PATCH payment phases → next GET shows updated phase array | ✅ `updateQuotationPaymentDetails` + `fetchPaymentPhasesByQuotationIds` |
| **Installment remove persists** (`replaceInstallments` / `PUT /installments` deletes orphans) | ✅ `utils/quotationPaymentPhases.ts` — see `BACKEND_INSTALLMENT_REPLACE.ts` |
| **Payment Excel journey columns** (`installationStatus`, metering fields on approved list) | ✅ `utils/paymentExcelJourneyStatus.ts` — see `BACKEND_PAYMENT_EXCEL_JOURNEY_STATUS.ts` |
| **Final Settlement** (remaining → `discountAmount`; `POST /final-settlement` atomic; status-only payment-details; persisted `finalSettlementApplied`) | ✅ `BACKEND_FINAL_SETTLEMENT.md` + `BACKEND_FINAL_SETTLEMENT.ts` / §AD |
| **Super Admin quotation login + inventory JWT** (`role: super-admin` shared token) | ✅ `utils/inventoryRole.ts` — see `BACKEND_SUPER_ADMIN_QUOTATION_LOGIN.ts` / §AD |
| **Admin Product Needed** (`GET /admin/product-needed?scope=installation_pending` + brand aggregates) | ✅ `controllers/adminController.ts` → `getAdminProductNeeded` — see **§13** / `BACKEND_ADMIN_PRODUCT_NEEDED.ts` |
| **Tally Purchase import** (`POST /products` without serials; attach serials on PUT) | ✅ `controllers/productController.ts` — see **§14** |
| `?dealerId=` / `?installmentCount=` on approved list | ❌ Optional |
| `GET /admin/overview/dealer-stats` | ❌ Optional |
| Persist `system_kw` column on create/update | ✅ `persistQuotationSystemKw` + migration |

---

## 1. HR uploaded leads — live counts (§7.8)

**Status: implemented**

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/hr/leads/uploads` | Live `assignedCount`, `unassignedCount`, `completedCount` (SQL, not upload-time `assigned`) |
| `GET` | `/api/hr/leads/uploads/:uploadId` | Full-batch counts + paginated rows with assignee fields; optional `?mobile=` / `q` / `search` |
| `GET` | `/api/hr/leads/search?mobile=` | Global mobile search across all uploads (`q` / `search` aliases); see `getHrLeadsSearchByMobile` |
| `POST` | `/api/hr/leads/upload-csv` | `assignedAtUpload` / `queuedAtUpload` only on POST |

**Invariant:** `assignedCount + unassignedCount + completedCount === leadCount`  
(`leadCount` may be lower than CSV `rowCount` when duplicates were skipped.)

**Bucket rules (Jul 2026):**
- `rowCount` / `uploadedRowCount` — CSV rows parsed at upload (e.g. 2600 for “2401 to 5K”, not 5000)
- `leadCount` / `createdCount` — leads created in DB
- `skippedDuplicate` — duplicate/invalid CSV rows not created as leads
- `assignedCount` — only open callable work: `assigned` / `in_progress` / `active` / dealer-owned `queued`
- `completedCount` — `completed` / `done` / `closed` **and** `rescheduled` (follow-ups are not “Assigned”)
- `unassignedCount` — residual on leads (pool / no assignee)

**QA:** Upload 1000, 3 at upload → GET `assignedCount: 3`, `unassignedCount: 997`; modal queued rows match header. Batch with only completed + rescheduled → `assignedCount: 0`, `unassignedCount: 0`. File “2401 to 5K” → `rowCount: 2600`, `leadCount: 2407`, `skippedDuplicate: 193`.

---

## 2. Quotation PDF display — panel range keys (§X, May 2026 update)

**Status: implemented** — run `yarn migrate` (includes range-key columns).

### No backend change needed (frontend-only)

| Area | Why |
|------|-----|
| Inverter dropdown (Goodwe, Vsole, Xwatt, Saatvik, …) | Still `products.inverterBrand` string from catalog |
| Combined labels (`Vsole/Xwatt/Saatvik`, `Vsole/Xwatt`) | Same field — allowed extra strings (see below) |
| Removed `pdfUseInverterBrandOptions` checkbox | PDF uses `inverterBrand` directly; flag not sent on new quotes |
| Pricing / subsidies / system size | Unchanged — PDF fields must not affect calculations |

### New optional fields on `products` JSON (persist + echo)

| Field | When set |
|-------|----------|
| `pdfPanelRangeKey` | DCR / Non-DCR / single panel line |
| `pdfDcrPanelRangeKey` | BOTH — DCR line |
| `pdfNonDcrPanelRangeKey` | BOTH — Non-DCR line |

**Allowed values:** `waaree_540_560_bifacial`, `waaree_580_700_bifacial_topcon`, **`waaree_580_630`**, `adani_540_580_bifacial`, `adani_610_625_bifacial_topcon`, **`adani_600_630`**, `premier_600_625_bifacial_topcon`, **`tata_530_570`** (`530W - 570W`, Tata DCR packages only), **`ina_500_600_bifacial`** (`500W - 600W`, INA DCR), **`renew_energy_600_630`** (`600W - 630W`, Non-DCR 80kW Renew Energy). Unknown keys stored as `null`.

**PDF display (client-generated; keys must round-trip on GET):**

- When a range key is set, panel line uses the **range label** (e.g. `530W - 570W` for `tata_530_570`), not generic “As per the set” for panels.
- **Tata DCR** (`panelBrand` = `Tata`, `systemType` = `dcr`) + `tata_530_570`: inverter line on PDF is **“As per the set”** even if DB stores catalog placeholders (`Vsole/Xwatt`, `5kW`).
- TOPCon note on PDF only when range key contains `topcon` (e.g. `adani_610_625_bifacial_topcon`).

**Clear on uncheck (critical):** `PATCH …/products` uses `buildQuotationProductPdfPersistFieldsForUpdate` — only overwrites PDF columns **present in the body**. Explicit `""`, `null`, or `false` clears DB values; omitted keys are left unchanged (no accidental wipe on partial PATCH).

**Snake_case aliases:** `pdf_panel_range_key`, `pdf_dcr_panel_range_key`, `pdf_non_dcr_panel_range_key`.

**Endpoints:** `POST /api/quotations`, `PATCH /api/quotations/{id}/products`, `GET` list/detail — same as before.

**Deprecated (legacy quotations only):** `pdfUsePanelSizeRange` / `pdf_use_panel_size_range` — still stored/echoed; frontend maps to a default range when loading old data. `pdfUseInverterBrandOptions` — ignore on new quotes.

**Example:**

```json
{
  "panelBrand": "Adani",
  "panelSize": "610W",
  "panelQuantity": 0,
  "inverterBrand": "Vsole/Xwatt/Saatvik",
  "pdfPanelRangeKey": "adani_610_625_bifacial_topcon"
}
```

**Validation tweaks:**

- `panelQuantity` / `dcrPanelQuantity` / `nonDcrPanelQuantity` may be **0** (nonnegative) when a range key is used for PDF-only rows.
- `inverterBrand` catalog check allows **`Vsole/Xwatt/Saatvik`** and **`Vsole/Xwatt`** in addition to catalog brands.
- `meterBrand` catalog check allows **`L&T/HPL/Genus/Secure`** in addition to catalog brands.
- Range keys are **not** passed into `validateProductSelection` or `calculatePricing`.
- **`validUntil`** on create defaults to **`createdAt + 7 days`** (was 5). Recomputed on products/pricing PATCH — see **§2.7**.

**Server PDFs:** use `utils/quotationProductPdfDisplay.ts` (`PDF_PANEL_RANGE_KEYS`, `extractPdfPanelRangeKeysFromProducts`).

**Frontend flow:** create may omit PDF keys on POST; follow-up `PATCH …/products` with range keys — backend must accept that PATCH (this implementation).

**Pricing tables:** `GET /api/quotations/pricing-tables` (alias of `GET /api/config/pricing`). When DB `dcr` is empty, API returns June 2026 defaults: Adani 555W, Adani Topcon 620W, Waaree 540W, Premier Energies, **Tata DCR** (`utils/defaultPricingTables.ts`).

**New quotes:** frontend is **DCR-only**; legacy rows may remain `non-dcr` / `both`. **GET is source of truth** for `pdf_panel_range_key` after save (not browser `localStorage`).

### 2.5 Commercial PDF flag — `pdfCommercialSet` (Jun 2026)

**Status: implemented** — migration `20260607120000-add-pdf-commercial-set-to-quotation-products.js`. Checkbox state **persists after reload** when GET returns the flag on `products`.

**What changes:** When **Commercial project** is checked, subsidy content is omitted from the proposal PDF **Terms & Conditions (page 3)** only. **Pricing in the app is unchanged** — `centralSubsidy` / `stateSubsidy` stay in DB; this is PDF display only.

**Hidden on PDF when `pdfCommercialSet: true`:**

| PDF section | Hidden content |
|-------------|----------------|
| Terms & Conditions (page 3) | Central Subsidy row |
| | State Subsidy row |
| | Subsidy disclaimer row |
| | Consent line (bottom) |
| | The word “subsidy” removed from agreement text |

**Not hidden (by design):** Page 2 **Panel Technology Note** may still say “subsidy-eligible” for DCR panels. Optional frontend follow-up: commercial wording on page 2 when Commercial is checked (no backend change).

**Frontend flows:**

| Flow | Steps |
|------|--------|
| **Create** | Configure DCR set → check Commercial project → continue → generate/download PDF. Flag saved as `pdfCommercialSet: true` via `PATCH …/products`. |
| **Edit** | Open quotation → Edit System Configuration → check Commercial → Save → download PDF. Checkbox restored from `products.pdfCommercialSet` on GET. |

**Frontend code:**

| Piece | Role |
|-------|------|
| Checkbox | `formData.pdfCommercialSet` (`product-selection-form.tsx`) |
| PDF gate | `shouldShowSubsidyTermsInPdf()` → `false` when `isPdfCommercialSet(products)` |
| PDF build | Subsidy T&C rows skipped in `buildTermsRows()` (`quotation-proposal-document.ts`) |

| Field | Type | Purpose |
|-------|------|---------|
| `pdfCommercialSet` | boolean | Commercial project — hide subsidy T&C on proposal PDF page 3 |
| `pdf_commercial_set` | boolean | snake_case mirror |

**Endpoints (no new routes):**

| Method | Path | Behavior |
|--------|------|----------|
| `PATCH` | `/api/quotations/{id}/products` | Persist flag (after create and on edit save) |
| `GET` | `/api/quotations`, `/api/quotations/{id}` | Echo flag on `products` so checkbox survives reload |

**Rules:**

- PDF-only — does **not** change pricing or `centralSubsidy` / `stateSubsidy` in DB.
- On uncheck: accept `false` and clear stored value (`buildQuotationProductPdfPersistFieldsForUpdate`).
- Do **not** strip unknown PDF keys on partial PATCH (same as `pdfPanelRangeKey`).

**Required GET/PATCH shape** (`products`):

```json
{
  "panelBrand": "Premier Energies",
  "pdfPanelRangeKey": "premier_600_625_bifacial_topcon",
  "pdfCommercialSet": true,
  "pdf_commercial_set": true
}
```

**Checklist:**

- [x] Persist `pdfCommercialSet` / `pdf_commercial_set` on `quotation_products`
- [x] Clear commercial flag on `false`
- [x] Return on GET list + GET by id (`quotationProductPdfDisplayApiFields`)
- [x] `dealer` on GET quotation (list + detail — unchanged)

**Code:** `utils/quotationProductPdfDisplay.ts`, `validations/quotationValidations.ts`, `controllers/quotationController.ts` → `updateQuotationProducts`.

### 2.6 Tata DCR package sets — `VAL_003` fix (**implemented**)

**Code:** `utils/quotationTataDcrValidation.ts`, `utils/quotationProductPdfDisplay.ts` (`PDF_PANEL_RANGE_KEYS`, `PDF_PANEL_RANGE_LABELS`), `controllers/quotationController.ts` → `validateProductSelection`.

**Do not return `VAL_003` for valid Tata DCR when:**

| Rule | Allowed |
|------|---------|
| `systemType` | `dcr` |
| `panelBrand` | `Tata` |
| `panelSize` | `As per the set`, `530W`, or catalog placeholder |
| `panelQuantity` | `0` or omitted when `pdf_panel_range_key` = `tata_530_570` |
| `inverterBrand` / `inverterSize` | `As per the set`, `Vsole/Xwatt`, `Vsole/Xwatt/Saatvik`, `3kW`–`30kW` |
| `structureSize` | `3.1kW`, `5.1kW`, `3kW`, `5kW`, `6kW`, `8kW`, `10kW` |
| PDF key | `pdfPanelRangeKey` / `pdf_panel_range_key` = **`tata_530_570`** |

**PATCH shapes (both accepted):**

1. **Display + PDF key** — `PATCH /api/quotations/{id}/products` with `pdfPanelRangeKey: "tata_530_570"` (and snake_case).
2. **Catalog-normalized** — `panelSize: "530W"`, `panelQuantity: 10`, `inverterBrand: "Vsole/Xwatt"`, `inverterSize: "5kW"`, `structureSize: "5kW"` plus PDF key on same or follow-up PATCH.

**Required GET shape after save** (`products` on list/detail):

```json
{
  "systemType": "dcr",
  "panelBrand": "Tata",
  "panelSize": "530W",
  "panelQuantity": 10,
  "inverterBrand": "Vsole/Xwatt",
  "inverterSize": "5kW",
  "structureSize": "5kW",
  "pdfPanelRangeKey": "tata_530_570",
  "pdf_panel_range_key": "tata_530_570"
}
```

**Checklist (Tata):**

- [x] `tata_530_570` in PDF range enum + Zod schema
- [x] Persist on `quotation_products` via `PATCH …/products` (`buildQuotationProductPdfPersistFieldsForUpdate`)
- [x] Always return `pdf_panel_range_key` on GET (`quotationProductPdfDisplayApiFields`)
- [x] `validateProductSelection` Tata path — no `VAL_003` for package payloads
- [x] `panelQuantity` 0 when range key set (Zod `hasPdfPanelRangeKey` + Tata package bypass)
- [x] `As per the set` / `As per Set` on panel, inverter, cables
- [x] Structure `3.1kW` / `5.1kW`
- [x] (Optional) Tata DCR rows in `GET /api/quotations/pricing-tables` defaults

### 2.6.1 INA DCR — catalog + PDF range + pricing (**implemented**)

**Minimum fix for `Invalid product selection` on INA save:**

| Area | Change |
|------|--------|
| `GET /api/quotations/product-catalog` | `panels.brands` includes **`INA`**; sizes include **500W–600W** (`utils/defaultProductCatalog.ts` merged via `normalizeProductCatalog`) |
| PDF range key | **`ina_500_600_bifacial`** → label `500W - 600W` (`PDF_PANEL_RANGE_KEYS`, Zod, swagger) |
| `PATCH …/products` / GET | Persist + return `pdfPanelRangeKey` / `pdf_panel_range_key` (same as other brands) |
| `panelQuantity` | `0` or omitted when any `pdf*PanelRangeKey` is set (`hasPdfPanelRangeKey`) |
| Inverter | **Non-Tata** — catalog `Vsole`/`Xwatt` + concrete kW; no forced “As per the set” |
| `GET /api/quotations/pricing-tables` | INA DCR rows + `dcrMatrix[].ina` column (defaults mirror Premier until overridden) |
| `panelType` / `inaDcrPackage` | Persist on `quotation_products`; echo on GET (`panel_type`, `ina_dcr_package`) — no Adani alias overwrite |
| Migration | `20260622120000-add-ina-package-fields-to-quotation-products.js` |

**Example PATCH** — see §2.6.2 below.

**Code:** `utils/defaultProductCatalog.ts`, `utils/quotationProductPdfDisplay.ts`, `utils/defaultPricingTables.ts` (`buildDcrPricingMatrix`), `controllers/configController.ts`, `controllers/quotationController.ts`.

### 2.6.2 INA DCR — native round-trip (June 2026, **implemented**)

Frontend no longer needs Adani catalog alias when API returns:

```json
{
  "panelBrand": "INA",
  "panelType": "INA",
  "inaDcrPackage": true,
  "pdfPanelRangeKey": "ina_500_600_bifacial",
  "pdfUsePanelSizeRange": true
}
```

| Endpoint | Requirement |
|----------|-------------|
| `GET /api/quotations/product-catalog` | `INA` in `panels.brands`; sizes 500W–600W |
| `GET /api/quotations/pricing-tables` | `dcr[].panelType: "INA"` + `dcrMatrix[].ina` |
| `PATCH /api/quotations/{id}/products` | Accept + persist `panelType`, `inaDcrPackage`, PDF keys |
| `GET /api/quotations/{id}` | Echo all fields above on `products` |

### 2.6.3 Dealer calling reports + reschedule remarks (June 2026, **implemented**)

| # | Endpoint | Behavior |
|---|----------|----------|
| 1 | `GET /api/dealers/me/calling-actions` | Dealer JWT — same shape as admin (`actions`, `callingActions`, date filters) |
| 1b | `GET /api/dealers/me/calling-queue/actions` | Alias of (1) |
| 2 | `GET /api/dealers/me/calling-queue/next` & `/current` | `scheduledLeads` deduped; remark fields on rows |
| 3 | `PATCH …/calling-queue/{leadId}/action` | Persist `callRemark`, `statusCategory`, `statusText`, `nextFollowUpAt`; `rescheduled` status |

See §4.4–§4.5.1 for queue tab arrays and active-lead rules.

**Code:** `controllers/callingLeadController.ts`, `routes/dealerRoutes.ts`.

### 2.7 Proposal PDF dates — `updatedAt` and `validUntil` (Jun 2026)

**Status: implemented**

**Frontend:** `lib/quotation-proposal-document.ts` (`normalizeQuotationTimestamps`, `resolveProposalQuotationDates`), `components/quotation-details-dialog.tsx` (**refetches `GET /api/quotations/{id}` before Download PDF**), `components/quotation-proposal-pdf.tsx`.

**PDF download flow:** The details dialog does **not** trust list-cache timestamps. On **Download PDF** it calls `GET /api/quotations/{id}` first, then builds the PDF from the fresh payload (including `products.pdfCommercialSet` and date fields).

**Frontend date resolution** (`resolveProposalQuotationDates`, `PROPOSAL_VALIDITY_DAYS = 7`):

| PDF field | Frontend source |
|-----------|-----------------|
| **Updated** | `updatedAt` → else `createdAt` → else `validUntil − 7 days` |
| **Valid Until** | Updated date **+ 7 days** |

Backend should keep `validUntil ≈ updatedAt + 7 days` so the third fallback is rarely needed (legacy rows only).

**Database** (`quotations` table — already present):

| Column | Notes |
|--------|--------|
| `updated_at` | `TIMESTAMP`, Sequelize `updatedAt`; bumped on quotation row save |
| `valid_until` | `TIMESTAMP NULL`; recommended — set on create and products/pricing updates |

**Backend contract:**

| Requirement | Implementation |
|-------------|----------------|
| GET list + GET by id | Return `createdAt`, `updatedAt`, `validUntil` on **every** quotation (camelCase + snake_case) |
| PATCH responses | Include fresh `updatedAt` / `validUntil` on `…/products`, `…/pricing`, `…/discount` |
| Bump `updated_at` | `PATCH /api/quotations/{id}/products`, `…/pricing`, `…/discount` |
| `validUntil` | `updatedAt + 7 days` on create (not 5) and on products/pricing/discount update |

**Endpoints that bump validity (no new routes):**

| Method | Path | Implementation |
|--------|------|----------------|
| `PATCH` | `/api/quotations/{id}/products` | `touchQuotationProposalValidity(quotation)` after product save |
| `PATCH` | `/api/quotations/{id}/pricing` | `validUntil: computeQuotationValidUntil(now)` on quotation update |
| `PATCH` | `/api/quotations/{id}/discount` | same as pricing (if still used) |

**Example GET response** (minimum for PDF dates to work):

```json
{
  "id": "QT-HTIV24",
  "createdAt": "2026-04-20T10:00:00.000Z",
  "created_at": "2026-04-20T10:00:00.000Z",
  "updatedAt": "2026-04-27T09:30:00.000Z",
  "updated_at": "2026-04-27T09:30:00.000Z",
  "validUntil": "2026-05-04T09:30:00.000Z",
  "valid_until": "2026-05-04T09:30:00.000Z"
}
```

**Checklist:**

- [x] Return `updatedAt` on GET list + GET by id
- [x] Bump `updated_at` on products/pricing/discount PATCH; return `updatedAt` in PATCH response
- [x] `validUntil` = `updatedAt + 7 days` on create and on products/pricing update
- [x] Return `dealer` on GET quotation (list + detail)
- [x] Existing PDF panel range keys + PATCH-after-create (§2, unchanged)

**Code:** `utils/quotationApiJson.ts` (`QUOTATION_PROPOSAL_VALIDITY_DAYS`, `computeQuotationValidUntil`, `quotationProposalDateApiFields`, `touchQuotationProposalValidity`), `controllers/quotationController.ts`.

---

## 3. Dealer calling queue — `LEAD_004` (Priority 1)

**Status: implemented**

### Problem

Dealer sees a lead from `/next` but `PATCH …/action` returned **403 / `LEAD_004`** when `assigned_dealer_id` was missing or owned by another dealer. Frontend may hide the error optimistically; **call outcomes still need a real assignment in DB**.

### Implemented options

| Option | Endpoint | Behavior |
|--------|----------|----------|
| **A** | `PATCH /api/dealers/me/calling-queue/:leadId/action` | On `start` (and outcome actions), auto-claim eligible pool lead → assign → transition |
| **B — claim** | `POST /api/dealers/me/calling-queue/:leadId/claim` | Assign pool lead to JWT dealer |
| **B — assign** | `POST /api/dealers/me/calling-queue/:leadId/assign` | Body `{ assignedDealerId, status: "assigned" }` |
| **B — patch** | `PATCH /api/dealers/me/calling-queue/:leadId` | Same body as assign |
| **C** | `GET …/calling-queue/next` & `/current` | `promoteQueuedLeadIfSlotAvailable` before building queue |

### Optional body on `start` / assign

```json
{
  "action": "start",
  "claim": true,
  "autoAssign": true,
  "assignedDealerId": "<dealer-uuid-from-jwt>"
}
```

Assign/claim endpoints reject a different dealer’s `assignedDealerId`; **`PATCH …/action`** auto-claims on `start` (no early body-id 403).

### Field rules

| Field | Use |
|-------|-----|
| `assignedDealerId` / `assigned_dealer_id` | Calling assignee (must match JWT when set) |
| `assignedDealerName` | From `dealers` join |
| `dealerId` / `dealerName` on lead | CRM/uploader only — **not** calling assignee |

### Rules

- Another dealer’s lead → **`LEAD_004`** (no steal)
- Pool lead + eligible batch → create assignment for this dealer
- Outcome actions (`called`, `follow_up`, …) also auto-claim when needed so saves persist after Start Call

### Submit payload (Not Connected → Call Unanswered)

```http
PATCH /api/dealers/me/calling-queue/{leadId}/action
Authorization: Bearer <dealer-jwt>
```

```json
{
  "action": "not_interested",
  "actionAt": "2026-06-05T10:30:00.000Z",
  "callRemark": "[part_1_call_and_lead] Call Unanswered",
  "call_remark": "[part_1_call_and_lead] Call Unanswered",
  "statusCategory": "part_1_call_and_lead",
  "status_category": "part_1_call_and_lead",
  "statusText": "Call Unanswered",
  "status_text": "Call Unanswered"
}
```

**200 must:** `assigned_dealer_id` = current dealer (if was pool) · persist remark fields · `status = completed` · return `nextLead`.

### Pool / unassigned assignees

Treat as unassigned: `null`, `unassigned`, `pool`, `open`, `none`, etc. (`isPoolOrUnassignedAssigneeId`). Claimed on `GET …/next` promote and on `PATCH …/action` `start`/submit.

### QA

1. HR uploads CSV with dealer pool (e.g. includes sanju shekhawat)
2. Dealer opens Calling Data → sees lead (e.g. DEEPA KANWAR)
3. **Start Call** → **200**, `in_progress`, no `LEAD_004`
4. Submit (Not Connected → Call Unanswered) → **200**, remark saved, `nextLead` returned
5. Admin → Calling Reports shows action with correct dealer name
6. Second dealer cannot claim same `in_progress` lead (`LEAD_004`)
7. `POST …/assign` with `{ assignedDealerId, status: "assigned" }` → **200** (frontend retry path)

**Quick ref:** `BACKEND_TEAM_SUMMARY.md` (Priority 1).

---

## 4. Calling remarks, queue tabs & start vs submit

**Status: implemented**

### 4.1 Remarks on `PATCH …/calling-queue/{leadId}/action`

Accepts: `callRemark` / `call_remark`, `statusCategory` / `status_category`, `statusText` / `status_text`, `statusLabel`, `remark`, tagged `[category] label | free text`.

| Field | Aliases | Notes |
|-------|---------|--------|
| Follow-up datetime | `nextFollowUpAt`, `next_follow_up_at` | ISO UTC; **required** for `rescheduled` |
| Status category | `statusCategory`, `statusCategoryKey`, `status_category` | e.g. `schedule` for Callback Scheduled |
| Status label | `statusText`, `status_text`, `statusLabel` | e.g. `Callback Scheduled` |
| Free remark | `remark`, tail after `\|` in `callRemark` | Stored in history `statusReason` |

- **`start`:** remark optional; sets `in_progress` + assignee.
- **Outcomes** (`called`, `follow_up`, `not_interested`, `rescheduled`): require `callRemark` **or** `statusCategory` + `statusText` (unless `editMode`).
- **`follow_up` + `nextFollowUpAt`** → treated as **`rescheduled`** (assignment `status: rescheduled`, not `completed`).
- Persists on assignment + `calling_action_history`; echoed on GET queue/history.
- **`call_remark`:** replace with one tagged string — do **not** append nested `[schedule] …` chains.

### 4.2 Customer note

`PATCH /api/dealers/me/calling-queue/{leadId}` with body `{ "customerNote": "..." }` only (no assign fields) → updates `calling_leads.customerNote`.

### 4.3 Quotation prefill

`POST /api/customers` accepts optional `notes` and `remarks` (same value). Migration: `20260520120000-add-notes-to-customers.js`.

### 4.4 Queue tab arrays (`GET …/next` & `/current`)

| Key | Tab |
|-----|-----|
| `scheduledLeads` | Scheduled (future **or overdue** `nextFollowUpAt`; one row per lead) |
| `upcomingFollowUps`, `rescheduledLeads` | Empty aliases — use `scheduledLeads` only (no duplicate rows) |
| `dialledActions` | Dialled (excludes future scheduled follow-ups) |
| `connectedActions` / `notConnectedActions` | Connected / Not connected subsets |
| `recentActions` / `actionHistory` | Analytics / history |

### 4.5 `start` vs completion response

| Action | Response |
|--------|----------|
| `start` | `lead` + `currentLead` (same row, `in_progress`) + `counts` — **no** `nextLead`, **no** full queue snapshot |
| Outcomes | Full queue snapshot + `nextLead` = new queue head after promote |

### 4.5.1 Active lead must stay `in_progress` until Submit (§E.1)

**Status: implemented** — fixes “current lead disappears before Submit” when FIFO queue head ≠ open call.

| Rule | Backend behavior |
|------|------------------|
| `PATCH …/action` **`start`** | Return **same** lead as `in_progress`; **omit** `nextLead`; auto-claim pool lead via **LEAD_004** when unassigned |
| `GET …/calling-queue/current` | Dealer’s open `in_progress` assignment **must** be `currentLead` (not FIFO head if different) |
| `GET …/calling-queue/next` | **Do not** return a different head lead while `in_progress` is open — `nextLead: null` |
| Completion (`called` / `follow_up` / `not_interested` / `rescheduled`) | Persist remarks/status, close assignment, promote queue, return `nextLead` = new head |
| Concurrency | **One open call per dealer** — `promoteQueuedLeadIfSlotAvailable` skips while `in_progress` exists |

**Wrong (FIFO head steals UI while call is open):**

```json
{
  "success": true,
  "data": {
    "currentLead": { "leadId": "aaa", "status": "assigned", "name": "Earlier lead" },
    "nextLead": { "leadId": "bbb", "status": "assigned", "name": "Queue peek" }
  }
}
```

Dealer started **`bbb`** (`in_progress`) but GET returns **`aaa`** because `assignedAt` is earlier.

**Correct (open call wins):**

```json
{
  "success": true,
  "data": {
    "currentLead": { "leadId": "bbb", "status": "in_progress", "name": "Active call" },
    "nextLead": null
  }
}
```

After Submit on **`bbb`**:

```json
{
  "success": true,
  "data": {
    "currentLead": { "leadId": "aaa", "status": "assigned" },
    "nextLead": { "leadId": "aaa", "status": "assigned" }
  }
}
```

**SQL guard sketch (one open call):**

```sql
-- Before promoting or returning nextLead, ensure no other in_progress for dealer
SELECT 1 FROM dealer_lead_assignments
WHERE "dealerId" = :dealerId AND status = 'in_progress'
LIMIT 1;
```

**Code:** `resolveDealerQueueHead()` + `promoteQueuedLeadIfSlotAvailable` early return in `controllers/callingLeadController.ts`.

### 4.5.2 Reschedule / Decision Pending Submit (§E.2)

**Status: implemented** — fixes **500** on Connected → Decision Pending → Callback Scheduled + datetime.

| Requirement | Backend behavior |
|-------------|------------------|
| Actions | Accept `rescheduled` (preferred); `follow_up` + `nextFollowUpAt` → same as `rescheduled` |
| Datetime | Read `nextFollowUpAt` **and** `next_follow_up_at` (ISO UTC) |
| Assignment status | `rescheduled` — **not** `completed` |
| Remarks | `status_category: schedule`, `statusText: Callback Scheduled`; single tagged `call_remark` |
| Replace | `buildTaggedCallRemark()` — no nested `[schedule] [schedule] …` append |
| Columns | `callRemark` / `call_remark` as **TEXT** (migration `20260606120000`) |
| Errors | Missing datetime → **400** `VAL_001`; bad transition → **409** `LEAD_005`; never uncaught **500** |
| Transition | `in_progress` → `rescheduled` for assignee |
| Response | `lead`, `nextLead`, row in `scheduledLeads` when `nextFollowUpAt` is in the future |

**Example PATCH body (frontend):**

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

**Common 500 causes (now guarded):**

| Cause | Fix |
|-------|-----|
| `rescheduled` missing from action enum | In Zod + DB enum |
| Ignoring `nextFollowUpAt` / snake_case alias | `resolveNextFollowUpAtFromRequest()` + Zod transform |
| `call_remark` VARCHAR overflow | TEXT migration + replace-not-append |
| Uncaught transition / DB errors | `LEAD_005` + `VAL_001` handlers |

**Code:** `validations/callingLeadValidations.ts`, `updateDealerCallingQueueAction` in `controllers/callingLeadController.ts`.

### QA

1. Submit with remarks → visible in history GET.
2. Scheduled tab ≠ Dialled (no future follow-ups only under Dialled).
3. Double **Start** → same lead until Submit.
4. **Create Quotation** from calling → customer `notes` saved.
5. `PATCH` customer note on lead → echoed on next queue GET.
6. **Start** lead B while lead A is still `assigned` with earlier `assignedAt` → `GET /current` shows B as `currentLead`, `nextLead: null` until Submit.
7. After Submit on B → `nextLead` advances to A (or next callable row); no stuck `in_progress`.
8. **Reschedule** with datetime → **200**, assignment `status: rescheduled`, lead appears in `scheduledLeads`, no **500**.
9. Submit with only `next_follow_up_at` (no camelCase) → **200** (alias read).
10. `follow_up` + `nextFollowUpAt` → same as `rescheduled` (frontend fallback path).

### 4.8 HR / Admin — `GET` calling-actions (date & dealer filters) — **§J**

**Status: implemented**

| Role | Paths |
|------|--------|
| HR | `GET /api/hr/calling-actions`, `GET /api/hr/calling-queue/actions` |
| Admin | `GET /api/admin/calling-actions`, `GET /api/admin/calling-queue/actions`, `GET /api/admin/leads/actions` |

**Query params:** `limit` (default 20, max **2000**), optional `dealerId` / `dealer_id`, `range` (`daily` \| `weekly` \| `monthly` \| `last_month` \| `all` \| **`custom`**), `startDate` / `endDate` / snake_case mirrors.

**Filtering**

- When **`startDate` and `endDate`** are both present, rows are filtered to **`action_at`** (with fallback to `created_at` for legacy rows missing `action_at`) within that inclusive window — including when `range=all` or `range=custom`.
- **`range=all`** with no dates → no date filter (subject to `limit` / pagination).
- **`range=weekly`** with no dates → **Monday 00:00:00** through **Sunday 23:59:59.999** in the **server’s local timezone** (document TZ in ops runbooks; align with `lib/calling-report-date-range.ts` on the frontend).
- **`range=custom`** relies on `startDate` / `endDate`; if omitted, no date window is applied.

**Response:** same handler returns `actions`, **`callingActions`**, `list`, `rows`, `items`, **`logs`**, plus `summary`, `dealers`, `pagination`.

---

## 5. Quotation create stability (sprint #10)

**Status: implemented**

- `POST /api/quotations` — product catalog validation returns **400** `VAL_003` with `details[]` (not unhandled throw).
- `pdfUsePanelSizeRange` / `pdfUseInverterBrandOptions` extracted via `extractPdfDisplayFlagsFromProducts`; **not** passed into `validateProductSelection` or `calculatePricing`.
- Agent selling-price lookup wrapped in try/catch so pricing service failures do not abort create.
- Customer embed on create uses `notes` / `remarks` with fallback if `customers.notes` column missing (run migration).

---

## 6. Dealer dashboard — Total Value (approved quotations only) — §7.9

**Status: implemented**

**Frontend:** `app/dashboard/page.tsx` — sums approved rows using **`subtotal` → `totalAmount` → `finalAmount`** (same as AMOUNT column / set price).

### `GET /api/quotations` (dealer JWT)

Each row includes **`status`**, **`subtotal`**, **`totalAmount`**, **`finalAmount`** (root and/or `pricing.*`).

### Optional — `GET /api/dealers/me/dashboard-stats`

```json
{
  "success": true,
  "data": {
    "totalQuotations": 27,
    "uniqueCustomers": 23,
    "thisMonthQuotations": 0,
    "approvedQuotationCount": 5,
    "approvedQuotationValue": 1250000
  }
}
```

`approvedQuotationValue` = sum of `ABS(COALESCE(subtotal, totalAmount, finalAmount, 0))` where `LOWER(TRIM(status)) = 'approved'` for the authenticated dealer.

**Also on** `GET /api/dealers/me/statistics`: `approvedQuotationCount`, `approvedQuotationValue`, `uniqueCustomers`, `thisMonthQuotations`.

### Admin approve

`PATCH` admin quotation status with `status: "approved"` persists **`approvedAt`** / **`statusApprovedAt`** (existing).

**Code:** `utils/quotationApiJson.ts` → `quotationAmountApiFields`, `approvedQuotationValueFromRow`; `controllers/dealerController.ts` → `getDealerDashboardStats`.

---

## 7. HR Dealer Actions — summary buckets (§J.1)

**Status: implemented**

**Frontend:** `lib/calling-action-summary.ts`, HR **Dealer Actions** tab.

### PATCH `/api/dealers/me/calling-queue/{leadId}/action`

On submit (`called` / `follow_up` / `not_interested` / `rescheduled`), persists **`statusCategory`**, **`statusLabel`** (picker text), **`statusReason`**, **`callRemark`** (tagged format supported).

### GET HR/Admin calling-actions

`GET /api/hr/calling-actions`, `/api/admin/calling-actions` (and aliases) return per row:

- `statusText` / `status_text`, `statusCategory` / `status_category`, `callRemark` / `call_remark`
- Optional **`summary`**: `{ interested, followUp, notInterested, others, total }` — computed from **statusText** (not `action: called` → Interested).

**Code:** `utils/callingActionSummary.ts`, `controllers/callingLeadController.ts` → `buildCallingActionsResponse`, `updateDealerCallingQueueAction`.

---

### 7.1 Dealer Calling Data — backend-only history and single-count totals

**Frontend:** `app/dashboard/calling-data/page.tsx` (analytics cards + tabs)

Goal: dealer Calling Data counts/history must come from backend action rows only, with each submit counted exactly once (no local cache dependency).

Required backend behavior:
- `GET /api/dealers/calling-actions` (or wired equivalent) returns canonical action rows.
- No duplicate rows for one logical submit event.
- Every row includes at least: `id`, `leadId`, `action`, `actionAt`, `callRemark` (`call_remark` alias).
- Prefer structured classification fields: `statusCategory`/`status_category`, `statusText`/`status_text`.
- PATCH submit path persists those fields on write (same event model as HR/Admin actions).

Suggested dedupe guard:
- enforce idempotency key, or
- unique constraint / dedupe policy for duplicate retries (return existing row with safe 200/409 semantics instead of a second insert).

Quick QA:
1. Submit one action once → connected/not-connected + outcome bucket increments by exactly 1.
2. Refresh / open on another tab/device → counts unchanged (no second increment).
3. History endpoint shows one row for that submit.

---

## 9. Dealer Customer Journey + HEIC uploads

**Status: implemented**

### Dealer Customer Journey (no new route)

**Frontend:** dealer dashboard journey panel uses existing **`GET /api/quotations`** (dealer-scoped).

Each quotation object includes:

| Field | Aliases | Used for |
|-------|---------|----------|
| `status` | — | Admin approval step |
| `installationStatus` | `installation_status` | Installation pipeline + current holder |
| `meteringStatus` | `metering_status`, `meteringStage` | Metering sub-step (derived from `installationStatus`) |
| `statusApprovedAt` | `status_approved_at`, `approvedAt`, `approved_at` | Optional approve date display |
| `fileLoginAt` | `file_login_at` | Optional file-login date display |
| `dealer` | nested object | `id`, `firstName`, `lastName`, `email`, `mobile`, `username`, `role` |

**`installationStatus` values:** `pending_installer`, `installer_in_progress`, `installer_approved`, `pending_metering`, `metering_in_progress`, `metering_approved`, `mco`, `pending_baldev`, `baldev_approved`, `completed`, etc.

**Code:** `utils/meteringWorkflowApi.ts` → `meteringWorkflowApiFields`; `utils/quotationApiJson.ts` → `quotationAdminMetadataFields`; `controllers/quotationController.ts` → `getQuotations`, `getQuotationById`.

**Note:** Journey UI should treat **`status`** (e.g. `pending` / `approved`) before **`installationStatus`** — new rows default `installationStatus` to `pending_installer` in DB even before admin approval.

### HEIC / HEIF image uploads

On multipart routes (quotation documents, visitor/dealer visit complete, metering meter doc):

- **MIME:** `image/heic`, `image/heif` (also `application/octet-stream` when filename ends with `.heic` / `.heif`)
- **Extensions:** `.heic`, `.heif`
- Unsupported types → **400** with clear message (not generic **500**)
- S3 `Content-Type` normalized via `resolveImageContentTypeForUpload` in `utils/uploadMimeTypes.ts`

**Browser preview:** HEIC may still not render in all browsers without client-side conversion (optional server JPEG/WebP transcode not implemented).

**Routes updated:** `routes/quotationRoutes.ts`, `routes/visitRoutes.ts`, `routes/visitorRoutes.ts`, `routes/meteringRoutes.ts`, `controllers/quotationController.ts` (document validation + S3), `controllers/workflowController.ts` (workflow S3).

---

## 10. Admin timestamps + dealers list

**Status: implemented**

| Endpoint | Behavior |
|----------|----------|
| `PATCH /api/admin/quotations/:id/status` | Optional `statusApprovedAt` / `approvedAt` (+ snake_case); persisted when `status=approved` |
| `PATCH /api/admin/quotations/:id/file-login` | Optional `fileLoginAt` / `file_login_at`; persisted on file-login save |
| `GET /api/admin/dealers` | `includeInactive=true` (or `1`) skips active-only filter; `pagination.totalPages` returned |

**Code:** `controllers/adminController.ts`, `validations/adminValidations.ts`.

---

## 11. Visitor complete visit — S3 multipart (§P–§U)

**Status: implemented**

| Method | Path | Auth |
|--------|------|------|
| `PATCH` | `/api/visits/{visitId}/complete` | Visitor (assigned) |
| `PATCH` | `/api/visitors/me/visits/{visitId}/complete` | Visitor alias |
| `PATCH` | `/api/visitors/visits/{visitId}/complete` | Visitor alias |

**Multipart fields:** `length`, `width`, `height`, `unit` (`feet` \| `cm`), `backLegFeet`, `midLegFeet` (optional), `frontLegFeet`, `notes`, `images[]`, `rowDiagramImage`, `existingImages` (JSON array string), `existingRowDiagramImage`.

**Behavior:** uploads to S3 via `uploadToS3FromMemory('visits')`; merges `existingImages` + new files; preserves `existingRowDiagramImage` when no new file; `status = completed`; response + **`GET /api/visitors/me/visits`** return **presigned/browsable URLs** (`resolveBrowsableMediaUrl`), not raw private S3 URLs.

**Response `data`:** `id`, `status`, `length`, `width`, `height`, `unit`, `backLegFeet`, `midLegFeet`, `frontLegFeet`, `images`, `rowDiagramImage`, `notes`, `updatedAt`.

---

## 8. Quotation customer documents — `PATCH` / `POST` + ZIP

**Status: implemented**

### `PATCH` / `POST` `/api/quotations/{quotationId}/documents`

- **Content-Type:** `multipart/form-data` (allowlisted fields only — stray fields → **400**, not **500**).
- **Auth:** dealer, admin, account-management, hr, baldev/confirmation (see `authorizeQuotationDocumentsEditor`).
- **Partial updates:** missing file parts keep existing S3 keys/URLs.
- **Storage:** `quotation-documents/{quotationId}/{field}-{timestamp}.{ext}` on S3.
- **Response:** `resolveQuotationDocumentUrls` — presigned GET URLs for UI “View file”.
- **Validation:** `phoneNumber`, `emailId`, `electricityKno` when provided; **`VALIDATION_ERROR`** + `details[]` on bad input; S3/DB errors mapped to **400**/**413** where possible.

**File fields (KYC):** `aadharFront`, `aadharBack`, `compliantAadharFront`, `compliantAadharBack`, `compliantPanImage`, `compliantBankPassbookImage`, `panImage`, `electricityBillImage`, `bankPassbookImage`, `geotagRoofPhoto`, `customerWithHousePhoto`, `propertyDocumentPdf` (**PDF optional** — Jul 2026; omit on submit without **400**).

**Final confirmation (use §20 POST — not KYC PATCH):** `customerFinalBillFile`, `panelWarrantyFile`, `inverterWarrantyFile`, `workCompletionWarrantyFile`.

**Text fields:** `isCompliantSenior`, `aadharNumber`, `phoneNumber`, `emailId`, `panNumber`, `electricityKno`, bank block, compliant block, etc.

**Partial updates:** missing file part on PATCH → keep existing stored key/URL. `propertyDocumentPdf` may remain null if never uploaded.

**Electricity bill:** `electricityBillImage` — **PDF only** (`application/pdf`, `.pdf`), max **30 MB** per file (multer limit).

**Compliant senior (`isCompliantSenior === true`):** required — `compliantContactPhone`, `compliantAadharFront`, `compliantAadharBack`, `compliantPanImage`, `compliantBankPassbookImage`. Optional text — `compliantAadharNumber`, `compliantPanNumber`, compliant bank fields (format-validated only when provided). When `false`, compliant required checks are skipped.

### `GET /api/quotations/{quotationId}/documents/zip`

- **Auth:** dealer (own rows) / admin; account-management/hr on approved quotations.
- Streams ZIP via S3 IAM (`fetchS3ObjectBuffer`); includes manifest `document-details.txt`; missing files noted, not fatal.
- **Headers:** `Content-Type: application/zip`, `Content-Disposition: attachment; filename="<Customer>-<QuotationId>.zip"`, `Cache-Control: no-store`.

### Presign helper (optional client refresh)

- `GET /api/quotations/{quotationId}/documents/view-url?url=…`
- `GET /api/quotations/{quotationId}/documents/presign-url?url=…`

---

## 12. Account Management — Payment Management (May 2026)

### Installment count filter — **no new backend endpoint**

**Frontend-only:** filters by `payment.phases.length` (aliases: `installments`, `paymentPhases`, `payment_phases`) after loading approved quotations. No `?installmentCount=` required unless the approved list grows very large.

### Required on `GET /api/quotations?status=approved` (account-management)

**Status: implemented** — each row includes:

| Field | Purpose |
|-------|---------|
| `dealerId` / `dealer_id` | Dealer filter dropdown (both keys on list rows) |
| `dealer` | `{ id, firstName, lastName, mobile, email, username, role }` |
| `statusApprovedAt` / `approved_at` | Approve-date range filter |
| `fileLoginAt` / `file_login_at` | File-login date filter |
| `paymentType`, `paymentStatus`, `paymentMode`, `bankName`, `bankIfsc` | Payment filters |
| `installments` / `paymentPhases` / `payment_phases` | Installment **count** filter (array length) |
| `subtotal`, `remaining`, `remainingAmount` | Payment amounts |
| `status` | Admin Approval column |
| `installationStatus` / `installation_status` | Installation + File Status columns |
| `meteringStatus` / `meteringStage` / `mcoStatus` | Metering column (derived from `installationStatus`) |
| `journeyStageProgress`, `fileStatus` (optional) | Pre-computed Excel labels |

### 12.5 — Payment Excel Customer Journey columns (July 2026)

**No new endpoint** — Account Management exports CSV client-side. Backend must echo workflow fields on **`GET /api/quotations?status=approved`** after refresh.

**Status:** Implemented — `utils/paymentExcelJourneyStatus.ts` → `paymentExcelJourneyApiFields` on list + detail.

| Excel column | API source |
|--------------|------------|
| Installment Count | `installments.length` |
| Admin Approval Status | `status` / `adminApprovalStatus` |
| Installation Status | `installationStatus` / `installationStatusLabel` |
| Metering Status | `meteringStatus` / `meteringStatusLabel` |
| Final Confirmation Status | `finalConfirmationStatusLabel` |
| File Status (last) | `fileStatus` |

If **`installationStatus` is missing** from GET, Excel shows **Workflow Pending** for every row — verify list payload includes `installationStatus` (defaults to `pending_installer` when null in DB).

**Reference:** `BACKEND_PAYMENT_EXCEL_JOURNEY_STATUS.ts`, `BACKEND_CHANGES_REQUIRED.md` §AC.

**Code:** `utils/meteringWorkflowApi.ts`, `controllers/quotationController.ts` → `getQuotations`.

After **`PATCH` / `PUT` `/api/quotations/{id}/installments`** (or `payment-details` / `payment-mode`), the next **GET** must echo updated phases (read-after-write).

**Installment remove:** when frontend sends `replaceInstallments: true`, `replace: true`, or uses **`PUT /installments`**, backend must **delete all** `quotation_payment_phases` rows for that quotation and insert only the request array (`phases: []` clears all). Do not upsert-by-`phase_number` only — that leaves orphan rows. See **`BACKEND_INSTALLMENT_REPLACE.ts`** and §AB below.

If the UI shows the wrong installment count, debug **stale or empty `installments[]`**, not the filter.

### Dealer filter — **client-side today**

Dropdown filters (`All Dealers` / specific dealer / `Unassigned`) run in the browser on loaded rows. No new endpoint required if `dealerId` + nested `dealer` are present.

### Optional (performance only)

| Param | Behavior |
|-------|----------|
| `?dealerId={uuid}` | Server-side dealer filter on approved list |
| `?dealerId=unassigned` | Rows with null/empty `dealer_id` |
| `?installmentCount=2` | Exact phase-row count match |

**Code:** `controllers/quotationController.ts` → `getQuotations`, `updateQuotationPaymentDetails`.

### 12.6 — Final Settlement (July 2026)

**Spec:** [`BACKEND_FINAL_SETTLEMENT.md`](./BACKEND_FINAL_SETTLEMENT.md) · **Copy-paste controllers:** [`BACKEND_FINAL_SETTLEMENT.ts`](./BACKEND_FINAL_SETTLEMENT.ts) · `BACKEND_CHANGES_REQUIRED.md` §AD

Client calls **`api.quotations.finalizeSettlement`**, which **persists to the DB and throws if nothing saved** (no localStorage fallback when the API is on). Settlement amount = **Remaining only** → `discountAmount` (`d`).

**Try-order:** (1) **`POST /final-settlement`** (preferred, atomic, idempotent) → else (2) `PATCH /pricing` (absolute `discountAmount`, no `subtotal`) + `PATCH /payment-details` **without phases** (`paymentStatus=completed`, `remaining=0`, `finalSettlementAmount`) → else (3) `PATCH /discount` (absolute INR).

**Do not** re-PUT installments (that caused `Total paid (290000) cannot exceed payable after discount (212000)`). GET must return **`finalSettlementApplied: true`** (and/or `finalSettlementAmount > 0`) so the button stays hidden after refresh on any device/role. Never return `remaining:0`/`completed` while an unpaid gap exists without discount.

---

## 12c. Revert Final Settlement (undo) (Jul 2026)

Backend must support undoing a previously persisted final settlement by clearing settlement audit fields and recomputing pricing/payment aggregates (`discountAmount`, `finalAmount`, `remaining/remainingAmount`, `paymentStatus`) without modifying installment rows.

**Endpoints (same behavior):**
- `POST /api/quotations/:id/revert-final-settlement` (preferred)
- fallback: `DELETE /api/quotations/:id/final-settlement`

**Auth:** `account-management` and `admin` (quotation admin = dealer `role: admin` also allowed by handler).

**Must clear:**
- `finalSettlementApplied = false`
- `finalSettlementAmount = 0`
- `finalSettlementAt = null`
- `finalSettlementBy = null`

**Must recompute/persist:**
- `discountAmount`, `discount`
- `finalAmount` and `totalAmount`
- `remaining/remainingAmount`
- `paymentStatus` (pending/partial/completed derived from remaining + paid)

**Must keep:** `installments/paymentPhases` unchanged.

**Docs:** `BACKEND_REVERT_SETTLEMENT.md`.

---

## 12b. Super Admin — Quotation login + Inventory data (Jul 2026)

**Status: implemented** — `BACKEND_CHANGES_REQUIRED.md` §AD, `BACKEND_SUPER_ADMIN_QUOTATION_LOGIN.ts`

**Frontend:** `/login` → Admin Panel → **Accounts** → **Open Inventory** (`/dashboard/inventory`).

| Requirement | Behavior |
|-------------|----------|
| `POST /api/auth/login` | Accepts inventory `users` including `super-admin`; returns `user.role: "super-admin"` |
| Role normalize | `superadmin` / `super_admin` → `super-admin` in JWT + response |
| `/api/admin/*` | Same access as admin via `authorizeAdmin` — any super-admin username |
| Shared token | Same Bearer works on inventory routes (`/products`, `/users`, `/stock-requests`, `/sales`, `/stock-returns`) |
| **Quotation Admin on inventory** | Dealer `role: admin` JWT → inventory session as **super-admin** (§AD.5.1) — no token errors; same access as Super Admin panel |
| Scope | Super-admin + quotation Admin see **all** inventory rows / can manage products, users, stock, sales |

**Code:** `utils/inventoryRole.ts`, `controllers/quotationAuthController.ts`, `middleware/authQuotation.ts`, `middleware/auth.ts` (`tryAuthenticateQuotationAdminForInventory`), `controllers/userController.ts`.

---

## 13. Admin Overview — total kW (capacity) by dealer (May 2026)

> **Related (Jul 2026):** Admin Overview → **Product Needed** is documented below as **§13b** (frontend §13). This section remains the kW / Dealers by Revenue contract.

### 13.1 — 0 kW bug — backend ticket (JAGDISH / revenue-only rows)

**Symptom:** Dealers by Revenue shows correct **₹ revenue** (from `subtotal`) but **0 kW** — e.g. JAGDISH ₹2.7L, Nikhil ₹1.9L, capacity 0.

**Cause:** Frontend sums kW only when the API returns **panel config** or **`systemKw`**. Revenue works from `subtotal` alone.

**Fix (implemented in this repo):**

| Endpoint | Change |
|----------|--------|
| `GET /api/admin/quotations` | `products` + `quotationProduct` + **`systemKw`** + root `panelSize` / `panel_quantity` |
| `GET /api/quotations?status=approved` | Same enrichment |
| `GET /api/quotations/{id}` | Same as list (was missing `systemKw` on detail) |
| `GET /api/admin/quotations/{id}` | **Added `quotation_products` join** (was missing entirely) |
| Approve + product save | Persist `quotations.system_kw` |

**Migration:** `database/migrations/add_system_kw_to_quotations.sql`  
**Backfill:** `npx ts-node scripts/backfill-system-kw.ts`

**Example row:**

```json
{
  "status": "approved",
  "statusApprovedAt": "2026-05-15T10:00:00.000Z",
  "dealerId": "dealer-uuid",
  "subtotal": 270000,
  "systemKw": 5,
  "products": { "systemType": "dcr", "panelSize": "555W", "panelQuantity": 9 }
}
```

**QA:** Network tab → JAGDISH approved row must show `systemKw > 0` or `products.panelSize` + `panelQuantity`. Filter “this month” uses **`statusApprovedAt`**, not `createdAt`.

---

**No new endpoint required.** Admin **Overview → Dealers by Revenue** sums **system kW** from each dealer’s **approved** quotations (same approval-date + dealer filters as revenue). Example: 12 approved quotes this month → **total kW = sum of all 12 system sizes**.

**Frontend:** `lib/merge-quotation-products.ts`, `lib/quotation-system-kw.ts`, `app/dashboard/admin/page.tsx`.

**Endpoint used today:** `GET /api/admin/quotations` (full list; client-side sum).

### Required — list row fields

| Field | Why |
|-------|-----|
| `status` = `approved` | Only approved rows count |
| `statusApprovedAt` / `status_approved_at` / `approvedAt` | Date filter (this month, etc.) |
| `dealerId` / `dealer_id` + nested `dealer` | Per-dealer grouping |
| Product / size data | Compute kW |
| `subtotal` | Revenue (unchanged) |

### Product data — at least one source (frontend merges all)

| Source | Backend status |
|--------|----------------|
| **`products`** (preferred) | ✅ `quotationProductsApiFields()` |
| **`quotationProduct`** (joined-row alias) | ✅ Same merged object as `products` |
| **`quotationProducts[]`** | ✅ `[merged]` when product row exists |
| Flat root `panelSize` / `panel_quantity` | ❌ Not on `quotations` table |
| Precomputed **`systemKw` / `system_kw`** | ✅ Computed on list (`utils/quotationSystemKw.ts`) |

**Anti-pattern (0 kW in production):** `{ "products": {}, "subtotal": 297000, "status": "approved" }` — revenue works, kW does not.

### Fields by system type (camelCase or snake_case)

| System type | Fields |
|-------------|--------|
| DCR / Non-DCR | `systemType`, `panelSize`, `panelQuantity` |
| BOTH | `dcrPanelSize`, `dcrPanelQuantity`, `nonDcrPanelSize`, `nonDcrPanelQuantity` |
| CUSTOMIZE | `customPanels[]` `{ size, quantity }` |
| Fallback | `inverterSize`, then `structureSize` |

### kW formula (match if precomputing `system_kw`)

```
kW = (panelSizeW × panelQuantity) / 1000
```

BOTH: DCR kW + Non-DCR kW. CUSTOMIZE: sum all custom panel rows.

### Backend verification checklist

| Check | Status |
|-------|--------|
| List includes `products` **or** `quotationProduct` with panel fields | ✅ |
| Not empty `products: {}` without panel data elsewhere | ⚠️ Data issue if `quotation_products` row missing |
| `statusApprovedAt` set on approve | ✅ |
| `dealerId` on every row | ✅ |
| Return `systemKw` / `system_kw` on list | ✅ Precomputed per row |
| Persist `system_kw` DB column | ✅ Migration + save on product update / approve |

**If revenue correct but kW still 0:** (1) Deploy API with `systemKw` on list rows; (2) confirm frontend hits updated API; (3) inspect Network — missing `products` **and** `systemKw` usually means stale production or empty `quotation_products` row.

### Optional (performance / accuracy)

| Change | Benefit |
|--------|---------|
| `system_kw` column on create/update | Fast kW; frontend prefers when present |
| `GET /api/admin/overview/dealer-stats?range=this_month` | Server aggregates for large volumes |

**Code:** `utils/quotationSystemKw.ts` → `computeSystemKwFromProducts`; `utils/quotationApiJson.ts` → `quotationProductListApiFields` (adds `systemKw`); `controllers/adminController.ts` → `getAllQuotations`; `controllers/quotationController.ts` → `getQuotations`.

**Reference:** `BACKEND_CHANGES_REQUIRED.md` §6.5.1.

### QA

1. Dealer with known approved count → Overview kW **> 0** when rows have panel config.
2. Manual sum `(panelSize × panelQuantity) / 1000` per approved row ≈ dealer total.
3. Revenue correct, kW 0 → API row lacks product/size fields.

---

## 14. Account Management hooks / scroll — no API change (May 2026)

| Item | Backend |
|------|---------|
| React hooks fix on account-management page | **No change** — frontend only |
| Payment list infinite scroll (batch 15) | **No change** — client slices already-fetched `GET /api/quotations?status=approved` list |
| Admin installation/metering infinite scroll | **No change** — same client-side pattern |

**Backend still responsible:** full approved list payload (§12) and fresh `installments` / `paymentPhases` after payment PATCH.

---

## 15. Mobile app — API URL (HTTPS)

**No API code change** if production serves HTTPS on `https://api.inventory.chairbordsolar.com/api`.

- HTTP → HTTPS redirect breaks Android WebView POST login; frontend uses HTTPS directly.
- Ensure CORS allows `https://quotation.chairbordsolar.com` (and dev origins if needed).

---

## Appendix — Frontend reference (implemented)

| File | Role |
|------|------|
| `lib/calling-lead-assignee.ts` | Assignee + `LEAD_004` detection |
| `lib/calling-remark-payload.ts` | Remark PATCH body enrichment |
| `lib/api.ts` | `claimCallingLead`, `assignCallingLeadToMe`, action retries |
| `app/dashboard/calling-data/page.tsx` | Queue tabs, remarks, Start/Submit |
| `lib/hr-upload-lead-display.ts` | HR count/table labels |
| `lib/quotation-pdf-display.ts` | PDF display helpers |
| `lib/phone-dialer.ts` | Desktop: copy number (no `tel:` app picker) |

---

## Priority summary for backend team

| Priority | Topic | Status |
|----------|--------|--------|
| **1** | Calling queue `LEAD_004` | **Done** — A + B (claim/assign/patch) + C |
| **2** | HR upload live counts | **Done** |
| **3** | PDF panel range keys on products (incl. **`tata_530_570`**, Tata `VAL_003`) | **Done** (+ migrate) |
| **4** | Remarks, tabs, start vs submit, customer note | **Done** (+ customer `notes` migrate) |
| **4b** | In-progress lead stays `currentLead` until Submit | **Done** — §4.5.1 / §E.1 |
| **4c** | Reschedule / Decision Pending Submit | **Done** — §4.5.2 / §E.2 |
| **5** | HR/Admin `GET` calling-actions (`dealerId`, dates, `custom`, aliases) | **Done** — §4.8 |
| **6** | Quotation create stability | **Done** — §5 |
| **7** | Quotations tab → Send to Metering | **Done** — §21 / §L.1 |

### HR/Admin GET example

```http
GET /api/hr/calling-actions?limit=2000&dealerId={uuid}&range=weekly&startDate=2026-05-19T00:00:00.000Z&endDate=2026-05-25T23:59:59.999Z
```

When both `startDate` and `endDate` are sent, filtering uses that window on `action_at` (legacy rows may fall back to `created_at`). `range=weekly` without dates uses **Mon–Sun** in server local TZ.

**Assignee rule:** `assignedDealerId` = who is calling; `dealerId` on lead = uploader/CRM only.

---

## 15A. Latest consolidated handoff (Must-have vs Optional)

### Must-have (blocking)

| Area | Requirement |
|------|-------------|
| Calling queue auth stability | Dealer JWT must be accepted on `GET /api/dealers/me/calling-queue/next` (and `/current` if kept). If no lead exists, return **200** with empty queue payload, not 401/403. |
| Calling submit + assignment | `PATCH /api/dealers/me/calling-queue/:leadId/action` supports `action`, `callRemark`/`call_remark`, `statusCategory`/`status_category`, `statusText`/`status_text`, `nextFollowUpAt`, `actionAt`; auto-assign pool/unassigned rows on `start`/submit to prevent valid-flow `LEAD_004`. |
| Calling remarks persistence | Persist `call_remark` in DB and echo it in queue responses (`next`/`current`) and history arrays (`recentActions`, `dialledActions`, `connectedActions`, `notConnectedActions`, etc.). Frontend local storage remains fallback only. |
| Quotation system types | Support `systemType: dcr | non-dcr | both` on create/update/read, and ensure `GET /api/quotations/pricing-tables` includes pricing for all three system types. |
| PDF/commercial metadata | Persist and return `pdfCommercialSet`; return `updatedAt` and (optional) `validUntil` for PDF workflows. |
| Admin quotations endpoint | Keep `GET /api/admin/quotations` working and properly role-authorized for dashboard flows. |

### Optional / recommended

| Area | Recommendation |
|------|----------------|
| Admin dashboard counters | Add/keep `GET /api/admin/statistics` with counters (`overview.totalQuotations`, `thisMonth.quotations`). |
| Calling queue response contract | Keep compatibility aliases in both camelCase and snake_case on action/queue payloads to avoid client regressions. |

---

## 16. Troubleshooting — Admin API errors & 0 kW after deploy

### `[API] ===== API ERROR DETECTED =====` on admin `loadData`

| Check | Action |
|-------|--------|
| API process | `yarn dev` — default **PORT=3050** (see `.env`) |
| Frontend base URL | `NEXT_PUBLIC_API_URL=http://localhost:3050/api` — **not** `localhost:3000` (Next.js does not proxy this backend) |
| Auth | Valid admin JWT; `GET /api/admin/quotations` without token → **401** |
| Migrations | `yarn migrate` + `system_kw` column (bootstrap also runs `ensureSystemKwColumn`) |

**Typical causes:** connection refused (wrong port), **401** (expired token), **500** (missing column before migrate).

### Revenue correct, kW still 0

1. Network tab: approved row must include **`systemKw` > 0** and/or **`products.panelSize` + `panelQuantity`**.
2. Confirm response is from **deployed** API (not cached old build).
3. If `products: {}` and no `systemKw`: missing `quotation_products` row — run product save or backfill script.
4. Date filter on Overview uses **`statusApprovedAt`**, not `createdAt`.

---

## 17. Payment Management → Admin Installation (June 2026)

**Status: implemented in repo.** **Production blocker:** if Installation tab is empty after hard refresh, production API is missing this deploy and/or DB columns — see **`BACKEND_INSTALLATION_RELEASE.md`** (SQL, curl QA, deploy checklist).

Account team releases approved quotations to the installer pipeline; admin Installation tabs and the installer dashboard only show **released** rows. Metering advance is **manual** (admin “Send to Metering”).

### 17.1 — Send to Installer (Account / Payment Management)

`PATCH /api/quotations/{id}/installation-release` (account-manager or dealer admin)

```json
{
  "installationReadyForInstaller": true,
  "installationReleasedAt": "2026-06-05T10:30:00.000Z"
}
```

Persists:

| Column | Value |
|--------|--------|
| `installation_ready_for_installer` | `true` |
| `installation_released_at` | ISO timestamp (body or server `now`) |
| `installation_status` | `pending_installer` |

**Code:** `controllers/quotationController.ts` → `updateQuotationInstallationRelease`.

### 17.2 — List GET must echo release + installation fields

| Endpoint | Consumers |
|----------|-----------|
| `GET /api/admin/quotations` | Admin → Installation tab; optional `?operationalView=installer` |
| `GET /api/quotations?status=approved` | Account Management — “Sent to installer” badge |
| `GET /api/installer/quotations` | Installer dashboard |

Each row includes (camelCase + snake_case aliases where noted):

- `installationReadyForInstaller` / `installation_ready_for_installer`
- `installationReleasedAt` / `installation_released_at`
- `installationStatus` / `installation_status`
- `installationScheduledAt`, `installationTeamId` (when set)
- Installation photo URLs after upload (`installationPhotoUrls`, `documents`, `installationFieldUrls`)

**Code:** `quotationAdminMetadataFields`, `meteringWorkflowApiFields`, `mapInstallationDocumentsForApi`.

### 17.3 — Release gate (installer queue)

Include a quotation **only if**:

```
installation_ready_for_installer = true
OR installation_released_at IS NOT NULL
```

**Do not** include approved quotations that were never sent from Payment Management (default `installation_status = pending_installer` alone is **not** enough).

**Code:** `constants/workflowQueues.ts` → `buildReleasedToInstallerWhere()`; used by:

- `GET /api/installer/quotations` (`getInstallerQueue`)
- `GET /api/admin/quotations?operationalView=installer`
- `GET /api/admin/quotations?scope=installer_queue`

### 17.4 — Pending vs Approved (Installation tabs)

| Tab | Backend filter (client may refine) |
|-----|-------------------------------------|
| **Pending Installation** | Released + `pending_installer` / `installer_in_progress` / no completion photos |
| **Approved Installation** | Released + `installer_approved` (or completion image URLs on GET) |

`?status=approved` on installer/admin installer queue maps to **`installer_approved` only** (not Baldev/metering).

### 17.5 — Manual metering (no auto-advance)

| Event | `installation_status` |
|-------|------------------------|
| Installer uploads photos + submits | `installer_approved` (**not** `pending_metering` / `pending_baldev`) |
| Admin clicks **Send to Metering** | `pending_metering` via `PATCH /api/admin/quotations/{id}/installation-status` or metering status PATCH |

`deriveMeteringStatus` returns `null` until the row is actually in `pending_metering`+ so Installation rows do not appear in Metering tabs prematurely.

### 17.6 — QA checklist

| Scenario | Expected |
|----------|----------|
| Approve but don’t send | **Not** in Installation / installer queue |
| Send from Payment Management | Appears in **Pending Installation** |
| Refresh / different browser | Still visible (server persistence) |
| Upload photos | Moves to **Approved Installation** (`installer_approved`) |
| Send to Metering | Leaves Installation; shows in Metering queue |

### 17.7 — DB columns (optional migration already applied)

`installation_ready_for_installer`, `installation_released_at`, `installation_status`, `installation_scheduled_at`, `installation_team_id` on `quotations`.

**Full spec:** `BACKEND_INSTALLATION_RELEASE.md`

---

## 21. Quotations tab → Send to Metering (§L.1)

**Status: implemented** — dedicated route + early handoff from `pending_installer` (Jul 2026).

### Symptom → fix

| Issue | Cause | Fix |
|-------|-------|-----|
| PATCH returns **403** | Handler required quotation `req.dealer` admin only | Inventory admin JWT allowed via `hasAdminQuotationAccess()` |
| PATCH **200** but Metering empty | Metering queue required PM release | `getMeteringQueue` — no release gate for metering pipeline rows |
| Installation still shows row | Wrong filter | `pending_metering` ∉ `INSTALLER_RELEASE_STATUSES` |
| **400** `Cannot send to metering from installation status 'pending_installer'` | Allowed-from set required `installer_approved` | Allow `pending_installer` / `installer_in_progress` for admin; preferred `.../send-to-metering` |

### Minimum deliverable

**Preferred:** `PATCH|POST /api/admin/quotations/{quotationId}/send-to-metering`

**Fallback:** `PATCH /api/admin/quotations/{quotationId}/installation-status`

```json
{
  "installationStatus": "pending_metering",
  "meteringStatus": "pending_metering",
  "force": true,
  "adminOverride": true,
  "allowFromPendingInstaller": true,
  "source": "admin"
}
```

| Item | Detail |
|------|--------|
| Auth | Quotation admin **or** inventory `admin` / `super-admin` |
| Persist | `installation_status = pending_metering` |
| GET | `meteringStatus` derived on list/detail |
| Early send | From `pending_installer` OK (no `installer_approved` required) |
| Idempotent | Re-send → **200** |
| Photo upload | `installer_approved` only until explicit PATCH |
| Partial | `installer_partial_approved` still **400** |

### Frontend retry order

`lib/api.ts` → `sendQuotationToMetering` → `/send-to-metering` → installation-status / workflow-status / metering-status aliases → 2-step promote.

### QA

1. Send while `pending_installer` → **200**.
2. `GET /api/metering/quotations?status=processing` includes row (without PM release).
3. Absent from installer queue.
4. Double Send → **200**.
5. Admin Metering + Metering-role login both show Meter Pending.

**Full spec:** `BACKEND_CHANGES_REQUIRED.md` §L.1. **Reference:** `BACKEND_SEND_TO_METERING.ts` (+ `BACKEND_ADMIN_QUOTATION_STATUS.ts`).

---

## 18. Inventory — decimal prices, product unit, kg → pieces (June 2025)

**Status: implemented in repo.** **Full spec:** `BACKEND_CHANGES_DECIMAL_PRICE_KG_TO_PIECES.md`

Product Manager / Super Admin **Add Product** and **Add Stock**: decimal prices, `unit` on every product, kg catalog items saved as **Pieces** with integer quantity and per-piece price.

### 18.1 — Decimal prices

- `unit_price`, `selling_price`, `default_price`, `cost_price` → `DECIMAL(10,2)` (products may use `DECIMAL(12,2)`).
- Accept `85.45`, `153.00`; reject negatives only.
- **Code:** `utils/productUnit.ts` → `roundProductPrice()`; `validations/productValidations.ts`

### 18.2 — Product `unit` column (required)

```sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit VARCHAR(50);
```

| Operation | Behavior |
|-----------|----------|
| `POST /api/products` | Accept `unit`: `Meters`, `Quantity`, `Pieces`, `Kilograms`, … |
| `PUT /api/products/:id` | Accept `unit`; `PUT { "unit": "Quantity" }` only is valid |
| `GET /api/products` | Return `unit` on every row (e.g. `900 Meters`, `69 Quantity`) |

Codes normalized on save: `PCS`→`Pieces`, `KGS`→`Kilograms`, `MTR`→`Meters`, `NOS`→`Quantity`.

**Code:** `models/Product.ts`, `controllers/productController.ts`, `utils/productApiFormat.ts`

### 18.3 — Kg → pieces (frontend only; backend stores finals)

| User enters | API receives |
|-------------|--------------|
| 10.5 kg | `quantity: 23` (pieces) |
| ₹340/kg × 0.45 kg/piece | `unit_price: 153.00` (per piece) |
| Catalog KGS | `unit: "Pieces"` |

**Not sent:** `total_weight_kg`, `weight_per_piece_kg`, `price_per_kg`. No server-side conversion.

### 18.4 — Unit validation (fixes 400)

- Accept display names + codes; **no** catalog-unit mismatch (ex-KGS → `Pieces` OK).
- Omit `unit` on update → leave unchanged.

### 18.5 — Stock rules

- `stock_to_add` = integer pieces; `new_qty = current + stock_to_add`.
- Structural/KGS items (nut bolts, J hooks) — serial numbers optional.

### 18.6 — QA checklist

| Test | Expected |
|------|----------|
| Create `unit_price: 85.45` | GET returns `85.45` |
| Create kg product `quantity: 23`, `unit: "Pieces"`, `unit_price: 153.00` | 201, no 400 |
| `stock_to_add: 11` | Quantity +11 pieces |
| Custom product `unit: "Meters"` | GET returns `unit` |
| `PUT` only `{ "unit": "Quantity" }` | Unit updates |

---

## 19. Admin Visitor Reports — `GET /api/admin/visits` (June 2026)

**Status: implemented.** Admin panel **Visitor Reports** tab loads all visits with filters. Until deployed, frontend shows “endpoint not available”.

### 19.1 — Endpoint

```
GET /api/admin/visits
Authorization: Bearer {admin_token}
```

**Fallback:** `GET /api/visits` when JWT is quotation **dealer admin** (`role=admin`) — same payload.

| Actor | `/admin/visits` | `/visits` |
|-------|-----------------|-----------|
| Quotation / inventory admin | ✅ | ✅ (fallback) |
| Dealer (non-admin) | 403 | Own dealer visits only |
| Visitor | 403 | 403 |

### 19.2 — Query parameters

| Param | Purpose |
|-------|---------|
| `status` | `pending`, `approved`, `completed`, `incomplete`, `rejected`, `rescheduled`, or `all` |
| `visitorId` | Filter by `visit_assignments.visitorId` |
| `startDate` / `endDate` | `YYYY-MM-DD` on `visitDate` |
| `search` | Customer, quotation id, location, visitor/dealer name |
| `page` / `limit` | Pagination (`limit` max **2000** — frontend uses `limit=2000&status=all`) |

### 19.3 — Response row (each visit)

`id`, `quotationId`, `dealerId`, `visitDate`, `visitTime`, `location`, `status`, `visitors[]` → `{ visitorId, visitorName }`, `customer` → `{ firstName, lastName, mobile }`, `dealer` → `{ id, firstName, lastName }`, `rejectionReason`, `notes` (when set). Shape mirrors `GET /api/visitors/me/visits` summary, scoped to all visits.

**Code:** `controllers/visitController.ts` → `getAdminVisits`; `utils/visitApiFormat.ts` → `formatAdminVisitReportRow`

### 19.4 — Details modal (no separate endpoint)

Admin **Details** reuses existing:

```
GET /api/quotations/{quotationId}/visits
```

Returns full **completion payload** per visit: `notes`, `length`, `width`, `height`, `unit`, `backLegFeet`, `midLegFeet`, `frontLegFeet`, `images`, `rowDiagramImage`, `meterImage`, presigned URLs (`resolveBrowsableMediaUrl`), `visitors[].visitorName`, `customer.firstName` / `lastName`.

Frontend fallback (works today): same per-quotation GET in a loop — `GET /admin/visits` replaces that for the **list**.

### 19.5 — List vs modal fields

| Endpoint | Media URLs | Names |
|----------|------------|-------|
| `GET /admin/visits` (default) | Omitted (faster) | `visitors[].visitorName`, `customer.*`, `dealer.*` |
| `GET /admin/visits?includeMedia=true` | Included | Same |
| `GET /quotations/{id}/visits` | Included (modal) | Full completion + names |

### 19.6 — QA

| Test | Expected |
|------|----------|
| Admin `GET /admin/visits?limit=2000&status=all` | 200, `data.visits[]` with names (no broken S3 on list) |
| `GET /quotations/{id}/visits` as admin | Completion fields + browsable image URLs |
| Dealer token on `/admin/visits` | 403 |
| `visitorId={uuid}` | Only visits with that assignment |
| `search=JAGDISH` | Rows matching dealer/visitor/customer/location |

**Full spec:** `BACKEND_CHANGES_REQUIRED.md` §Z / §Z.11

---

## 20. Final confirmation document uploads (§M)

**Status: implemented**

### Symptom → cause

Admin **Final Confirmation** tab uploads fail with **400** `Invalid quotation document payload` when the client uses **`PATCH /api/quotations/{id}/documents`** — that route enforces KYC text fields (`phoneNumber`, `emailId`, `electricityKno`) for dealer JWTs.

### Minimum deliverable

| Item | Implementation |
|------|----------------|
| **Preferred** | `POST /api/admin/quotations/{id}/final-confirmation-documents` |
| **Baldev** | `POST /api/baldev/quotations/{id}/final-confirmation-documents` |
| **Roles** | `admin`, `super-admin`, `super-admin-manager`, `baldev`, `confirmation` |
| **Fields** | `customerFinalBillFile`, `panelWarrantyFile`, `inverterWarrantyFile`, `workCompletionWarrantyFile` |
| **Partial** | Any subset per request |
| **Storage** | S3 + `quotation_documents` columns; GET returns `*FileUrl` presigned aliases |
| **KYC PATCH** | Unchanged — do **not** use for final confirmation |

### Frontend retry order

1. `POST /api/admin/quotations/{id}/final-confirmation-documents` (batch multipart)
2. On **404**: `POST /api/admin/quotations/{id}/final-confirmation-documents/upload` (`field` + `file`)
3. On **404**: `POST /api/quotations/{id}/documents/upload` (`field` = one of four keys + `file`)

### QA

1. Upload one PDF → **200**; `GET /api/admin/quotations/{id}` shows `customerFinalBillFileUrl`.
2. Upload second slot in separate request → prior slot preserved.
3. Baldev JWT on `/api/baldev/…/final-confirmation-documents` → **200**.
4. Wrong field name `finalBill` → **400** (not **500**).
5. KYC PATCH with only `panelWarrantyFile` + dealer JWT → **200** (skip KYC when final-confirmation-only).

**Full spec:** `BACKEND_CHANGES_REQUIRED.md` §M. **Reference:** `BACKEND_ADMIN_QUOTATION_STATUS.ts` → `postAdminFinalConfirmationDocuments`.

---

## 13. Installation Partial Approved + multi PI + Metering fields (Jul 2026)

**Full handoff:** `BACKEND_INSTALLATION_PARTIAL_AND_METERING.md`.

| Area | Backend |
|------|---------|
| Status | `installer_partial_approved` + flags `installationPartialApproved` / `At` |
| Upload | Accepts status + `existingInstallationImageUrlsJson` + `existingPiUploadUrl(s)Json` |
| Multi PI | Repeated `piUpload`; GET returns `piUploadUrls[]` (+ singular) |
| Metering | Persist `meteringRemarks` + `meteringAuthorizedRepresentative`; echo on lists |
| Send to Metering | **Blocked** until `installer_approved` (partial cannot advance) |

### QA

1. Partial upload → Partial Approved tab; not Approved Installation.
2. Complete & Approve → `installer_approved`; partial flags cleared.
3. Partial → Send to Metering → **400**.
4. 2+ PI → `piUploadUrls.length >= 2` on GET.
5. Metering remarks + authorized representative survive refresh.

---

## 14. Meter Installation Pending + WCC fields (Jul 2026)

**Full handoff:** `BACKEND_METER_INSTALLATION_PENDING.md`.

| Area | Backend |
|------|---------|
| Status | `meter_installation_pending` (+ `meterInstallationPendingAt`) |
| From | `metering_approved` → MIP via admin/metering PATCH |
| To MCO | `meter_installation_pending` → `mco` (legacy `metering_approved` still allowed) |
| Details POST | `meterInstallationPhoto`, `plantLivePhoto`, `discomLocation`, WCC fields |
| GET echo | Public/presigned photo URLs + names; `discomLocation` |

### QA

1. Meter in Discom → To Meter Installation Pending → status survives refresh.
2. MIP Update uploads 2 photos → GET returns browsable URLs.
3. WCC save Discom + Assigned + optional location → Meter Pending after stage set.
4. MIP → To MCO → `mco`.

---

## 13b / §13 (frontend) — Admin Product Needed (installation-pending brand dashboard) (Jul 2026)

**Frontend:** Admin Panel → Overview → **Product Needed**  
**API:** `GET /admin/product-needed` via `api.admin.productNeeded.getAll`  
**Reference:** [`BACKEND_ADMIN_PRODUCT_NEEDED.ts`](./BACKEND_ADMIN_PRODUCT_NEEDED.ts)  
**Client:** `lib/admin-product-needed.ts`, `lib/load-admin-product-needed.ts`

### Goal

Procurement dashboard for **installation-pending jobs only** (same gate as Admin → Pending Installation):

- One **brand card** per panel brand with wattage / set lines
- One **brand card** per inverter brand with kW / set lines
- “As per the set” with missing qty → **1 set per job** (2 Tata jobs = **2 sets**)

SPA already aggregates from `GET /admin/quotations` when this route is missing.

### Required backend

1. **`GET /admin/product-needed`** (admin JWT only)
2. Query params:

| Param | Notes |
|-------|--------|
| `scope` | `installation_pending` (default). **Do not** require `tab=file_login` |
| `dealerId`, `search`, `startDate`, `endDate` | Optional |
| `dateField` | `installation_released` (default) or `created` |
| `page`, `limit` | Default 500, max 2000 |

3. **Eligibility** (Pending Installation only):
   - Released / sent to installer
   - Status in `pending_installer`, `installer_in_progress`
   - **Exclude** partial approved, `installer_approved`, metering, baldev/completed, `installerApprovedAt`
4. Each row: structured **`panelLines`** + **`inverterBrand` / `inverterSize` / `inverterQuantity`**
5. Optional **`data.aggregates`** on the **full filtered set** before pagination (`buildBrandAggregates`)
6. Keep `GET /admin/quotations` release flags + products for SPA fallback

### Response shape (minimum)

```json
{
  "success": true,
  "data": {
    "rows": [
      {
        "quotationId": "QT-…",
        "dealerId": "…",
        "customerName": "…",
        "customerMobile": "…",
        "dealerName": "…",
        "systemKw": "5kW",
        "systemType": "DCR",
        "panels": "Waaree 540W × 10",
        "inverter": "Vsole/Xwatt · 5kW",
        "panelLines": [{ "brand": "Waaree", "size": "540W", "quantity": 10 }],
        "inverterBrand": "Vsole/Xwatt",
        "inverterSize": "5kW",
        "inverterQuantity": 1,
        "installationReleasedAt": "2026-07-01T10:00:00.000Z",
        "quotationStatus": "approved"
      }
    ],
    "aggregates": {
      "jobCount": 22,
      "totalPanels": 151,
      "totalInverters": 22,
      "panels": [
        {
          "brand": "Waaree",
          "totalQuantity": 63,
          "jobCount": 8,
          "sizes": [
            { "size": "540W", "quantity": 54, "jobCount": 7, "unit": "panels" },
            { "size": "560W", "quantity": 9, "jobCount": 1, "unit": "panels" }
          ]
        },
        {
          "brand": "Tata",
          "totalQuantity": 2,
          "jobCount": 2,
          "sizes": [
            { "size": "As per the set", "quantity": 2, "jobCount": 2, "unit": "sets" }
          ]
        }
      ],
      "inverters": []
    },
    "pagination": { "page": 1, "limit": 2000, "total": 22, "totalPages": 1 }
  }
}
```

### Checklist

- [ ] `GET /admin/product-needed?scope=installation_pending` → **200** (admin)
- [ ] Dealer / visitor → **403**
- [ ] Only Pending Installation jobs
- [ ] `panelLines` + wattage normalized (`540W`)
- [ ] Set packages qty `0` → **sets** (1 per job)
- [ ] Optional `aggregates.panels` / `aggregates.inverters`
- [ ] `dealerId` + date filters server-side
- [ ] SPA works if route **404** (quotation-list fallback)

### QA

1. Send to installer → appears; approve installation → leaves.
2. Two Adani jobs (540W×10, 620W×5) → **one Adani card**, two size lines.
3. Two Tata “As per the set” qty 0 → **2 sets**.
4. Filter by dealer → totals for that dealer only.
5. Non-admin → **403**.

---

## 14. Inventory — Tally Purchase import `POST /products` (Jul 2026)

**Frontend:** Inventory → Add New Product → **Import stock from Tally Purchase JSON**  
**Failing call (before fix):** `POST /api/products` → **500** `{ error: "Server error" }`

### Frontend mitigation (already shipped)

1. `POST /products` — name, model, category, qty, unit (`NOS`), cost — **no** `serial_numbers`
2. `PUT /products/:id` — `stock_to_add: 0` + `serial_numbers` JSON string

### Backend (implemented in this repo)

| Change | File |
|--------|------|
| Allow create **without** serials for Panels/Inverters (attach on PUT) | `controllers/productController.ts` |
| Accept `serial_numbers` as JSON **string or array** | `validations/productValidations.ts` |
| Return real error message/`code` on create failure (not bare `"Server error"`) | `createProduct` catch |
| Units `NOS` / `PCS` / `MTR` / `KGS` (+ display aliases) | `utils/productUnit.ts` |
| Do not init S3 unless an image file is present | already |

### Checklist

- [x] `POST /products` JSON without image → **201**
- [x] Create Inverter/Panel with qty and **no** serials → **201**
- [x] `PUT /products/:id` with `serial_numbers` string → attaches serials
- [x] Duplicate serial → **400** with clear message
- [x] 500 responses include exception message / `code`

### QA

1. Import Tally Purchase JSON with Inverter + 2 serials → product + both serials.
2. Same voucher twice → clear duplicate error (no opaque 500).
3. Create without photo works when AWS is misconfigured.

---

## 28. Admin — Product Needed (alias)

> Canonical section is **§13b / frontend §13** above. Kept for older links that pointed at §28.

**Reference:** `BACKEND_ADMIN_PRODUCT_NEEDED.ts`

---

## 15. Calling / HR uploads — FCFS + Unassigned → 0 (Jul 2026)

**Symptom:** `/current` 500; HR Unassigned badges (193, 97, …) stuck; dealers see empty Current Lead.

**Shipped:**

| Piece | Implementation |
|-------|----------------|
| `/current` + `/next` always **200** | `getDealerCallingQueueCurrent` / `Next` — empty on error, never SYS_001 |
| FCFS allocate | `promoteQueuedLeadIfSlotAvailable` + SKIP LOCKED; stuck reclaim |
| **`POST …/uploads/:uploadId/assign-unassigned`** | Round-robin all pool/unassigned leads → `unassignedCount === 0` |
| Upload `assignmentMode=round_robin_all` | Assign **every** new row (ignore `activeLimitPerDealer` leftovers) |
| Upload Zod | `activeLimitPerDealer` / `activeLeadsLimit` **1..50** (SPA sends `1`; do **not** send >50 — use `round_robin_all` to assign all) |

**Refs:** `BACKEND_ASSIGN_UNASSIGNED.ts`, `BACKEND_CALLING_QUEUE_CURRENT.ts`

**QA:** Upload with `activeLimitPerDealer=1` succeeds; HR Assign unassigned → Unassigned **0**; `/current` never 500; `/next` returns dealer’s assigned lead until Assigned **0**.

### §15-C-2 — Upload CSV must never 500 on Assign Leads (Jul 2026)

**Symptom:** `POST /api/hr/leads/upload-csv` → delay → **500 Internal server error**. Zod is fine (`activeLimitPerDealer=1`).

**Shipped in `uploadCallingLeadsCsv`:**

| # | Fix |
|---|-----|
| 1 | Unknown dealers → **400 VAL_002** before insert |
| 2 | CSV parse try/catch → **400 VAL_001** |
| 3 | Per-row insert + **SAVEPOINT** — unique → `skippedDuplicate`, continue |
| 4 | **Chunked inserts (500)** — avoids large-CSV timeout |
| 5 | Per-assign SAVEPOINT — try next / pool |
| 6 | Outer **SYS_001** includes truncated `e.message` |
| 7 | Zod max **50**; `assignmentMode=round_robin_all` ignores numeric cap |

**QA:**
```bash
curl -sS -X POST "$API/hr/leads/upload-csv" \
  -H "Authorization: Bearer $HR_JWT" \
  -F "file=@leads.csv" \
  -F "dealerIds[]=$DEALER1" \
  -F "activeLimitPerDealer=1"
# Expect 201 with created/assigned — NEVER 500
```

---

## 17. Metering — dual track (Meter process left + Bank process right)

**Frontend:** Admin → Metering, `/dashboard/metering`, Installer → Metering  
**Full handoff:** **`BACKEND_METERING_DUAL_TRACK.md`**  
**Meter stages:** `BACKEND_METERING_DISCOM_WCC_METER_INSTALL.md`

| Track | Tabs |
|-------|------|
| **Meter** (left) | Meter Pending → Discom → WCC Pending → Meter Installation Pending → Final Step |
| **Bank** (right, parallel, loan/mix only) | Bank Process → Pending Payment |

**Shipped:**

| Piece | Implementation |
|-------|----------------|
| Columns | `bankProcessDone`, `bankProcessDoneAt` — migration `20260725120000-bank-process-done.js` |
| GET echo | `quotationPaymentApiFields` → `paymentType`, `bankProcessDone`, bank name/IFSC |
| PATCH bank | `updateQuotationBankProcess` — `/admin|metering|quotations/…/bank-process` (+ payment-details fallbacks) |
| Installer auth | `authorizeMetering` / `authorizeMeteringOrAdmin` allow `installer` + installation-team; WCC + bank routes before admin-only gate |

**QA:** Loan row in Meter + Bank Process; mark bank done → Pending Payment, same Meter tab after refresh; Installer Metering queue no AUTH_004.

---

## 18. Document Submission — Property Documents (PDF) optional

**Frontend:** Dashboard / Quotations Document Submission — label has no `*`; client no longer blocks Submit when PDF is missing.

**Backend:** **`BACKEND_PROPERTY_DOCUMENT_OPTIONAL.md`**

### Required API change

On `PATCH /api/quotations/{quotationId}/documents` (KYC / customer documents):

1. Remove `propertyDocumentPdf` from any **required** file list (Zod / manual checks).
2. Do **not** return **400** when the property PDF part is omitted or when the quotation has never stored one.
3. Still accept and store the PDF when uploaded; leave null when never provided.
4. Keep `geotagRoofPhoto` / `customerWithHousePhoto` optional as today.

**Shipped:** KYC hard-requires only `phoneNumber` / `emailId` / `electricityKno`; `OPTIONAL_QUOTATION_DOCUMENT_MEDIA_FIELDS` documents the optional set; Zod uses `optionalMediaRef` so empty multipart values do not 400.

### QA

1. Submit documents without Property Documents PDF → **200**.
2. Later upload PDF only → persists; reopen shows View link.

---

## 19. Non-DCR 80kW set — Renew Energy / Waaree / Adani (Vsole/Xwatt)

**Frontend:** Non-DCR browse + PDF proposal  
**Full handoff:** **`BACKEND_NON_DCR_80KW.md`**

### Set prices (3-Phase, inverter 80kW Vsole/Xwatt)

| Panel brand | Set price |
|-------------|-----------|
| **Renew Energy** | ₹25,10,000 |
| **Waaree** | ₹25,90,000 |
| **Adani** | ₹25,90,000 |

### PDF panel ranges (persist `pdfPanelRangeKey`)

| Brand | Key | Label |
|-------|-----|-------|
| Renew Energy | `renew_energy_600_630` | 600W - 630W |
| Waaree | `waaree_580_630` | 580W - 630W |
| Adani | `adani_600_630` | 600W - 630W |

### Other

- Allow brand **`Renew Energy`** (do not coerce to RenewSys / Adani).
- ≥20kW PDF: CT / BT + “As per the set” is **frontend-only**.
- `GET /quotations/pricing-tables` includes the three 80kW `nonDcr` rows + system presets.

### QA (short)

1. Save 80kW Renew Energy → GET echoes brand + `renew_energy_600_630` + subtotal 2510000.
2. Waaree / Adani same with their keys/prices.
3. Empty range key clears on PATCH.

---

## Related docs

| Doc | Section |
|-----|---------|
| `BACKEND_CHANGES_REQUIRED.md` | §7.7–7.8, dealer queue, §J, §X, **§L.1**, **§M**, **§N**, **§Z** |
| `API_ENDPOINTS_SUMMARY.md` | `GET /admin/visits` |
| `API_SPECIFICATION.txt` | §K Admin Visitor Reports |
| `BACKEND_INSTALLATION_RELEASE.md` | Installation release PATCH + GET contract |
| `BACKEND_INSTALLATION_PARTIAL_AND_METERING.md` | Partial Approved, multi PI, metering remarks |
| `BACKEND_METER_INSTALLATION_PENDING.md` | Meter Installation Pending + WCC / MIP photos |
| `BACKEND_CHANGES_DECIMAL_PRICE_KG_TO_PIECES.md` | Decimal prices + unit + kg→pieces |
| `BACKEND_ADMIN_QUOTATION_STATUS.ts` | Reference contracts |
| **`BACKEND_ADMIN_PRODUCT_NEEDED.ts`** | **§13** Admin Product Needed — installation-pending + brand aggregates |
| `BACKEND_SUPER_ADMIN_QUOTATION_LOGIN.ts` | Super-admin `/auth/login` + shared JWT for inventory |
| `BACKEND_FINAL_SETTLEMENT.ts` / `.md` | Final Settlement persist + GET |
| `BACKEND_SEND_TO_METERING.ts` | Admin pending_installer → pending_metering |
| **§14** (this file) | Inventory Tally import — `POST /products` + serial attach on PUT |
| **§15** (this file) | Calling `/current` 500 + FCFS + Unassigned → 0 |
| **`BACKEND_ASSIGN_UNASSIGNED.ts`** | **§15-C** `POST …/assign-unassigned` + upload `round_robin_all` |
| **`BACKEND_CALLING_QUEUE_CURRENT.ts`** | **§15** `/calling-queue/current` + `/next` (never SYS_001) |
| **§17** (this file) | Metering dual track — Meter left + Bank right |
| **`BACKEND_METERING_DUAL_TRACK.md`** | **§17** `bank_process_done` + installer auth on metering routes |
| **`BACKEND_METERING_DISCOM_WCC_METER_INSTALL.md`** | Meter Pending → Discom → WCC → MIP → Final Step |
| **§18** (this file) | Document Submission — Property Documents PDF optional |
| **`BACKEND_PROPERTY_DOCUMENT_OPTIONAL.md`** | **§18** stop requiring `propertyDocumentPdf` on PATCH …/documents |
| **§19** (this file) | Non-DCR 80kW set — Renew Energy / Waaree / Adani |
| **`BACKEND_NON_DCR_80KW.md`** | **§19** PDF range keys + pricing-tables 80kW rows |

