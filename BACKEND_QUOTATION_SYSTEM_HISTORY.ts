// @ts-nocheck
/**
 * =============================================================================
 * BACKEND REFERENCE — Additional quotation + restore current (Jul 2026)
 * =============================================================================
 *
 * Handoff: BACKEND_CHANGES_HANDOFF.md §23
 * Frontend:
 *   - saveQuotation({ allowAdditionalForCustomer, sourceQuotationId })
 *   - api.quotations.restoreAsCurrent(id)
 *   - lib/quotation-current.ts
 *
 * Implemented in this repo:
 *   - utils/quotationAdditionalCreate.ts
 *   - migration isCurrent + sourceQuotationId
 *   - POST /quotations allow-additional + isCurrent
 *   - POST …/restore-current (+ set-current + PATCH isCurrent fallbacks)
 *   - GET list/detail isCurrent / sourceQuotationId
 *
 * Product ask:
 *   1. Store OLD + NEW quotations for the same customer (Adani kept, Waaree added).
 *   2. Mark one as Current; others Previous.
 *   3. Actions → Restore makes an older quotation Current again.
 *
 * Live blocker:
 *   POST /quotations rejects second quotation for same mobile.
 *
 * REQUIRED (A) — allow additional create
 * REQUIRED (B) — is_current flag + restore endpoint
 */

export function isAdditionalQuotationRequest(body = {}) {
  if (body.allowAdditionalQuotation === true || body.allow_additional_quotation === true) {
    return true
  }
  if (body.allowDuplicateMobile === true || body.allow_duplicate_mobile === true) {
    return true
  }
  return Boolean(resolveSourceQuotationId(body))
}

export function resolveSourceQuotationId(body = {}) {
  return String(
    body.sourceQuotationId ||
      body.source_quotation_id ||
      body.previousQuotationId ||
      body.previous_quotation_id ||
      body.revisesQuotationId ||
      body.revises_quotation_id ||
      "",
  ).trim()
}

/**
 * Migration:
 *
 *   ALTER TABLE quotations
 *     ADD COLUMN IF NOT EXISTS source_quotation_id VARCHAR(64) NULL,
 *     ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT TRUE;
 *
 * Backfill: for each customer_id, set is_current=true only on the newest row.
 */

/**
 * A) POST /quotations — skip duplicate mobile when additional flags present.
 *    On create with allowAdditionalQuotation:
 *      - INSERT new quotation with is_current = true
 *      - UPDATE other quotations for same customer_id SET is_current = false
 *      - Do NOT delete/update products on the old row
 */
export async function afterCreateAdditionalQuotation(newQuotation, { Quotations, transaction }) {
  const customerId = newQuotation.customer_id || newQuotation.customerId
  if (!customerId || !newQuotation.id) return

  await Quotations.update(
    { is_current: false },
    {
      where: {
        customer_id: customerId,
        id: { $ne: newQuotation.id }, // adapt to Sequelize Op.ne
      },
      transaction,
    },
  )
  await Quotations.update(
    { is_current: true },
    { where: { id: newQuotation.id }, transaction },
  )
}

/**
 * B) POST /quotations/:id/restore-current
 *
 *   Make this quotation current; all other quotations for the same customer
 *   become previous (is_current=false). Do not delete any rows.
 */
export async function postRestoreQuotationCurrent(req, res, { Quotations, db }) {
  const id = req.params.id || req.params.quotationId
  const t = await db.transaction()
  try {
    const quotation = await Quotations.findByPk(id, {
      transaction: t,
      lock: t.LOCK?.UPDATE,
    })
    if (!quotation) {
      await t.rollback()
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Quotation not found" },
      })
    }

    const customerId = quotation.customer_id || quotation.customerId
    if (customerId) {
      await Quotations.update(
        { is_current: false },
        {
          where: { customer_id: customerId },
          transaction: t,
        },
      )
    }

    await quotation.update({ is_current: true }, { transaction: t })
    await t.commit()

    const fresh = await Quotations.findByPk(id)
    return res.json({
      success: true,
      data: {
        ...(typeof fresh.toJSON === "function" ? fresh.toJSON() : fresh),
        isCurrent: true,
        is_current: true,
      },
      message: `${id} restored as current quotation`,
    })
  } catch (e) {
    await t.rollback()
    throw e
  }
}

/**
 * GET /quotations — include for every row:
 *   isCurrent / is_current
 *   sourceQuotationId / source_quotation_id (optional)
 *
 * Frontend shows:
 *   - Badge "Current" / "Previous"
 *   - Rotate icon "Restore as current" on Previous rows when customer has 2+ quotations
 *   - FilePlus "New quotation (same customer)" on any row
 */

/**
 * Frontend body on revise save:
 * {
 *   "allowAdditionalQuotation": true,
 *   "isCurrent": true,
 *   "setAsCurrent": true,
 *   "sourceQuotationId": "QT-OLD",
 *   "customer": { "mobile": "…" },
 *   "products": { … },
 *   "subtotal": …, "totalAmount": …, "finalAmount": …
 * }
 *
 * Restore:
 *   POST /api/quotations/QT-OLD/restore-current
 *   (fallback PATCH /quotations/QT-OLD { isCurrent: true })
 */

/**
 * QA
 * ---
 * 1. QT-OLD Adani exists (is_current=true)
 * 2. POST additional Waaree with flags → QT-NEW is_current=true, QT-OLD is_current=false
 * 3. GET list → both rows; badges Current / Previous
 * 4. POST /quotations/QT-OLD/restore-current → QT-OLD current again, QT-NEW previous
 * 5. Neither row deleted; products unchanged on each id
 */
