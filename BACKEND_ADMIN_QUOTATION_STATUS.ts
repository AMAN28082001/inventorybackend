// @ts-nocheck
/* global Quotation */
// In your server: import { Quotation } from './models/Quotation'
//
// Implemented in this repo:
//   - PATCH /api/admin/quotations/:quotationId/status → controllers/adminController.ts `updateQuotationStatus`
//   - PATCH /api/admin/quotations/:quotationId/file-login → `updateQuotationFileLogin`
//   - JSON shape helpers → utils/quotationApiJson.ts (`quotationPaymentApiFields`, `quotationAdminMetadataFields`)
//   - DB columns → database/migrations/20260411140000-add-quotation-status-history-file-login-subsidy.js
//     + subsidyCheques JSONB, remainingAmount → 20260411150000-add-subsidy-cheques-remaining-amount.js
//   - PATCH /api/quotations/:id/payment-details → updateQuotationPaymentDetails
//     (replaceInstallments / replace / PUT installments → delete-all-then-insert phases; see BACKEND_INSTALLMENT_REPLACE.ts)
//     (subsidyCheques in body, cap total paid vs subtotal, persist remainingAmount)
//
/**
 * =============================================================================
 * BACKEND REFERENCE
 * 1) Admin quotation approval + bank fields + Account Management
 * 2) HR lead upload + DB-backed uploaded-data list + one-by-one assignment
 * =============================================================================
 *
 * Frontend calls (see lib/api.ts):
 *
 *   PATCH /admin/quotations/:quotationId/status
 *   Body when approving:
 *     { status: "approved", paymentType, paymentMode, bankName?, bankIfsc? }
 *   - paymentType and paymentMode are the same value: "loan" | "cash" | "mix"
 *   - For "loan" or "mix", frontend requires bankName + bankIfsc (11-char IFSC)
 *
 *   GET /quotations?status=approved&limit=1000   (Account Management list)
 *   GET /quotations/:id                          (Quotation details dialog)
 *
 *   HR upload/assignment flow:
 *   POST /hr/leads/upload-csv
 *     multipart: file, dealerIds[], activeLimitPerDealer
 *     - frontend now sends activeLimitPerDealer = 1 (single active lead per dealer)
 *   GET /hr/leads/uploads?limit=200
 *     - used by HR "Uploaded Data" tab, must come from DB (not local cache)
 *
 * Each quotation in JSON should expose (camelCase preferred; frontend also reads snake_case):
 *   paymentMode, paymentType (optional), bankName, bankIfsc
 */

const PAYMENT_TYPES = ["loan", "cash", "mix"]
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/

function normalizePaymentType(raw) {
  if (typeof raw !== "string") return null
  const v = raw.trim().toLowerCase()
  return PAYMENT_TYPES.includes(v) ? v : null
}

function normalizeIfsc(raw) {
  if (typeof raw !== "string") return null
  const v = raw.trim().toUpperCase().replace(/\s/g, "")
  return IFSC_REGEX.test(v) ? v : null
}

/**
 * --- DATABASE: quotations table ---
 *
 * PostgreSQL:
 *   ALTER TABLE quotations ADD COLUMN IF NOT EXISTS bank_name VARCHAR(255);
 *   ALTER TABLE quotations ADD COLUMN IF NOT EXISTS bank_ifsc VARCHAR(11);
 *   -- payment_mode often already exists; ensure it can store loan|cash|mix
 *
 * MySQL:
 *   ALTER TABLE quotations ADD COLUMN bank_name VARCHAR(255) NULL;
 *   ALTER TABLE quotations ADD COLUMN bank_ifsc VARCHAR(11) NULL;
 *
 * Sequelize model (example):
 *   bankName: { type: DataTypes.STRING(255), allowNull: true, field: 'bank_name' },
 *   bankIfsc: { type: DataTypes.STRING(11), allowNull: true, field: 'bank_ifsc' },
 *   paymentMode: { type: DataTypes.STRING(20), allowNull: true, field: 'payment_mode' },
 */

/**
 * PATCH /admin/quotations/:quotationId/status
 */
