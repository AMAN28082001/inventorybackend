// @ts-nocheck
/**
 * =============================================================================
 * BACKEND — Admin Installation **Revert** (approved → pending_installer)
 * =============================================================================
 *
 * UI: Admin → Installation → **Approved Installation** → **Revert**
 * Frontend: `api.admin.quotations.revertInstallationToPending` in `lib/api.ts`
 * Related: `BACKEND_INSTALLATION_RELEASE.md`, HANDOFF §35, REQUIRED §AH
 *
 * Symptom:
 *   Clicking Revert does nothing / row stays on Approved Installation.
 *
 * Causes (fix all):
 *   1) PATCH installation-status **rejects** `installer_approved` → `pending_installer`
 *      (one-way workflow guard).
 *   2) Handler writes `quotations.status = 'pending_installer'`. That column is
 *      quotation lifecycle (`pending` | `approved` | `rejected`), not install
 *      workflow. Enum/check constraint → **400**.
 *   3) After a successful PATCH, list GET still classifies the row as approved
 *      because `GET /installer/quotations?status=approved` still returns the id,
 *      or `installer_approved_at` is left set, or queue filter ignores
 *      `installation_status`.
 *
 * Photos: **do not delete** S3 objects. Revert is “send back to pending so they
 * can re-upload / re-approve”. Files may remain on the quotation.
 *
 * =============================================================================
 */

export const INSTALLATION_REVERT_ALLOWED_FROM = new Set([
  "installer_approved",
  "installer_partial_approved",
  "partial_approved",
  "installer_in_progress",
  "in_progress",
  "pending_installer", // idempotent
])

export function normalizeInstallStatus(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
}

/**
 * Apply admin revert. Call from:
 *   PATCH /api/admin/quotations/:id/installation-status
 *   PATCH /api/admin/quotations/:id/workflow-status
 *   PATCH /api/installer/quotations/:id/installation-status
 *   POST  /api/admin/quotations/:id/revert-installation   (optional dedicated)
 *
 * Body (frontend sends all of these):
 *   installationStatus / installation_status = "pending_installer"
 *   force: true
 *   adminOverride: true
 *   allowRevert: true
 *   source: "admin-install-revert"
 *   installerApprovedAt: null
 *   installationPartialApproved: false
 *
 * Auth: role **admin** (or equivalent).
 */
export async function revertInstallationToPending(req, quotation) {
  const next = normalizeInstallStatus(
    req.body?.installationStatus || req.body?.installation_status || "pending_installer",
  )
  if (next !== "pending_installer") {
    throw Object.assign(new Error("Revert target must be pending_installer"), { status: 400 })
  }

  const current = normalizeInstallStatus(quotation.installation_status)
  if (current && !INSTALLATION_REVERT_ALLOWED_FROM.has(current)) {
    throw Object.assign(
      new Error(
        `Cannot revert installation from '${current}'. Allowed from installer_approved / partial / in_progress.`,
      ),
      { status: 409 },
    )
  }

  // NEVER write pending_installer onto quotations.status
  await db.query(
    `
    UPDATE quotations SET
      installation_status = 'pending_installer',
      installer_approved_at = NULL,
      installation_partial_approved = FALSE,
      updated_at = NOW()
    WHERE id = $1
    `,
    [quotation.id],
  )

  const row = await db.query(`SELECT * FROM quotations WHERE id = $1`, [quotation.id]).then((r) => r.rows[0])
  return serializeQuotation(row)
}

/**
 * PATCH /installation-status dispatcher:
 *   if body.installationStatus === 'pending_installer' && (admin || body.allowRevert)
 *     → revertInstallationToPending (do not run “forward-only” transition table)
 */

/**
 * GET /api/installer/quotations?status=approved
 * MUST exclude rows where installation_status = 'pending_installer'.
 *
 * GET /api/installer/quotations?status=pending_installer
 * MUST include reverted rows (even if document URLs still exist).
 *
 * GET /api/admin/quotations
 * Echo:
 *   installationStatus / installation_status
 *   installerApprovedAt / installer_approved_at  (null after revert)
 *   installationPartialApproved                  (false after revert)
 *
 * Classification for Admin tabs (backend queues should match):
 *   pending_installer | installer_in_progress  → Pending Installation
 *   installer_partial_approved                 → Partial Approved
 *   installer_approved                         → Approved Installation
 * Presence of photos alone is NOT enough to keep a row in Approved after revert.
 */

export function serializeAfterRevert(row) {
  return {
    id: row.id,
    status: row.status, // still "approved" (quotation), unchanged
    installationStatus: "pending_installer",
    installation_status: "pending_installer",
    installerApprovedAt: null,
    installer_approved_at: null,
    installationPartialApproved: false,
    installation_partial_approved: false,
  }
}
