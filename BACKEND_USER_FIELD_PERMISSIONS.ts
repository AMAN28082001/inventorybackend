// @ts-nocheck
/**
 * =============================================================================
 * BACKEND — Office location + workflow field permissions (read/write + scope)
 * =============================================================================
 *
 * UI: Admin → Users → Create/Edit User → **Dashboard access** section
 *   Each workflow dashboard row (Installation, Metering, Final confirmation) has:
 *     - Checkbox = can open that dashboard (`access[]`)
 *     - Field access dropdown = `none` | `read` | `write`
 *     - Who can access dropdown = scope + optional selected user IDs
 *       UI labels: Everyone | Selected one | Only there
 *
 * Office location (Jaipur / Ajmer / Chomu) is on the employee profile
 * (Personal Information). Used with scope `office_only`.
 *
 * Frontend:
 *   - `lib/module-field-permissions.ts`
 *   - `components/module-field-permissions-editor.tsx`
 *   - `app/dashboard/admin/page.tsx` (save payload)
 *   - `lib/auth-context.tsx` (login echo)
 *   - Dashboards: installer, metering, baldev (+ admin tabs use same rules when wired)
 *
 * Docs: `BACKEND_USER_FIELD_PERMISSIONS.md`, REQUIRED **§AK**, HANDOFF **§38**
 *
 * Until backend persists these fields, frontend uses localStorage overrides:
 *   - `userModulePermissionOverrides`
 *   - `userOfficeLocationOverrides`
 *
 * =============================================================================
 */

/** Allowed office locations */
export const OFFICE_LOCATIONS = ["Jaipur", "Ajmer", "Chomu"] as const
export type OfficeLocation = (typeof OFFICE_LOCATIONS)[number]

export type ModulePermissionLevel = "none" | "read" | "write"

export type ModulePermissionScope =
  | "everyone"
  | "selected_users"
  | "office_only"

export type WorkflowModuleKey = "installation" | "metering" | "final_confirmation"

export type ModulePermissionRule = {
  level: ModulePermissionLevel
  scope: ModulePermissionScope
  selectedUserIds: string[]
}

export type ModuleFieldPermissions = Partial<Record<WorkflowModuleKey, ModulePermissionRule>>

/**
 * Example persisted on user row (JSONB column or JSON text):
 */
export const EXAMPLE_MODULE_FIELD_PERMISSIONS: ModuleFieldPermissions = {
  installation: {
    level: "read",
    scope: "everyone",
    selectedUserIds: [],
  },
  metering: {
    level: "write",
    scope: "selected_users",
    selectedUserIds: ["user-uuid-1", "user-uuid-2"],
  },
  final_confirmation: {
    level: "write",
    scope: "office_only",
    selectedUserIds: [],
  },
}

/**
 * =============================================================================
 * 1. DATABASE
 * =============================================================================
 *
 * Add to **dealers**, **account_managers**, **visitors** (and baldev users if
 * separate table — often same as account_managers with role `baldev`):
 *
 *   office_location     VARCHAR(32) NULL
 *     CHECK (office_location IN ('Jaipur', 'Ajmer', 'Chomu') OR office_location IS NULL)
 *
 *   module_field_permissions JSONB NOT NULL DEFAULT '{}'::jsonb
 *
 * Optional index for office filter on quotations:
 *
 *   ALTER TABLE quotations ADD COLUMN IF NOT EXISTS office_location VARCHAR(32) NULL;
 *   -- or derive from dealer.office_location at create time
 *
 * Migration backfill:
 *   - Existing users: `{}` permissions → frontend treats missing keys as default write
 *     for users who already have dashboard access (see getModulePermissionRule default).
 *   - office_location NULL = "Not set" in UI.
 */

/**
 * =============================================================================
 * 2. VALIDATION (Zod / class-validator)
 * =============================================================================
 *
 * const modulePermissionRuleSchema = z.object({
 *   level: z.enum(["none", "read", "write"]),
 *   scope: z.enum(["everyone", "selected_users", "office_only"]),
 *   // preprocess input: everyone_except_dealer → everyone
 *   selectedUserIds: z.array(z.string().uuid()).default([]),
 * })
 *
 * const moduleFieldPermissionsSchema = z.object({
 *   installation: modulePermissionRuleSchema.optional(),
 *   metering: modulePermissionRuleSchema.optional(),
 *   final_confirmation: modulePermissionRuleSchema.optional(),
 * }).optional()
 *
 * const officeLocationSchema = z.enum(["Jaipur", "Ajmer", "Chomu"]).nullable().optional()
 *
 * Rules:
 *   - Accept snake_case aliases on input: office_location, module_permissions,
 *     selected_user_ids, finalConfirmation (camelCase module key).
 *   - Normalize output to camelCase `moduleFieldPermissions` + `officeLocation`.
 *   - If scope !== selected_users, coerce selectedUserIds to [].
 *   - If level === none, scope may still be stored but UI ignores scope.
 */

