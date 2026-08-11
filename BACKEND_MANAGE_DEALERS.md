# Backend — HR Manage dealers (Uploaded Data)

**Frontend:** HR → Uploaded Data → **Add dealers**  
**Code:** `app/dashboard/hr/page.tsx` · `lib/api.ts` (`updateUploadDealerPool`, `assignUnassignedLeads`)  
**Related:** `BACKEND_ASSIGN_UNASSIGNED.ts` · HANDOFF §15-C · dealer queue `BACKEND_CALLING_QUEUE_CURRENT.ts`

HR no longer has a separate **Assign unassigned** button.  
**Add dealers** = pick the batch pool (check/uncheck) → save → FE calls **active_cap** assign (1 open lead per dealer). Rest stay **Unassigned** until Complete → `/next`.

**Bug to fix:** `assignmentMode: "round_robin_all"` dumped every row into Assigned (e.g. Assigned **4916**). That mode must **not** be the default for Manage dealers.

---

## Must ship

| # | Deliverable | If missing |
|---|-------------|------------|
| **A** | `PATCH /hr/leads/uploads/:uploadId/dealers` with `mode: "replace"` | Toast: could not update dealers / 404 |
| **B** | Persist full `dealerIds[]` on the upload (replace, not merge-only) | Unchecked dealers stay on the batch |
| **C** | `POST …/assign-unassigned` with **`active_cap` + `rebalance`** (1 lead/dealer) | Assigned stays ~full CSV size; Unassigned never recovers |
| **D** | GET uploads list returns updated `dealerIds` / names + counts | UI badges/names stale after save |
| **E** | Dealer `GET …/calling-queue/next` claims next Unassigned after Complete | Dealer stuck after finishing 1 lead |

Optional: `POST …/add-dealers` with `mode: "replace"`. Prefer **A**.

---

## A) Replace dealer pool (required)

```http
PATCH /api/hr/leads/uploads/:uploadId/dealers
Authorization: Bearer <HR token>
Content-Type: application/json

{
  "dealerIds": ["dealer-uuid-1", "dealer-uuid-2"],
  "mode": "replace"
}
```

### Aliases FE tries on 404/405/501 (same body)

1. `POST /hr/leads/uploads/:uploadId/add-dealers` — `{ dealerIds, mode: "replace" }` (FE tries this first)
2. `PATCH /hr/leads/uploads/:uploadId/dealers`
3. `POST /hr/calling-uploads/:uploadId/add-dealers`
4. `PATCH /hr/calling-uploads/:uploadId/dealers`
5. `PATCH /hr/leads/uploads/:uploadId` — body `{ dealerIds }`
6. `PUT /hr/uploads/:uploadId/dealers`
7. `PATCH /admin/leads/uploads/:uploadId/dealers`

Ship **one** primary route; aliases are fallbacks only.

### Rules

1. Auth: HR role.
2. Load upload by `:uploadId`. 404 if missing.
3. `dealerIds` must be a non-empty array of active dealer UUIDs. Empty → `400 VAL_002`.
4. Validate every id exists and is active.
5. **`mode: "replace"`:** set `upload.dealerIds = unique(dealerIds)` — **overwrite**, do not merge.
6. Do **not** change Completed leads.
7. Do **not** auto-assign here (FE calls assign-unassigned next).
8. Return updated pool + names.

### Success response

```json
{
  "success": true,
  "uploadId": "<uuid>",
  "dealerIds": ["dealer-uuid-1", "dealer-uuid-2"],
  "dealers": [
    { "id": "dealer-uuid-1", "name": "Himani Sharma" },
    { "id": "dealer-uuid-2", "name": "Kiran Choudhary" }
  ]
}
```

### Errors

| Status | Code | When |
|--------|------|------|
| 401 | `AUTH_003` | Not HR |
| 404 | `NOT_001` | Upload missing |
| 400 | `VAL_002` | Empty / invalid dealerIds |
| 400 | `VAL_003` | Dealer inactive or not found |

---

## B) Legacy merge-only (optional)

```http
POST /api/hr/leads/uploads/:uploadId/add-dealers
{ "dealerIds": ["new-uuid"], "mode": "add" }
```

If you already have add-dealers, support both modes:

```ts
if (mode === "replace") {
  upload.dealerIds = unique(body.dealerIds)
} else {
  upload.dealerIds = unique([...existing, ...body.dealerIds])
}
```

