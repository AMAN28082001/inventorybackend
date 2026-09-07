# Backend — Workflow dashboard parity (Installation / Metering / Final confirmation)

**Frontend (Sep 2026):** Individual dashboards match Admin for Installation, Metering, and Final confirmation (same sub-tabs, tables, overdue chips, permission scopes).  
**Code:** `app/dashboard/installer/page.tsx`, `components/metering/metering-workflow-panel.tsx`, `components/final-confirmation-workflow-panel.tsx`, `lib/module-field-permissions.ts`, `lib/load-operational-installation-rows.ts`  
**Related:** `BACKEND_USER_FIELD_PERMISSIONS.md`, REQUIRED **§AK**, HANDOFF **§38**, **§42**

---

## 1. Permission scopes (must match frontend)

Dashboard `access[]` still controls which pages open. **`moduleFieldPermissions`** controls how many **rows** each user sees per module.

| Scope (stored) | UI label | Who sees which **quotation rows** |
|----------------|----------|-----------------------------------|
| `everyone` | **Everyone** | All rows for that workflow (all dealers), when `level` ≠ `none` |
| `selected_users` | **Selected one** | Rows where `quotation.dealerId` ∈ `selectedUserIds` (IDs picked in Admin → Users) |
| `office_only` | **Only there** | Rows where `quotation.officeLocation` === viewer `officeLocation`; if quotation has no office, only rows where `quotation.dealerId` === viewer `id` |

**Important — `selected_users`:** `selectedUserIds` are **dealer / user IDs to include in the list**, not “only these staff can open the dashboard”. Any employee with dashboard access + `level` ≠ `none` can open the module; the list is filtered by **dealerId**.

**Legacy:** Accept `everyone_except_dealer` on input; normalize to `everyone` on save/GET.

**Modules:** `accounts`, `installation`, `metering`, `final_confirmation`

| `level` | UI |
|---------|-----|
| `none` | No records |
| `read` | View only (403 on mutating routes) |
| `write` | Full edit |

---

## 2. Full-list APIs when scope is **Everyone** (P0)

The SPA does **not** rely only on client-side filtering when scope is `everyone`. It calls **full-list** routes, then applies workflow visibility (sent-to-installer, metering pipeline, confirmation queue).

| Module | Frontend behavior | Backend must provide |
|--------|-------------------|----------------------|
| **Accounts** | `GET /account-management/quotations?status=approved` then `GET /admin/quotations` fallback | All approved quotations (all dealers) — see §AK |
| **Installation** | `loadOperationalInstallationRows({ fetchAdminQuotationList: true })` → `GET /admin/quotations` + installer queue + payment-sent rows | **Same full list** for non-admin users with `installation` access + `scope: everyone` |
| **Metering** | `MeteringWorkflowPanel` merges installer queue + `GET /admin/quotations` when everyone | Full metering-relevant rows for metering access + `scope: everyone` |
| **Final confirmation** | `FinalConfirmationWorkflowPanel` → workflow list when everyone, else scoped `GET /quotations?status=approved` | Full confirmation-queue rows when `final_confirmation.scope === everyone` |

### Frontend API fallback order (Sep 2026)

When scope is **Everyone**, the SPA calls `api.quotations.getWorkflowDashboardList()` (`lib/api.ts`) which tries **quietly** (`suppressErrorLog` — no console error on expected 403):

1. `GET /api/admin/quotations?page=1&limit=1000`
2. `GET /api/account-management/quotations?page=1&limit=1000`
3. `GET /api/installer/quotations?page=1&limit=1000`
4. `GET /api/quotations?page=1&limit=1000` (dealer-scoped fallback only)

**Accounts** uses `getApprovedForAccounts()` — tries `/account-management/quotations` then `/admin/quotations`, then `/quotations`.

Installation also merges `GET /installer/queue` (status filters) + payment-sent rows (`loadOperationalInstallationRows`). Metering merges installer queue + workflow list.

**Until backend ships Option A (or B) below**, non-admin users with **Everyone** only see dealer-scoped rows from step 4 — installer/metering tables will not match Admin row counts.

### Option A (recommended): Expand auth on existing route

Allow **`GET /api/admin/quotations`** (page/limit query) when the JWT user has **any** of:

- `role` = `admin` | `super-admin`
- `accounts` in `access` + `moduleFieldPermissions.accounts.scope === "everyone"` + level ≠ `none`
- `installation` in `access` + `moduleFieldPermissions.installation.scope === "everyone"` + level ≠ `none`
- `metering` in `access` + `moduleFieldPermissions.metering.scope === "everyone"` + level ≠ `none`
- `final_confirmation` in `access` + `moduleFieldPermissions.final_confirmation.scope === "everyone"` + level ≠ `none`

**Do not** filter that response to `dealerId = req.user.id` when scope is `everyone`.

