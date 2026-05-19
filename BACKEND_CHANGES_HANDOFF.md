# Backend changes handoff (May 2026)

Action items from recent frontend work. Full detail: `BACKEND_CHANGES_REQUIRED.md` (**§7.7–7.8**, dealer queue ~2307, **§X**). Reference: `BACKEND_ADMIN_QUOTATION_STATUS.ts`, `controllers/callingLeadController.ts`, `utils/quotationProductPdfDisplay.ts`.

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

If `assignedDealerId` ≠ authenticated dealer → **`LEAD_004`**.

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

## 4. Frontend (reference only)

| File | Role |
|------|------|
| `lib/calling-lead-assignee.ts` | Assignee + `LEAD_004` detection |
| `lib/api.ts` | `claimCallingLead`, `assignCallingLeadToMe`, action retries |
| `app/dashboard/calling-data/page.tsx` | Dial + assign retries; optimistic UI if `LEAD_004` |
| `lib/hr-upload-lead-display.ts` | HR count/table labels |
| `lib/quotation-pdf-display.ts` | PDF display helpers |

---

## Priority summary for backend team

| Priority | Topic | Status |
|----------|--------|--------|
| **1** | Calling queue `LEAD_004` | **Done** — A + B (claim/assign/patch) + C |
| **2** | HR upload live counts | **Done** |
| **3** | PDF flags on products | **Done** (+ migrate) |

---

## Related docs

| Doc | Section |
|-----|---------|
| `BACKEND_CHANGES_REQUIRED.md` | §7.7–7.8, dealer queue, §X |
| `BACKEND_ADMIN_QUOTATION_STATUS.ts` | Reference contracts |
