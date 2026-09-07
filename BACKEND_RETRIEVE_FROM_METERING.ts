// @ts-nocheck
/**
 * =============================================================================
 * BACKEND — Admin **Retrieve from Metering** (Meter Pending → Installation approved)
 * =============================================================================
 *
 * Frontend:
 *   - Admin → Quotations → **Retrieve** (when in early metering)
 *   - Admin → Metering → Meter Pending → **Retrieve**
 *   - `lib/api.ts` → `retrieveQuotationFromMetering`
 *   - `lib/operational-install-queue.ts` → `canRetrieveFromMeteringPipeline`
 *
 * Product:
 *   Pull a quotation back from Meter Pending before Discom / WCC / MCO so admin can
 *   fix installation or re-send to Metering later.
 *
 * NOT the same as:
 *   - Admin Installation **Revert** (approved → pending_installer) — see
 *     `BACKEND_INSTALLATION_REVERT.ts`
 *   - **Retrieve from Installation** (undo Send to Installer) — see
 *     `BACKEND_RETRIEVE_FROM_INSTALLATION.ts`
 *
 * =============================================================================
 */

const EARLY_METERING = new Set(["pending_metering", "metering_in_progress", ""])
const LATE_METERING = new Set([
  "metering_approved",
  "meter_installation_pending",
  "meter_install",
  "meter_install_pending",
  "mco",
  "pending_baldev",
  "baldev_approved",
  "completed",
])

function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
}

function currentStages(q) {
  const install = norm(q.installation_status || q.installationStatus)
  const metering = norm(q.metering_status || q.meteringStatus || q.metering_stage || q.meteringStage)
  return { install, metering }
}

function requireAdmin(req, res) {
  const user = req.user || req.dealer
  if (!user || user.role !== "admin") {
    res.status(403).json({ success: false, error: { code: "AUTH_004", message: "Forbidden" } })
    return null
  }
  return user
}

/**
 * Apply retrieve-from-metering: early metering → installer_approved.
 * Keep Payment Management release flags (installation_ready_for_installer).
 */
export async function applyRetrieveFromMetering(quotation) {
  const { install, metering } = currentStages(quotation)

  const inEarly =
    EARLY_METERING.has(metering) ||
    EARLY_METERING.has(install) ||
    metering === "pending_metering" ||
    install === "pending_metering" ||
    metering === "metering_in_progress" ||
    install === "metering_in_progress"

  if (!inEarly) {
    const err = new Error(
      `Cannot retrieve from metering while stage is '${metering || install || "unset"}'. Use late-stage revert flows.`,
    )
    err.status = 409
    err.code = "WF_RETRIEVE_METERING_001"
    throw err
  }

  if (LATE_METERING.has(metering) || LATE_METERING.has(install)) {
    const err = new Error("Quotation is past Meter Pending — retrieve not allowed.")
    err.status = 409
    err.code = "WF_RETRIEVE_METERING_002"
    throw err
  }

  await quotation.update({
    installationStatus: "installer_approved",
    installation_status: "installer_approved",
    meteringStatus: null,
    metering_status: null,
    meteringStage: null,
    metering_stage: null,
    pendingMeteringAt: null,
    pending_metering_at: null,
    // Do NOT clear installation_ready_for_installer / installation_released_at.
    // Do NOT change quotations.status (still approved).
  })
  await quotation.reload()
  return quotation
}

/**
 * PATCH|POST /api/admin/quotations/:id/retrieve-from-metering
 *
 * Body from frontend:
 * {
 *   "installationStatus": "installer_approved",
 *   "installation_status": "installer_approved",
 *   "target": "installer_approved",
 *   "retrieveFromMetering": true,
 *   "allowRevert": true,
 *   "force": true,
 *   "adminOverride": true,
 *   "source": "admin"
 * }
 */
export async function postAdminRetrieveFromMetering(req, res) {
  const user = requireAdmin(req, res)
  if (!user) return
  const quotationId = req.params.quotationId || req.params.id

  try {
    const quotation = await Quotation.findByPk(quotationId)
    if (!quotation) {
      return res.status(404).json({ success: false, error: { code: "RES_001", message: "Not found" } })
    }

    await applyRetrieveFromMetering(quotation)
    const data = quotationToApiJson(quotation)
    return res.json({ success: true, data })
  } catch (e) {
    const status = e?.status || 500
    return res.status(status).json({
      success: false,
      error: { code: e?.code || "SYS_001", message: e?.message || "Internal error" },
    })
  }
}

/**
 * Optional: same handler on metering-handoff with retrieve flag
 *
 * PATCH /api/admin/quotations/:id/metering-handoff
 * { "retrieveFromMetering": true, "target": "installer_approved", "allowRevert": true }
 */

/*
router.patch("/admin/quotations/:id/retrieve-from-metering", authAdmin, postAdminRetrieveFromMetering)
router.post ("/admin/quotations/:id/retrieve-from-metering", authAdmin, postAdminRetrieveFromMetering)
*/

// -----------------------------------------------------------------------------
// GET after retrieve — MUST echo on next list load (frontend no longer relies only on localStorage)
// -----------------------------------------------------------------------------
/*
{
  "installationStatus": "installer_approved",
  "installation_status": "installer_approved",
  "meteringStatus": null or "",
  "metering_status": null or "",
  "installationReadyForInstaller": true,   // unchanged
  "installationReleasedAt": "…"           // unchanged
}
*/

// -----------------------------------------------------------------------------
// QA
// -----------------------------------------------------------------------------
/*
1. Send quotation to Metering (pending_metering).
2. Admin → Quotations → Retrieve → 200.
3. GET row: installation_status = installer_approved; metering_status empty/null.
4. Row NOT in Meter Pending queue; Send to Metering available again on Quotations.
5. Retrieve from metering_approved → 409.
*/