export async function patchAdminQuotationStatus(req, res) {
  try {
    const user = req.admin ?? req.user
    if (!user || user.role !== "admin") {
      res.status(401).json({ success: false, error: { code: "AUTH_003", message: "Admin required" } })
      return
    }

    const quotationId = req.params.quotationId || req.params.id
    if (!quotationId) {
      res.status(400).json({ success: false, error: { code: "VAL_001", message: "Quotation ID required" } })
      return
    }

    const body = req.body || {}
    const statusRaw = typeof body.status === "string" ? body.status.trim().toLowerCase() : ""
    const allowed = ["pending", "approved", "rejected", "completed"]
    if (!allowed.includes(statusRaw)) {
      res.status(400).json({
        success: false,
        error: { code: "VAL_002", message: `status must be one of: ${allowed.join(", ")}` },
      })
      return
    }

    const quotation = await Quotation.findByPk(quotationId)
    if (!quotation) {
      res.status(404).json({ success: false, error: { code: "RES_001", message: "Quotation not found" } })
      return
    }

    const updates = { status: statusRaw }

    if (statusRaw === "approved") {
      const paymentType =
        normalizePaymentType(body.paymentType) ?? normalizePaymentType(body.paymentMode)
      if (!paymentType) {
        res.status(400).json({
          success: false,
          error: {
            code: "VAL_003",
            message: "paymentType or paymentMode required (loan, cash, mix)",
          },
        })
        return
      }
      updates.paymentMode = paymentType

      if (paymentType === "loan" || paymentType === "mix") {
        const bankName = typeof body.bankName === "string" ? body.bankName.trim() : ""
        const ifsc = normalizeIfsc(body.bankIfsc ?? body.bank_ifsc)
        if (!bankName) {
          res.status(400).json({
            success: false,
            error: { code: "VAL_004", message: "bankName required for loan/mix" },
          })
          return
        }
        if (!ifsc) {
          res.status(400).json({
            success: false,
            error: { code: "VAL_005", message: "Valid 11-char bankIfsc required for loan/mix" },
          })
          return
        }
        updates.bankName = bankName
        updates.bankIfsc = ifsc
      } else {
        updates.bankName = null
        updates.bankIfsc = null
      }
    } else if (statusRaw === "rejected") {
      updates.bankName = null
      updates.bankIfsc = null
      updates.paymentMode = null
    }

    await quotation.update(updates)
    await quotation.reload()

    res.json({
      success: true,
      data: {
        id: quotationId,
        status: quotation.status,
        paymentMode: quotation.paymentMode,
        bankName: quotation.bankName,
        bankIfsc: quotation.bankIfsc,
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: { code: "SYS_001", message: "Internal error" } })
  }
}

/**
 * --- GET serializers (list + by id) ---
 *
 * Include in every quotation JSON object:
 *   paymentMode  (string | null)
 *   bankName     (string | null)
 *   bankIfsc     (string | null)
 *   paymentType  (optional; frontend falls back to paymentMode)
 *
 * If you use Sequelize `attributes: [...]` whitelist on findAll/findByPk, add:
 *   'bank_name', 'bank_ifsc', 'payment_mode'
 *
 * Example mapper:
 */
export function quotationToApiJson(row) {
  const q = row.get ? row.get({ plain: true }) : row
  return {
    ...q,
    paymentMode: q.paymentMode ?? q.payment_mode ?? null,
    paymentType: q.paymentType ?? q.payment_type ?? q.paymentMode ?? q.payment_mode ?? null,
    bankName: q.bankName ?? q.bank_name ?? null,
    bankIfsc: q.bankIfsc ?? q.bank_ifsc ?? null,
  }
}

/**
 * Route registration (Express example):
 *   router.patch('/admin/quotations/:quotationId/status', adminAuth, patchAdminQuotationStatus)
 */

/**
 * -----------------------------------------------------------------------------
 * HR BACKEND CHANGES (Database-first uploaded data + assignment queue)
 * -----------------------------------------------------------------------------
 *
 * Suggested tables:
 *
 * hr_lead_uploads
 *   id (uuid/pk)
 *   file_name
 *   uploaded_by (hr user id)
 *   uploaded_at
 *   row_count
 *   dealer_ids (json/array)   -- selected dealers at upload time
 *
 * hr_leads
 *   id (uuid/pk)
 *   upload_id (fk -> hr_lead_uploads.id)
 *   name
 *   mobile
 *   alt_mobile
 *   k_number
 *   address
 *   city
 *   state
 *   customer_note
 *   assigned_dealer_id (nullable)
 *   status (queued|active|called|follow_up|not_interested|closed)
 *   created_at / updated_at
 *
 * Assignment rule required by frontend:
 *   activeLimitPerDealer = 1
 *   -> every selected dealer can hold only one "active" lead at a time.
 *   -> remaining rows stay queued and are assigned when dealer frees up.
 */

function asArray(value) {
  if (Array.isArray(value)) return value
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : [value]
    } catch {
      return [value]
    }
  }
  return []
}

/**
 * POST /hr/leads/upload-csv
 * - Store upload metadata in hr_lead_uploads
 * - Store parsed rows in hr_leads
 * - Enforce per-dealer active cap (default 1) when assigning initial rows
 */
