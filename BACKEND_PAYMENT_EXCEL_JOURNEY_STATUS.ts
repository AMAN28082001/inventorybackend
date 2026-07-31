// @ts-nocheck
/**
 * =============================================================================
 * BACKEND REFERENCE — Payment Management Excel (Customer Journey columns)
 * =============================================================================
 *
 * Frontend (Jul 2026):
 *   - `app/dashboard/account-management/page.tsx` → Payment Management → **Download Excel**
 *   - `lib/customer-journey.ts` → `getJourneyStageProgress`, `resolveMeteringJourneyStatus`, `formatJourneyStageStatusLabel`
 *
 * Implemented in this repo (HANDOFF §24):
 *   - utils/paymentExcelJourneyStatus.ts — deriveMeteringStage + journeyStageProgress.metering
 *   - utils/meteringWorkflowApi.ts — meteringStatus / meteringWccAfterDiscom echo
 *   - GET /quotations, /admin/quotations, /metering/quotations include fields + journey labels
 *
 * Export is **client-side CSV** (no new download endpoint required). Backend must return
 * workflow fields on the approved quotation list so journey columns are accurate after
 * refresh on any device.
 *
 * -----------------------------------------------------------------------------
 * Endpoint (existing)
 * -----------------------------------------------------------------------------
 *
 *   GET /api/quotations?status=approved&page=1&limit=1000
 *
 * Auth: `account-management`, `admin`
 * Must return only `status = approved` rows for account-management role.
 *
 * -----------------------------------------------------------------------------
 * New Excel columns (appended after payment amounts)
 * -----------------------------------------------------------------------------
 *
 * | CSV header                  | Source |
 * |-----------------------------|--------|
 * | Installment Count           | `installments` / `paymentPhases` array `.length` |
 * | Admin Approval Status       | Journey stage 1 — Pending / In Progress / Completed |
 * | Installation Status         | Journey stage 2 |
 * | Metering Status             | Journey stage 3 |
 * | Final Confirmation Status   | Journey stage 4 |
 * | File Status                 | Overall hold label (last column) |
 *
 * Stage labels must match `lib/customer-journey.ts` (see helpers below).
 *
 * -----------------------------------------------------------------------------
 * Required fields on each approved list row
 * -----------------------------------------------------------------------------
 *
 * | Field (camelCase) | snake_case aliases | Purpose |
 * |-------------------|--------------------|---------|
 * | `status` | — | Admin approval gate (`approved` → Admin Approval = Completed) |
 * | `installationStatus` | `installation_status` | Installation + File Status |
 * | `meteringStage` | `metering_stage` | Metering workflow (preferred when split from install) |
 * | `meteringStatus` | `metering_status` | Alias |
 * | `mcoStatus` | `mco_status` | Final Step / MCO |
 * | `meteringWccAfterDiscom` | `metering_wcc_after_discom` | WCC Pending flag (FILE STATUS → In Progress) |
 * | `installationReadyForInstaller` | `installation_ready_for_installer` | Send-to-installer badge (UI; optional for journey) |
 * | `installationReleasedAt` | `installation_released_at` | Same |
 * | `installments` | `payment_phases`, `paymentPhases` | Installment count column |
 * | `statusApprovedAt` | `status_approved_at`, `approved_at` | Existing export |
 * | `fileLoginAt` | `file_login_at` | Existing export |
 * | `fileLoginStatus` | `file_login_status` | Existing export |
 *
 * **Do not** omit `installationStatus` on account-management list GET — without it every
 * row exports as **Workflow Pending** / installation **Pending** even when admin/installer
 * dashboards show progress.
 *
 * -----------------------------------------------------------------------------
 * Metering FILE STATUS (Payment Management + dashboards) — Jul 2026
 * -----------------------------------------------------------------------------
 *
 * Align labels with Admin → Metering tabs. Frontend: `resolveMeteringJourneyStatus`
 * in `lib/customer-journey.ts`.
 *
 * | Admin Metering tab              | Persist / return                          | FILE STATUS → Metering |
 * |---------------------------------|-------------------------------------------|-------------------------|
 * | Meter Pending                   | `pending_metering`                        | **Pending**             |
 * | Meter in Discom                 | `metering_approved` (or stage `approved`) | **In Progress**         |
 * | WCC Pending                     | `meteringWccAfterDiscom: true`            | **In Progress**         |
 * | Meter Installation Pending      | `meter_installation_pending`              | **In Progress**         |
 * | Final Step                      | `mco`                                     | **Completed**           |
 * | After Final Step (Baldev+)      | `pending_baldev` / `baldev_approved` / `completed` | **Completed**  |
 * | Not sent to metering yet        | (no metering stage)                       | **Pending**             |
 *
 * Labels for Excel / UI: `Pending` | `In Progress` | `Completed`
 * (`formatJourneyStageStatusLabel`).
 *
 * Persist these on every transition and return them on:
 *   GET /api/quotations?status=approved
 *   GET /api/admin/quotations
 *   GET /api/metering/quotations
 *
 * -----------------------------------------------------------------------------
 * Optional — pre-computed journey block (recommended for reporting / future server export)
 * -----------------------------------------------------------------------------
 *
 * Return on each row (or nested under `quotation`):
 *
 * {
 *   "journeyStageProgress": {
 *     "adminApproval": "completed" | "pending" | "in_progress",
 *     "installation": "completed" | "pending" | "in_progress",
 *     "metering": "completed" | "pending" | "in_progress",
 *     "finalConfirmation": "completed" | "pending" | "in_progress"
 *   },
 *   "fileStatus": "Pending Metering",
 *   "journeyHolder": "Metering"
 * }
 *
 * Frontend **today** computes these client-side from raw workflow fields; pre-computed
 * values are optional but must match logic below if added.
 *
 * -----------------------------------------------------------------------------
 * Journey logic (must match `lib/customer-journey.ts`)
 * -----------------------------------------------------------------------------
 */

