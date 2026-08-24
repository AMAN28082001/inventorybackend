// @ts-nocheck
/**
 * =============================================================================
 * BACKEND REFERENCE — Meter Document public view link (Metering Details modal)
 * =============================================================================
 *
 * Frontend (Aug 2026):
 *   - Admin → Metering → Metering Details modal
 *     (`app/dashboard/admin/page.tsx` → Save Details)
 *   - Metering role → same modal (`components/metering/metering-workflow-panel.tsx`)
 *   - Upload parse / public href: `lib/parse-api-media.ts`, `lib/media-url.ts`,
 *     `components/stored-media-preview.tsx`
 *   - API client: `lib/api.ts` → `api.metering.saveDetails`
 *
 * Symptom:
 *   User uploads PDF/image in Metering Details → Save → modal still shows
 *   "No meter document on file yet." and there is no Open public link.
 *
 * Root cause (backend):
 *   1. File not accepted (wrong multipart field name only)
 *   2. File uploaded to private S3 but response/list returns only private object URL
 *      → browser Access Denied
 *   3. Save response / GET quotation list omit `meterDocumentPublicUrl` /
 *      `meterDocumentUrl` / `meterDocumentName`
 *
 * Goal:
 *   After upload + on every quotation list/detail GET used by Metering/Admin,
 *   return a **browser-openable public URL** so the UI can show
 *   "Uploaded meter document" → **Open public link**.
 *
 * =============================================================================
 * ENDPOINTS
 * =============================================================================
 *
 * Primary:
 *   POST /api/metering/quotations/:quotationId/details
 *   Content-Type: multipart/form-data
 *   Auth roles: metering, admin (NOT admin-only — metering JWT must work)
 *
 * Fallback accepted by SPA:
 *   POST /api/quotations/:quotationId/metering-details
 *
 * List/detail (must echo document fields after refresh):
 *   GET /api/admin/quotations
 *   GET /api/metering/quotations
 *   GET /api/quotations/:id   (if used)
 *
 * Optional (SPA already calls these when URL looks private):
 *   GET /api/quotations/:id/documents/view-url?url=...
 *   GET /api/quotations/:id/documents/presign-url?url=...
 *   GET /api/admin/quotations/:id/documents/view-url?url=...
 *   GET /api/media/presign-url?url=...
 *   GET /api/files/presigned-url?url=...
 *   Response: { publicUrl | signedUrl | url }
 *
 * =============================================================================
 * MULTIPART FIELD NAMES (accept ANY of these)
 * =============================================================================
 *
 * Frontend may send the file under one or more of:
 *   - meterDocumentImage          ← canonical (prefer)
 *   - meter_document_image
 *   - meterDocument
 *   - meter_document
 *   - meterDocumentFile
 *   - file
 *
 * Text fields (unchanged):
 *   discomName, meterType, meterNo, solarMeterNo, netMeterNo,
 *   remarks, authorizedRepresentative / authorized_representative,
 *   discomLocation / discom_location
 *
 * Multer tip — accept aliases:
 *
 *   upload.any()  // then pick first file whose fieldname matches the set above
 *   // OR
 *   upload.fields([
 *     { name: "meterDocumentImage", maxCount: 1 },
 *     { name: "meter_document_image", maxCount: 1 },
 *     { name: "meterDocument", maxCount: 1 },
 *     { name: "meter_document", maxCount: 1 },
 *     { name: "meterDocumentFile", maxCount: 1 },
 *     { name: "file", maxCount: 1 },
 *   ])
 *
 * Allow: image/* and application/pdf (max ~10–15 MB).
 *
 * =============================================================================
 * REQUIRED RESPONSE FIELDS (save + list/detail)
 * =============================================================================
 *
 * Always return camelCase (snake_case also accepted by SPA):
 *
 * | Field                     | Required after upload | Notes |
 * |---------------------------|-----------------------|-------|
 * | meterDocumentPublicUrl    | YES                   | Presigned GET (≥7d) OR CDN/public-read URL — must open in browser tab |
 * | meterDocumentUrl          | YES                   | Same as public URL (or duplicate) |
 * | meterDocumentName         | YES                   | original filename |
 * | meterDocumentKey          | recommended           | S3 object key for re-presign |
 *
 * Snake aliases: meter_document_public_url, meter_document_url, meter_document_name,
 * meter_document_key.
 *
 * Save success example:
 *
 * ```json
 * {
 *   "success": true,
 *   "data": {
 *     "id": "QT-…",
 *     "discomName": "HATOJ",
 *     "meterType": "solar",
 *     "meterNo": "U7066676",
 *     "remarks": "MTR SUBMIT DISCOM",
 *     "authorizedRepresentative": "VIKARAM SINGH",
 *     "meterDocumentName": "meter.pdf",
 *     "meterDocumentKey": "metering/QT-…/1710000000-uuid.pdf",
 *     "meterDocumentUrl": "https://…presigned…",
 *     "meterDocumentPublicUrl": "https://…presigned…"
 *   }
 * }
 * ```
 *
 * Nested shapes also accepted by SPA parser:
 *   data.documents.meterDocumentPublicUrl
 *   data.quotation.meterDocumentPublicUrl
 *   data.documents[] with docType meter_doc / meter_document
 *
 * =============================================================================
 * S3 / PUBLIC URL RULES (critical)
 * =============================================================================
 *
 * DO NOT return only:
 *   https://{bucket}.s3.{region}.amazonaws.com/{key}
 * without signature or public-read — browsers get Access Denied.
 *
 * DO return one of:
 *   A) Presigned GET URL (SigV4 query params) — preferred if bucket is private
 *      Expiry: ≥ 7 days (or regenerate on every GET list/detail)
 *   B) Public CDN / CloudFront / NEXT_PUBLIC_MEDIA_BASE_URL style URL
 *   C) Bucket public-read object URL (only if org policy allows)
 *
 * On every GET list/detail:
 *   If stored value is a bare key or private S3 URL, re-issue
 *   meterDocumentPublicUrl = getPresignedGetUrl(bucket, key) before respond.
 *
 * Persist:
 *   meter_document_key   (stable)
 *   meter_document_name
 *   meter_document_url   (last public/presigned — optional; key is source of truth)
 *
 * =============================================================================
 * REFERENCE HANDLER (Express)
 * =============================================================================
 */

