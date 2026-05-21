# Backend changes handoff (May 2026)

**Single handoff doc for the API team.** Full specs: `BACKEND_CHANGES_REQUIRED.md` (§7.8, dealer queue §E–§H, §J, §X, §Y). Reference contracts: `BACKEND_ADMIN_QUOTATION_STATUS.ts`. Implementation: `controllers/callingLeadController.ts`, `controllers/quotationController.ts`, `controllers/customerController.ts`, `utils/quotationProductPdfDisplay.ts`.

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
| 9 | Medium | PDF flags on products (not in validation) | **Done** | §2 |
| 10 | Medium | Quotation create stability | **Done** | §5 |

**Deploy before QA:**

```bash
yarn migrate
```

| Migration | Purpose |
|-----------|---------|
| `20260519120000-add-pdf-display-flags-to-quotation-products.js` | `pdfUsePanelSizeRange`, `pdfUseInverterBrandOptions` |
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

## 2. Quotation PDF display flags (§X)

**Status: implemented** — run `yarn migrate` if columns missing.

| Field | PDF when `true` |
|-------|-----------------|
| `pdfUsePanelSizeRange` | **540W-620W** |
| `pdfUseInverterBrandOptions` | **Inverter Brand- Vsole/Xwatt/Saatvik** |

- `POST` / `PATCH …/products` / `GET` quotations — persist and echo on `quotation_products`
- Not used in pricing or `validateProductSelection`
- Server PDFs: use `utils/quotationProductPdfDisplay.ts` if API generates PDFs

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

## 6. Frontend (reference only)

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
| **3** | PDF flags on products | **Done** (+ migrate) |
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