type JourneyStageStatus = "completed" | "pending" | "in_progress"

function getInstallationWorkflowStatus(q: Record<string, unknown>): string {
  return String(q.installationStatus || q.installation_status || "").toLowerCase()
}

function getMeteringWorkflowRaw(q: Record<string, unknown>): string {
  return String(
    q.meteringStage ||
      q.metering_stage ||
      q.meteringStatus ||
      q.metering_status ||
      q.mcoStatus ||
      q.mco_status ||
      "",
  ).toLowerCase()
}

function isInstallationCompleteForMetering(q: Record<string, unknown>): boolean {
  const install = getInstallationWorkflowStatus(q)
  return (
    install === "installer_approved" ||
    install === "completed" ||
    install === "pending_baldev" ||
    install === "baldev_approved"
  )
}

export function formatJourneyStageStatusLabel(status: JourneyStageStatus): string {
  if (status === "completed") return "Completed"
  if (status === "in_progress") return "In Progress"
  return "Pending"
}

export function getJourneyStageProgress(q: Record<string, unknown>) {
  const approvalStatus = String(q.status || "pending").toLowerCase()
  const installStatus = getInstallationWorkflowStatus(q)
  const meteringRaw = getMeteringWorkflowRaw(q)
  const meteringStage =
    meteringRaw ||
    (["pending_metering", "metering_in_progress", "metering_approved", "mco"].includes(installStatus)
      ? installStatus
      : "")

  const adminApproval: JourneyStageStatus =
    approvalStatus === "approved" ? "completed" : "pending"

  let installation: JourneyStageStatus = "pending"
  let metering: JourneyStageStatus = "pending"
  let finalConfirmation: JourneyStageStatus = "pending"

  if (installStatus === "installer_in_progress" || installStatus === "pending_installer") {
    installation = "in_progress"
  }
  if (isInstallationCompleteForMetering(q)) {
    installation = "completed"
  }

  // Metering FILE STATUS (align Admin Metering tabs):
  // Final Step (mco) → Completed
  // Meter Pending (pending_metering) → Pending
  // Meter in Discom / WCC / Meter Installation → In Progress
  const wccFlag = q.meteringWccAfterDiscom ?? q.metering_wcc_after_discom
  const isWcc =
    wccFlag === true || wccFlag === 1 || wccFlag === "true" || wccFlag === "1"
  if (
    ["pending_baldev", "baldev_approved", "completed"].includes(installStatus) ||
    ["pending_baldev", "baldev_approved", "completed", "mco"].includes(meteringStage) ||
    meteringStage.includes("mco")
  ) {
    metering = "completed"
  } else if (
    isWcc ||
    ["metering_approved", "metering_in_progress", "meter_installation_pending", "meter_install_pending"].includes(
      meteringStage,
    ) ||
    meteringStage.includes("meter_install")
  ) {
    metering = "in_progress"
  } else if (meteringStage === "pending_metering") {
    metering = "pending"
  } else {
    metering = "pending"
  }

  if (installStatus === "pending_baldev" || meteringStage === "pending_baldev") {
    finalConfirmation = "in_progress"
  }
  if (
    installStatus === "baldev_approved" ||
    installStatus === "completed" ||
    meteringStage === "baldev_approved"
  ) {
    finalConfirmation = "completed"
  }

  return { adminApproval, installation, metering, finalConfirmation }
}