/**
 * =============================================================================
 * 3. API — user CRUD (accept + echo)
 * =============================================================================
 *
 * | Method | Path | Body fields (add) |
 * |--------|------|-------------------|
 * | POST   | /api/admin/account-managers | officeLocation, moduleFieldPermissions |
 * | PUT    | /api/admin/account-managers/:id | same |
 * | GET    | /api/admin/account-managers | echo on each row |
 * | GET    | /api/admin/account-managers/:id | echo |
 * | POST   | /api/admin/dealers | same (optional for dealers) |
 * | PUT    | /api/admin/dealers/:id | same |
 * | GET    | /api/admin/dealers | echo |
 * | POST   | /api/admin/visitors | same |
 * | PUT    | /api/admin/visitors/:id | same |
 * | GET    | /api/admin/visitors | echo |
 *
 * Accept aliases in request body:
 *   office_location, modulePermissions, module_permissions
 *
 * Example POST /api/admin/account-managers body (partial):
 */
export const EXAMPLE_CREATE_ACCOUNT_MANAGER_BODY = {
  username: "ops_jaipur",
  password: "…",
  firstName: "Aman",
  lastName: "Rajak",
  email: "aman@example.com",
  mobile: "9876543210",
  role: "installer",
  access: ["installation", "visitor"],
  permissions: ["installation", "visitor"],
  officeLocation: "Jaipur",
  office_location: "Jaipur",
  moduleFieldPermissions: {
    installation: {
      level: "read",
      scope: "office_only",
      selectedUserIds: [],
    },
    metering: {
      level: "none",
      scope: "everyone",
      selectedUserIds: [],
    },
    final_confirmation: {
      level: "none",
      scope: "everyone",
      selectedUserIds: [],
    },
  },
  modulePermissions: EXAMPLE_MODULE_FIELD_PERMISSIONS,
}

/**
 * Example GET list item (account-manager / dealer / visitor):
 */
export const EXAMPLE_USER_GET_RESPONSE = {
  id: "uuid",
  username: "ops_jaipur",
  firstName: "Aman",
  lastName: "Rajak",
  role: "installer",
  access: ["installation", "visitor"],
  permissions: ["installation", "visitor"],
  officeLocation: "Jaipur",
  moduleFieldPermissions: EXAMPLE_MODULE_FIELD_PERMISSIONS,
  isActive: true,
}

/**
 * =============================================================================
 * 4. API — login / session
 * =============================================================================
 *
 * POST /api/auth/login (and refresh / GET me if used) must echo on `user`:
 *
 *   user.officeLocation
 *   user.moduleFieldPermissions  (alias modulePermissions)
 *   user.access / user.permissions (existing)
 *
 * Example login response fragment:
 */
export const EXAMPLE_LOGIN_USER_FRAGMENT = {
  id: "uuid",
  username: "ops_jaipur",
  role: "installer",
  access: ["installation", "metering"],
  officeLocation: "Jaipur",
  moduleFieldPermissions: EXAMPLE_MODULE_FIELD_PERMISSIONS,
}

/**
 * Optional JWT claims (P2):
 *   officeLocation, moduleFieldPermissions (compact or omit — prefer DB on each request)
 */

/**
 * =============================================================================
 * 5. API — quotations (record scope for office_only / selected_users)
 * =============================================================================
 *
 * Frontend filters lists client-side using:
 *   - Viewer: user.officeLocation, user.id, user.moduleFieldPermissions
 *   - Record: quotation.officeLocation, quotation.dealerId (or dealer.id)
 *
 * Echo on quotation list + detail (P0 for office_only scope):
 *
 *   officeLocation / office_location   — "Jaipur" | "Ajmer" | "Chomu"
 *   dealerId / dealer_id               — UUID (for selected_users record filter)
 *   dealer: { id, firstName, lastName, … }  (existing)
 *
 * Source for office_location on quotation (pick one):
 *   A) Copy dealer.office_location at quotation create
 *   B) Copy customer office if captured at visit
 *   C) Admin-set field on quotation
 *
 * GET endpoints that should include these fields:
 *   - GET /api/quotations?status=approved (installer / metering / baldev queues)
 *   - GET /api/admin/quotations
 *   - GET /api/quotations/:id
 */

