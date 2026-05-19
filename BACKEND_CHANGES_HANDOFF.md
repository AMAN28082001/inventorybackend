# Backend changes handoff (May 2026)

Action items from recent frontend work. Full detail: `BACKEND_CHANGES_REQUIRED.md` (**§7.7–7.8**, dealer queue ~2307, **§X**). Reference: `BACKEND_ADMIN_QUOTATION_STATUS.ts`, `controllers/callingLeadController.ts`.

---

## 1. HR uploaded leads — live counts (§7.8)

**Status: implemented**

- `GET /api/hr/leads/uploads` — SQL aggregates; `assignedCount` / `unassignedCount` / `completedCount` (not upload-time `assigned`)
- `GET /api/hr/leads/uploads/:batchId` — full-batch counts + paginated rows
- `POST /api/hr/leads/upload-csv` — `assignedAtUpload` / `queuedAtUpload`
- Latest assignment per lead in count SQL; `dla.status::text` for enum safety

---

## 2. Quotation PDF display flags (§X)

**Status: implemented** (run `yarn migrate` if columns missing)

- `pdfUsePanelSizeRange`, `pdfUseInverterBrandOptions` on `quotation_products`
- Create / PATCH products + GET echo; not used in pricing/validation

---

## 3. Dealer calling queue — `LEAD_004` on Start Call

**Status: implemented**

### Problem

`GET /dealers/me/calling-queue/next` could show a pool lead, but `PATCH .../action` with `start` returned **403 / `LEAD_004`** when no `dealer_lead_assignments` row existed for that dealer.

### Backend behavior (A + B + C)

| Option | Implementation |
|--------|----------------|
| **A — Auto-assign on `start`** | `PATCH /api/dealers/me/calling-queue/:leadId/action` with `action: "start"` claims eligible pool leads (creates assignment + moves to `in_progress`) |
| **B — Claim endpoint** | `POST /api/dealers/me/calling-queue/:leadId/claim` |
| **C — Assign in `/next`** | `buildCallableQueue` runs `promoteQueuedLeadIfSlotAvailable` before returning queue |

### Optional body hints (honored on `start` or when `claim` / `autoAssign` is true)

```json
{
  "action": "start",
  "claim": true,
  "autoAssign": true,
  "assignedDealerId": "<dealer-uuid-from-jwt>"
}
```

If `assignedDealerId` is sent and does not match the authenticated dealer → `LEAD_004`.

### Assignee fields

- `assignedDealerId` / `assigned_dealer_id` = calling assignee (must match JWT dealer id when set)
- `dealerId` / `dealerName` on lead = CRM/uploader only — not used for queue ownership

### Rules

- Lead already assigned to **another** dealer → `LEAD_004` (no steal)
- No assignment + dealer in upload pool → create assignment for this dealer
- `/next` and `/current` return the same snapshot; queue rows always include `assignedDealerId` for the authenticated dealer

### QA

1. Dealer opens Calling Data → current lead visible
2. **Start Call** → **200**, status `in_progress` (no `LEAD_004`)
3. Second dealer cannot start the same in-progress lead
4. Pool lead: first `start` assigns; second dealer gets `LEAD_004` or a different lead

---

## 4. Frontend (reference)

| File | Role |
|------|------|
| `lib/calling-lead-assignee.ts` | Assignee normalization + `LEAD_004` detection |
| `lib/api.ts` | `claimCallingLead`, `updateCallingLeadAction` retries |
| `app/dashboard/calling-data/page.tsx` | Queue filter + claim retry |
| `app/dashboard/hr/page.tsx` | HR upload counts UI |

---

## Related docs

| Doc | Section |
|-----|---------|
| `BACKEND_CHANGES_REQUIRED.md` | §7.7–7.8, dealer queue, §X |
| `BACKEND_ADMIN_QUOTATION_STATUS.ts` | Reference contracts |
