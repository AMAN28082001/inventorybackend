# Backend handoff — Meter Installation Pending + WCC fields (Jul 2026)

Frontend Admin → Metering is live. Persist the status and media below so tabs survive refresh.

---

## Summary

| Area | Frontend behaviour | Backend needed |
|------|--------------------|----------------|
| **WCC Pending** | Install-approved jobs before Discom + Assigned person are saved | Persist `discomName`, `remarks`, `authorizedRepresentative`, optional `discomLocation` on metering-details POST; return on GET |
| **Meter Pending → Meter in Discom** | Existing approve flow | Unchanged (`pending_metering` → `metering_approved`) |
| **To Meter Installation Pending** | Button on **Meter in Discom** (was “To MCO”) | Accept + persist status **`meter_installation_pending`** |
| **Meter Installation Pending tab** | Only rows with that status; Update modal uploads 2 photos + assigned/remarks | Accept files + return public URLs; keep status until moved to MCO |
| **To MCO** | Now from **Meter Installation Pending** | Existing MCO advance from `meter_installation_pending` |

### Tab flow (Admin Metering)

```text
WCC Pending
  → (save Discom + Assigned) → Meter Pending
Meter Pending
  → (approve / details) → Meter in Discom
Meter in Discom
  → [To Meter Installation Pending] → Meter Installation Pending
Meter Installation Pending
  → (Update photos) + [To MCO] → MCO
```

---

## 1. New workflow status: `meter_installation_pending`

### 1.1 Enum / DB

Add to installation / metering / ops workflow enum (same column(s) as `installation_status` / `metering_status`):

```text
…
metering_approved
meter_installation_pending   ← NEW
mco
pending_baldev
…
```

Alias also accepted on read: `meter_install_pending` (frontend treats both as Meter Installation Pending).

Optional audit:

```sql
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS meter_installation_pending_at TIMESTAMP NULL;
```

### 1.2 Accept on operational status PATCH

Frontend probes (any one is enough if it accepts the value):

| Method | Path |
|--------|------|
| `PATCH` | `/api/admin/quotations/{id}/installation-status` |
| `PATCH` | `/api/admin/quotations/{id}/workflow-status` |
| `PATCH` | `/api/quotations/{id}/status` |
| `PATCH` | `/api/quotations/{id}/metering-status` |

**Body (frontend sends):**

```json
{
  "installationStatus": "meter_installation_pending",
  "installation_status": "meter_installation_pending",
  "meteringStatus": "meter_installation_pending",
  "metering_status": "meter_installation_pending",
  "status": "meter_installation_pending"
}
```

**Allowed transitions (recommended):**

| From | To |
|------|-----|
| `metering_approved` | `meter_installation_pending` |
| `meter_installation_pending` | `mco` |
| `meter_installation_pending` | `metering_approved` (optional undo → Meter in Discom) |

When entering `meter_installation_pending`, set `meter_installation_pending_at = now()`.

When moving to `mco`, keep existing MCO stamp (`mcoAt` / `mco_at`).

### 1.3 Return on list / get

On `GET /api/admin/quotations` (and metering list if used):

- `installationStatus` / `installation_status`
- `meteringStatus` / `metering_status`

Must equal `meter_installation_pending` for rows in that tab after refresh.

---

## 2. Meter Installation Pending media + fields

Saved from Admin → Meter Installation Pending → **Update** via existing metering-details multipart POST.

### 2.1 Endpoints (already used)

| Method | Path |
|--------|------|
| `POST` | `/api/metering/quotations/{id}/details` |
| `POST` | `/api/quotations/{id}/metering-details` (fallback) |

### 2.2 New multipart fields

| Form field | Also accepted | Type | Notes |
|------------|---------------|------|--------|
| `meterInstallationPhoto` | `meter_installation_photo` | file (image) | Required for complete pack from UI |
| `plantLivePhoto` | `plant_live_photo` | file (image) | Required for complete pack from UI |
| `remarks` | — | string | Optional update |
| `authorizedRepresentative` | `authorized_representative` | string | Assigned person (required in UI) |

Existing fields on the same endpoint should keep working: `discomName`, `discomLocation` / `discom_location`, meter numbers, `meterDocumentImage`, etc.

### 2.3 Persist + return (public URLs)

Upload to S3 (or equivalent). **Do not** return only private virtual-hosted S3 URLs (Access Denied in browser).

Return and store on the quotation (or linked metering details row):