---

## C) Assign unassigned — **active_cap + rebalance** (required)

```http
POST /api/hr/leads/uploads/:uploadId/assign-unassigned
Authorization: Bearer <HR token>
Content-Type: application/json

{
  "assignmentMode": "active_cap",
  "activeLimitPerDealer": 1,
  "rebalance": true
}
```

Aliases FE tries: `/hr/calling-uploads/…`, `/hr/uploads/…`, `/admin/leads/uploads/…`.

### Product rule

| Badge | Meaning |
|-------|---------|
| **Assigned** | At most **1** open lead **per dealer** in the pool |
| **Unassigned** | Everyone else waiting in the FIFO queue |
| **Completed** | Finished calling — never touched by this API |

Example: 7 dealers, 4918 rows, 1 completed → **Assigned ≈ 7**, **Unassigned ≈ 4910**, **Completed = 1**.  
**Wrong:** Assigned 4916 (that was `round_robin_all`).

### Algorithm

1. Load `upload.dealerIds`. Empty → `400 VAL_002`.
2. **`rebalance: true`:** for each dealer, keep the **oldest** `N` open Assigned/in_progress leads (`N = activeLimitPerDealer`, default 1). Clear assignee on the rest → status `queued` / Unassigned. **Do not touch Completed.**
3. **Top up:** while any pool dealer has open count `< N` and Unassigned remains, assign oldest Unassigned to that dealer (round-robin among dealers under cap).
4. Return counts. `assignedCount` must be ≈ `dealers × N`, **not** `rowCount`.

### Do / Don't

| Do | Don't |
|----|-------|
| Default `assignmentMode` = `active_cap`, limit = **1** | Default to `round_robin_all` for this UI |
| Honor `rebalance: true` to fix over-assigned batches | Leave Assigned 4916 after HR re-saves |
| Cap Zod `activeLimitPerDealer` at **≤ 50** | Ignore body and assign every row |

### Success response

```json
{
  "success": true,
  "uploadId": "<uuid>",
  "assignmentMode": "active_cap",
  "activeLimitPerDealer": 1,
  "assigned": 7,
  "released": 4909,
  "unassignedRemaining": 4910,
  "unassignedCount": 4910,
  "assignedCount": 7,
  "completedCount": 1,
  "rowCount": 4918,
  "counts": { "assigned": 7, "unassigned": 4910, "completed": 1 }
}
```

`released` = excess Assigned rows returned to Unassigned during rebalance.

### Errors

| Status | Code | When |
|--------|------|------|
| 401 | `AUTH_003` | Not HR |
| 404 | `NOT_001` | Upload missing |
| 400 | `VAL_002` | No dealer pool |

---

## D) Frontend call order

```
1. PATCH/POST …/dealers|add-dealers  { dealerIds: selected[], mode: "replace" }
2. POST …/assign-unassigned  { assignmentMode: "active_cap", activeLimitPerDealer: 1, rebalance: true }
3. Refresh uploads list
```

Save closes the dialog after step 1; step 2 runs in the background.

---

## E) After Complete → next lead (dealer queue)

When a dealer completes their 1 Assigned lead:

1. Mark Completed.
2. `GET /dealers/me/calling-queue/next` must assign the oldest Unassigned from uploads where dealer ∈ `upload.dealerIds` (or return their next already-Assigned lead).
3. Never 500 `SYS_001` on `/current` or `/next`.

Full queue reference: `BACKEND_CALLING_QUEUE_CURRENT.ts`.

---

## Acceptance checklist

- [ ] Add dealers Save → pool names update (unchecked dealers removed)
- [ ] Large batch after Save: **Assigned ≈ # dealers**, **not** full row count
- [ ] Re-save over-assigned batch (Assigned 4916) → `released` > 0, Assigned drops to ≈ # dealers
- [ ] Completed count unchanged
- [ ] Dealer Completes → `/next` gives another Unassigned lead
- [ ] Empty `dealerIds` rejected

---

## Reference implementation

`BACKEND_ASSIGN_UNASSIGNED.ts`:

- `patchHrLeadsUploadDealers` / `postHrLeadsUploadAddDealers`
- `postHrLeadsUploadAssignUnassigned` — **active_cap + rebalance**
