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
 *   PATCH /hr/leads/uploads/:uploadId/dealers
 *     body: { "dealerIds": ["…full pool…"], "mode": "replace" }
 *     → replace upload.dealerIds (eligible pool). Does NOT reassign completed leads.
 *     Then FE calls assign-unassigned with active_cap (1 lead / dealer).
 *   POST /hr/leads/uploads/:uploadId/assign-unassigned
 *     body: {
 *       "assignmentMode": "active_cap",
 *       "activeLimitPerDealer": 1,
 *       "rebalance": true
 *     }
 *     → at most 1 open Assigned per dealer; excess → Unassigned; rest stay Unassigned.
 *     Do NOT default to round_robin_all (that created Assigned: 4916).
 *   POST /hr/leads/uploads/:uploadId/add-dealers  (legacy merge-only)
 *     body: { "dealerIds": ["dealer-uuid-2"], "mode": "add" }
 *   POST /hr/leads/upload-csv
 *     multipart (default / working path):
 *       file, dealerIds[], activeLimitPerDealer=1
 *       (SPA does NOT send oversized limits — Zod rejects >50 with
 *        "Too big: expected number to be <=50")
 *     optional: assignmentMode=round_robin_all → ONLY if product explicitly wants
 *       Unassigned → 0 at upload (NOT the Manage dealers / Calling FIFO path)
 *   GET  /dealers/me/calling-queue/next   ← MUST return dealer’s next assigned lead
 *   GET  /dealers/me/calling-queue/current ← MUST 200 (never SYS_001)
 *
 * =============================================================================
 * 0) NEW ROUTE — add dealers to an existing upload pool
 * =============================================================================
 *
 *   POST /api/hr/leads/uploads/:uploadId/add-dealers
 *   Auth: HR role
 *   Body: { dealerIds: string[], mode?: "add" }
 *
 *   Behavior (mode "add"):
 *   - Load upload by id.
 *   - Validate every dealerId exists and is active.
 *   - Merge into upload.dealerIds (dedupe). Persist.
 *   - Do not change lead assigned_dealer_id / status.
 *   - Return { dealerIds: string[], dealers?: {id,name}[] }
 *
 *   Preferred for HR UI "Add dealers" / Manage dealers:
 *   PATCH /api/hr/leads/uploads/:uploadId/dealers
 *   Body: { dealerIds: string[], mode: "replace" }
 *   → replace full pool. FE then calls assign-unassigned if Unassigned > 0.
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
 *   - Default assignmentMode = active_cap, activeLimitPerDealer = 1.
 *   - Load upload.dealerIds (pool from upload / Manage dealers replace).
 *   - If rebalance: keep oldest N open assigned per dealer; return excess to Unassigned.
 *   - Top up dealers under the cap from Unassigned (oldest first).
 *   - Do NOT touch Completed rows.
 *   - After active_cap: assignedCount ≈ dealers × limit (not full rowCount).
 *
 * Success response (SPA reads these keys):
 *
 * {
 *   "success": true,
 *   "uploadId": "<uuid>",
 *   "assignmentMode": "active_cap",
 *   "activeLimitPerDealer": 1,
 *   "assigned": 7,
 *   "released": 4909,
 *   "unassignedRemaining": 4910,
 *   "unassignedCount": 4910,
 *   "assignedCount": 7,
 *   "completedCount": 1,
 *   "rowCount": 4918,
 *   "counts": { "assigned": 7, "unassigned": 4910, "completed": 1 }
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
 * PATCH /hr/leads/uploads/:uploadId/dealers
 * Body: { dealerIds: string[], mode?: "replace" | "add" }
 * Also usable for POST …/add-dealers (default mode "add" via postHrLeadsUploadAddDealers).
 * Product: BACKEND_MANAGE_DEALERS.md
 */
export async function patchHrLeadsUploadDealers(req, res, db) {
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

    const mode = String(req.body?.mode || "replace").trim().toLowerCase()
    const incoming = asArray(req.body?.dealerIds ?? req.body?.dealer_ids)
      .map(String)
      .map((s) => s.trim())
      .filter(Boolean)

    if (incoming.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: "VAL_002", message: "Select at least one dealer" },
      })
    }

    const uniqueIncoming = Array.from(new Set(incoming))
    for (const dealerId of uniqueIncoming) {
      const dealer = await db.dealers.findById(dealerId)
      const active =
        dealer &&
        (dealer.isActive === true ||
          dealer.is_active === true ||
          String(dealer.status || "").toLowerCase() === "active" ||
          dealer.status == null)
      if (!dealer || !active) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VAL_003",
            message: `Dealer not found or inactive: ${dealerId}`,
          },
        })
      }
    }

    const existing = asArray(upload.dealerIds ?? upload.dealer_ids)
      .map(String)
      .filter(Boolean)

    const nextDealerIds =
      mode === "add"
        ? Array.from(new Set([...existing, ...uniqueIncoming]))
        : uniqueIncoming

    await db.hrLeadUploads.updateById(uploadId, {
      dealerIds: nextDealerIds,
      dealer_ids: nextDealerIds,
    })

    const dealers = []
    for (const id of nextDealerIds) {
      const d = await db.dealers.findById(id)
      if (!d) continue
      const name =
        d.name ||
        [d.firstName ?? d.first_name, d.lastName ?? d.last_name].filter(Boolean).join(" ").trim() ||
        id
      dealers.push({ id, name })
    }

    return res.status(200).json({
      success: true,
      uploadId,
      dealerIds: nextDealerIds,
      dealers,
      mode: mode === "add" ? "add" : "replace",
    })
  } catch (error) {
    console.error("[upload-dealers]", error)
    return res.status(500).json({
      success: false,
      error: { code: "SYS_001", message: "Internal error" },
    })
  }
}

