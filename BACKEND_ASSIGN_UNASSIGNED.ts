// @ts-nocheck
/**
 * =============================================================================
 * BACKEND REFERENCE — Drain Unassigned → Assigned (Jul 2026)
 * =============================================================================
 *
 * Handoff: BACKEND_CHANGES_HANDOFF.md §15-C
 * Also in: BACKEND_ADMIN_QUOTATION_STATUS.ts (postHrLeadsUploadAssignUnassigned)
 * Related: BACKEND_CALLING_QUEUE_CURRENT.ts (§15-A/B dealer queue)
 *
 * SHIPPED in this repo (controllers/callingLeadController.ts):
 *   POST /api/hr/leads/uploads/:uploadId/assign-unassigned → assignHrUploadUnassigned
 *   Aliases: /hr/uploads/…, /hr/calling-uploads/…, /admin/leads/uploads/…
 *   Upload CSV honors assignmentMode=round_robin_all (ignore activeLimitPerDealer)
 *   Zod: activeLimitPerDealer / activeLeadsLimit = 1..50 (SPA sends 1)
 *   §15-C-2: uploadCallingLeadsCsv hardened — never opaque 500 on Assign Leads
 *     (dealer VAL_002, parse VAL_001, SAVEPOINT per-row, chunk 500, SYS_001+message)
 *   GET /dealers/me/calling-queue/current|/next — always 200; never SYS_001
 *
 * Product (live screenshot Jul 2026):
 *   Top batch: Unassigned 193 + Assigned 37 + Completed 2370 = 2600
 *   Goal ANYHOW: Unassigned → 0 AND Assigned → 0 (Completed absorbs them).
 *   Dealers (Himani, Kiran, Harshita, …) must see remaining leads in
 *   Calling Data → Current Lead — NOT "No calling data pending for you."
 *
 * Drain order (required):
 *   1) Unassigned → Assigned (HR assign-unassigned OR dealer /next claim)
 *      → yellow badge 0
 *   2) Assigned → Completed (dealer works Current Lead one-by-one via /next)
 *      → blue badge 0
 *   3) Repeat across ALL uploads oldest-first until every batch is 0 / 0 / rows
 *
 * Frontend already calls:
 *   POST /hr/leads/uploads/:uploadId/assign-unassigned
 *     body: { "assignmentMode": "round_robin_all" }
 *   POST /hr/leads/upload-csv
 *     multipart (default / working path):
 *       file, dealerIds[], activeLimitPerDealer=1
 *       (SPA does NOT send oversized limits — Zod rejects >50 with
 *        "Too big: expected number to be <=50")
 *     optional: assignmentMode=round_robin_all → backend MUST ignore the
 *       numeric cap and assign EVERY created row (Unassigned → 0 at upload)
 *   GET  /dealers/me/calling-queue/next   ← MUST return dealer’s next assigned lead
 *   GET  /dealers/me/calling-queue/current ← MUST 200 (never SYS_001)
 *
 * =============================================================================
 * 1) NEW ROUTE — assign remaining unassigned for one upload
 * =============================================================================
 *
 * POST /api/hr/leads/uploads/:uploadId/assign-unassigned
 * Auth: HR JWT
 *
 * Optional aliases (SPA tries these on 404):
 *   POST /api/hr/calling-uploads/:uploadId/assign-unassigned
 *   POST /api/hr/uploads/:uploadId/assign-unassigned
 *   POST /api/admin/leads/uploads/:uploadId/assign-unassigned
 *
 * Rules:
 *   - Load upload.dealerIds (pool selected at upload time).
 *   - Find all leads in that upload that are still Unassigned:
 *       assigned_dealer_id IS NULL / '' / sentinel
 *       OR status IN ('queued','pending','open') with no real assignee
 *       AND status NOT IN ('completed','done','closed','complete')
 *   - Order by COALESCE(queued_at, created_at) ASC (FCFS within batch).
 *   - Round-robin assign to upload.dealerIds.
 *   - Set status = 'assigned', assigned_at = NOW(), assigned_dealer_id = <dealer>.
 *   - Do NOT touch Completed rows.
 *   - After: unassignedCount MUST be 0 (unless dealerIds empty → 400).
 *
 * Success response (SPA reads these keys):
 *
 * {
 *   "success": true,
 *   "uploadId": "<uuid>",
 *   "assigned": 193,
 *   "unassignedRemaining": 0,
 *   "unassignedCount": 0,
 *   "assignedCount": 230,
 *   "completedCount": 2370,
 *   "rowCount": 2600,
 *   "counts": { "assigned": 230, "unassigned": 0, "completed": 2370 }
 * }
 *
 * Errors:
 *   401 AUTH_003 — not HR
 *   404 NOT_001 — upload missing
 *   400 VAL_002 — upload has no dealerIds
 */

const DONE = new Set(["completed", "done", "closed", "complete"])
const UNASSIGNED_SENTINELS = new Set([
  "",
  "unassigned",
  "null",
  "none",
  "-",
  "na",
  "n/a",
  "pool",
  "open",
])

