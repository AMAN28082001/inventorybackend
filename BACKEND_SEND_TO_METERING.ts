// @ts-nocheck
/**
 * =============================================================================
 * BACKEND REFERENCE — Admin "Send to Metering" from pending_installer (Jul 2026)
 * =============================================================================
 *
 * Frontend (done):
 *   - app/dashboard/admin/page.tsx → handleSendToMetering
 *   - lib/operational-install-queue.ts → getAdminQuotationsTabSendToMeteringState
 *   - lib/api.ts → sendQuotationToMetering
 *
 * What the user does:
 *   Admin → Quotations → All → clicks **Metering** / **Send to Metering** on a row
 *   that is still OPS **Pending Installer** (`installationStatus = pending_installer`).
 *   The row must move to Meter Pending (`pending_metering`) for BOTH:
 *     - Admin → Metering → Meter Pending
 *     - Metering role login → Meter Pending
 *
 * THE BUG THIS FIXES:
 *   Backend returned 400:
 *     "Cannot send to metering from installation status 'pending_installer'"
 *   Admin’s manual handoff was blocked while OPS is still Pending Installer.
 *
 * Frontend call order (lib/api.ts → sendQuotationToMetering):
 *   1) PATCH|POST /api/admin/quotations/:id/send-to-metering   ← PREFERRED
 *   2) PATCH /api/admin/quotations/:id/installation-status
 *        { installationStatus: "pending_metering", force, adminOverride, ... }
 *   3) PATCH .../workflow-status / metering-status (aliases)
 *   4) 2-step promote: installer_approved → pending_metering (last resort)
 *
 * Every status write includes:
 *   force: true, adminOverride: true, allowFromPendingInstaller: true, source: "admin"
 *
 * Auth: quotation dealer admin OR inventory admin / super-admin.
 * Do NOT require Payment Management release for this admin handoff.
 *
 * Live implementation in THIS repo (kept in sync with this reference):
 *   controllers/adminController.ts — sendQuotationToMetering,
 *     updateQuotationInstallationStatus (admin override from pending_installer)
 *   routes/adminRoutes.ts — PATCH|POST .../send-to-metering + installation-status
 *   utils/meteringWorkflowApi.ts — deriveMeteringStatus / meteringWorkflowApiFields
 *
 * =============================================================================
 */

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------

function logSTM(stage, data) {
  const ts = new Date().toISOString()
  try {
    const isErr = typeof stage === "string" && stage.includes("✖")
    const line = `[SendToMetering ${ts}] ${stage}`
    if (isErr) console.error(line, data)
    else console.log(line, data === undefined ? "" : typeof data === "string" ? data : JSON.stringify(data))
  } catch {
    console.log(`[SendToMetering ${ts}] ${stage}`)
  }
}

function requireAdmin(req, res) {
  const user = req.user || req.admin
  const dealer = req.dealer
  const isQuotationAdmin = dealer && dealer.role === "admin"
  const isInventoryAdmin =
    user && ["admin", "super-admin", "super-admin-manager"].includes(user.role)
  if (!isQuotationAdmin && !isInventoryAdmin) {
    res.status(403).json({
      success: false,
      error: { code: "AUTH_004", message: "Admin access required" },
    })
    return null
  }
  return { user, dealer, isQuotationAdmin, isInventoryAdmin }
}

/**
 * Truthy flags the frontend always sends on Admin Metering handoff.
 * Also treat pure admin role as override (this endpoint is admin-only anyway).
 */
function isAdminMeteringOverride(body, admin) {
  const b = body || {}
  if (b.force === true || b.force === "true" || b.force === 1) return true
  if (b.adminOverride === true || b.adminOverride === "true") return true
  if (b.allowFromPendingInstaller === true || b.allowFromPendingInstaller === "true") return true
  if (String(b.source || "").toLowerCase() === "admin") return true
  // Dedicated send-to-metering route OR any admin JWT ⇒ allow early handoff
  if (admin) return true
  return false
}

