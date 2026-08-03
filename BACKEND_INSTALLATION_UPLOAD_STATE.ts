// @ts-nocheck
/**
 * =============================================================================
 * BACKEND — Installation completion upload state gate (Aug 2026)
 * =============================================================================
 *
 * Symptom (Admin / Installer toast):
 *   Upload failed — Installation upload not allowed for this quotation state
 *
 * Cause:
 *   POST …/documents (installer completion) rejects when
 *   installation_status is still `pending_installer` (or empty / released).
 *   Admin Pending Installation tab submits Complete / Partial without requiring
 *   a separate Start click — backend must allow that.
 *
 * Frontend workaround (already shipped):
 *   Before upload, PATCH …/installation-status → `installer_in_progress`, then
 *   POST documents with force / adminOverride / allowFromPendingInstaller.
 *   Still retry once if the state error returns.
 *
 * Backend should still fix the gate so upload works even if Start PATCH fails.
 *
 * Related: BACKEND_INSTALLATION_COMPLETION_MULTER.ts (§26), HANDOFF §29
 * Routes: same as §26 Multer doc
 *   POST /api/installer/quotations/:quotationId/documents
 *   POST /api/admin/quotations/:quotationId/installer-documents
 *   POST /api/admin/installer/quotations/:quotationId/documents
 *
 * =============================================================================
 */

/** Statuses that may upload completion / partial docs. */
export const INSTALLATION_UPLOAD_ALLOWED_FROM = new Set([
  "",
  "pending_installer",
  "pending",
  "released",
  "sent_to_installer",
  "installer_in_progress",
  "in_progress",
  "installer_partial_approved",
  // Re-upload / edit after full approve (admin edit photos)
  "installer_approved",
])

/** Statuses that must never accept a new completion upload. */
export const INSTALLATION_UPLOAD_BLOCKED = new Set([
  "installer_rejected",
  "pending_metering",
  "metering_in_progress",
  "metering_approved",
  "meter_installation_pending",
  "mco",
  "pending_baldev",
  "baldev_approved",
  "completed",
])

export function normalizeInstallStatus(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
}

/**
 * Call at the start of the completion-documents handler (after auth + load quotation).
 *
 * Rules:
 *   1) Admin JWT (or body.force / adminOverride / allowFromPendingInstaller):
 *        allow from any status in INSTALLATION_UPLOAD_ALLOWED_FROM
 *        (especially pending_installer).
 *   2) Installer JWT: same allow-list.
 *   3) If status is empty/null after Send to Installer → treat as pending_installer.
 *   4) On success, if body.installationStatus is installer_approved /
 *      installer_partial_approved, persist that (do not require prior in_progress).
 *   5) Optional: if current is pending_installer and upload succeeds, set
 *      installer_in_progress first then target status in one transaction.
 */
export function assertInstallationUploadAllowed(args) {
  const {
    quotation,
    role, // "admin" | "installer" | "installation-team" | …
    body = {},
  } = args

  const current = normalizeInstallStatus(
    quotation?.installationStatus ?? quotation?.installation_status,
  )

  const force =
    body.force === true ||
    body.force === "true" ||
    body.adminOverride === true ||
    body.adminOverride === "true" ||
    body.allowFromPendingInstaller === true ||
    body.allowFromPendingInstaller === "true" ||
    role === "admin" ||
    role === "superadmin" ||
    role === "super_admin"

  if (INSTALLATION_UPLOAD_BLOCKED.has(current) && !force) {
    return {
      ok: false,
      status: 409,
      code: "WF_INSTALL_001",
      message: "Installation upload not allowed for this quotation state",
    }
  }

  // Allow pending_installer (and empty) always for admin; for installer too —
  // completing from Pending without a separate Start is product intent.
  if (!current || INSTALLATION_UPLOAD_ALLOWED_FROM.has(current)) {
    return { ok: true }
  }

  if (force) {
    return { ok: true }
  }

  return {
    ok: false,
    status: 409,
    code: "WF_INSTALL_001",
    message: "Installation upload not allowed for this quotation state",
  }
}

/**
 * Example Express handler sketch (wire into your existing documents route).
 *
 *   router.post(
 *     '/installer/quotations/:quotationId/documents',
 *     authInstallerOrAdmin,
 *     installationCompletionUpload, // Multer — see §26
 *     postInstallationCompletionDocuments,
 *   )
 */
export async function postInstallationCompletionDocuments(req, res, db) {
  try {
    const user = req.admin ?? req.installer ?? req.user
    const role = String(user?.role || "").toLowerCase()
    const quotationId = req.params.quotationId || req.params.id
    const quotation = await db.quotations.findById(quotationId)
    if (!quotation) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_001", message: "Quotation not found" },
      })
    }

    const gate = assertInstallationUploadAllowed({
      quotation,
      role,
      body: req.body || {},
    })
    if (!gate.ok) {
      return res.status(gate.status).json({
        success: false,
        error: { code: gate.code, message: gate.message },
      })
    }

    const targetRaw = String(
      req.body?.installationStatus || req.body?.installation_status || "",
    )
      .trim()
      .toLowerCase()
    const target =
      targetRaw === "installer_partial_approved"
        ? "installer_partial_approved"
        : targetRaw === "installer_approved"
          ? "installer_approved"
          : null

    // … upload files to S3, persist URLs, legs, expenses, remarks …

    if (target) {
      await db.quotations.updateById(quotationId, {
        installationStatus: target,
        installation_status: target,
        ...(target === "installer_approved"
          ? { installerApprovedAt: new Date(), installer_approved_at: new Date() }
          : {
              installationPartialApproved: true,
              installation_partial_approved: true,
            }),
      })
    } else if (
      normalizeInstallStatus(quotation.installationStatus ?? quotation.installation_status) ===
        "pending_installer" ||
      !normalizeInstallStatus(quotation.installationStatus ?? quotation.installation_status)
    ) {
      // Upload without target status → at least move Pending → In Progress
      await db.quotations.updateById(quotationId, {
        installationStatus: "installer_in_progress",
        installation_status: "installer_in_progress",
      })
    }

    return res.status(200).json({
      success: true,
      data: {
        id: quotationId,
        installationStatus: target || "installer_in_progress",
        // … echo uploaded URLs …
      },
    })
  } catch (error) {
    console.error("[installation-completion]", error)
    return res.status(500).json({
      success: false,
      error: { code: "SYS_001", message: "Internal error" },
    })
  }
}

/**
 * Also accept Start without upload:
 *   PATCH /api/admin|installer/quotations/:id/installation-status
 *   { "installationStatus": "installer_in_progress", "force": true }
 *
 * Frontend may call this before documents POST. Idempotent 200.
 */

/**
 * =============================================================================
 * QA
 * =============================================================================
 *
 * 1. Quotation with installation_status = pending_installer (Pending tab).
 * 2. Admin JWT: POST …/documents with installationStatus=installer_approved
 *    (photos optional for admin) → **200**, not 409 / “not allowed for this quotation state”.
 * 3. GET row → installationStatus = installer_approved (or installer_partial_approved).
 * 4. Installer JWT: same from pending_installer → 200.
 * 5. Quotation already pending_metering without force → may 409 (OK).
 * 6. body.force=true / adminOverride=true still allowed for admin re-edit when needed.
 */

export default {
  INSTALLATION_UPLOAD_ALLOWED_FROM,
  INSTALLATION_UPLOAD_BLOCKED,
  assertInstallationUploadAllowed,
  postInstallationCompletionDocuments,
  normalizeInstallStatus,
}