function asArray(value) {
  if (Array.isArray(value)) return value
  if (value == null || value === "") return []
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed
    } catch {
      /* ignore */
    }
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return [value]
}

function isUnassignedLead(lead) {
  const status = String(lead.status || "").trim().toLowerCase()
  if (DONE.has(status)) return false
  const assignee = String(lead.assigned_dealer_id ?? lead.assignedDealerId ?? "")
    .trim()
    .toLowerCase()
  if (!assignee || UNASSIGNED_SENTINELS.has(assignee)) return true
  if (status === "queued" || status === "pending" || status === "open") {
    // Has assignee already → not unassigned for badge purposes
    return !assignee || UNASSIGNED_SENTINELS.has(assignee)
  }
  return false
}

/**
 * Same count rules as GET /hr/leads/uploads badges.
 * Adapt to your computeHrUploadLeadCounts if it already exists.
 */
export function computeHrUploadLeadCounts(leads) {
  const counts = { rowCount: 0, assignedCount: 0, unassignedCount: 0, completedCount: 0 }
  for (const lead of leads || []) {
    counts.rowCount += 1
    const status = String(lead.status || "").trim().toLowerCase()
    if (DONE.has(status)) {
      counts.completedCount += 1
      continue
    }
    if (isUnassignedLead(lead)) {
      counts.unassignedCount += 1
      continue
    }
    counts.assignedCount += 1
  }
  return counts
}

/**
 * POST /hr/leads/uploads/:uploadId/assign-unassigned
 *
 * Live impl: assignHrUploadUnassigned in controllers/callingLeadController.ts
 * (dealer_lead_assignments + calling_leads.batchId — not hr_leads table).
 *
 * Prefer one transaction. Emit socket `calling:uploads-updated` after commit if you have realtime.
 */
export async function postHrLeadsUploadAssignUnassigned(req, res, db) {
  try {
    const user = req.hr ?? req.user
    if (!user || user.role !== "hr") {
      return res.status(401).json({
        success: false,
        error: { code: "AUTH_003", message: "HR required" },
      })
    }

    const uploadId = req.params.uploadId || req.params.id
    const upload = await db.hrLeadUploads.findById(uploadId)
    if (!upload) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_001", message: "Upload not found" },
      })
    }

    const dealerIds = asArray(upload.dealerIds ?? upload.dealer_ids).filter(Boolean)
    if (dealerIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VAL_002",
          message: "Upload has no dealer pool — re-upload with dealers selected",
        },
      })
    }

    const allLeads = await db.hrLeads.findAllByUploadId(uploadId)
    const unassigned = allLeads
      .filter(isUnassignedLead)
      .sort((a, b) => {
        const ta = new Date(a.queued_at || a.queuedAt || a.created_at || a.createdAt || 0).getTime()
        const tb = new Date(b.queued_at || b.queuedAt || b.created_at || b.createdAt || 0).getTime()
        return ta - tb
      })

    let assigned = 0
    let cursor = 0
    for (const lead of unassigned) {
      const dealerId = dealerIds[cursor % dealerIds.length]
      cursor += 1
      await db.hrLeads.updateById(lead.id, {
        assignedDealerId: dealerId,
        assigned_dealer_id: dealerId,
        assignedAt: new Date(),
        assigned_at: new Date(),
        status: "assigned",
      })
      assigned += 1
    }

    const refreshed = await db.hrLeads.findAllByUploadId(uploadId)
    const counts = computeHrUploadLeadCounts(refreshed)

    // Optional: notify HR + dealer clients
    // req.app?.get('io')?.emit('calling:uploads-updated', { uploadId })

    return res.status(200).json({
      success: true,
      uploadId,
      assigned,
      unassignedRemaining: counts.unassignedCount,
      unassignedCount: counts.unassignedCount,
      assignedCount: counts.assignedCount,
      completedCount: counts.completedCount,
      rowCount: counts.rowCount,
      counts: {
        assigned: counts.assignedCount,
        unassigned: counts.unassignedCount,
        completed: counts.completedCount,
      },
    })
  } catch (error) {
    console.error("[assign-unassigned]", error)
    return res.status(500).json({
      success: false,
      error: { code: "SYS_001", message: "Internal error" },
    })
  }
}

/**
 * =============================================================================
 * 2) CHANGE EXISTING UPLOAD — honor assignmentMode=round_robin_all
 * =============================================================================
 *
 * POST /api/hr/leads/upload-csv
 * Multipart fields SPA sends (default Assign Leads):
 *   file | csvFile
 *   dealerIds[] | dealerIds
 *   activeLimitPerDealer | activeLeadsLimit = 1..50  (Zod max 50 — never larger)
 *
 * Optional (when SPA opts into full assign-at-upload):
 *   assignmentMode = "round_robin_all"
 *   → IGNORE activeLimitPerDealer and assign every created row.
 *
 * Patch inside postHrLeadsUploadCsv allocator:
 */