import { Router } from "express"
import multer from "multer"
import { randomUUID } from "crypto"
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

const METER_DOC_FIELDS = new Set([
  "meterDocumentImage",
  "meter_document_image",
  "meterDocument",
  "meter_document",
  "meterDocumentFile",
  "file",
])

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
})

const s3 = new S3Client({ region: process.env.AWS_REGION })
const bucket = process.env.AWS_S3_BUCKET

async function getPresignedGetUrl(key, expiresIn = 60 * 60 * 24 * 7) {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn },
  )
}

function pickMeterDocumentFile(req) {
  if (req.file && METER_DOC_FIELDS.has(req.file.fieldname)) return req.file
  if (Array.isArray(req.files)) {
    return req.files.find((f) => METER_DOC_FIELDS.has(f.fieldname)) || null
  }
  if (req.files && typeof req.files === "object") {
    for (const name of METER_DOC_FIELDS) {
      const arr = req.files[name]
      if (Array.isArray(arr) && arr[0]) return arr[0]
    }
  }
  return null
}

/**
 * POST /api/metering/quotations/:quotationId/details
 */
export async function postMeteringDetails(req, res, db) {
  try {
    const user = req.user || req.metering || req.admin
    const role = String(user?.role || "").toLowerCase()
    if (!user || !["metering", "admin", "super_admin"].includes(role)) {
      return res.status(403).json({
        success: false,
        error: { code: "AUTH_004", message: "metering or admin role required" },
      })
    }

    const quotationId = req.params.quotationId || req.params.id
    const quotation = await db.quotations.findById(quotationId)
    if (!quotation) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_001", message: "Quotation not found" },
      })
    }

    const discomName = String(req.body.discomName || "").trim()
    const meterType = String(req.body.meterType || "").trim() || null
    const meterNo = String(req.body.meterNo || "").trim()
    const solarMeterNo = String(req.body.solarMeterNo || "").trim()
    const netMeterNo = String(req.body.netMeterNo || "").trim()
    const remarks = String(req.body.remarks || "").trim()
    const authorizedRepresentative = String(
      req.body.authorizedRepresentative || req.body.authorized_representative || "",
    ).trim()
    const discomLocation = String(
      req.body.discomLocation || req.body.discom_location || "",
    ).trim()

    const existing = await db.quotationMeteringDetails.findByQuotationId(quotationId)

    let meterDocumentKey = existing?.meterDocumentKey || existing?.meter_document_key || null
    let meterDocumentName = existing?.meterDocumentName || existing?.meter_document_name || null
    let meterDocumentPublicUrl = null

    const file = pickMeterDocumentFile(req)
    if (file) {
      const ext = (file.originalname.split(".").pop() || "bin").toLowerCase()
      meterDocumentKey = `metering/${quotationId}/${Date.now()}-${randomUUID()}.${ext}`
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: meterDocumentKey,
          Body: file.buffer,
          ContentType: file.mimetype || "application/octet-stream",
        }),
      )
      meterDocumentName = file.originalname
    }

    if (meterDocumentKey) {
      meterDocumentPublicUrl = await getPresignedGetUrl(meterDocumentKey)
    }

    const saved = await db.quotationMeteringDetails.upsert(quotationId, {
      discomName: discomName || existing?.discomName || null,
      meterType: meterType || existing?.meterType || null,
      meterNo: meterNo || existing?.meterNo || null,
      solarMeterNo: solarMeterNo || existing?.solarMeterNo || null,
      netMeterNo: netMeterNo || existing?.netMeterNo || null,
      remarks: remarks || existing?.remarks || null,
      authorizedRepresentative:
        authorizedRepresentative || existing?.authorizedRepresentative || null,
      discomLocation: discomLocation || existing?.discomLocation || null,
      meterDocumentKey,
      meterDocumentName,
      meterDocumentUrl: meterDocumentPublicUrl,
      meterDocumentPublicUrl,
      savedByUserId: user.id,
      savedByRole: role,
    })

    // Also denormalize onto quotations row if your list joins that table only.
    await db.quotations.update(quotationId, {
      meter_document_key: meterDocumentKey,
      meter_document_name: meterDocumentName,
      meter_document_url: meterDocumentPublicUrl,
      meter_document_public_url: meterDocumentPublicUrl,
    })

    return res.json({
      success: true,
      data: {
        id: quotationId,
        discomName: saved.discomName,
        meterType: saved.meterType,
        meterNo: saved.meterNo,
        solarMeterNo: saved.solarMeterNo,
        netMeterNo: saved.netMeterNo,
        remarks: saved.remarks,
        authorizedRepresentative: saved.authorizedRepresentative,
        discomLocation: saved.discomLocation,
        meterDocumentName: saved.meterDocumentName,
        meterDocumentKey: saved.meterDocumentKey,
        meterDocumentUrl: meterDocumentPublicUrl,
        meterDocumentPublicUrl,
        meter_document_name: saved.meterDocumentName,
        meter_document_key: saved.meterDocumentKey,
        meter_document_url: meterDocumentPublicUrl,
        meter_document_public_url: meterDocumentPublicUrl,
      },
    })
  } catch (err) {
    console.error("postMeteringDetails", err)
    return res.status(500).json({
      success: false,
      error: { code: "SYS_001", message: "Internal server error" },
    })
  }
}

