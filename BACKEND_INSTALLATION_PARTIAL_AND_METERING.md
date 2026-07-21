# Backend handoff — Installation Partial Approved, multi PI, Metering details (Jul 2026)

Frontend is live for Admin Installation / Metering. Backend must persist the fields and statuses below so tabs and lists survive refresh.

---

## Summary

| Area | Frontend behaviour | Backend needed |
|------|--------------------|----------------|
| **Partial Approved** | New Installation sub-tab; uploads partial photos without marking full approve | Accept + persist `installer_partial_approved` |
| **Full approve** | Moves to Approved Installation (not Partial) | `installer_approved` + clear partial flags |
| **Multi PI upload** | Multiple PI files per job | Accept repeated `piUpload` + `existingPiUploadUrlsJson` |
| **Metering labels** | UI only: Meter Pending / Meter in Discom | No rename required on API stage keys |
| **Metering fields** | Discom + **Remarks** + **Authorized Representative** | Persist on metering details POST + return on GET |
| **Install overdue UI** | Yellow ≥5 days / red ≥10 days; filters | **Frontend-only** (uses install date already stored) |
| **Discom → WCC → Meter install** | See dedicated handoff | **`BACKEND_METERING_DISCOM_WCC_METER_INSTALL.md`** / §L.2 |

---

## 1. `installer_partial_approved` status

### 1.1 Enum / DB

Add to installation / ops workflow enum (same column as `installation_status`):

```text
pending_installer
installer_in_progress
installer_partial_approved   ← NEW
installer_approved
pending_metering
…
```

Suggested columns (or JSON flags):

```sql
-- status already covers this; optional audit flags:
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS installation_partial_approved BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS installation_partial_approved_at TIMESTAMP NULL;
```

When status becomes `installer_approved`, set `installation_partial_approved = false`.

### 1.2 Accept on operational status PATCH

Existing admin probes (any one is enough if it accepts the value):

| Method | Path |
|--------|------|
| `PATCH` | `/api/admin/quotations/{id}/installation-status` |
| `PATCH` | `/api/admin/quotations/{id}/workflow-status` |
| `PATCH` | `/api/quotations/{id}/status` |

**Body (frontend sends):**

```json
{
  "installationStatus": "installer_partial_approved",
  "installation_status": "installer_partial_approved",
  "meteringStatus": "installer_partial_approved",
  "metering_status": "installer_partial_approved",
  "status": "installer_partial_approved"
}
```

For partial, **do not** treat this as metering. Prefer:

- Persist **`installationStatus` / `installation_status` only** as `installer_partial_approved`
- Leave metering fields unchanged (or ignore metering keys when value is an installation-only stage)

**Allowed transitions (recommended):**

| From | To |
|------|-----|
| `pending_installer` / `installer_in_progress` | `installer_partial_approved` |
| `installer_partial_approved` | `installer_approved` (full complete) |
| `installer_partial_approved` | `pending_installer` (revert) |
| `installer_partial_approved` | `installer_in_progress` |

**Do not** allow `installer_partial_approved` → `pending_metering` / metering approve / MCO. **Send to Metering** stays blocked until **`installer_approved`** (existing rules).

### 1.3 Completion upload multipart

`POST` installer/admin completion documents (same routes as today) may send:

| Field | Values |
|-------|--------|
| `installationStatus` | `installer_partial_approved` **or** `installer_approved` |
| `installationPartialApproved` | `"true"` / `"false"` |
| `installation_partial_approved` | `"true"` / `"false"` |

**Partial Approved button:**

- May send **some** photos only (not all slots)
- Must **not** require full installer photo set
- Persist files + set status to `installer_partial_approved`

**Complete & Mark as Approved:**

- Same upload handler with `installationStatus=installer_approved`
- Clear partial flags; set `installerApprovedAt`

### 1.4 List / GET responses

Every list used by Admin Installation must return enough to bucket rows:

```json
{
  "id": "QT-XXXX",
  "installationStatus": "installer_partial_approved",
  "installation_status": "installer_partial_approved",
  "installationPartialApproved": true,
  "installation_partial_approved": true,
  "installerApprovedAt": null,
  "installationScheduledAt": "2026-07-21",
  "documents": { "...": "..." }
}
```

**Admin tab mapping (frontend):**

| Tab | Rule |
|-----|------|
| Pending Installation | Not partial, not upload-complete |
| **Partial Approved** | `installationStatus === installer_partial_approved` (or partial flag true) |
| Approved Installation | `installer_approved` / later stages — **exclude** partial |

`imageUrlCount > 0` alone must **not** force Approved if status is still `installer_partial_approved`.

---

## 2. Multiple PI uploads

