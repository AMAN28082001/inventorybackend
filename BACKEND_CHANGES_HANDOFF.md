# Backend changes handoff (May 2026)

**Single handoff doc for the API team.** Full specs: `BACKEND_CHANGES_REQUIRED.md` (§7.8–§7.9, dealer queue §E–§H, §J, §X, §Y). Reference contracts: `BACKEND_ADMIN_QUOTATION_STATUS.ts`. Implementation: `controllers/callingLeadController.ts`, `controllers/quotationController.ts`, `controllers/visitController.ts`, `controllers/customerController.ts`, `utils/quotationProductPdfDisplay.ts`, `utils/s3Service.ts`.

## Sprint checklist (copy for tracking)

| # | Priority | Area | Status | Handoff § |
|---|----------|------|--------|-----------|
| 1 | High | HR upload GET live counts | **Done** | §1 |
| 2 | High | PATCH calling action + remarks | **Done** | §4.1 |
| 3 | High | Queue GET tab buckets | **Done** | §4.4 |
| 4 | High | `start` without `nextLead` | **Done** | §4.5 |
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

**Deploy before QA:**

```bash
yarn migrate
```

| Migration | Purpose |
|-----------|---------|
| `20260519120000-add-pdf-display-flags-to-quotation-products.js` | Legacy booleans (old quotations) |
| `20260521120000-add-pdf-panel-range-keys-to-quotation-products.js` | `pdfPanelRangeKey`, `pdfDcrPanelRangeKey`, `pdfNonDcrPanelRangeKey` |
| `20260520120000-add-notes-to-customers.js` | `customers.notes` for calling → quotation prefill |

Optional: `TZ=Asia/Kolkata` if weekly HR reports must match SPA Mon–Sun in IST.

**Not required on backend:** logout console noise (frontend); dealer analytics date filter (client-side on queue `recentActions`).

---

## 1. HR uploaded leads — live counts (§7.8)