/** Statuses that may become pending_metering without admin override. */
const SEND_TO_METERING_NORMAL = new Set([
  "installer_approved",
  "pending_baldev",
  "baldev_approved",
  "baldev_rejected",
  "metering_in_progress",
])

/**
 * Extra statuses Admin may jump from when force / adminOverride / source=admin.
 * This is the Jul 2026 fix — pending_installer must NOT 400.
 */
const SEND_TO_METERING_ADMIN_EARLY = new Set([
  "pending_installer",
  "installer_in_progress",
  "installer_rejected",
])

/** Never advance these to metering (partial must Complete & Approve first). */
const SEND_TO_METERING_BLOCKED = new Set([
  "installer_partial_approved",
])

/** Terminal / past metering — reject with clear message. */
const SEND_TO_METERING_TOO_LATE = new Set([
  "metering_approved",
  "meter_installation_pending",
  "mco",
  "completed",
])

function pickRequestedStatus(body) {
  const b = body || {}
  const keys = [
    "installationStatus",
    "installation_status",
    "meteringStatus",
    "metering_status",
    "status",
  ]
  for (const k of keys) {
    if (typeof b[k] === "string" && b[k].trim()) return b[k].trim()
  }
  // Dedicated send-to-metering endpoint implies pending_metering when body omits status
  return "pending_metering"
}

function respondMeteringSlice(quotation) {
  const installationStatus = quotation.installationStatus || null
  const meteringStatus = ["pending_metering", "metering_in_progress", "metering_approved", "meter_installation_pending", "mco"].includes(
    installationStatus,
  )
    ? installationStatus
    : null
  return {
    id: quotation.id,
    installationStatus,
    installation_status: installationStatus,
    meteringStatus,
    metering_status: meteringStatus,
    meteringStage: meteringStatus,
    meteringActionAt: quotation.meteringActionAt || null,
    updatedAt: quotation.updatedAt,
  }
}

/**
 * Core mutation: set installationStatus = pending_metering.
 * Idempotent when already pending_metering.
 * Returns { ok, status, data?, error? }.
 */
async function applySendToMetering(quotation, { adminOverride }) {
  const current = String(quotation.installationStatus || "pending_installer").trim()
  logSTM("① BEFORE", {
    id: quotation.id,
    installationStatus: current,
    adminOverride: !!adminOverride,
  })

  if (current === "pending_metering") {
    logSTM("② AFTER (idempotent)", { id: quotation.id, installationStatus: current })
    return { ok: true, status: 200, data: respondMeteringSlice(quotation) }
  }

  if (SEND_TO_METERING_BLOCKED.has(current)) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "VAL_001",
        message: `Cannot send to metering from installation status "${current}"`,
        details: [
          {
            field: "installationStatus",
            message: "Complete & Mark as Approved first (installer_partial_approved cannot go to metering)",
          },
        ],
      },
    }
  }

  if (SEND_TO_METERING_TOO_LATE.has(current)) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "VAL_001",
        message: `Cannot send to metering from installation status "${current}"`,
        details: [
          {
            field: "installationStatus",
            message: "Quotation is already past Meter Pending",
          },
        ],
      },
    }
  }

  const allowed =
    SEND_TO_METERING_NORMAL.has(current) ||
    (adminOverride && SEND_TO_METERING_ADMIN_EARLY.has(current))

  if (!allowed) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "VAL_001",
        message: `Cannot send to metering from installation status "${current}"`,
        details: [
          {
            field: "installationStatus",
            message: adminOverride
              ? "Unsupported installation status for Send to Metering"
              : "Send force/adminOverride (or use /send-to-metering) to allow pending_installer",
          },
        ],
      },
    }
  }

  const now = new Date()
  await quotation.update({
    installationStatus: "pending_metering",
    meteringActionAt: now,
    // Clear post-Discom WCC flag when (re)entering Meter Pending
    meteringWccAfterDiscom: false,
    meteringWccAfterDiscomAt: null,
    meteringApprovedAt: null,
    mcoAt: null,
    meterInstallationPendingAt: null,
  })
  await quotation.reload()

  const after = respondMeteringSlice(quotation)
  logSTM("② AFTER", after)
  logSTM("③ DIFF", {
    installationStatus: { from: current, to: after.installationStatus },
    meteringStatus: { from: null, to: after.meteringStatus },
  })

  if (after.installationStatus !== "pending_metering") {
    logSTM("⚠ WARN installationStatus did NOT persist as pending_metering", {
      id: quotation.id,
      got: after.installationStatus,
    })
  }

  return { ok: true, status: 200, data: after }
}