export function getJourneyHoldInfo(q: Record<string, unknown>) {
  const opsStatus = getInstallationWorkflowStatus(q)
  const approvalStatus = String(q.status || "pending").toLowerCase()

  if (approvalStatus !== "approved") {
    return { holder: "Admin Approval", stageLabel: "Pending Admin Approval" }
  }
  if (opsStatus === "pending_installer") {
    return { holder: "Installer", stageLabel: "Pending Installer" }
  }
  if (opsStatus === "installer_in_progress") {
    return { holder: "Installer", stageLabel: "Installer In Progress" }
  }
  if (opsStatus === "installer_approved") {
    return { holder: "Metering", stageLabel: "Pending Metering" }
  }
  if (opsStatus === "pending_metering" || opsStatus === "metering_in_progress") {
    return { holder: "Metering", stageLabel: "Metering Processing" }
  }
  if (opsStatus === "metering_approved") {
    return { holder: "Metering", stageLabel: "Metering Approved" }
  }
  if (opsStatus === "mco") {
    return { holder: "Metering", stageLabel: "MCO Docs Pending" }
  }
  if (opsStatus === "pending_baldev") {
    return { holder: "Baldev", stageLabel: "Pending Final Confirmation" }
  }
  if (opsStatus === "baldev_approved" || opsStatus === "completed") {
    return { holder: "Completed", stageLabel: "Final Approved" }
  }
  return { holder: "Operations", stageLabel: "Workflow Pending" }
}

/**
 * Example: build Excel journey cells for one quotation row
 */
export function buildPaymentExcelJourneyCells(q: Record<string, unknown>) {
  const progress = getJourneyStageProgress(q)
  const hold = getJourneyHoldInfo(q)
  const installments = q.installments || q.paymentPhases || q.payment_phases || []
  const count = Array.isArray(installments) ? installments.length : 0
  return {
    installmentCount: count,
    adminApprovalStatus: formatJourneyStageStatusLabel(progress.adminApproval),
    installationStatus: formatJourneyStageStatusLabel(progress.installation),
    meteringStatus: formatJourneyStageStatusLabel(progress.metering),
    finalConfirmationStatus: formatJourneyStageStatusLabel(progress.finalConfirmation),
    fileStatus: hold.stageLabel,
  }
}

/**
 * -----------------------------------------------------------------------------
 * installation_status enum (workflow — keep in sync with installer/metering PATCH)
 * -----------------------------------------------------------------------------
 *
 *   pending_installer
 *   installer_in_progress
 *   installer_approved
 *   pending_metering
 *   metering_in_progress
 *   metering_approved
 *   mco
 *   pending_baldev
 *   baldiv_approved   (typo guard: also accept baldev_approved)
 *   baldev_approved
 *   completed
 *
 * When metering is stored separately, set meteringStage / metering_status instead of
 * overloading installation_status after installer_approved.
 *
 * -----------------------------------------------------------------------------
 * Sequelize / SQL — include on GET /quotations list serializer
 * -----------------------------------------------------------------------------
 *
 *   attributes: [
 *     'id', 'status', 'installation_status', 'metering_stage', 'metering_status',
 *     'mco_status', 'metering_wcc_after_discom',
 *     'installation_ready_for_installer', 'installation_released_at',
 *     'status_approved_at', 'file_login_at', 'file_login_status',
 *     // ... payment + dealer + customer fields from §6.5
 *   ],
 *   include: [
 *     { model: QuotationInstallment, as: 'installments' },
 *     { model: Customer, as: 'customer' },
 *     { model: Dealer, as: 'dealer' },
 *   ]
 *
 * -----------------------------------------------------------------------------
 * Checklist
 * -----------------------------------------------------------------------------
 *
 * - [ ] GET /api/quotations?status=approved returns installationStatus on every row
 * - [ ] meteringStage / meteringStatus returned when quotation is in metering pipeline
 * - [ ] meteringWccAfterDiscom returned for WCC Pending rows
 * - [ ] Metering FILE STATUS: Final Step=mco→Completed; Meter Pending→Pending; Discom/WCC/Install→In Progress
 * - [ ] installments array length matches DB after §AB replace
 * - [ ] PATCH installation-release / installer / metering / baldev updates reflected on next GET
 * - [ ] (Optional) journeyStageProgress + fileStatus on list rows for reporting
 *
 * -----------------------------------------------------------------------------
 * QA
 * -----------------------------------------------------------------------------
 *
 * 1. Approve quotation → Excel: Admin Approval = Completed, File Status = Pending Installer
 *    (after Send to Installer) or Workflow Pending (before release — depends on installation_status).
 * 2. Installer in progress → Installation = In Progress, File Status = Installer In Progress.
 * 3. installer_approved → Installation = Completed, File Status = Pending Metering.
 * 4. pending_metering → Metering Status = Pending (FILE STATUS column).
 * 5. metering_approved / WCC / meter_installation_pending → Metering Status = In Progress.
 * 6. mco (Final Step) → Metering Status = Completed.
 * 7. pending_baldev → Final Confirmation = In Progress, File Status = Pending Final Confirmation.
 * 8. baldev_approved → all four stages Completed, File Status = Final Approved.
 * 9. Refresh browser → Excel columns unchanged (no localStorage-only workflow).
 *
 * Related: BACKEND_CHANGES_REQUIRED.md §AC, BACKEND_CHANGES_HANDOFF.md §6 + **§24**,
 * BACKEND_INSTALLATION_RELEASE.md, BACKEND_METERING_DISCOM_WCC_METER_INSTALL.md.
 */