export async function postHrLeadsUploadCsv(req, res, db) {
  try {
    const user = req.hr ?? req.user
    if (!user || user.role !== "hr") {
      res.status(401).json({ success: false, error: { code: "AUTH_003", message: "HR required" } })
      return
    }

    const file = req.file
    if (!file) {
      res.status(400).json({ success: false, error: { code: "VAL_001", message: "CSV file required" } })
      return
    }

    const dealerIds = asArray(req.body.dealerIds ?? req.body["dealerIds[]"]).filter(Boolean)
    if (dealerIds.length === 0) {
      res.status(400).json({ success: false, error: { code: "VAL_002", message: "At least one dealerId required" } })
      return
    }

    // Frontend sends 1. Keep safe default to 1 for backend correctness.
    const requestedLimit = Number(req.body.activeLimitPerDealer ?? req.body.activeLeadsLimit)
    const activeLimitPerDealer = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.floor(requestedLimit) : 1

    // parseCsvRowsFromFile is backend-specific parser you already use
    const parsedRows = await db.parseCsvRowsFromFile(file.path)
    const parsed = parsedRows.length

    const upload = await db.hrLeadUploads.create({
      fileName: file.originalname || "uploaded.csv",
      uploadedBy: user.id,
      uploadedAt: new Date(),
      rowCount: parsed,
      dealerIds,
    })

    let created = 0
    let skippedDuplicate = 0
    const leadIds = []

    for (const row of parsedRows) {
      const mobile = String(row.mobile || "").replace(/\D/g, "").slice(-10)
      if (!mobile) continue

      const exists = await db.hrLeads.exists({ mobile, uploadId: upload.id })
      if (exists) {
        skippedDuplicate += 1
        continue
      }

      const lead = await db.hrLeads.create({
        uploadId: upload.id,
        name: row.name || "",
        mobile,
        altMobile: row.altMobile || "",
        kNumber: row.kNumber || "",
        address: row.address || "",
        city: row.city || "",
        state: row.state || "",
        customerNote: row.customerNote || "",
        status: "queued",
      })
      leadIds.push(lead.id)
      created += 1
    }

    // Queue allocator (DB-transaction recommended in real impl)
    let assigned = 0
    const activeCountByDealer = new Map()
    for (const dealerId of dealerIds) {
      // Count only leads visible in Current Lead (assigned).
      const activeCount = await db.hrLeads.count({ assignedDealerId: dealerId, status: "assigned" })
      activeCountByDealer.set(dealerId, activeCount)
    }

    let dealerCursor = 0
    for (const leadId of leadIds) {
      let allocated = false
      for (let i = 0; i < dealerIds.length; i += 1) {
        const idx = (dealerCursor + i) % dealerIds.length
        const dealerId = dealerIds[idx]
        const currentActive = activeCountByDealer.get(dealerId) || 0
        if (currentActive < activeLimitPerDealer) {
          // Important: Current Lead tab reads assigned/in_progress/rescheduled, not queued.
          await db.hrLeads.updateById(leadId, { assignedDealerId: dealerId, status: "assigned" })
          activeCountByDealer.set(dealerId, currentActive + 1)
          dealerCursor = (idx + 1) % dealerIds.length
          assigned += 1
          allocated = true
          break
        }
      }
      if (!allocated) {
        // stays queued
      }
    }

    const queued = Math.max(0, created - assigned)

    res.json({
      success: true,
      parsed,
      created,
      assigned,
      queued,
      skippedDuplicate,
      uploadId: upload.id,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: { code: "SYS_001", message: "Internal error" } })
  }
}

/**
 * Live HR upload batch counts (§7.8) — implemented in controllers/callingLeadController.ts
 *
 *   computeHrUploadLeadCounts(rowCount, { completedCount, assignedCount })
 *   buildHrUploadCountsForBatches() — SQL aggregate per batchId (no full row load on list)
 *
 * Buckets (mutually exclusive, sum to rowCount):
 *   completed — assignment status in completed|done|closed
 *   assigned — not completed + valid calling assignee dealer id (not pool/unassigned sentinels)
 *   unassigned — remainder (includes CSV rows without a created lead)
 *
 * POST upload response uses assignedAtUpload / queuedAtUpload (not list assignedCount).
 * GET /hr/leads/uploads returns live assignedCount / unassignedCount / completedCount only.
 */

/**
 * GET /hr/leads/uploads?limit=200
 * Return DB-backed upload history for HR Uploaded Data tab.
 */
