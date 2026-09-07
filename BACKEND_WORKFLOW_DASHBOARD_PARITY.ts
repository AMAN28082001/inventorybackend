/**
 * BACKEND — Workflow dashboard parity (Installation / Metering / Final confirmation)
 *
 * Individual dashboards now mirror Admin UI. Implement list auth + scope rules below.
 *
 * Markdown: BACKEND_WORKFLOW_DASHBOARD_PARITY.md
 * Also: BACKEND_USER_FIELD_PERMISSIONS.ts, REQUIRED §AK, HANDOFF §42
 */

export type WorkflowModuleKey = "accounts" | "installation" | "metering" | "final_confirmation"

export type ModulePermissionRule = {
  level: "none" | "read" | "write"
  scope: "everyone" | "selected_users" | "office_only"
  selectedUserIds: string[]
}

export type AuthUser = {
  id: string
  role: string
  officeLocation?: string | null
  access?: string[]
  moduleFieldPermissions?: Partial<Record<WorkflowModuleKey, ModulePermissionRule>>
}

/**
 * =============================================================================
 * 1. Scope semantics (match `lib/module-field-permissions.ts`)
 * =============================================================================
 *
 * | scope          | UI           | Record filter |
 * |----------------|--------------|---------------|
 * | everyone       | Everyone     | All workflow rows (level ≠ none) |
 * | selected_users | Selected one | quotation.dealerId ∈ selectedUserIds |
 * | office_only    | Only there   | office match OR dealerId === viewer.id |
 *
 * selectedUserIds = dealer/user IDs picked in Admin (NOT "viewer must be in list").
 */

export function normalizeScope(scope: string): "everyone" | "selected_users" | "office_only" {
  if (scope === "everyone_except_dealer") return "everyone"
  return scope as "everyone" | "selected_users" | "office_only"
}

export function recordMatchesWorkflowScope(
  user: AuthUser,
  rule: ModulePermissionRule,
  quotation: { dealerId?: string; officeLocation?: string },
): boolean {
  if (user.role === "admin" || user.role === "super-admin") return true
  const scope = normalizeScope(rule.scope ?? "everyone")
  if (scope === "everyone") return true
  if (scope === "selected_users") {
    if (!rule.selectedUserIds?.length) return false
    const dealerId = String(quotation.dealerId ?? "").trim()
    return Boolean(dealerId && rule.selectedUserIds.includes(dealerId))
  }
  if (scope === "office_only") {
    const recordOffice = String(quotation.officeLocation ?? "").trim()
    const viewerOffice = String(user.officeLocation ?? "").trim()
    if (recordOffice && viewerOffice) return recordOffice === viewerOffice
    const dealerId = String(quotation.dealerId ?? "").trim()
    return Boolean(dealerId && dealerId === String(user.id))
  }
  return true
}

/**
 * =============================================================================
 * 2. GET /admin/quotations — auth expansion (P0)
 * =============================================================================
 *
 * Allow non-admin JWT when user has module access + scope everyone + level ≠ none:
 *
 *   accounts | installation | metering | final_confirmation
 *
 * Response: ALL quotations for admin list (no dealerId = req.user.id filter when everyone).
 *
 * Alternatives:
 *   GET /installation/quotations
 *   GET /metering/quotations
 *   GET /final-confirmation/quotations
 */

export function canAccessFullAdminQuotationList(user: AuthUser, module: WorkflowModuleKey): boolean {
  if (user.role === "admin" || user.role === "super-admin") return true
  const rule = user.moduleFieldPermissions?.[module]
  if (!rule || rule.level === "none") return false
  return normalizeScope(rule.scope) === "everyone"
}

/**
 * =============================================================================
 * 3. Frontend load paths (what to support)
 * =============================================================================
 *
 * | Module            | Frontend when scope === everyone |
 * |-------------------|----------------------------------|
 * | accounts          | getApprovedForAccounts() → /account-management/quotations → /admin/quotations |
 * | installation      | getWorkflowDashboardList() → admin → account-mgmt → installer → /quotations |
 * | metering          | MeteringWorkflowPanel → getWorkflowDashboardList() + installer queue |
 * | final_confirmation| FinalConfirmationWorkflowPanel → getWorkflowDashboardList() |
 *
 * getWorkflowDashboardList: lib/api.ts — tries routes in order with suppressErrorLog on 403.
 */

/**
 * =============================================================================
 * 4. Required list fields (P0)
 * =============================================================================
 *
 * Common: dealerId, officeLocation, nested dealer
 *
 * Installation: installationReadyForInstaller, installationReleasedAt, installationStatus,
 *   installationScheduledAt, installationTeamId, install photo URLs
 *
 * Metering: installationStatus, meteringStage/Status, meteringApprovedAt, mcoAt,
 *   discomName, meterType, meterNo, remarks, authorizedRepresentative, meter/MCO URLs
 *
 * Final confirmation: installationStatus (installer_approved | pending_baldev | baldev_approved),
 *   dcrGenerated, installerApprovedAt, products/system kW,
 *   customerFinalBillFileUrl, panelWarrantyFileUrl, inverterWarrantyFileUrl,
 *   workCompletionWarrantyFileUrl (+ name columns)
 */

/**
 * =============================================================================
 * 5. Mutations (P0)
 * =============================================================================
 *
 * | Action              | Route example                                      |
 * |---------------------|----------------------------------------------------|
 * | Install in progress | PATCH …/installation-status → installer_in_progress |
 * | Install approved    | POST installer documents + status installer_approved |
 * | Metering stages     | PATCH metering / operational status routes         |
 * | Final docs          | POST …/final-confirmation-documents (4 files)        |
 * | Final approved      | PATCH operational-status → baldev_approved         |
 *
 * assertWorkflowWrite(user, module, quotation) before each mutation.
 * 403: { code: "FIELD_PERMISSION_DENIED" }
 */

export const FINAL_CONFIRMATION_UPLOAD_FIELDS = [
  "customerFinalBillFile",
  "panelWarrantyFile",
  "inverterWarrantyFile",
  "workCompletionWarrantyFile",
] as const

/**
 * =============================================================================
 * 6. QA
 * =============================================================================
 *
 * 1. Installation everyone → GET /admin/quotations 200, all sent-to-installer rows, all dealers
 * 2. Selected one [dealer-A, dealer-B] → only those dealerIds in list + mutations
 * 3. Only there Ajmer → officeLocation Ajmer only
 * 4. Final confirmation PATCH baldev_approved for baldev write user
 * 5. Read-only level → 403 on POST/PATCH
 */