**Status: implemented**

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/hr/leads/uploads` | Live `assignedCount`, `unassignedCount`, `completedCount` (SQL, not upload-time `assigned`) |
| `GET` | `/api/hr/leads/uploads/:uploadId` | Full-batch counts + paginated rows with assignee fields |
| `POST` | `/api/hr/leads/upload-csv` | `assignedAtUpload` / `queuedAtUpload` only on POST |

**Invariant:** `assignedCount + unassignedCount + completedCount === rowCount`

**QA:** Upload 1000, 3 at upload → GET `assignedCount: 3`, `unassignedCount: 997`; modal queued rows match header.

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

**Allowed values:** `waaree_540_560_bifacial`, `waaree_580_700_bifacial_topcon`, `adani_540_580_bifacial`, `adani_610_625_bifacial_topcon` (unknown keys stored as `null`).

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
- **`validUntil`** on create defaults to **`createdAt + 7 days`** (was 5).

**Server PDFs:** use `utils/quotationProductPdfDisplay.ts` (`PDF_PANEL_RANGE_KEYS`, `extractPdfPanelRangeKeysFromProducts`).

**Frontend flow:** create may omit PDF keys on POST; follow-up `PATCH …/products` with range keys — backend must accept that PATCH (this implementation).

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

### QA

1. Dealer A → current lead → **Start Call** → **200**, `in_progress`
2. Submit **called** / follow-up → **200**, persisted
3. Dealer B does not get A’s in-progress lead from `/next`
4. `POST …/assign` with `{ assignedDealerId, status: "assigned" }` → **200** (frontend retry path)

---

## 4. Calling remarks, queue tabs & start vs submit

**Status: implemented**

### 4.1 Remarks on `PATCH …/calling-queue/{leadId}/action`

Accepts: `callRemark` / `call_remark`, `statusCategory` / `status_category`, `statusText` / `status_text`, `statusLabel`, `remark`, tagged `[category] label | free text`.

- **`start`:** remark optional; sets `in_progress` + assignee.
- **Outcomes** (`called`, `follow_up`, `not_interested`, `rescheduled`): require `callRemark` **or** `statusCategory` + `statusText` (unless `editMode`).
- Persists on assignment + `calling_action_history`; echoed on GET queue/history.

### 4.2 Customer note

`PATCH /api/dealers/me/calling-queue/{leadId}` with body `{ "customerNote": "..." }` only (no assign fields) → updates `calling_leads.customerNote`.

### 4.3 Quotation prefill

`POST /api/customers` accepts optional `notes` and `remarks` (same value). Migration: `20260520120000-add-notes-to-customers.js`.

### 4.4 Queue tab arrays (`GET …/next` & `/current`)

| Key | Tab |
|-----|-----|
| `scheduledLeads`, `upcomingFollowUps`, `rescheduledLeads` | Scheduled (future `nextFollowUpAt`) |
| `dialledActions` | Dialled (excludes future scheduled follow-ups) |
| `connectedActions` / `notConnectedActions` | Connected / Not connected subsets |
| `recentActions` / `actionHistory` | Analytics / history |

### 4.5 `start` vs completion response

| Action | Response |
|--------|----------|
| `start` | `lead` + `currentLead` (same row, `in_progress`) + `counts` — **no** `nextLead`, **no** full queue snapshot |
| Outcomes | Full queue snapshot + `nextLead` = new queue head after promote |

### QA

1. Submit with remarks → visible in history GET.
2. Scheduled tab ≠ Dialled (no future follow-ups only under Dialled).
3. Double **Start** → same lead until Submit.
4. **Create Quotation** from calling → customer `notes` saved.
5. `PATCH` customer note on lead → echoed on next queue GET.

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

**File fields:** `aadharFront`, `aadharBack`, `compliantAadharFront`, `compliantAadharBack`, `compliantPanImage`, `compliantBankPassbookImage`, `panImage`, `electricityBillImage`, `bankPassbookImage`, `geotagRoofPhoto`, `customerWithHousePhoto`, `propertyDocumentPdf`, plus final-confirmation files when used.

**Text fields:** `isCompliantSenior`, `aadharNumber`, `phoneNumber`, `emailId`, `panNumber`, `electricityKno`, bank block, compliant block, etc.

### `GET /api/quotations/{quotationId}/documents/zip`

- **Auth:** dealer (own rows) / admin; account-management/hr on approved quotations.
- Streams ZIP via S3 IAM (`fetchS3ObjectBuffer`); includes manifest `document-details.txt`; missing files noted, not fatal.
- **Headers:** `Content-Type: application/zip`, `Content-Disposition: attachment; filename="<Customer>-<QuotationId>.zip"`, `Cache-Control: no-store`.

### Presign helper (optional client refresh)

- `GET /api/quotations/{quotationId}/documents/view-url?url=…`
- `GET /api/quotations/{quotationId}/documents/presign-url?url=…`

---

## 9. Frontend (reference only)

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
| **3** | PDF panel range keys on products | **Done** (+ migrate) |
| **4** | Remarks, tabs, start vs submit, customer note | **Done** (+ customer `notes` migrate) |
| **5** | HR/Admin `GET` calling-actions (`dealerId`, dates, `custom`, aliases) | **Done** — §4.8 |
| **6** | Quotation create stability | **Done** — §5 |

### HR/Admin GET example

```http
GET /api/hr/calling-actions?limit=2000&dealerId={uuid}&range=weekly&startDate=2026-05-19T00:00:00.000Z&endDate=2026-05-25T23:59:59.999Z
```

When both `startDate` and `endDate` are sent, filtering uses that window on `action_at` (legacy rows may fall back to `created_at`). `range=weekly` without dates uses **Mon–Sun** in server local TZ.

**Assignee rule:** `assignedDealerId` = who is calling; `dealerId` on lead = uploader/CRM only.

---

## Related docs

| Doc | Section |
|-----|---------|
| `BACKEND_CHANGES_REQUIRED.md` | §7.7–7.8, dealer queue, §J, §X |
| `BACKEND_ADMIN_QUOTATION_STATUS.ts` | Reference contracts |

