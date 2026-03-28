// @ts-nocheck
/* global Quotation */
// In your server: import { Quotation } from './models/Quotation'

/**
 * =============================================================================
 * BACKEND REFERENCE — Admin quotation approval + bank fields + Account Management
 * =============================================================================
 *
 * Frontend calls (see lib/api.ts):
 *
 *   PATCH /admin/quotations/:quotationId/status
 *   Body when approving:
 *     { status: "approved", paymentType, paymentMode, bankName?, bankIfsc? }
 *   - paymentType and paymentMode are the same value: "loan" | "cash" | "mix"
 *   - For "loan" or "mix", frontend requires bankName + bankIfsc (11-char IFSC)
 *
 *   GET /quotations?status=approved&limit=1000   (Account Management list)
 *   GET /quotations/:id                          (Quotation details dialog)
 *
 * Each quotation in JSON should expose (camelCase preferred; frontend also reads snake_case):
 *   paymentMode, paymentType (optional), bankName, bankIfsc
 */

const PAYMENT_TYPES = ["loan", "cash", "mix"]
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/

function normalizePaymentType(raw) {
  if (typeof raw !== "string") return null
  const v = raw.trim().toLowerCase()
  return PAYMENT_TYPES.includes(v) ? v : null
}

function normalizeIfsc(raw) {
  if (typeof raw !== "string") return null
  const v = raw.trim().toUpperCase().replace(/\s/g, "")
  return IFSC_REGEX.test(v) ? v : null
}

/**
 * --- DATABASE: quotations table ---
 *
 * PostgreSQL:
 *   ALTER TABLE quotations ADD COLUMN IF NOT EXISTS bank_name VARCHAR(255);
 *   ALTER TABLE quotations ADD COLUMN IF NOT EXISTS bank_ifsc VARCHAR(11);
 *   -- payment_mode often already exists; ensure it can store loan|cash|mix
 *
 * MySQL:
 *   ALTER TABLE quotations ADD COLUMN bank_name VARCHAR(255) NULL;
 *   ALTER TABLE quotations ADD COLUMN bank_ifsc VARCHAR(11) NULL;
 *
 * Sequelize model (example):
 *   bankName: { type: DataTypes.STRING(255), allowNull: true, field: 'bank_name' },
 *   bankIfsc: { type: DataTypes.STRING(11), allowNull: true, field: 'bank_ifsc' },
 *   paymentMode: { type: DataTypes.STRING(20), allowNull: true, field: 'payment_mode' },
 */

/**
 * PATCH /admin/quotations/:quotationId/status
 */
export async function patchAdminQuotationStatus(req, res) {
  try {
    const user = req.admin ?? req.user
    if (!user || user.role !== "admin") {
      res.status(401).json({ success: false, error: { code: "AUTH_003", message: "Admin required" } })
      return
    }

    const quotationId = req.params.quotationId || req.params.id
    if (!quotationId) {
      res.status(400).json({ success: false, error: { code: "VAL_001", message: "Quotation ID required" } })
      return
    }

    const body = req.body || {}
    const statusRaw = typeof body.status === "string" ? body.status.trim().toLowerCase() : ""
    const allowed = ["pending", "approved", "rejected", "completed"]
    if (!allowed.includes(statusRaw)) {
      res.status(400).json({
        success: false,
        error: { code: "VAL_002", message: `status must be one of: ${allowed.join(", ")}` },
      })
      return
    }

    const quotation = await Quotation.findByPk(quotationId)
    if (!quotation) {
      res.status(404).json({ success: false, error: { code: "RES_001", message: "Quotation not found" } })
      return
    }

    const updates = { status: statusRaw }

    if (statusRaw === "approved") {
      const paymentType =
        normalizePaymentType(body.paymentType) ?? normalizePaymentType(body.paymentMode)
      if (!paymentType) {
        res.status(400).json({
          success: false,
          error: {
            code: "VAL_003",
            message: "paymentType or paymentMode required (loan, cash, mix)",
          },
        })
        return
      }
      updates.paymentMode = paymentType

      if (paymentType === "loan" || paymentType === "mix") {
        const bankName = typeof body.bankName === "string" ? body.bankName.trim() : ""
        const ifsc = normalizeIfsc(body.bankIfsc ?? body.bank_ifsc)
        if (!bankName) {
          res.status(400).json({
            success: false,
            error: { code: "VAL_004", message: "bankName required for loan/mix" },
          })
          return
        }
        if (!ifsc) {
          res.status(400).json({
            success: false,
            error: { code: "VAL_005", message: "Valid 11-char bankIfsc required for loan/mix" },
          })
          return
        }
        updates.bankName = bankName
        updates.bankIfsc = ifsc
      } else {
        updates.bankName = null
        updates.bankIfsc = null
      }
    } else if (statusRaw === "rejected") {
      updates.bankName = null
      updates.bankIfsc = null
      updates.paymentMode = null
    }

    await quotation.update(updates)
    await quotation.reload()

    res.json({
      success: true,
      data: {
        id: quotationId,
        status: quotation.status,
        paymentMode: quotation.paymentMode,
        bankName: quotation.bankName,
        bankIfsc: quotation.bankIfsc,
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: { code: "SYS_001", message: "Internal error" } })
  }
}

/**
 * --- GET serializers (list + by id) ---
 *
 * Include in every quotation JSON object:
 *   paymentMode  (string | null)
 *   bankName     (string | null)
 *   bankIfsc     (string | null)
 *   paymentType  (optional; frontend falls back to paymentMode)
 *
 * If you use Sequelize `attributes: [...]` whitelist on findAll/findByPk, add:
 *   'bank_name', 'bank_ifsc', 'payment_mode'
 *
 * Example mapper:
 */
export function quotationToApiJson(row) {
  const q = row.get ? row.get({ plain: true }) : row
  return {
    ...q,
    paymentMode: q.paymentMode ?? q.payment_mode ?? null,
    paymentType: q.paymentType ?? q.payment_type ?? q.paymentMode ?? q.payment_mode ?? null,
    bankName: q.bankName ?? q.bank_name ?? null,
    bankIfsc: q.bankIfsc ?? q.bank_ifsc ?? null,
  }
}

/**
 * Route registration (Express example):
 *   router.patch('/admin/quotations/:quotationId/status', adminAuth, patchAdminQuotationStatus)
 *
 * This repo: `utils/quotationApiJson.ts` → `quotationPaymentApiFields` (payment/bank slice +
 * snake_case mirrors) used by GET quotation list/detail and admin quotation serializers;
 * live PATCH handler: `updateQuotationStatus` in `controllers/adminController.ts`.
 */