**Inventory implementation:** `canAccessFullAdminQuotationList()` in `utils/moduleFieldPermissions.ts`; used by `getAllQuotations` in `controllers/adminController.ts`. Accounts full list: `GET /account-management/quotations` → `getAccountManagementQuotations`.

### Option B: Module-specific list routes

| Method | Path | Auth | Returns |
|--------|------|------|---------|
| `GET` | `/api/installation/quotations` | `installation` access + module level ≠ `none` | Rows visible in Admin → Installation (sent to installer) |
| `GET` | `/api/metering/quotations` | `metering` access + module level ≠ `none` | Rows visible in Admin → Metering |
| `GET` | `/api/final-confirmation/quotations` | `final_confirmation` access + module level ≠ `none` | Rows visible in Admin → Final confirmation |

Apply **record scope** server-side for `selected_users` / `office_only`; return **all** matching workflow rows for `everyone`.

### Installer queue

`GET /api/installer/queue` (all status filters) today often returns only the logged-in dealer’s jobs. For account managers with **installation** or **metering** + **Everyone**, either:

- Return all rows in the pipeline (same as admin), **or**
- Rely on `GET /admin/quotations` (Option A) — frontend already merges both.

---

## 3. Required fields on list + detail (P0)

Echo **camelCase + snake_case** aliases where noted.

### All workflow lists

| Field | Used for |
|-------|----------|
| `dealerId` / `dealer_id` | `selected_users` filter |
| `officeLocation` / `office_location` | `office_only` filter |
| `dealer` (nested name, mobile) | Table columns |

### Installation (`GET /admin/quotations`, installer queue)

| Field | Notes |
|-------|--------|
| `installationReadyForInstaller`, `installation_ready_for_installer` | Sent to installer |
| `installationReleasedAt`, `installation_released_at` | Sent date column |
| `installationStatus`, `installation_status` | Pending / in progress / approved |
| `installationScheduledAt`, `installation_scheduled_at` | Install date picker |
| `installationTeamId`, `installation_team_id` | Team dropdown |
| Installation photo URLs / document fields | Upload panel |

Row visible in Installation tab when: `installation_ready_for_installer === true` OR `installation_released_at` set OR status in install pipeline (see `BACKEND_INSTALLATION_RELEASE.md`).

### Metering

| Field | Notes |
|-------|--------|
| `installationStatus` / `installation_status` | Includes `pending_metering`, `metering_in_progress`, … |
| `meteringStage`, `metering_stage`, `meteringStatus`, `metering_status` | Sub-tabs |
| `meteringApprovedAt`, `metering_approved_at`, `mcoAt`, `mco_at` | Date + overdue |
| `discomName`, `meterType`, `meterNo`, `remarks`, `authorizedRepresentative` | Table columns |
| Meter document + MCO image URLs | Details / MCO modals |

### Final confirmation

| Field | Notes |
|-------|--------|
| `installationStatus` | `installer_approved`, `pending_baldev`, `baldev_approved`, `completed` |
| `dcrGenerated`, `dcr_generated` | DCR vs Final process split |
| `installerApprovedAt`, `installer_approved_at` | Date column |
| `products` (or system kW fields) | DCR tab System kW |
| Final doc URL + name (×4) | See below |

**Final confirmation document columns** (batch upload + list echo):

| Form field | URL column examples | Name column examples |
|------------|---------------------|----------------------|
| `customerFinalBillFile` | `customerFinalBillFileUrl`, `customer_final_bill_file_url` | `customerFinalBillFileName` |
| `panelWarrantyFile` | `panelWarrantyFileUrl`, `panel_warranty_file_url` | `panelWarrantyFileName` |
| `inverterWarrantyFile` | `inverterWarrantyFileUrl`, … | `inverterWarrantyFileName` |
| `workCompletionWarrantyFile` | `workCompletionWarrantyFileUrl`, … | `workCompletionWarrantyFileName` |

Also under nested `documents` / `document` if used.

---

## 4. Mutating routes + server enforcement (P0 / P1)

Return **403** `{ "code": "FIELD_PERMISSION_DENIED", "message": "…" }` when:

- `moduleFieldPermissions[module].level` is `none` or `read` (for writes)
- Record fails scope check (`dealerId`, `officeLocation`)

| Module | Routes (examples) | Target status / action |
|--------|-------------------|------------------------|
| **Installation** | `PATCH /admin/quotations/:id/installation-status` (or operational-status) | `installer_in_progress`, `installer_approved` |
| | `PATCH /admin/quotations/:id/installation-scheduled-date` | Install date |
| | `POST /installer/quotations/:id/documents` (or admin install upload) | Photos |
| | `PATCH /quotations/:id/installation-release` | Send to installer (accounts) |
| **Metering** | `PATCH` metering stage / handoff routes | `pending_metering`, `metering_approved`, WCC, MCO, … |
| | Meter document + MCO upload routes | |
| **Final confirmation** | `POST /quotations/:id/final-confirmation-documents` | 4 PDF/JPG files |
| | `PATCH` operational status → `baldev_approved` | Mark Final Approved |