| Field | Snake alias |
|-------|-------------|
| `meterInstallationPhotoUrl` | `meter_installation_photo_url` |
| `meterInstallationPhotoPublicUrl` | `meter_installation_photo_public_url` |
| `meterInstallationPhotoName` | `meter_installation_photo_name` |
| `plantLivePhotoUrl` | `plant_live_photo_url` |
| `plantLivePhotoPublicUrl` | `plant_live_photo_public_url` |
| `plantLivePhotoName` | `plant_live_photo_name` |

Include these on:

- Response of the metering-details POST
- `GET /api/admin/quotations` / `GET /api/quotations/{id}`
- Metering list GETs if the metering role should see them later

### 2.4 Suggested columns

```sql
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS meter_installation_photo_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS meter_installation_photo_key TEXT NULL,
  ADD COLUMN IF NOT EXISTS meter_installation_photo_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS plant_live_photo_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS plant_live_photo_key TEXT NULL,
  ADD COLUMN IF NOT EXISTS plant_live_photo_name TEXT NULL;
```

(Or equivalent in a `quotation_metering_details` table keyed by quotation id.)

---

## 3. WCC Pending fields (same metering-details POST)

When Admin saves **WCC Pending**, frontend posts:

| Form field | Required in UI |
|------------|----------------|
| `discomName` | Yes |
| `authorizedRepresentative` / `authorized_representative` | Yes (Assigned person) |
| `remarks` | No |
| `discomLocation` / `discom_location` | No |

Then (best effort) sets operational status to `pending_metering` so the row leaves WCC → **Meter Pending**.

### Persist + return on GET

| Field | Notes |
|-------|--------|
| `discomName` / `discom_name` | |
| `remarks` | |
| `authorizedRepresentative` / `authorized_representative` | Also readable as assigned person |
| `discomLocation` / `discom_location` | Optional |

WCC Pending membership (frontend): installation approved / upload complete **and** missing Discom name **or** Assigned person. Once both are saved and stage is `pending_metering` (or later), the row leaves WCC.

---

## 4. Stage detection rules (so tabs don’t flip wrongly)

| Stage key (API) | Admin tab |
|-----------------|-----------|
| Install approved, no Discom+Assigned pack | **WCC Pending** (frontend-only filter) |
| `pending_metering` / `metering_in_progress` | **Meter Pending** |
| `metering_approved` | **Meter in Discom** |
| `meter_installation_pending` | **Meter Installation Pending** |
| `mco` | **MCO** |

Priority on read (same as frontend `getMeteringWorkflowStage`):

1. `mco` (or `mcoAt` set)
2. `meter_installation_pending` / `meter_install_pending`
3. `metering_approved`
4. `pending_metering` / `metering_in_progress`

Do **not** treat `meter_installation_pending` as still `metering_approved`.

---

## 5. MCO transition

Frontend **To MCO** from Meter Installation Pending still uses the existing MCO advance (`forceAdvanceToMco` / status → `mco`).

Recommended allow from:

- `meter_installation_pending` → `mco` (primary)
- `metering_approved` → `mco` (optional, if you keep a legacy path)

---

## 6. Acceptance checklist

- [ ] PATCH operational status accepts `meter_installation_pending` from `metering_approved`
- [ ] Admin list GET returns that status after refresh → row only in **Meter Installation Pending**
- [ ] Metering-details POST accepts `meterInstallationPhoto` + `plantLivePhoto`
- [ ] POST/GET return browsable public URLs + file names for both photos
- [ ] Metering-details POST persists `discomLocation` and returns it
- [ ] WCC save (`discomName` + `authorizedRepresentative` + optional `remarks` / `discomLocation`) + `pending_metering` survives refresh
- [ ] `meter_installation_pending` → `mco` works for **To MCO**

---

## 7. Not required from backend

- Tab label strings (“Meter Installation Pending”, “Meter in Discom”, etc.) — UI only
- Customer location in the MIP modal — read from existing quotation/customer address / visit fields already on GET
- Overdue row colours / filters — frontend-only using existing dates

---

## 8. Backend implementation notes (inventorybackend)

| Item | Location |
|------|----------|
| Migration | `database/migrations/20260715120000-meter-installation-pending.js` |
| Status derive | `utils/meteringWorkflowApi.ts` |
| Photo URL echo | `utils/meteringMediaApi.ts` → `buildMeterInstallationPendingPhotoApiFields` |
| Details POST | `controllers/workflowController.ts` → `saveMeteringDetails` |
| Status PATCH | `controllers/adminController.ts`, `meteringStatusUpdate` |
| Multer fields | `routes/meteringRoutes.ts`, `routes/quotationRoutes.ts` |

**Run migration** before relying on new columns / ENUM value.
