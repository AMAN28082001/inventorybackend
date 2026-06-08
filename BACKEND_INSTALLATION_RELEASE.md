# Backend: Payment Management → Admin Installation (release flags)

**Status:** Implemented in this repo. **Production blocker:** deploy latest API + ensure DB columns exist (migration or server bootstrap).

Share this doc with the backend team for implement/verify/QA.

---

## Symptom (frontend correct)

| Symptom | Cause |
|---------|--------|
| Installation tab empty after hard refresh | `PATCH installation-release` not persisting, or `GET` not returning release fields |
| Green “Sent to installer” badge only in same browser | Client cache; no server persistence |
| `404` on PATCH | Route not deployed or wrong URL |

Frontend shows Installation rows **only** when the API returns:

```json
{
  "installationReadyForInstaller": true,
  "installationReleasedAt": "2026-06-05T10:30:00.000Z",
  "installationStatus": "pending_installer"
}
```

---

## 1. Database columns

PostgreSQL (camelCase column names match Sequelize model):

```sql
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS "installationReadyForInstaller" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS "installationReleasedAt" TIMESTAMPTZ NULL;

-- installation_status already exists on quotations as installationStatus (enum/text)
```

**Migration:** `database/migrations/20260415100000-add-installation-release-fields-to-quotations.js`

**Startup bootstrap (idempotent):** `config/sequelizeBootstrap.ts` → `ensureInstallationReleaseColumns()` runs on server start if migrate was skipped.

---

## 2. PATCH — Send to Installer

**Primary route (Account Management JWT):**

```
PATCH /api/quotations/{quotationId}/installation-release
Authorization: Bearer <account-management-token>
Content-Type: application/json
```

**Alternate routes (same handler):**

- `PATCH /api/quotations/{quotationId}/installation/ready`
- `PATCH /api/admin/quotations/{quotationId}/installation-release` (admin JWT)

**Body (camelCase or snake_case):**

```json
{
  "installationReadyForInstaller": true,
  "installationReleasedAt": "2026-06-05T10:30:00.000Z"
}
```

**Persists:**

| Column | Value |
|--------|--------|
| `installationReadyForInstaller` | `true` |
| `installationReleasedAt` | body timestamp or server `now` |
| `installationStatus` | `pending_installer` |

**Auth:** `account-management`, inventory `admin` / `super-admin` / `super-admin-manager`, or quotation dealer JWT with `role === 'admin'`.

**Code:** `controllers/quotationController.ts` → `updateQuotationInstallationRelease`  
**Validation:** `validations/quotationValidations.ts` → `updateInstallationReleaseSchema` (accepts snake_case)  
**Serialize:** `utils/quotationApiJson.ts` → `serializeInstallationReleaseFields`

### curl QA

```bash
API="http://localhost:3050/api"
TOKEN="<account-management-jwt>"
QID="<approved-quotation-uuid>"

curl -sS -X PATCH "$API/quotations/$QID/installation-release" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"installationReadyForInstaller":true,"installationReleasedAt":"2026-06-05T10:30:00.000Z"}' | jq .
```

**Expected 200:**

```json
{
  "success": true,
  "data": {
    "id": "...",
    "installationReadyForInstaller": true,
    "installationReleasedAt": "2026-06-05T10:30:00.000Z",
    "installationStatus": "pending_installer"
  }
}
```

**Common errors:**

| Code | Meaning |
|------|---------|
| `404` | Route not deployed |
| `401` / `403` | Wrong role or token |
| `400` VAL_001 | Missing/invalid `installationReadyForInstaller` |
| `500` | DB column missing — run migrate or restart API (bootstrap) |

---

## 3. GET — Admin Installation tab

**Recommended (only Payment Management “sent” rows, up to 1000):**

```
GET /api/admin/quotations?operationalView=installer&limit=1000
GET /api/admin/quotations?releasedToInstaller=true&limit=1000
```

Aliases also accepted: `installationReadyForInstaller=true`, `sentToInstaller=true`.

Without `limit`, installation-list queries default to **1000** rows server-side.

**General admin list (all quotations — client filters by release flags):**

```
GET /api/admin/quotations?limit=1000
Authorization: Bearer <admin-token>
```

Every row must include top-level release fields (released or not):

```json
{
  "id": "uuid",
  "status": "approved",
  "installationReadyForInstaller": true,
  "installationReleasedAt": "2026-06-05T10:30:00.000Z",
  "installationStatus": "pending_installer",
  "installationPhotoUrls": []
}
```

Optional server filter for installer queue only:

```
GET /api/admin/quotations?operationalView=installer
```

Returns **only** released rows (`installationReadyForInstaller = true` OR `installationReleasedAt` set).

**Code:** `controllers/adminController.ts` → `getAllQuotations`

---

## 4. GET — Account Management (green badge)

```
GET /api/quotations?status=approved&limit=1000
Authorization: Bearer <account-management-token>
```

Same release fields on each row (`serializeInstallationReleaseFields` + `quotationAdminMetadataFields`).

**Code:** `controllers/quotationController.ts` → `getQuotations`

---

## 5. GET — Installer dashboard

```
GET /api/installer/quotations
```

Only **released** quotations; gated by `buildReleasedToInstallerWhere()`.

---

## 6. Why only one row (e.g. Karma Devi) appears today

If Payment Management shows green **Sent to installer** for Jagdish, Sharwan, RAJ KUMAR, etc., but Admin → Installation shows **only one** row after hard refresh:

| Cause | Fix |
|-------|-----|
| **PATCH was not deployed** when those sends happened | Deploy API, then click **Send to Installer** again for each customer |
| Sends lived only in **browser localStorage** | Re-send after deploy — only DB rows appear on all devices |
| **Only one row** has `installationReadyForInstaller: true` in PostgreSQL | Verify with SQL below |

```sql
SELECT id, "installationReadyForInstaller", "installationReleasedAt", "installationStatus"
FROM quotations
WHERE "installationReadyForInstaller" = true
   OR "installationReleasedAt" IS NOT NULL
ORDER BY "installationReleasedAt" DESC NULLS LAST;
```

Frontend merge of localStorage + lists is a **bridge** until every send is persisted via PATCH.

---

## 7. End-to-end QA (after deploy)

1. Approve a quotation (admin) — **do not** send to installer.
2. `GET /api/admin/quotations` — row has `installationReadyForInstaller: false`, `installationReleasedAt: null`.
3. Admin Installation tab — **empty** for that customer (frontend filter).
4. Account team: **Send to Installer** → PATCH succeeds.
5. Hard refresh Admin → Installation → customer under **Pending Installation**.
6. `GET /api/quotations?status=approved` — green badge fields present.
7. Upload photos → `installationStatus: installer_approved` → **Approved Installation** tab.
8. Admin **Send to Metering** → `pending_metering` → leaves Installation, appears in Metering.

---

## 8. Reference files

| File | Purpose |
|------|---------|
| `BACKEND_ADMIN_QUOTATION_STATUS.ts` | Reference: `patchQuotationInstallationRelease`, `serializeInstallationReleaseFields` |
| `BACKEND_CHANGES_HANDOFF.md` §17 | Sprint summary |
| `BACKEND_CHANGES_REQUIRED.md` §M | Checklist for backend team |
| `constants/workflowQueues.ts` | `buildReleasedToInstallerWhere()` release gate |

---

## 9. Deploy checklist

```bash
yarn migrate   # or rely on sequelizeBootstrap on restart
yarn build
# restart API (port 3050 default)
```

Verify health + column:

```bash
curl -sS http://localhost:3050/health
```

Then run PATCH + GET curl from §2 and §3.
