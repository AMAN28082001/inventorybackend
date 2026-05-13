# Backend Changes Required

## Metering — sync and persistence

- Metering tab placement and modal data come **only from the backend** (no local/session storage for metering stage or saved details).
- After **Save details**, **Move to Approved**, or **Move to MCO**, `GET /api/metering/quotations` (and related list/detail) must return updated `installationStatus` / `meteringStatus`, `meteringApprovedAt`, and `mcoAt` so **Approved** and **MCO** tabs match the database after refresh.

## Metering queue vs actions (`WF_003`)

- **Rule:** Do not return rows in `GET /api/metering/quotations` that a metering user cannot legally complete with the documented API, **or** allow the documented approval path from those stages.
- **Processing tab** (`status=processing`): maps to `pending_metering`, `metering_in_progress` only.
- **Approval path:** For rows the metering UI shows, backend supports at least one of:
  - `PATCH .../status` with `{ "action": "approve" }`, or
  - `{ "action": "start" }` then `{ "action": "approve" }`.
- **Pre-metering fallback:** `start` / `approve` are also allowed from `pending_installer` and `installer_in_progress` so a chained `start` → `approve` does not fail with `WF_003` if such rows ever appear in client state.

## Frontend retry contract (backend support)

Preferred order on the client:

1. `PATCH /api/metering/quotations/{id}/status` with `{ "action": "approve" }`.
2. On `409` / `WF_003`: `{ "action": "start" }` then `{ "action": "approve" }` again.
3. On continued failure: **direct status body** (same semantics as approve / send_to_mco):
   - `PATCH /api/metering/quotations/{id}/status` **or**
   - `PATCH /api/quotations/{id}/metering-status`  
   JSON example:
   ```json
   {
     "installationStatus": "metering_approved",
     "meteringStatus": "metering_approved"
   }
   ```
   For MCO:
   ```json
   { "installationStatus": "mco", "meteringStatus": "mco" }
   ```
   Allowed direct targets when `action` is omitted: **`metering_approved`** | **`mco`** (same guards as `approve` / `send_to_mco`).

## Detail save (`POST /api/metering/quotations/{id}/details`)

- Allowed stages include pre-metering workflow states so users can persist S3 + DB without waiting for a later stage.
- If save is not allowed for the current stage, return **`409`** with `WF_003` and a clear message — **no** “save locally and retry later”; the client should show an error until the stage allows save.

## Modal prefill (queue / save response)

Queue and save responses should expose metering fields consistently (camelCase **and** snake_case aliases where listed):

- `discomName`, `meterType`, `meterNo`, `solarMeterNo`, `netMeterNo`
- `meterDocumentImageUrl`, `meterDocumentUrl`, `meter_document_url`
- `meterDocumentName`, `meter_document_name`

## References (frontend)

- Metering dashboard save/status: `app/dashboard/metering/page.tsx`
- Primary metering API: `PATCH /api/metering/quotations/{id}/status`
- Quotation-scoped fallback: `PATCH /api/quotations/{id}/metering-status`

---

## Installer completion upload — §6.4.C (implemented in API)

**Route:** `POST /api/installer/quotations/{quotationId}/documents` (multipart). **Auth:** `authorizeInstallerOrAdmin` — quotation **dealer** admins (`req.dealer.role === admin`), inventory **admin** / **super-admin** / **super-admin-manager**, **installer**, and **installation-team** JWTs.

### §6.4.C.1 — Admin vs installer file validation

- **Installer / installation-team:** unchanged — at least one of files, URL doc refs, site dimensions (cm/feet), or `extraExpensesJson` is required (`VAL_002` when empty). When `installationStatus=installer_approved`, at least one existing `site_completion_image` doc is required (`WF_002`).
- **Admin:** multipart may contain **no files**. A payload is accepted when it includes any of: files, URL docs, site/feet signals, parsed extra expenses, **or** (metadata-only) `installationStatus`, `installerRemarks`, or `remarks` text fields. When `installationStatus=installer_approved`, **do not** require site completion images (`WF_002` skipped for admin).

### §6.4.C.2 — Leg validation (cm)

- **Installer / installation-team:** if any cm leg field is non-empty, **both** back and front legs must be positive numbers; optional mid must be positive when provided (existing behavior).
- **Admin:** empty `siteLength` / `siteHeight` / `siteWidth` (and `*LegCm` aliases) are treated as omitted — no `400` for “missing legs” when all are empty. When a leg field **is** provided, that value alone must be a positive number (partial updates).

### Audit / FK note

- On admin-driven `installer_approved`, `installerId` on the quotation is **not** overwritten with the admin user id (preserves the real installer when present).
- `QuotationInstallationDoc.uploadedBy*` uses `req.user?.id` / `req.dealer?.id` and matching role for attribution.