export async function getHrLeadsUploads(req, res, db) {
  try {
    const user = req.hr ?? req.user
    if (!user || user.role !== "hr") {
      res.status(401).json({ success: false, error: { code: "AUTH_003", message: "HR required" } })
      return
    }

    const limitRaw = Number(req.query.limit || 50)
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 50

    const uploads = await db.hrLeadUploads.findManyWithRows({ limit, orderBy: "uploadedAt_DESC" })

    res.json({
      success: true,
      uploads: uploads.map((u) => ({
        id: u.id,
        uploadedAt: u.uploadedAt,
        fileName: u.fileName,
        rowCount: u.rowCount,
        dealerIds: u.dealerIds || [],
        rows: (u.rows || []).map((r) => ({
          id: r.id,
          name: r.name,
          mobile: r.mobile,
          altMobile: r.altMobile,
          kNumber: r.kNumber,
          address: r.address,
          city: r.city,
          state: r.state,
          customerNote: r.customerNote,
          assignedDealerId: r.assignedDealerId,
          status: r.status,
        })),
      })),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: { code: "SYS_001", message: "Internal error" } })
  }
}

/**
 * Additional routes (Express example):
 *   router.post('/hr/leads/upload-csv', hrAuth, upload.single('file'), postHrLeadsUploadCsv)
 *   router.get('/hr/leads/uploads', hrAuth, getHrLeadsUploads)
 */

/**
 * -----------------------------------------------------------------------------
 * CALLING ACTIONS RESPONSE CONTRACT (for Calling Data page)
 * -----------------------------------------------------------------------------
 *
 * Frontend requirement:
 * 1) Status Category, Status, and Remark must come as separate fields from API.
 * 2) Recent Actions must return ALL rows (no fixed slice like 10).
 *
 * Frontend screens using this:
 *   - Dealer Calling Data > Recent Actions
 *   - Dealer Calling Data > Interested
 *
 * Expected response source keys (any one works):
 *   recentActions | actionHistory | completedActions
 */

export function parseTaggedCallRemark(rawRemark) {
  const raw = String(rawRemark || "").trim()
  if (!raw) return { statusCategory: null, status: null, remark: null }

  // Format saved by frontend: [Category] Status | optional free remark
  const match = raw.match(/^\[([^\]]+)\]\s*([^|]*?)\s*(?:\|\s*(.*))?$/)
  if (!match) {
    return { statusCategory: null, status: null, remark: raw }
  }

  const statusCategory = (match[1] || "").trim() || null
  const status = (match[2] || "").trim() || null
  const remark = (match[3] || "").trim() || null
  return { statusCategory, status, remark }
}

/**
 * Allowed backend statusCategory enum values.
 */
export const ALLOWED_STATUS_CATEGORIES = [
  "call_connectivity",
  "lead_validity",
  "customer_intent",
  "financial",
  "competition",
  "schedule",
  "other",
]

const STATUS_CATEGORY_ALIASES = {
  // UI labels (legacy/frontend display labels) -> backend enum keys
  "Part 1 — Call & lead quality": "call_connectivity",
  "Part 2 — Interest & qualification": "customer_intent",
  "Part 3 — Follow-up & sales": "schedule",
  "Part 4 — Rejection / lost": "competition",
  // keep raw keys idempotent
  call_connectivity: "call_connectivity",
  lead_validity: "lead_validity",
  customer_intent: "customer_intent",
  financial: "financial",
  competition: "competition",
  schedule: "schedule",
  other: "other",
}

export function normalizeStatusCategory(rawCategory) {
  const clean = String(rawCategory || "").trim()
  if (!clean) return null
  const mapped = STATUS_CATEGORY_ALIASES[clean] || clean
  return ALLOWED_STATUS_CATEGORIES.includes(mapped) ? mapped : null
}

/**
 * Action serializer (use this in /dealers/me/calling-queue/next and related APIs)
 */
export function callingActionToApiJson(row) {
  const a = row.get ? row.get({ plain: true }) : row
  const parsed = parseTaggedCallRemark(a.callRemark ?? a.call_remark)
  return {
    ...a,
    // Keep legacy combined field for compatibility
    callRemark: a.callRemark ?? a.call_remark ?? null,

    // New explicit fields required by frontend
    statusCategory: a.statusCategory ?? a.status_category ?? parsed.statusCategory,
    status: a.statusText ?? a.status_text ?? parsed.status ?? a.status ?? null,
    remark: a.remark ?? parsed.remark ?? null,
  }
}