// -----------------------------------------------------------------------------
// 1) PREFERRED — PATCH|POST /api/admin/quotations/:id/send-to-metering
// -----------------------------------------------------------------------------
/**
 * Body (optional — frontend may send the full override payload):
 * {
 *   "installationStatus": "pending_metering",
 *   "meteringStatus": "pending_metering",
 *   "force": true,
 *   "adminOverride": true,
 *   "allowFromPendingInstaller": true,
 *   "source": "admin"
 * }
 *
 * Always treats the caller as admin override → pending_installer is ALLOWED.
 */
export async function sendQuotationToMetering(req, res) {
  const admin = requireAdmin(req, res)
  if (!admin) return

  const quotationId = req.params.quotationId || req.params.id
  logSTM("▶ IN  send-to-metering", {
    quotationId,
    user: admin.user?.id || admin.dealer?.id,
    role: admin.user?.role || admin.dealer?.role,
    body: req.body,
  })

  try {
    const quotation = await Quotation.findByPk(quotationId)
    if (!quotation) {
      logSTM("◀ OUT 404", { quotationId })
      return res.status(404).json({
        success: false,
        error: { code: "RES_001", message: "Quotation not found" },
      })
    }

    const result = await applySendToMetering(quotation, { adminOverride: true })
    if (!result.ok) {
      logSTM("◀ OUT 400", result.error)
      return res.status(result.status).json({ success: false, error: result.error })
    }

    logSTM("◀ OUT 200", result.data)
    return res.json({ success: true, data: result.data })
  } catch (e) {
    logSTM("✖ ERROR send-to-metering", { quotationId, message: e?.message, stack: e?.stack })
    return res.status(500).json({
      success: false,
      error: { code: "SYS_001", message: "Internal server error" },
    })
  }
}

// -----------------------------------------------------------------------------
// 2) FALLBACK — PATCH /api/admin/quotations/:id/installation-status
// -----------------------------------------------------------------------------
/**
 * When body has force / adminOverride / allowFromPendingInstaller / source:"admin"
 * (or caller is admin), DO NOT return:
 *   "Cannot send to metering from installation status 'pending_installer'"
 *
 * Still reject installer_partial_approved and terminal metering stages.
 */
export async function patchAdminInstallationStatusForMetering(req, res) {
  const admin = requireAdmin(req, res)
  if (!admin) return

  const quotationId = req.params.quotationId || req.params.id
  const body = req.body || {}
  const nextStatus = pickRequestedStatus(body)
  const adminOverride = isAdminMeteringOverride(body, admin)

  logSTM("▶ IN  PATCH /installation-status", {
    quotationId,
    nextStatus,
    adminOverride,
    body,
  })

  try {
    // Only the pending_metering path is handled here in this reference.
    // Other status transitions stay in updateQuotationInstallationStatus.
    if (nextStatus !== "pending_metering") {
      logSTM("↪ DELEGATE non-metering status to existing handler", { nextStatus })
      return updateQuotationInstallationStatus(req, res)
    }

    const quotation = await Quotation.findByPk(quotationId)
    if (!quotation) {
      logSTM("◀ OUT 404", { quotationId })
      return res.status(404).json({
        success: false,
        error: { code: "RES_001", message: "Quotation not found" },
      })
    }

    const result = await applySendToMetering(quotation, { adminOverride })
    if (!result.ok) {
      logSTM("◀ OUT 400", result.error)
      return res.status(result.status).json({ success: false, error: result.error })
    }

    logSTM("◀ OUT 200", result.data)
    return res.json({ success: true, data: result.data })
  } catch (e) {
    logSTM("✖ ERROR PATCH /installation-status", {
      quotationId,
      message: e?.message,
      stack: e?.stack,
    })
    return res.status(500).json({
      success: false,
      error: { code: "SYS_001", message: "Internal server error" },
    })
  }
}