/**
 * =============================================================================
 * 6. Permission semantics (match frontend `lib/module-field-permissions.ts`)
 * =============================================================================
 *
 * ### level (per module: installation | metering | final_confirmation)
 *
 * | level  | List records | Edit / submit |
 * |--------|--------------|---------------|
 * | none   | Hidden       | Blocked       |
 * | read   | Visible      | UI read-only  |
 * | write  | Visible      | Allowed       |
 *
 * Admin / super-admin: always full access (frontend bypass).
 *
 * ### scope — Who can access (UI labels)
 *
 * | scope | UI label | Viewer check | Record check (list filter) |
 * |-------|----------|--------------|----------------------------|
 * | everyone | Everyone | Allow (dealers OK) | All records (if level ≠ none) |
 * | selected_users | Selected one | Viewer id in selectedUserIds | dealerId in selectedUserIds when set |
 * | office_only | Only there | Viewer officeLocation required | record.officeLocation === viewer office |
 *
 * Legacy: accept `everyone_except_dealer` on input; normalize to `everyone` (no dealer exclusion).
 *
 * Dashboard checkbox (`access` includes installation | metering | final_confirmation)
 * is separate: user must have dashboard access AND field level ≠ none to see data.
 *
 * ### Module → dashboard route
 *
 * | moduleFieldPermissions key | access[] key | Route |
 * |----------------------------|--------------|-------|
 * | installation | installation | /dashboard/installer |
 * | metering | metering | /dashboard/metering |
 * | final_confirmation | final_confirmation | /dashboard/baldev |
 */

/**
 * =============================================================================
 * 7. Server-side enforcement (P1 — recommended)
 * =============================================================================
 *
 * Do not rely only on frontend read-only. Enforce on mutating routes:
 *
 * | Module | Example routes | Rule |
 * |--------|----------------|------|
 * | installation | POST …/installer/quotations/:id/documents, PATCH operational install stage | canWriteWorkflowModule(installation) + record scope |
 * | metering | PATCH metering stage, meter document upload | canWriteWorkflowModule(metering) + record scope |
 * | final_confirmation | POST …/baldev/quotations/:id/final-confirmation-documents, final approve | canWriteWorkflowModule(final_confirmation) + record scope |
 *
 * On deny: 403 `{ code: "FIELD_PERMISSION_DENIED", message: "…" }`
 *
 * Helper (pseudo):
 *
 *   function normalizeScope(scope: string) {
 *     return scope === 'everyone_except_dealer' ? 'everyone' : scope
 *   }
 *
 *   function assertWorkflowWrite(user, module, quotation) {
 *     const rule = user.moduleFieldPermissions?.[module] ?? defaultWriteRule
 *     if (user.role === 'admin') return
 *     if (rule.level !== 'write') throw forbidden()
 *     const scope = normalizeScope(rule.scope)
 *     if (scope === 'office_only' && user.officeLocation !== quotation.officeLocation) throw forbidden()
 *     if (scope === 'selected_users' && !rule.selectedUserIds.includes(user.id)) throw forbidden()
 *     // optional: quotation.dealerId in selectedUserIds for record-level
 *   }
 */

/**
 * =============================================================================
 * 8. QA checklist
 * =============================================================================
 *
 * 1. Create user: office Ajmer, Installation read, scope office_only
 *    → login → installer dashboard shows only Ajmer quotations; fields disabled.
 * 2. Metering write + selected_users [dealer-uuid] → only that dealer's rows editable.
 * 3. Final confirmation read + everyone → baldev sees records, no DCR/approve.
 * 4. Dealer + installation access + everyone → install upload allowed (server).
 * 5. Legacy everyone_except_dealer in DB → GET normalizes to everyone.
 * 6. Edit user → GET returns same moduleFieldPermissions + officeLocation as saved.
 * 7. Login echoes permissions (no localStorage override needed after backend ships).
 */