/**
 * GET /dealers/me/calling-queue/next  (alias: /current)
 * IMPORTANT backend behavior:
 * - Do not hard-cap action history to 10.
 * - Return full action history by default OR support client-controlled pagination.
 * - §4.5.1 / §E.1: when dealer has an open in_progress assignment, currentLead MUST be
 *   that row (not FIFO queue head). nextLead must be null until Submit closes the call.
 *   promoteQueuedLeadIfSlotAvailable must not run while in_progress is open.
 *
 * Recommended:
 *   const limit = req.query.limit ? clamp(Number(req.query.limit), 1, 5000) : 1000
 *   // If you must paginate, also return pagination metadata and let frontend request more.
 *
 * Response shape example:
 * {
 *   success: true,
 *   currentLead: {...},           // in_progress when call is open
 *   nextLead: null,               // null while in_progress; new head after Submit
 *   scheduledLeads: [...],
 *   recentActions: actionRows.map(callingActionToApiJson),  // no fixed 10-row slice
 *   counts: { pending, queued, scheduled, completed }
 * }
 */

/**
 * PATCH /dealers/me/calling-queue/:leadId/action
 *
 * Frontend behavior (Calling Data page):
 * - "Submit Status" sends:
 *     {
 *       action: "called" | "follow_up" | "not_interested" | "rescheduled",
 *       callRemark: "[Status Category] Status | optional free remark",
 *       nextFollowUpAt?: ISO string,
 *       actionAt?: ISO string
 *     }
 *
 * Backend MUST:
 * - On action "start": return lead + currentLead (same in_progress row) + counts;
 *   omit nextLead (see HANDOFF §4.5.1 / REQUIRED §E.1).
 * - On outcome actions: persist remarks, close assignment, return full snapshot with nextLead.
 * - §E.2 Reschedule (Decision Pending → Callback Scheduled):
 *     action: "rescheduled" OR "follow_up" when nextFollowUpAt / next_follow_up_at is set
 *     → assignment.status = "rescheduled" (NOT completed)
 *     → nextFollowUpAt required (400 VAL_001 if missing/invalid)
 *     → call_remark = single `[schedule] Callback Scheduled | remark` — replace, never append
 *     → response includes lead, nextLead, scheduledLeads (future follow-up)
 * - Parse payload.callRemark using parseTaggedCallRemark()
 * - Persist values separately:
 *     status_category   (or statusCategory)
 *     status_text       (or statusLabel / status)
 *     remark            (free text only, without tags)
 * - Keep legacy call_remark column updated (optional but recommended):
 *     call_remark = `[${status_category}] ${status_text}${remark ? " | "+remark : ""}`
 *
 * If you currently store only call_remark text, you can still pass these
 * values through by parsing during GET responses (parse on the fly).
 */
export async function patchDealerCallingQueueAction(req, res, db) {
  try {
    const dealer = req.dealer ?? req.user
    if (!dealer) {
      res.status(401).json({ success: false, error: { code: "AUTH_003", message: "Dealer required" } })
      return
    }

    const leadId = req.params.leadId || req.params.id
    if (!leadId) {
      res.status(400).json({ success: false, error: { code: "VAL_001", message: "Lead id required" } })
      return
    }

    const body = req.body || {}
    let action = body.action
    const nextFollowUpAt = body.nextFollowUpAt ?? body.next_follow_up_at ?? null

    // §E.2 — follow_up + datetime is reschedule submit (frontend may retry with follow_up on 500).
    if (action === "follow_up" && nextFollowUpAt) {
      action = "rescheduled"
    }

    if (action === "rescheduled") {
      if (!nextFollowUpAt) {
        res.status(400).json({
          success: false,
          error: { code: "VAL_001", message: "nextFollowUpAt is required for rescheduled action" },
        })
        return
      }
      const followUpDate = new Date(nextFollowUpAt)
      if (Number.isNaN(followUpDate.getTime()) || followUpDate.getTime() <= Date.now()) {
        res.status(400).json({
          success: false,
          error: { code: "VAL_001", message: "nextFollowUpAt must be a valid future ISO datetime" },
        })
        return
      }
    }

    const parsed = parseTaggedCallRemark(body.callRemark ?? body.call_remark)
    const normalizedCategory =
      normalizeStatusCategory(body.statusCategory ?? body.status_category ?? parsed.statusCategory)
    const statusCategory = normalizedCategory
    const statusText =
      body.statusText ?? body.status_text ?? body.statusLabel ?? parsed.status ?? null
    const remark = body.remark ?? parsed.remark ?? null

    const updates: any = {
      action,
      nextFollowUpAt: action === "rescheduled" ? nextFollowUpAt : null,
      actionAt: body.actionAt ?? new Date(),
      assignmentStatus: action === "rescheduled" ? "rescheduled" : "completed",
    }

    if (statusCategory && statusText) {
      updates.status_category = statusCategory
      updates.status_text = statusText
      updates.remark = remark
      // Replace — do not append nested [schedule] chains (§E.2).
      updates.call_remark = remark
        ? `[${statusCategory}] ${statusText} | ${remark}`
        : `[${statusCategory}] ${statusText}`
    } else if (body.callRemark || body.call_remark) {
      if (!normalizedCategory) {
        res.status(400).json({
          success: false,
          error: {
            code: "VAL_001",
            message: `Invalid statusCategory. Allowed values: ${ALLOWED_STATUS_CATEGORIES.join(",")}`,
          },
        })
        return
      }
      updates.status_category = statusCategory
      updates.status_text = statusText
      updates.remark = remark
      updates.call_remark = remark
        ? `[${statusCategory}] ${statusText} | ${remark}`
        : `[${statusCategory}] ${statusText}`
    }

    await db.dealerCallingLeads.updateById(leadId, updates)

    const updatedRow = await db.dealerCallingLeads.findById(leadId)
    res.json({
      success: true,
      lead: callingActionToApiJson(updatedRow),
      nextLead: null,
      scheduledLeads: action === "rescheduled" ? [callingActionToApiJson(updatedRow)] : [],
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: { code: "SYS_001", message: "Internal error" } })
  }
}