### 2.1 Multipart (write)

| Part | Type | Notes |
|------|------|--------|
| `piUpload` | file, **repeatable** | Each new PI (PDF/image) |
| `existingPiUploadUrl` | text | Single legacy URL (still sent when exactly one retained) |
| `existingPiUploadUrlsJson` | text JSON | `["https://...","https://..."]` retained URLs |

Merge: keep existing URLs that are still listed + append newly uploaded `piUpload` parts to S3.

Increase Multer `maxCount` for `piUpload` (e.g. **10+**).

### 2.2 Responses (read)

Prefer array; keep singular for backward compatibility:

```json
{
  "piUploadUrl": "https://...first...",
  "piUploadUrls": ["https://...1...", "https://...2..."],
  "documents": {
    "piUploadUrl": "https://...first...",
    "piUploadUrls": ["https://...1...", "https://...2..."]
  }
}
```

Frontend also accepts `pi_upload_urls`, `piUploads`, `pi_uploads`.

---

## 3. Metering details — Remarks + Authorized Representative

### 3.1 POST details (multipart)

Existing:

- `POST /api/metering/quotations/{id}/details`
- fallback `POST /api/quotations/{id}/metering-details`

**New text parts (in addition to `discomName`, meter fields, `meterDocumentImage`):**

| Field | Also accept |
|-------|-------------|
| `remarks` | — |
| `authorizedRepresentative` | `authorized_representative` |

`discomName` already supported.

### 3.2 Persist + echo on GET

```sql
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS metering_remarks TEXT NULL,
  ADD COLUMN IF NOT EXISTS metering_authorized_representative TEXT NULL;
-- discom_name / meter fields should already exist
```

Quotation list/detail (admin + metering dashboards):

```json
{
  "discomName": "…",
  "discom_name": "…",
  "remarks": "…",
  "authorizedRepresentative": "…",
  "authorized_representative": "…"
}
```

### 3.3 Stage keys (unchanged)

| Internal stage | UI label (frontend only) |
|----------------|--------------------------|
| `processing` / `pending_metering` | Meter Pending |
| `approved` / `metering_approved` | Meter in Discom |
| `mco` | MCO |

No API rename required.

---

## 4. Install date overdue colours / filters

**No backend change.** Frontend uses:

- `installationScheduledAt` / `installation_scheduled_at` (YYYY-MM-DD), else sent-to-install + 7 days
- Yellow: overdue days **≥ 5**
- Red: overdue days **≥ 10**
- Filters: less than 5 / 5+ / 10+

Ensure list/GET always returns **`installationScheduledAt`** when set via existing `PATCH` scheduled-date endpoint.

---

## 5. QA checklist

1. Partial upload → status `installer_partial_approved` → Admin **Partial Approved** tab after refresh; **not** in Approved Installation.
2. Continue upload → **Complete & Mark as Approved** → status `installer_approved` → Approved tab; `installationPartialApproved` false.
3. Partial row: **Send to Metering** still blocked.
4. Upload 2+ PI files → GET returns `piUploadUrls` length ≥ 2; re-open modal shows all.
5. Save metering details with remarks + authorized representative → survive refresh on Admin Metering + Metering dashboard.
6. Revert / move-back from partial does not leave dirty `installer_approved` timestamps.

---

## 6. Frontend references

| File | Role |
|------|------|
| `app/dashboard/admin/page.tsx` | Partial tab, upload modes, overdue UI, multi PI |
| `components/installation-completion-panel.tsx` | Partial Approved button, multi PI picker |
| `lib/operational-install-queue.ts` | `isInstallationPartialApproved`, Approved-tab exclusion |
| `lib/api.ts` | `metering.saveDetails` remarks / authorizedRepresentative; operational status body |
| `app/dashboard/metering/page.tsx` | Meter Pending / Meter in Discom labels + fields |

Also update living docs: `BACKEND_CHANGES_REQUIRED.md` §6.2 enum + §6.4.C PI notes.

---

## 7. Backend implementation notes (inventorybackend)

| Item | Location |
|------|----------|
| Migration | `database/migrations/20260715010000-installation-partial-and-metering-fields.js` |
| Helpers | `utils/installationPartialApi.ts` |
| Upload + merge | `controllers/workflowController.ts` (`installerUploadDocuments`, `saveMeteringDetails`) |
| Status PATCH / Send to Metering gate | `controllers/adminController.ts` |
| Multi PI GET | `utils/installationDocumentsApi.ts` → `piUploadUrls` |
| Validations | `validations/workflowValidations.ts`, `validations/adminValidations.ts` |

**Run migration** before relying on new columns / ENUM value in production.
