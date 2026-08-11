# Backend — Account Management PI upload (multiple)

## Goal
Account Management must upload **one or many** proforma/PI documents per quotation (PDF or images), show the same list after refresh, and allow removing individual files.

## Storage mapping
PI documents are persisted into `quotation_installation_docs` with:
- `docType = 'installer_pi'`
- `fileUrl = S3 object key`

`GET /api/quotations?status=approved` echoes them as `piUploadUrls[]` / `piUploadUrl` via `utils/installationDocumentsApi.ts`.

## Preferred endpoint (primary)
`POST /api/quotations/:quotationId/pi-upload`

Auth: `account-management` OR `admin` OR `super-admin` (super-admin-manager allowed).

Multipart:
- `piUpload` (repeatable, up to 20 files)

## FE fields
- `existingPiUploadUrlsJson` (optional): JSON array string of S3 URLs/keys to keep
- `replacePiUploads` (optional): `"true"` / `"false"`; default `false`

### Append (default)
- `replacePiUploads=false`
- backend stores: `unique(dbExisting + existingPiUploadUrlsJson + newlyUploaded)`

### Remove / replace list
- `replacePiUploads=true`
- backend stores exactly: `unique(existingPiUploadUrlsJson)` (new files are ignored)

If replace=true and the kept list is empty, all PI uploads are removed.

## Allowed file types
Accept (case-insensitive) PDF + these images:
- `.jpg/.jpeg/.png/.webp/.gif/.heic/.heif`
- `application/pdf`
- image mimes: `image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif`

Reject others with `400 VAL_002`.

## Response
```json
{
  "success": true,
  "quotationId": "<uuid>",
  "piUploadUrl": "<first-url-or-null>",
  "piUploadUrls": ["<url1>", "<url2>"],
  "pi_upload_url": "<first-url-or-null>",
  "pi_upload_urls": ["<url1>", "<url2>"],
  "data": {
    "quotationId": "<uuid>",
    "piUploadUrl": "<first-url-or-null>",
    "piUploadUrls": ["<url1>", "<url2>"]
  }
}
```

## Aliases (FE fallbacks)
These map to the same handler:
- `POST /api/quotations/:quotationId/pi-documents`

Other legacy paths (`.../documents`) may already route through existing installer-doc detection.

## Code locations
- Route: `routes/quotationRoutes.ts`
- Handler: `controllers/quotationController.ts` (`uploadAccountPiDocuments`)
- GET echo: `utils/installationDocumentsApi.ts` + `GET /api/quotations?status=approved`