/** POST …/add-dealers — same handler; defaults mode to "add". */
export async function postHrLeadsUploadAddDealers(req, res, db) {
  if (req.body == null) req.body = {}
  if (req.body.mode == null) req.body.mode = "add"
  return patchHrLeadsUploadDealers(req, res, db)
}

/**
 * POST /hr/leads/uploads/:uploadId/assign-unassigned
 *
 * Product rule (Chairbord Calling FIFO):
 *   - Each dealer in upload.dealerIds may have at most activeLimitPerDealer open leads
 *     (default 1). Status assigned/in_progress count toward the cap.
 *   - Remaining rows stay Unassigned until a dealer Completes and claims the next.
 *   - Do NOT use round_robin_all here for Manage dealers — that dumps every row into Assigned.
 *
 * Body (SPA default):
 *   {
 *     "assignmentMode": "active_cap",
 *     "activeLimitPerDealer": 1,
 *     "rebalance": true
 *   }
 *
 * Steps:
 *   1) If rebalance: for each dealer, keep the oldest N open assigned leads; clear
 *      assignee on the rest → status back to queued/unassigned (Completed untouched).
 *   2) Top up: while any dealer has openCount < N and Unassigned remains, assign
 *      oldest Unassigned to that dealer (round-robin across dealers under cap).
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

    const dealerIds = asArray(upload.dealerIds ?? upload.dealer_ids)
      .map(String)
      .filter(Boolean)
    if (dealerIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VAL_002",
          message: "Upload has no dealer pool — re-upload with dealers selected",
        },
      })
    }

    const mode = String(req.body?.assignmentMode || "active_cap")
      .trim()
      .toLowerCase()
    const assignAll = mode === "round_robin_all" || mode === "round-robin-all"
    const requested = Number(req.body?.activeLimitPerDealer ?? req.body?.activeLeadsLimit)
    const activeLimit = assignAll
      ? Number.MAX_SAFE_INTEGER
      : Number.isFinite(requested) && requested > 0
        ? Math.min(50, Math.floor(requested))
        : 1
    const rebalance = req.body?.rebalance !== false && !assignAll

    const allLeads = await db.hrLeads.findAllByUploadId(uploadId)
    const openAssignedByDealer = new Map()
    for (const id of dealerIds) openAssignedByDealer.set(String(id), [])

    for (const lead of allLeads) {
      const status = String(lead.status || "").trim().toLowerCase()
      if (DONE.has(status)) continue
      if (isUnassignedLead(lead)) continue
      const dealerId = String(lead.assigned_dealer_id ?? lead.assignedDealerId ?? "").trim()
      if (!dealerId || !openAssignedByDealer.has(dealerId)) continue
      openAssignedByDealer.get(dealerId).push(lead)
    }

    let released = 0
    if (rebalance) {
      for (const dealerId of dealerIds) {
        const open = openAssignedByDealer.get(String(dealerId)) || []
        open.sort((a, b) => {
          const ta = new Date(a.assigned_at || a.assignedAt || a.created_at || a.createdAt || 0).getTime()
          const tb = new Date(b.assigned_at || b.assignedAt || b.created_at || b.createdAt || 0).getTime()
          return ta - tb
        })
        const keep = open.slice(0, activeLimit)
        const excess = open.slice(activeLimit)
        openAssignedByDealer.set(String(dealerId), keep)
        for (const lead of excess) {
          await db.hrLeads.updateById(lead.id, {
            assignedDealerId: null,
            assigned_dealer_id: null,
            assignedAt: null,
            assigned_at: null,
            status: "queued",
          })
          released += 1
        }
      }
    }

    const refreshedAfterRebalance = rebalance
      ? await db.hrLeads.findAllByUploadId(uploadId)
      : allLeads

    const unassigned = refreshedAfterRebalance
      .filter(isUnassignedLead)
      .sort((a, b) => {
        const ta = new Date(a.queued_at || a.queuedAt || a.created_at || a.createdAt || 0).getTime()
        const tb = new Date(b.queued_at || b.queuedAt || b.created_at || b.createdAt || 0).getTime()
        return ta - tb
      })

    const openCount = new Map()
    for (const id of dealerIds) {
      openCount.set(String(id), (openAssignedByDealer.get(String(id)) || []).length)
    }
    // Recount from DB if we rebalanced
    if (rebalance) {
      for (const id of dealerIds) openCount.set(String(id), 0)
      for (const lead of refreshedAfterRebalance) {
        const status = String(lead.status || "").trim().toLowerCase()
        if (DONE.has(status) || isUnassignedLead(lead)) continue
        const dealerId = String(lead.assigned_dealer_id ?? lead.assignedDealerId ?? "").trim()
        if (openCount.has(dealerId)) openCount.set(dealerId, (openCount.get(dealerId) || 0) + 1)
      }
    }

    let assigned = 0
    let cursor = 0
    for (const lead of unassigned) {
      let picked = null
      for (let i = 0; i < dealerIds.length; i += 1) {
        const idx = (cursor + i) % dealerIds.length
        const dealerId = String(dealerIds[idx])
        if ((openCount.get(dealerId) || 0) < activeLimit) {
          picked = dealerId
          cursor = idx + 1
          break
        }
      }
      if (!picked) break

      await db.hrLeads.updateById(lead.id, {
        assignedDealerId: picked,
        assigned_dealer_id: picked,
        assignedAt: new Date(),
        assigned_at: new Date(),
        status: "assigned",
      })
      openCount.set(picked, (openCount.get(picked) || 0) + 1)
      assigned += 1
    }

    const refreshed = await db.hrLeads.findAllByUploadId(uploadId)
    const counts = computeHrUploadLeadCounts(refreshed)

    return res.status(200).json({
      success: true,
      uploadId,
      assignmentMode: assignAll ? "round_robin_all" : "active_cap",
      activeLimitPerDealer: assignAll ? null : activeLimit,
      assigned,
      released,
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

export default {
  postHrLeadsUploadAssignUnassigned,
  computeHrUploadLeadCounts,
  resolveActiveLimitFromUploadBody,
  isUnassignedLead,
}