export function resolveActiveLimitFromUploadBody(body) {
  const mode = String(body?.assignmentMode || "")
    .trim()
    .toLowerCase()
  const assignAll = mode === "round_robin_all" || mode === "round-robin-all"
  if (assignAll) return Number.MAX_SAFE_INTEGER

  const requested = Number(body?.activeLimitPerDealer ?? body?.activeLeadsLimit)
  if (Number.isFinite(requested) && requested > 0) return Math.floor(requested)
  return 1 // legacy default
}

/**
 * After creating lead rows, round-robin assign while dealer active count
 * < activeLimitPerDealer. With round_robin_all, limit is MAX_SAFE_INTEGER →
 * every created row gets status='assigned' + assigned_dealer_id.
 *
 * Response must report:
 *   assignedAtUpload / assigned  = created (ideally)
 *   queuedAtUpload / queued      = 0
 *
 * So new batches show Unassigned: 0 immediately on HR Uploaded Data.
 */

/**
 * =============================================================================
 * 3) DEALER QUEUE — WHY HARSHITA SEES EMPTY (must fix)
 * =============================================================================
 *
 * Symptom: HR shows Assigned 37 (Harshita is on the batch) but dealer UI says
 *   "No calling data pending for you."
 *
 * Cause: GET /calling-queue/current → 500 SYS_001 and/or /next returns lead:null
 * without looking up rows where assigned_dealer_id = Harshita’s dealers.id.
 *
 * Required GET /api/dealers/me/calling-queue/next (JWT = dealer):
 *   1) If dealer has status IN ('assigned','in_progress') → return OLDEST
 *      (ORDER BY COALESCE(assigned_at, queued_at, created_at) ASC). Persist nothing.
 *   2) Else claim oldest Unassigned in uploads where dealer ∈ upload.dealerIds
 *      (FOR UPDATE SKIP LOCKED) → set assigned_dealer_id = dealer, status='assigned'.
 *   3) Else 200 { lead: null } — ONLY when this dealer truly has nothing left.
 *
 * Required GET /api/dealers/me/calling-queue/current:
 *   Same as (1) only — never throw SYS_001. Empty → 200 { lead: null }.
 *
 * On PATCH …/action that completes a lead:
 *   Mark completed, then immediately run /next logic and return nextLead
 *   so Assigned count keeps draining without refresh.
 *
 * Full reference: BACKEND_CALLING_QUEUE_CURRENT.ts
 *
 * =============================================================================
 * 3b) OPTIONAL — one-shot drain all uploads (oldest first)
 * =============================================================================
 *
 * POST /api/hr/leads/uploads/assign-all-unassigned
 * Auth: HR
 * Body: { "assignmentMode": "round_robin_all" }
 *
 * Pseudocode:
 *   uploads = findMany ORDER BY uploaded_at ASC
 *   for each upload: run same logic as assign-unassigned
 *   return { success, batchesProcessed, totalAssigned, uploads: [{id, assigned, unassignedCount}] }
 *
 * SPA already loops client-side oldest-first; server bulk is nicer for large DBs.
 */

/**
 * =============================================================================
 * EXPRESS WIRING (example)
 * =============================================================================
 *
 * router.post(
 *   '/hr/leads/uploads/:uploadId/assign-unassigned',
 *   hrAuth,
 *   (req, res) => postHrLeadsUploadAssignUnassigned(req, res, db),
 * )
 *
 * // Keep existing:
 * router.post('/hr/leads/upload-csv', hrAuth, upload.single('file'), postHrLeadsUploadCsv)
 */

/**
 * =============================================================================
 * QA CURLS
 * =============================================================================
 *
 * # Drain one batch (use real upload id from GET /hr/leads/uploads)
 * curl -sS -X POST "$API/hr/leads/uploads/$UPLOAD_ID/assign-unassigned" \
 *   -H "Authorization: Bearer $HR_JWT" \
 *   -H "Content-Type: application/json" \
 *   -d '{"assignmentMode":"round_robin_all"}'
 * # Expect: unassignedCount === 0, assigned === previous unassigned
 *
 * # Confirm badges
 * curl -sS "$API/hr/leads/uploads?limit=200" -H "Authorization: Bearer $HR_JWT"
 * # That upload: unassignedCount 0, assignedCount + completedCount === rowCount
 *
 * # Dealer can pull assigned lead
 * curl -sS "$API/dealers/me/calling-queue/next" -H "Authorization: Bearer $DEALER_JWT"
 * # Expect 200 + lead.assignedDealerId === dealer id (not SYS_001)
 */

/**
 * =============================================================================
 * CHECKLIST (§15-C)
 * =============================================================================
 *
 * [x] Upload with activeLimitPerDealer=1 succeeds (Zod max 50)
 * [x] POST …/assign-unassigned → Unassigned badge 0
 * [x] /current never 500
 * [x] /next returns dealer’s assigned leads until Assigned 0
 * [x] assignmentMode=round_robin_all ignores numeric cap (no need to send >50)
 */

export default {
  postHrLeadsUploadAssignUnassigned,
  computeHrUploadLeadCounts,
  resolveActiveLimitFromUploadBody,
  isUnassignedLead,
}