// -----------------------------------------------------------------------------
// 3) GET must return pending_metering (keeps row in Meter Pending for all logins)
// -----------------------------------------------------------------------------
/**
 * After save, EVERY GET that lists/details this quotation must include:
 *
 *   {
 *     "installationStatus": "pending_metering",
 *     "installation_status": "pending_metering",
 *     "meteringStatus": "pending_metering",
 *     "metering_status": "pending_metering"
 *   }
 *
 * Use meteringWorkflowApiFields() / deriveMeteringStatus() — meteringStatus is
 * derived from installationStatus; do NOT require a separate metering_status column.
 *
 * Queues that must include the row:
 *   GET /api/admin/quotations?…          (Admin → Metering → Meter Pending)
 *   GET /api/metering/quotations?status=processing
 *        → filters pending_metering,metering_in_progress
 *
 * Must leave installer queues (pending_metering ∉ INSTALLER_RELEASE_STATUSES).
 */

// -----------------------------------------------------------------------------
// 4) Route registration (Express)
// -----------------------------------------------------------------------------
/*
router.patch(
  "/quotations/:quotationId/send-to-metering",
  authAdmin,
  sendQuotationToMetering,
)
router.post(
  "/quotations/:quotationId/send-to-metering",
  authAdmin,
  sendQuotationToMetering,
)
router.patch(
  "/quotations/:quotationId/installation-status",
  authAdmin,
  patchAdminInstallationStatusForMetering, // or wire override into existing handler
)
router.patch(
  "/quotations/:quotationId/workflow-status",
  authAdmin,
  patchAdminInstallationStatusForMetering,
)
*/

// -----------------------------------------------------------------------------
// 5) Live-code patch (controllers/adminController.ts) — minimal diff
// -----------------------------------------------------------------------------
/*
// Expand the allowed-from set OR gate with admin override:

const SEND_TO_METERING_FROM_STATUSES = new Set([
  'pending_installer',      // ← ADD (Jul 2026 admin early handoff)
  'installer_in_progress',  // ← ADD
  'installer_rejected',     // ← ADD (optional)
  'installer_approved',
  'pending_baldev',
  'baldev_approved',
  'baldev_rejected',
  'metering_in_progress',
]);

// Inside updateQuotationInstallationStatus, when nextStatus === 'pending_metering':
const body = req.body || {};
const adminOverride =
  body.force === true ||
  body.adminOverride === true ||
  body.allowFromPendingInstaller === true ||
  String(body.source || '').toLowerCase() === 'admin' ||
  hasAdminQuotationAccess(req); // this handler is already admin-only

const allowed =
  SEND_TO_METERING_FROM_STATUSES.has(currentStatus) ||
  (adminOverride &&
    ['pending_installer', 'installer_in_progress', 'installer_rejected'].includes(currentStatus));

// Still reject installer_partial_approved explicitly.
*/

// -----------------------------------------------------------------------------
// 6) QA checklist
// -----------------------------------------------------------------------------
/*
 1. Admin Quotations → All → Metering on a pending_installer row → 200.
 2. GET returns installationStatus=pending_metering + meteringStatus=pending_metering.
 3. Admin → Metering → Meter Pending shows the row.
 4. Metering role login → Meter Pending shows the SAME row.
 5. Row leaves installer / Pending Installation queues.
 6. Re-click Metering (idempotent) → 200, still pending_metering.
 7. installer_partial_approved → still 400 (Complete & Approve first).
 8. metering_approved / mco / completed → 400.
 9. Server log shows:
      ▶ IN → ① BEFORE (pending_installer) → ② AFTER (pending_metering) → ③ DIFF → ◀ OUT 200
 10. Without force on a non-admin path (if any), pending_installer may still be blocked —
     but admin /send-to-metering and admin installation-status MUST allow it.
*/

export {}