/**
 * -----------------------------------------------------------------------------
 * TRANSITION RULE UPDATE (fix "Invalid lead action transition" in Recent Actions)
 * -----------------------------------------------------------------------------
 *
 * Problem:
 * - Existing transition validator often allows only queue flow:
 *     assigned/in_progress -> called/follow_up/not_interested/rescheduled
 * - But Recent Actions cards are already completed/history rows, so editing status there
 *   can trigger LEAD_005 "Invalid lead action transition".
 *
 * Required backend behavior:
 * - Support an EDIT path for already-acted leads from Recent Actions.
 * - If lead belongs to current dealer and exists, allow updating:
 *     status_category, status_text, remark, call_remark, next_follow_up_at, action, action_at
 *   even when current status is completed/rescheduled.
 *
 * Recommended validation:
 * 1) Keep strict transition for current queue actions (`start` / first completion).
 * 2) Add "edit mode" for recent action updates:
 *    - Trigger when payload contains callRemark or status fields for an already-acted lead
 *    - Validate dealer ownership
 *    - Perform UPDATE (not INSERT) on latest row for that lead
 *    - Return updated row via callingActionToApiJson
 *
 * Pseudo-code:
 *   const lead = findLeadById(leadId)
 *   if (!lead || lead.dealerId !== dealer.id) -> LEAD_004
 *   const isEditMode = lead.status in ["completed","rescheduled"] || body.editMode === true
 *   if (isEditMode) {
 *     update latest action fields and return success
 *   } else {
 *     apply existing strict transition matrix
 *   }
 *
 * This removes false LEAD_005 failures from Recent Actions status edits.
 */

/**
 * =============================================================================
 * Payment Management → Admin Installation (release flags) — June 2026
 * Full spec: BACKEND_INSTALLATION_RELEASE.md
 * Implemented: controllers/quotationController.ts, utils/quotationApiJson.ts
 * =============================================================================
 */

function serializeInstallationReleaseFields(row) {
  const installationReadyForInstaller = Boolean(
    row.installationReadyForInstaller ?? row.installation_ready_for_installer ?? false
  )
  const installationReleasedAt = row.installationReleasedAt ?? row.installation_released_at ?? null
  const installationStatus = row.installationStatus ?? row.installation_status ?? null
  return {
    installationReadyForInstaller,
    installation_ready_for_installer: installationReadyForInstaller,
    installationReleasedAt,
    installation_released_at: installationReleasedAt,
    installationStatus,
    installation_status: installationStatus,
  }
}

/**
 * PATCH /api/quotations/:quotationId/installation-release
 * Also: PATCH /api/quotations/:id/installation/ready
 *       PATCH /api/admin/quotations/:id/installation-release
 */
/**
 * POST /admin/quotations/:quotationId/final-confirmation-documents  (§M)
 *
 * multipart/form-data — any subset of:
 *   customerFinalBillFile, panelWarrantyFile, inverterWarrantyFile, workCompletionWarrantyFile
 *
 * Roles: admin, super-admin, super-admin-manager, baldev, confirmation
 * Do NOT use PATCH /quotations/:id/documents for these files (KYC validation).
 *
 * Baldev alias: POST /baldev/quotations/:quotationId/final-confirmation-documents
 * Single-file fallback: POST …/final-confirmation-documents/upload  (body.field + file)
 */
