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
