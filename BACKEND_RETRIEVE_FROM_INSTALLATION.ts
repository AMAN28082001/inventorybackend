// @ts-nocheck
/**
 * =============================================================================
 * BACKEND — **Retrieve from Installation** (undo Send to Installer)
 * =============================================================================
 *
 * Frontend:
 *   - Admin → Installation → Pending / Partial / In progress → **Revert** (↺)
 *   - Account Management → Payment Management → **Sent to installer** → **Revert**
 *   - `lib/api.ts` → `retrieveQuotationFromInstallation`
 *   - `lib/operational-install-queue.ts` → `getRetrieveFromInstallationState`
 *
 * Product:
 *   Undo Account Management **Send to Installer**. Row leaves Admin Installation tab
 *   and Accounts shows **Send to Installer** again.
 *
 * NOT the same as:
 *   - Admin Installation **Revert** on Approved tab (installer_approved → pending_installer)
 *     — `BACKEND_INSTALLATION_REVERT.ts`
 *   - **Retrieve from Metering** — `BACKEND_RETRIEVE_FROM_METERING.ts`
 *
 * =============================================================================
 */

const LATE_BLOCK_RETRIEVE = new Set([
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

function requireAdminOrAccounts(req, res) {
  const user = req.user || req.dealer
  if (!user || !["admin", "account-management"].includes(user.role)) {
    res.status(403).json({ success: false, error: { code: "AUTH_004", message: "Forbidden" } })
    return null
  }
  return user
}

function isReleased(q) {
  return Boolean(
    q.installation_ready_for_installer ||
      q.installationReadyForInstaller ||
      q.installation_released_at ||
      q.installationReleasedAt,
  )
}

/**
 * Clear release flags. Optionally reset early install workflow when not late metering.
 */
export async function applyRetrieveFromInstallation(quotation, { force = false } = {}) {
  if (!isReleased(quotation) && !force) {
    const err = new Error("Quotation was not released to installer.")
    err.status = 409
    err.code = "WF_RETRIEVE_INSTALL_001"
    throw err
  }

  const metering = norm(quotation.metering_status || quotation.meteringStatus)
  const install = norm(quotation.installation_status || quotation.installationStatus)

  if (LATE_BLOCK_RETRIEVE.has(metering) || LATE_BLOCK_RETRIEVE.has(install)) {
    const err = new Error(
      "Cannot retrieve from Installation — quotation is already in Metering (approved or later).",
    )
    err.status = 409
    err.code = "WF_RETRIEVE_INSTALL_002"
    throw err
  }

  // Clear release gate — Installation tab hides row when these are false/null.
  const updates = {
    installationReadyForInstaller: false,
    installation_ready_for_installer: false,
    installationReleasedAt: null,
    installation_released_at: null,
  }

  // Optional: reset workflow to pre-installer if still in open install stages.
  // Frontend allows revert from pending_installer / in_progress / partial without requiring this.
  if (
    !install ||
    install === "pending_installer" ||
    install === "installer_in_progress" ||
    install === "in_progress" ||
    install === "installer_partial_approved" ||
    install === "partial_approved"
  ) {
    updates.installationStatus = null
    updates.installation_status = null
  }

  // Do NOT change quotations.status (stays approved).
  // Do NOT delete installation photos / S3 URLs.

  await quotation.update(updates)
  await quotation.reload()
  return quotation
}

/**
 * PATCH|POST /api/admin/quotations/:id/retrieve-from-installation
 *
 * Body from frontend:
 * {
 *   "installationReadyForInstaller": false,
 *   "installation_ready_for_installer": false,
 *   "installationReleasedAt": null,
 *   "installation_released_at": null,
 *   "retrieveFromInstallation": true,
 *   "allowRevert": true,
 *   "source": "retrieve-from-installation"
 * }
 */
export async function postAdminRetrieveFromInstallation(req, res) {
  const user = requireAdminOrAccounts(req, res)
  if (!user) return
  const quotationId = req.params.quotationId || req.params.id
  const body = req.body || {}
  const force = body.force === true || body.adminOverride === true || body.allowRevert === true

  try {
    const quotation = await Quotation.findByPk(quotationId)
    if (!quotation) {
      return res.status(404).json({ success: false, error: { code: "RES_001", message: "Not found" } })
    }

    await applyRetrieveFromInstallation(quotation, { force })
    return res.json({ success: true, data: quotationToApiJson(quotation) })
  } catch (e) {
    const status = e?.status || 500
    return res.status(status).json({
      success: false,
      error: { code: e?.code || "SYS_001", message: e?.message || "Internal error" },
    })
  }
}

/**
 * ALSO ACCEPT on existing release route (frontend fallback):
 *
 * PATCH /api/quotations/:id/installation-release
 * {
 *   "installationReadyForInstaller": false,
 *   "installation_ready_for_installer": false,
 *   "installationReleasedAt": null,
 *   "installation_released_at": null,
 *   "retrieveFromInstallation": true,
 *   "allowRevert": true
 * }
 *
 * Must NOT wipe installments / payment phases when body only contains release flags.
 */

/*
router.patch("/admin/quotations/:id/retrieve-from-installation", authAdminOrAm, postAdminRetrieveFromInstallation)
router.post ("/admin/quotations/:id/retrieve-from-installation", authAdminOrAm, postAdminRetrieveFromInstallation)
router.patch("/quotations/:id/retrieve-from-installation", authAdminOrAm, postAdminRetrieveFromInstallation)
router.patch("/quotations/:id/installation-release", authAdminOrAm, patchInstallationReleaseMerge)
*/

// -----------------------------------------------------------------------------
// GET after retrieve
// -----------------------------------------------------------------------------
/*
{
  "installationReadyForInstaller": false,
  "installation_ready_for_installer": false,
  "installationReleasedAt": null,
  "installation_released_at": null
}
*/

// Installer queue GET must EXCLUDE this quotation id until released again.

// -----------------------------------------------------------------------------
// QA
// -----------------------------------------------------------------------------
/*
1. Accounts → Send to Installer → row in Admin Installation Pending.
2. Admin Installation → Revert (↺) → 200.
3. GET: installationReadyForInstaller = false; Accounts shows Send to Installer.
4. Installer queue does not list the quotation.
5. metering_approved row → Revert disabled / 409.
*/