**Final approval (P0):** Frontend calls `PATCH /admin/quotations/:id/operational-status` with `installationStatus: "baldev_approved"` (see `lib/api.ts` → `updateOperationalStatus`). Must succeed for non-admin baldev / account users with `final_confirmation` **write**.

**DCR generated:** Persist `dcrGenerated: true` on quotation when backend supports it; frontend also uses localStorage (`finalConfirmationDcrGenerated`, `adminDcrGenerated`, `baldevDcrGenerated`) until API echoes the flag.

---

## 5. Server-side scope helper (reference)

```typescript
type Scope = "everyone" | "selected_users" | "office_only"

function normalizeScope(scope: string): Scope {
  if (scope === "everyone_except_dealer") return "everyone"
  return scope as Scope
}

function recordMatchesWorkflowScope(
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
    return dealerId && rule.selectedUserIds.includes(dealerId)
  }
  if (scope === "office_only") {
    const recordOffice = String(quotation.officeLocation ?? "").trim()
    const viewerOffice = String(user.officeLocation ?? "").trim()
    if (recordOffice && viewerOffice) return recordOffice === viewerOffice
    const dealerId = String(quotation.dealerId ?? "").trim()
    return dealerId && dealerId === String(user.id)
  }
  return true
}

function assertWorkflowWrite(user: AuthUser, module: WorkflowModule, quotation: Quotation) {
  const rule = user.moduleFieldPermissions?.[module] ?? { level: "write", scope: "everyone" }
  if (rule.level !== "write") throw forbidden("FIELD_PERMISSION_DENIED")
  if (!recordMatchesWorkflowScope(user, rule, quotation)) throw forbidden("FIELD_PERMISSION_DENIED")
}
```

---

## 6. User + login (unchanged from §AK)

- Persist `office_location`, `module_field_permissions` JSONB on user tables
- Echo `officeLocation`, `moduleFieldPermissions` on user CRUD + `POST /auth/login`

---

## 7. QA checklist

- [ ] Account manager: **Installation** + **Everyone** + write → `GET /admin/quotations` returns **all dealers** sent to installation (not 403, not single-dealer list)
- [ ] Same user → Installer dashboard table matches Admin Installation row count (pending tab)
- [ ] **Metering** + **Everyone** → Meter Pending shows all dealers; **Selected one** with two dealer UUIDs → only those dealers
- [ ] **Only there** + office Ajmer → installation/metering/final lists only Ajmer `officeLocation` rows
- [ ] **Final confirmation** write → `POST` final docs + `PATCH` `baldev_approved` succeed; read → 403 on mutations
- [ ] List echoes `dealerId`, `officeLocation`, workflow status fields, final doc URLs
- [ ] `dcrGenerated` on GET after DCR (or localStorage-only until implemented)
- [ ] Login echoes `moduleFieldPermissions` for all four modules

---

## 9. Backend implementation status (inventory API)

| Item | Status |
|------|--------|
| Migration: `officeLocation` + `moduleFieldPermissions` on users; `officeLocation` on quotations | Done |
| Login + user CRUD echo permissions | Done |
| Scope helpers (`recordMatchesWorkflowScope`, `canAccessFullAdminQuotationList`) | Done — `utils/moduleFieldPermissions.ts` |
| **GET /admin/quotations** — non-admin + module **everyone** → 200, all dealers | Done |
| **GET /account-management/quotations** — all approved when accounts everyone | Done |
| Scope semantics (`selected_users` = `dealerId`; `office_only` fallback) | Done |
| List fields (dealerId, officeLocation, install/metering/final workflow + final doc URLs) | Done on admin list |
| **PATCH …/installation-status** — workflow write + `FIELD_PERMISSION_DENIED` | Done |
| Install upload / metering PATCH / final-confirmation docs | Done — `workflowController` + `quotationController` |
| Server-side scope filter on list routes (`selected_users` / `office_only`) | **P1** — FE filters client-side today |
| **GET /installer/queue** cross-dealer for Everyone scope | **P1** — FE relies on admin list merge |
| Persist **`dcrGenerated`** on quotation | **P1** — FE uses localStorage until echoed |
| Option B module routes (`/installation/quotations`, …) | Not built — Option A preferred |

---

## 10. Do not

- Filter `GET /admin/quotations` to `dealerId = req.user.id` when module scope is `everyone`
- Require `selectedUserIds` to contain the **viewer’s** id for `selected_users` (use **quotation.dealerId**)
- Replace dashboard `access[]` with `moduleFieldPermissions` — both required
