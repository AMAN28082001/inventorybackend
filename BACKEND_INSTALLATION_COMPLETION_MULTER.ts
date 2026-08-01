/**
 * BACKEND — Installation completion upload Multer fix
 * (Admin / Installer “Complete & Mark as Approved” / “Partial Approved”)
 *
 * Symptom (frontend toast):
 *   Upload failed — Unexpected or too many file fields
 *
 * Implemented in this repo (HANDOFF §26):
 *   - routes/installerRoutes.ts — Multer `.any()` + limits.files ≥ 40 (rejects none by field name)
 *   - POST /api/installer/quotations/:id/documents (admin allowed)
 *   - POST /api/admin/quotations/:id/installer-documents (+ aliases)
 *   - POST /api/quotations/:id/documents routes completion multipart → installer handler (not KYC)
 *   - Parse installerCompletionImageFieldOrderJson; persist installer_approved / partial; GET media
 *
 * Cause:
 *   Multer `.fields([...])` allow-list does not match the client, OR `maxCount` /
 *   `limits.files` is too low (LIMIT_UNEXPECTED_FILE / LIMIT_FILE_COUNT).
 *
 * Frontend (`lib/api.ts` → `api.installer.uploadCompletionDocuments`):
 *   1) Preferred: repeated `installerCompletionImages` + text
 *      `installerCompletionImageFieldOrderJson` (JSON array of logical keys in order)
 *   2) Fallback: per-field parts (`homeFrontPhoto`, `panelSerialNumberPhoto`, …)
 *   3) Admin last resort: single-file `field`+`file` upload, then text-only status POST
 *
 * Routes (same multipart body; allow **admin** + **installer** + **installation-team**):
 *   POST /api/installer/quotations/:quotationId/documents
 *   POST /api/admin/quotations/:quotationId/installer-documents
 *   POST /api/admin/installer/quotations/:quotationId/documents
 *
 * Do NOT use PATCH /api/quotations/:id/documents (customer KYC) for this payload.
 *
 * -----------------------------------------------------------------------------
 * Multer config (required)
 * -----------------------------------------------------------------------------
 *
 *   import multer from "multer"
 *
 *   const upload = multer({
 *     storage: multer.memoryStorage(),
 *     limits: { fileSize: 12 * 1024 * 1024, files: 40 },
 *   })
 *
 *   // Option A — explicit allow-list (must include BOTH aggregate + per-field + piUpload)
 *   export const installationCompletionUpload = upload.fields([
 *     { name: "installerCompletionImages", maxCount: 30 },
 *     { name: "piUpload", maxCount: 10 },
 *     { name: "homeFrontPhoto", maxCount: 5 },
 *     { name: "homeWithPersonPhoto", maxCount: 5 },
 *     { name: "inverterWithCustomerPhoto", maxCount: 5 },
 *     { name: "plantWithCustomerPhoto", maxCount: 5 },
 *     { name: "inverterSerialNumberPhoto", maxCount: 5 },
 *     { name: "panelSerialNumberPhoto", maxCount: 20 },
 *     { name: "geoTagPlantPhoto", maxCount: 5 },
 *     { name: "otherImages", maxCount: 20 },
 *   ])
 *
 *   // Option B — simplest if you validate keys in the handler:
 *   // export const installationCompletionUpload = upload.any()
 *
 * Apply `installationCompletionUpload` ONLY on the installer-completion routes above.
 * KYC document routes must keep their own (different) Multer config.
 *
 * -----------------------------------------------------------------------------
 * File field names
 * -----------------------------------------------------------------------------
 */

export const INSTALLATION_COMPLETION_FILE_FIELD_NAMES = [
  "installerCompletionImages",
  "piUpload",
  "homeFrontPhoto",
  "homeWithPersonPhoto",
  "inverterWithCustomerPhoto",
  "plantWithCustomerPhoto",
  "inverterSerialNumberPhoto",
  "panelSerialNumberPhoto",
  "geoTagPlantPhoto",
  "otherImages",
] as const

/** Text / JSON parts (not file fields — Multer must not treat these as files). */
export const INSTALLATION_COMPLETION_TEXT_FIELDS = [
  "installerCompletionImageFieldOrderJson",
  "existingInstallationImageUrlsJson",
  "existingPiUploadUrl",
  "existingPiUploadUrlsJson",
  "extraExpensesJson",
  "extraExpensesTotal",
  "siteLength",
  "siteWidth",
  "siteHeight",
  "backLegCm",
  "midLegCm",
  "frontLegCm",
  "backLegFeet",
  "midLegFeet",
  "frontLegFeet",
  "installerRemarks",
  "installationStatus",
  "installationPartialApproved",
  "installation_partial_approved",
] as const

/**
 * When `installerCompletionImages` is used, map index → column via:
 *   installerCompletionImageFieldOrderJson = '["homeFrontPhoto","panelSerialNumberPhoto",…]'
 *
 * Pseudo:
 *   const order = JSON.parse(req.body.installerCompletionImageFieldOrderJson || "[]")
 *   const files = req.files.installerCompletionImages || []
 *   files.forEach((file, i) => assignToColumn(order[i] || "otherImages", file))
 *   // Also merge any per-field arrays if present (fallback clients).
 */

/**
 * Single-file fallback routes (admin):
 *   POST /api/installer/quotations/:id/documents/upload
 *   POST /api/installer/quotations/:id/upload
 *   POST /api/quotations/:id/installer-documents/upload
 *   multipart: field=<logicalKey>, file=<binary>
 */
export const INSTALLATION_SINGLE_ASSET_FIELDS = ["field", "file"] as const

/**
 * After success, persist:
 *   installation_status = installer_approved | installer_partial_approved
 *   installer_approved_at = now() when fully approved
 *   clear partial flags when fully approved
 * Return image URLs on next GET so Admin Approved Installation + Account FILE STATUS stay in sync.
 *
 * Related:
 *   BACKEND_CHANGES_REQUIRED.md §6.4.C
 *   BACKEND_CHANGES_HANDOFF.md §26
 *   BACKEND_INSTALLATION_PARTIAL_AND_METERING.md
 *   lib/api.ts → uploadCompletionDocuments / uploadCompletionAsset
 */

/** Checklist */
export const INSTALLATION_COMPLETION_MULTER_CHECKLIST = [
  "Multer on installer-completion POST allows installerCompletionImages (maxCount ≥ 20)",
  "Same route allows piUpload (maxCount ≥ 10)",
  "Same route allows per-field photo keys (fallback clients)",
  "limits.files ≥ 40 (or equivalent)",
  "Admin JWT accepted on at least one of the admin/installer document routes",
  "KYC PATCH /quotations/:id/documents is NOT used for this payload",
  "installationStatus installer_approved / installer_partial_approved persisted",
  "GET list returns installation photos / installerApprovedAt after upload",
] as const