/** Wire: upload.any() then postMeteringDetails */
export function registerMeteringDetailsRoute(app, db) {
  app.post(
    "/api/metering/quotations/:quotationId/details",
    /* requireAuth, requireRole(["metering","admin"]), */
    upload.any(),
    (req, res) => postMeteringDetails(req, res, db),
  )
  app.post(
    "/api/quotations/:quotationId/metering-details",
    upload.any(),
    (req, res) => postMeteringDetails(req, res, db),
  )
}

/**
 * On GET admin/metering quotation lists — map each row:
 *
 *   if (row.meter_document_key) {
 *     row.meterDocumentPublicUrl = await getPresignedGetUrl(row.meter_document_key)
 *     row.meterDocumentUrl = row.meterDocumentPublicUrl
 *     row.meterDocumentName = row.meter_document_name
 *   }
 */

/**
 * =============================================================================
 * SQL
 * =============================================================================
 *
 * ALTER TABLE quotation_metering_details
 *   ADD COLUMN IF NOT EXISTS meter_document_key TEXT,
 *   ADD COLUMN IF NOT EXISTS meter_document_name TEXT,
 *   ADD COLUMN IF NOT EXISTS meter_document_url TEXT,
 *   ADD COLUMN IF NOT EXISTS meter_document_public_url TEXT;
 *
 * -- Optional denormalized columns on quotations for fast list joins:
 * ALTER TABLE quotations
 *   ADD COLUMN IF NOT EXISTS meter_document_key TEXT,
 *   ADD COLUMN IF NOT EXISTS meter_document_name TEXT,
 *   ADD COLUMN IF NOT EXISTS meter_document_url TEXT,
 *   ADD COLUMN IF NOT EXISTS meter_document_public_url TEXT;
 *
 * =============================================================================
 * CHECKLIST
 * =============================================================================
 *
 * - [ ] POST details accepts meterDocumentImage + aliases (upload.any / fields)
 * - [ ] Roles: metering + admin (no AUTH_004 for metering login)
 * - [ ] Upload PDF + images to S3; store key + name
 * - [ ] Response includes meterDocumentPublicUrl (=presigned/CDN) + meterDocumentUrl + meterDocumentName
 * - [ ] GET /api/admin/quotations and GET /api/metering/quotations echo the same three fields
 * - [ ] Re-presign on GET if URL expired (key is source of truth)
 * - [ ] QA: Admin Metering Details → upload PDF → Save → reopen → "Open public link" works in new tab
 *
 * =============================================================================
 * QA
 * =============================================================================
 *
 * 1. Login as metering (or admin).
 * 2. Open Metering Details for a quotation in Meter Pending / Discom.
 * 3. Upload a PDF → Save Details.
 * 4. Expect toast success; reopen modal → see "Uploaded meter document" + Open public link.
 * 5. Click link → PDF opens (not S3 Access Denied XML).
 * 6. Refresh page → same link still works (re-presign on GET if needed).
 */

export {}