export async function postAdminFinalConfirmationDocuments(req, res) {
  try {
    const role = req.user?.role
    const allowed = ["admin", "super-admin", "super-admin-manager", "baldev", "confirmation"]
    if (!role || !allowed.includes(role)) {
      res.status(403).json({ success: false, error: { code: "AUTH_004", message: "Insufficient permissions" } })
      return
    }

    const quotationId = req.params.quotationId || req.params.id
    if (!quotationId) {
      res.status(400).json({ success: false, error: { code: "VAL_001", message: "Quotation ID required" } })
      return
    }

    const ALLOWED_FIELDS = [
      "customerFinalBillFile",
      "panelWarrantyFile",
      "inverterWarrantyFile",
      "workCompletionWarrantyFile",
    ]

    const files = req.files || {}
    const updates = {}
    let anyFile = false

    for (const field of ALLOWED_FIELDS) {
      const part = files[field]?.[0]
      if (!part) continue
      anyFile = true
      // Production: upload part to S3 → quotation-documents/{quotationId}/{field}-….
      updates[field] = `quotation-documents/${quotationId}/${field}-example.pdf`
    }

    if (!anyFile) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "At least one final confirmation document is required",
        },
      })
      return
    }

    // await upsert quotation_documents row (partial)
    const documents = { ...updates }
    for (const field of ALLOWED_FIELDS) {
      if (documents[field]) documents[`${field}Url`] = documents[field]
    }

    res.json({
      success: true,
      data: {
        quotationId,
        documents,
        ...documents,
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: { code: "SYS_001", message: "Internal error" } })
  }
}

/**
 * Route registration (Express):
 *
 *   router.post(
 *     "/quotations/:quotationId/final-confirmation-documents",
 *     handleFinalConfirmationDocumentsMultipart,
 *     saveFinalConfirmationDocuments
 *   )
 *
 * Implemented in routes/adminRoutes.ts, routes/baldevRoutes.ts, routes/quotationRoutes.ts
 */

/**
 * PATCH /admin/quotations/:quotationId/installation-status  (§L.1 — Send to Metering)
 *
 * Body: installationStatus / meteringStatus (and snake_case mirrors) = "pending_metering"
 *
 * Rules:
 * - Quotation dealer admin OR inventory admin JWT
 * - Allow from pending_installer / installer_* / baldev_* (early handoff OK)
 * - Idempotent when already pending_metering → 200
 * - Do NOT require Payment Management release for admin send
 * - meteringStatus on GET is derived from installationStatus (deriveMeteringStatus)
 * - Reject metering_approved / mco / completed → 400 VAL_001
 */
export async function patchAdminQuotationInstallationStatus(req, res) {
  try {
    const user = req.admin ?? req.user
    const dealer = req.dealer
    const isQuotationAdmin = dealer && dealer.role === "admin"
    const isInventoryAdmin =
      user &&
      ["admin", "super-admin", "super-admin-manager"].includes(user.role)
    if (!isQuotationAdmin && !isInventoryAdmin) {
      res.status(403).json({
        success: false,
        error: { code: "AUTH_004", message: "Admin access required" },
      })
      return
    }

    const quotationId = req.params.quotationId || req.params.id
    const body = req.body || {}
    const nextStatus =
      body.installationStatus ||
      body.installation_status ||
      body.meteringStatus ||
      body.metering_status ||
      body.status

    if (!nextStatus || typeof nextStatus !== "string") {
      res.status(400).json({
        success: false,
        error: { code: "VAL_001", message: "installationStatus is required" },
      })
      return
    }

    const quotation = await Quotation.findByPk(quotationId)
    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: "RES_001", message: "Quotation not found" },
      })
      return
    }

    const current = quotation.installationStatus || "pending_installer"
    if (nextStatus === "pending_metering" && current === "pending_metering") {
      res.json({
        success: true,
        data: {
          id: quotation.id,
          installationStatus: "pending_metering",
          meteringStatus: "pending_metering",
        },
      })
      return
    }

    const allowedFrom = new Set([
      "pending_installer",
      "installer_in_progress",
      "installer_approved",
      "installer_rejected",
      "pending_baldev",
      "baldev_approved",
      "baldev_rejected",
      "pending_metering",
      "metering_in_progress",
    ])
    if (nextStatus === "pending_metering" && !allowedFrom.has(current)) {
      res.status(400).json({
        success: false,
        error: {
          code: "VAL_001",
          message: `Cannot send to metering from ${current}`,
        },
      })
      return
    }

    await quotation.update({ installationStatus: nextStatus })
    await quotation.reload()

    const meteringStatus =
      ["pending_metering", "metering_in_progress", "metering_approved", "mco"].includes(
        quotation.installationStatus
      )
        ? quotation.installationStatus
        : null

    res.json({
      success: true,
      data: {
        id: quotation.id,
        installationStatus: quotation.installationStatus,
        meteringStatus,
        updatedAt: quotation.updatedAt,
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: { code: "SYS_001", message: "Internal error" } })
  }
}

export async function patchQuotationInstallationRelease(req, res) {
  try {
    const quotationId = req.params.quotationId || req.params.id
    const body = req.body || {}
    const installationReadyForInstaller =
      body.installationReadyForInstaller ?? body.installation_ready_for_installer
    const installationReleasedAt = body.installationReleasedAt ?? body.installation_released_at

    if (typeof installationReadyForInstaller !== "boolean") {
      res.status(400).json({
        success: false,
        error: {
          code: "VAL_001",
          message: "installationReadyForInstaller (or installation_ready_for_installer) must be boolean",
        },
      })
      return
    }

    const role = req.user?.role
    const isAccountManager = role === "account-management"
    const isInventoryAdmin =
      role === "admin" || role === "super-admin" || role === "super-admin-manager"
    const isQuotationAdmin = req.dealer && req.dealer.role === "admin"
    if (!isAccountManager && !isInventoryAdmin && !isQuotationAdmin) {
      res.status(403).json({
        success: false,
        error: { code: "AUTH_004", message: "Insufficient permissions" },
      })
      return
    }

    const quotation = await Quotation.findByPk(quotationId)
    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: "RES_001", message: "Quotation not found" },
      })
      return
    }

    const releaseTimestamp =
      installationReadyForInstaller === true
        ? installationReleasedAt
          ? new Date(installationReleasedAt)
          : new Date()
        : null

    await quotation.update({
      installationReadyForInstaller,
      installationReleasedAt: releaseTimestamp,
      installationStatus: installationReadyForInstaller ? "pending_installer" : quotation.installationStatus,
    })
    await quotation.reload()

    const row = quotation.get({ plain: true })
    res.json({
      success: true,
      data: {
        id: quotation.id,
        quotationId: quotation.id,
        ...serializeInstallationReleaseFields(row),
        updatedAt: quotation.updatedAt,
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: { code: "SYS_001", message: "Internal error" } })
  }
}

/**
 * PATCH /api/quotations/:quotationId/products
 * (Jun 2026 — commercial PDF flag + proposal validity dates)
 *
 * Implemented: controllers/quotationController.ts → updateQuotationProducts
 * PDF flags: utils/quotationProductPdfDisplay.ts
 *   - buildQuotationProductPdfPersistFieldsForUpdate (partial PATCH; clear pdfCommercialSet on false)
 *   - quotationProductPdfDisplayApiFields (GET echo camelCase + snake_case)
 * Dates: utils/quotationApiJson.ts
 *   - touchQuotationProposalValidity(quotation) after product save
 *   - quotationProposalDateApiFields in PATCH + GET responses
 *
 * Frontend before Download PDF: GET /quotations/:id (quotation-details-dialog refetch).
 * PDF Updated = updatedAt → createdAt → validUntil − 7d (resolveProposalQuotationDates).
 * PDF Valid Until = Updated + 7 days (PROPOSAL_VALIDITY_DAYS).
 *
 * Example body (after create or on edit):
 * {
 *   "panelBrand": "Premier Energies",
 *   "pdfPanelRangeKey": "premier_600_625_bifacial_topcon",
 *   "pdfCommercialSet": true
 * }
 */
function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

/** Reference sketch — real handler: quotationController.updateQuotationProducts */
export async function patchQuotationProductsPdfFlagsExample(req, res) {
  const { quotationId } = req.params
  const products = req.body?.products ?? req.body

  const quotation = await Quotation.findByPk(quotationId)
  if (!quotation) {
    res.status(404).json({ success: false, error: { code: "RES_001", message: "Quotation not found" } })
    return
  }

  // merge products + pdfPersistFields (see buildQuotationProductPdfPersistFieldsForUpdate)
  // await QuotationProduct.update({ ...merged, ...pdfPersistFields }, { where: { quotationId } })
  const now = new Date()
  await quotation.update({ validUntil: addDays(now, 7) })
  await quotation.reload()

  res.json({
    success: true,
    data: {
      id: quotation.id,
      products,
      updatedAt: quotation.updatedAt?.toISOString?.() ?? quotation.updatedAt,
      validUntil: quotation.validUntil?.toISOString?.() ?? quotation.validUntil,
    },
  })
}
