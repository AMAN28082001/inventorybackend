// @ts-nocheck
/* global Quotation */
// In your server: import { Quotation } from './models/Quotation'

/**
 * =============================================================================
 * BACKEND REFERENCE
 * 1) Admin quotation approval + bank fields + Account Management
 * 2) HR lead upload + DB-backed uploaded-data list + one-by-one assignment
 * =============================================================================
 *
 * Frontend calls (see lib/api.ts):
 *
 *   PATCH /admin/quotations/:quotationId/status
 *   Body when approving:
 *     { status: "approved", paymentType, paymentMode, bankName?, bankIfsc?, subsidyChequeDetails? }
 *   - paymentType and paymentMode are the same value: "loan" | "cash" | "mix" (UI label for mix: "Cash + loan")
 *   - For mix: also persist loanAmount + cashAmount (must sum to quotation subtotal) — see BACKEND_CASH_LOAN_AMOUNTS.md
 *   - For loan: persist loanAmount; clear cashAmount
 *   - For cash: clear loanAmount / cashAmount
 *   - Echo loanAmount / cashAmount / paymentType on GET list + detail
 *   - For "loan" or "mix", frontend requires bankName + bankIfsc (11-char IFSC)
 *   - Optional subsidyChequeDetails (text) when payment is "cash" or "mix"
 *
 *   On every status change, append to statusHistory: [{ status, at }, ...] (ISO timestamps).
 *   When status becomes "approved", set statusApprovedAt (ISO). Frontend shows "Last approved".
 *
 *   PATCH /admin/quotations/:quotationId/file-login
 *   Body either:
 *     { resetFileLogin: true }   -- clear file-login fields
 *   or:
 *     { fileLoginStatus: "already_login"|"login_now", filePaymentType: "loan"|"cash"|"mix",
 *       fileBankName?, fileBankIfsc?, bankName?, bankIfsc?, fileSubsidyChequeDetails? }
 *   - Frontend may duplicate bank as bankName/bankIfsc and fileBankName/fileBankIfsc; persist file* columns.
 *   - For loan/mix: require bank + IFSC (same rules as approval).
 *   - On successful save (not reset): set fileLoginAt = now (ISO).
 *
 *   GET /quotations?status=approved&limit=1000   (Account Management list)
 *   GET /quotations/:id                          (Quotation details dialog)
 *
 *   PATCH /quotations/:quotationId/payment-details   (Account Management — primary)
 *   PUT  /quotations/:quotationId/installments       (preferred replace — see BACKEND_INSTALLMENT_REPLACE.ts)
 *   PATCH /quotations/:quotationId/installments      (fallback; body may use `installments` not `phases`)
 *   Body flags: replaceInstallments: true | replace: true → **full replace** of installment rows (not merge).
 *   Empty phases/installments array [] clears all installments.
 *   Body (JSON):
 *     paymentType?, paymentMode?, paymentStatus?,
 *     phases: [{ phaseNumber, phaseName, amount, paidAmount, status, dueDate?, paymentDate?, paymentMode?, transactionId?, note? }]
 *     subsidyCheques?: [{ id, details, amount, status: "pending"|"cleared", clearedAt? }]
 *   - Persist phases/installments to DB; recompute remaining = subtotal − sum(paidAmount) (store `remaining` / `remaining_amount` if you expose it).
 *   - Persist `subsidy_cheques` JSON for audit (optional but recommended so clients do not rely only on localStorage).
 *   - Cleared subsidy amounts are also reflected in `paidAmount` on phases when accounts “apply to paid”; keep subsidyCheques in sync.
 *
 *   Authorization: allow role `account-management` and `admin` for payment-details PATCH; dealers must NOT update other dealers’ quotations unless your product allows it.
 *
 *   HR upload/assignment flow:
 *   POST /hr/leads/upload-csv
 *     multipart: file, dealerIds[], activeLimitPerDealer
 *     - frontend now sends activeLimitPerDealer = 1 (single active lead per dealer)
 *   GET /admin/dealers (HR dealer pool selector)
 *     - return ALL dealers for selection (or support `includeInactive=true`).
 *     - do not hard-filter to only active dealers for this screen.
 *     - this endpoint is the single source of truth for HR "Select Dealers" checkbox list
 *       (frontend should not need to merge old local/quotation dealer snapshots).
 *     - include stable identity/contact fields per row:
 *         { id, firstName, lastName, mobile, email, username, isActive, createdAt }
 *   GET /hr/leads/uploads?limit=200
 *     - used by HR "Uploaded Data" tab, must come from DB (not local cache)
 *
 * Each quotation in JSON should expose (camelCase preferred; frontend also reads snake_case):
 *   paymentMode, paymentType (optional), bankName, bankIfsc, subsidyChequeDetails
 *   fileLoginStatus, filePaymentType, fileBankName, fileBankIfsc, fileSubsidyChequeDetails, fileLoginAt
 *   statusApprovedAt, statusHistory (array of { status, at })
 *   subsidyCheques (array, audit trail for Account Management — see below)
 *   remaining OR remainingAmount (number, optional but recommended for list UI)
 *   installments | paymentPhases | payment_phases (phase rows; same shape as PATCH `phases`, including optional `note`)
 *
 * Dealer details required by frontend:
 *   - For quotation list rows:
 *       include either nested `dealer` OR resolvable `dealerId` with directory endpoint.
 *       Recommended nested shape:
 *         dealer: { id, firstName, lastName, email, mobile, username, role }
 *   - For `/admin/dealers` directory:
 *       each row should include at least:
 *         { id, firstName, lastName, mobile, email, username, isActive, createdAt }
 *       (HR assignment uses this list for dealer checkbox selection; mobile is mandatory in UI)
 *   - Do not omit `mobile` from dealer payloads where dealer identity is shown in admin tables.
 */

const PAYMENT_TYPES = ["loan", "cash", "mix"]
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/

function normalizePaymentType(raw) {
  if (typeof raw !== "string") return null
  const v = raw.trim().toLowerCase()
  return PAYMENT_TYPES.includes(v) ? v : null
}

function parseApproveInrAmount(raw) {
  if (raw === undefined || raw === null || raw === "") return null
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[₹,\s]/g, ""))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n)
}

/** Resolve loan/cash amounts on approve — see BACKEND_CASH_LOAN_AMOUNTS.ts */
function resolveApproveLoanCashAmounts({ paymentType, loanAmountRaw, cashAmountRaw, quotationSubtotal }) {
  const loan = parseApproveInrAmount(loanAmountRaw)
  const cash = parseApproveInrAmount(cashAmountRaw)
  const S = Math.max(0, Math.round(Number(quotationSubtotal) || 0))

  if (paymentType === "cash") {
    return { ok: true, loanAmount: null, cashAmount: null }
  }
  if (paymentType === "loan") {
    if (loan == null || loan <= 0) {
      return { ok: false, code: "VAL_LOAN_AMT", message: "loanAmount required for loan approval" }
    }
    return { ok: true, loanAmount: loan, cashAmount: null }
  }
  if (loan == null || loan <= 0) {
    return { ok: false, code: "VAL_LOAN_AMT", message: "loanAmount required for Cash + loan" }
  }
  if (cash == null || cash <= 0) {
    return { ok: false, code: "VAL_CASH_AMT", message: "cashAmount required for Cash + loan" }
  }
  if (S > 0 && loan + cash !== S) {
    return {
      ok: false,
      code: "VAL_AMT_SUM",
      message: `loanAmount + cashAmount must equal quotation total (${S})`,
    }
  }
  return { ok: true, loanAmount: loan, cashAmount: cash }
}

function normalizeIfsc(raw) {
  if (typeof raw !== "string") return null
  const v = raw.trim().toUpperCase().replace(/\s/g, "")
  return IFSC_REGEX.test(v) ? v : null
}

function readStatusHistory(row) {
  const raw = row.statusHistory ?? row.status_history
  if (Array.isArray(raw)) return raw.filter((e) => e && e.status && e.at)
  if (typeof raw === "string" && raw.trim()) {
    try {
      const p = JSON.parse(raw)
      return Array.isArray(p) ? p.filter((e) => e && e.status && e.at) : []
    } catch {
      return []
    }
  }
  return []
}

function normalizeFileLoginStatus(raw) {
  if (typeof raw !== "string") return null
  const v = raw.trim().toLowerCase().replace(/[-\s]+/g, "_")
  if (v === "already_login" || v === "already_logged_in" || v === "alreadylogin") return "already_login"
  if (v === "login_now" || v === "loginnow") return "login_now"
  return null
}

/**
 * --- DATABASE: quotations table ---
 *
 * PostgreSQL:
 *   ALTER TABLE quotations ADD COLUMN IF NOT EXISTS bank_name VARCHAR(255);
 *   ALTER TABLE quotations ADD COLUMN IF NOT EXISTS bank_ifsc VARCHAR(11);
 *   ALTER TABLE quotations ADD COLUMN IF NOT EXISTS subsidy_cheque_details TEXT;
 *   ALTER TABLE quotations ADD COLUMN IF NOT EXISTS file_login_status VARCHAR(32);
 *   ALTER TABLE quotations ADD COLUMN IF NOT EXISTS file_payment_type VARCHAR(16);
 *   ALTER TABLE quotations ADD COLUMN IF NOT EXISTS file_bank_name VARCHAR(255);
 *   ALTER TABLE quotations ADD COLUMN IF NOT EXISTS file_bank_ifsc VARCHAR(11);
 *   ALTER TABLE quotations ADD COLUMN IF NOT EXISTS file_subsidy_cheque_details TEXT;
 *   ALTER TABLE quotations ADD COLUMN IF NOT EXISTS file_login_at TIMESTAMPTZ;
 *   ALTER TABLE quotations ADD COLUMN IF NOT EXISTS status_approved_at TIMESTAMPTZ;
 *   ALTER TABLE quotations ADD COLUMN IF NOT EXISTS status_history JSONB DEFAULT '[]'::jsonb;
 *   ALTER TABLE quotations ADD COLUMN IF NOT EXISTS subsidy_cheques JSONB DEFAULT '[]'::jsonb;
 *   ALTER TABLE quotations ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(14,2);
 *   ALTER TABLE quotations ADD COLUMN IF NOT EXISTS loan_amount NUMERIC(14,2);
 *   ALTER TABLE quotations ADD COLUMN IF NOT EXISTS cash_amount NUMERIC(14,2);
 *   -- Or compute `remaining` in API from subtotal − sum(phases.paidAmount) if you do not store it.
 *   -- payment_mode often already exists; ensure it can store loan|cash|mix
 *
 * MySQL:
 *   ALTER TABLE quotations ADD COLUMN bank_name VARCHAR(255) NULL;
 *   ALTER TABLE quotations ADD COLUMN bank_ifsc VARCHAR(11) NULL;
 *   ALTER TABLE quotations ADD COLUMN subsidy_cheque_details TEXT NULL;
 *   ALTER TABLE quotations ADD COLUMN file_login_status VARCHAR(32) NULL;
 *   ALTER TABLE quotations ADD COLUMN file_payment_type VARCHAR(16) NULL;
 *   ALTER TABLE quotations ADD COLUMN file_bank_name VARCHAR(255) NULL;
 *   ALTER TABLE quotations ADD COLUMN file_bank_ifsc VARCHAR(11) NULL;
 *   ALTER TABLE quotations ADD COLUMN file_subsidy_cheque_details TEXT NULL;
 *   ALTER TABLE quotations ADD COLUMN file_login_at DATETIME(3) NULL;
 *   ALTER TABLE quotations ADD COLUMN status_approved_at DATETIME(3) NULL;
 *   ALTER TABLE quotations ADD COLUMN status_history JSON NULL;
 *   ALTER TABLE quotations ADD COLUMN subsidy_cheques JSON NULL;
 *   ALTER TABLE quotations ADD COLUMN remaining_amount DECIMAL(14,2) NULL;
 *   ALTER TABLE quotations ADD COLUMN loan_amount DECIMAL(14,2) NULL;
 *   ALTER TABLE quotations ADD COLUMN cash_amount DECIMAL(14,2) NULL;
 *
 * Sequelize model (example):
 *   bankName: { type: DataTypes.STRING(255), allowNull: true, field: 'bank_name' },
 *   bankIfsc: { type: DataTypes.STRING(11), allowNull: true, field: 'bank_ifsc' },
 *   paymentMode: { type: DataTypes.STRING(20), allowNull: true, field: 'payment_mode' },
 *   loanAmount: { type: DataTypes.DECIMAL(14, 2), allowNull: true, field: 'loan_amount' },
 *   cashAmount: { type: DataTypes.DECIMAL(14, 2), allowNull: true, field: 'cash_amount' },
 *   subsidyChequeDetails: { type: DataTypes.TEXT, allowNull: true, field: 'subsidy_cheque_details' },
 *   fileLoginStatus: { type: DataTypes.STRING(32), allowNull: true, field: 'file_login_status' },
 *   filePaymentType: { type: DataTypes.STRING(16), allowNull: true, field: 'file_payment_type' },
 *   fileBankName: { type: DataTypes.STRING(255), allowNull: true, field: 'file_bank_name' },
 *   fileBankIfsc: { type: DataTypes.STRING(11), allowNull: true, field: 'file_bank_ifsc' },
 *   fileSubsidyChequeDetails: { type: DataTypes.TEXT, allowNull: true, field: 'file_subsidy_cheque_details' },
 *   fileLoginAt: { type: DataTypes.DATE, allowNull: true, field: 'file_login_at' },
 *   statusApprovedAt: { type: DataTypes.DATE, allowNull: true, field: 'status_approved_at' },
 *   statusHistory: { type: DataTypes.JSON, allowNull: true, field: 'status_history', defaultValue: [] },
 *   subsidyCheques: { type: DataTypes.JSON, allowNull: true, field: 'subsidy_cheques', defaultValue: [] },
 *   remainingAmount: { type: DataTypes.DECIMAL(14, 2), allowNull: true, field: 'remaining_amount' },
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

    const at = new Date().toISOString()
    const prevHistory = readStatusHistory(quotation.get ? quotation.get({ plain: true }) : quotation)
    const updates = {
      status: statusRaw,
      statusHistory: [...prevHistory, { status: statusRaw, at }],
    }

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
      updates.paymentType = paymentType
      updates.statusApprovedAt = at

      // Persist loan / cash split (Cash + loan). See BACKEND_CASH_LOAN_AMOUNTS.ts §28.
      const quotationSubtotal = pickQuotationSubtotalForPayments(quotation)
      const amountResult = resolveApproveLoanCashAmounts({
        paymentType,
        loanAmountRaw: body.loanAmount ?? body.loan_amount,
        cashAmountRaw: body.cashAmount ?? body.cash_amount,
        quotationSubtotal,
      })
      if (!amountResult.ok) {
        res.status(400).json({
          success: false,
          error: { code: amountResult.code, message: amountResult.message },
        })
        return
      }
      updates.loanAmount = amountResult.loanAmount
      updates.cashAmount = amountResult.cashAmount
      // Keep file-login type in sync so list UIs that still read filePaymentType stay correct.
      updates.filePaymentType = paymentType

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

      const subsidyRaw =
        typeof body.subsidyChequeDetails === "string"
          ? body.subsidyChequeDetails.trim()
          : typeof body.subsidy_cheque_details === "string"
            ? body.subsidy_cheque_details.trim()
            : ""
      if (paymentType === "loan") {
        updates.subsidyChequeDetails = null
      } else if (paymentType === "cash" || paymentType === "mix") {
        updates.subsidyChequeDetails = subsidyRaw || null
      }
    } else if (statusRaw === "rejected") {
      updates.bankName = null
      updates.bankIfsc = null
      updates.paymentMode = null
      updates.paymentType = null
      updates.loanAmount = null
      updates.cashAmount = null
      updates.subsidyChequeDetails = null
    }

    await quotation.update(updates)
    await quotation.reload()

    res.json({
      success: true,
      data: {
        id: quotationId,
        status: quotation.status,
        paymentMode: quotation.paymentMode,
        paymentType: quotation.paymentType ?? quotation.paymentMode,
        loanAmount: quotation.loanAmount ?? quotation.loan_amount ?? null,
        cashAmount: quotation.cashAmount ?? quotation.cash_amount ?? null,
        bankName: quotation.bankName,
        bankIfsc: quotation.bankIfsc,
        subsidyChequeDetails: quotation.subsidyChequeDetails ?? quotation.subsidy_cheque_details ?? null,
        statusApprovedAt: quotation.statusApprovedAt ?? quotation.status_approved_at ?? null,
        statusHistory: readStatusHistory(quotation.get ? quotation.get({ plain: true }) : quotation),
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: { code: "SYS_001", message: "Internal error" } })
  }
}

/**
 * PATCH /admin/quotations/:quotationId/file-login
 * Body: { resetFileLogin: true } OR full file-login payload (see file header).
 */
export async function patchAdminQuotationFileLogin(req, res) {
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

    const quotation = await Quotation.findByPk(quotationId)
    if (!quotation) {
      res.status(404).json({ success: false, error: { code: "RES_001", message: "Quotation not found" } })
      return
    }

    const body = req.body || {}
    if (body.resetFileLogin === true) {
      await quotation.update({
        fileLoginStatus: null,
        filePaymentType: null,
        fileBankName: null,
        fileBankIfsc: null,
        fileSubsidyChequeDetails: null,
        fileLoginAt: null,
      })
      await quotation.reload()
      res.json({
        success: true,
        data: {
          id: quotationId,
          reset: true,
          fileLoginStatus: null,
          fileLoginAt: null,
        },
      })
      return
    }

    const fls = normalizeFileLoginStatus(body.fileLoginStatus ?? body.file_login_status)
    if (!fls) {
      res.status(400).json({
        success: false,
        error: { code: "VAL_006", message: "fileLoginStatus must be already_login or login_now" },
      })
      return
    }

    const paymentType =
      normalizePaymentType(body.filePaymentType) ??
      normalizePaymentType(body.paymentMode) ??
      normalizePaymentType(body.file_payment_type)
    if (!paymentType) {
      res.status(400).json({
        success: false,
        error: { code: "VAL_007", message: "filePaymentType or paymentMode required (loan, cash, mix)" },
      })
      return
    }

    const updates = {
      fileLoginStatus: fls,
      filePaymentType: paymentType,
      fileLoginAt: new Date(),
    }

    if (paymentType === "loan" || paymentType === "mix") {
      const bankName =
        typeof (body.fileBankName ?? body.bankName) === "string"
          ? String(body.fileBankName ?? body.bankName).trim()
          : ""
      const ifsc = normalizeIfsc(body.fileBankIfsc ?? body.file_bank_ifsc ?? body.bankIfsc ?? body.bank_ifsc)
      if (!bankName) {
        res.status(400).json({
          success: false,
          error: { code: "VAL_008", message: "Bank name required for loan / cash + loan file login" },
        })
        return
      }
      if (!ifsc) {
        res.status(400).json({
          success: false,
          error: { code: "VAL_009", message: "Valid 11-char IFSC required for loan / cash + loan file login" },
        })
        return
      }
      updates.fileBankName = bankName
      updates.fileBankIfsc = ifsc
    } else {
      updates.fileBankName = null
      updates.fileBankIfsc = null
    }

    const chequeRaw =
      typeof body.fileSubsidyChequeDetails === "string"
        ? body.fileSubsidyChequeDetails.trim()
        : typeof body.file_subsidy_cheque_details === "string"
          ? body.file_subsidy_cheque_details.trim()
          : ""
    updates.fileSubsidyChequeDetails =
      chequeRaw && (paymentType === "cash" || paymentType === "mix") ? chequeRaw : null

    await quotation.update(updates)
    await quotation.reload()
    const plain = quotation.get ? quotation.get({ plain: true }) : quotation

    res.json({
      success: true,
      data: {
        id: quotationId,
        fileLoginStatus: plain.fileLoginStatus ?? plain.file_login_status,
        filePaymentType: plain.filePaymentType ?? plain.file_payment_type,
        fileBankName: plain.fileBankName ?? plain.file_bank_name,
        fileBankIfsc: plain.fileBankIfsc ?? plain.file_bank_ifsc,
        fileSubsidyChequeDetails: plain.fileSubsidyChequeDetails ?? plain.file_subsidy_cheque_details,
        fileLoginAt: plain.fileLoginAt ?? plain.file_login_at,
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
 *   dealer object with contact mobile (either nested `dealer.mobile` OR ensure `/admin/dealers` returns `mobile`
 *   for lookup by `dealerId`).
 *   subsidyChequeDetails, fileLoginStatus, filePaymentType, fileBankName, fileBankIfsc,
 *   fileSubsidyChequeDetails, fileLoginAt, statusApprovedAt, statusHistory
 *
 * If you use Sequelize `attributes: [...]` whitelist on findAll/findByPk, add:
 *   'bank_name', 'bank_ifsc', 'payment_mode', 'subsidy_cheque_details',
 *   'file_login_status', 'file_payment_type', 'file_bank_name', 'file_bank_ifsc',
 *   'file_subsidy_cheque_details', 'file_login_at', 'status_approved_at', 'status_history',
 *   'subsidy_cheques', 'remaining_amount'
 *
 * Example mapper:
 */
function readSubsidyCheques(q) {
  const raw = q.subsidyCheques ?? q.subsidy_cheques
  if (Array.isArray(raw)) return raw
  if (typeof raw === "string" && raw.trim()) {
    try {
      const p = JSON.parse(raw)
      return Array.isArray(p) ? p : []
    } catch {
      return []
    }
  }
  return []
}

export function quotationToApiJson(row) {
  const q = row.get ? row.get({ plain: true }) : row
  const phases =
    q.installments ||
    q.paymentPhases ||
    q.payment_phases ||
    q.quotationPaymentPhases ||
    q.quotation_payment_phases ||
    []
  return {
    ...q,
    paymentMode: q.paymentMode ?? q.payment_mode ?? null,
    paymentType: q.paymentType ?? q.payment_type ?? q.paymentMode ?? q.payment_mode ?? null,
    loanAmount: q.loanAmount ?? q.loan_amount ?? null,
    cashAmount: q.cashAmount ?? q.cash_amount ?? null,
    loan_amount: q.loanAmount ?? q.loan_amount ?? null,
    cash_amount: q.cashAmount ?? q.cash_amount ?? null,
    bankName: q.bankName ?? q.bank_name ?? null,
    bankIfsc: q.bankIfsc ?? q.bank_ifsc ?? null,
    subsidyChequeDetails: q.subsidyChequeDetails ?? q.subsidy_cheque_details ?? null,
    fileLoginStatus: q.fileLoginStatus ?? q.file_login_status ?? null,
    filePaymentType: q.filePaymentType ?? q.file_payment_type ?? null,
    fileBankName: q.fileBankName ?? q.file_bank_name ?? null,
    fileBankIfsc: q.fileBankIfsc ?? q.file_bank_ifsc ?? null,
    fileSubsidyChequeDetails: q.fileSubsidyChequeDetails ?? q.file_subsidy_cheque_details ?? null,
    fileLoginAt: q.fileLoginAt ?? q.file_login_at ?? null,
    statusApprovedAt: q.statusApprovedAt ?? q.status_approved_at ?? null,
    statusHistory: readStatusHistory(q),
    subsidyCheques: readSubsidyCheques(q),
    remaining: q.remaining ?? q.remaining_amount ?? null,
    remainingAmount: q.remainingAmount ?? q.remaining_amount ?? q.remaining ?? null,
    installments: Array.isArray(phases) ? phases : [],
    paymentPhases: Array.isArray(phases) ? phases : [],
  }
}

/**
 * Normalize subsidy cheque rows from PATCH body (Account Management).
 */
export function normalizeSubsidyChequesFromRequestBody(body) {
  const raw = body?.subsidyCheques ?? body?.subsidy_cheques
  if (!Array.isArray(raw)) return undefined
  const out = []
  for (const c of raw) {
    if (!c || typeof c !== "object") continue
    const id = String(c.id || "").trim() || `sc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const details = String(c.details ?? c.chequeDetails ?? "").trim()
    const amount = Math.max(0, Math.round(Number(c.amount) || 0))
    const status = c.status === "cleared" ? "cleared" : "pending"
    const clearedAt =
      c.clearedAt || c.cleared_at || (status === "cleared" ? new Date().toISOString() : undefined)
    out.push({ id, details, amount, status, clearedAt })
  }
  return out
}

function pickQuotationSubtotalForPayments(row) {
  const q = row.get ? row.get({ plain: true }) : row
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  return Math.max(
    0,
    Math.round(
      n(q.subtotal) ||
        n(q.pricing?.subtotal) ||
        n(q.pricing?.totalAmount) ||
        n(q.totalAmount) ||
        n(q.finalAmount),
    ),
  )
}

/**
 * PATCH /quotations/:quotationId/payment-details
 * - Intended for Account Management “Manage” / Submit (see lib/api.ts updatePaymentDetails).
 * - Merge with your real persistence (installment table vs JSON on quotation).
 */
export async function patchQuotationPaymentDetails(req, res) {
  try {
    const user = req.user
    const role = user?.role
    if (!user || !["account-management", "admin"].includes(role)) {
      res.status(403).json({ success: false, error: { code: "AUTH_004", message: "Insufficient permissions" } })
      return
    }

    const quotationId = req.params.quotationId || req.params.id
    if (!quotationId) {
      res.status(400).json({ success: false, error: { code: "VAL_001", message: "Quotation ID required" } })
      return
    }

    const quotation = await Quotation.findByPk(quotationId)
    if (!quotation) {
      res.status(404).json({ success: false, error: { code: "RES_001", message: "Quotation not found" } })
      return
    }

    const plain = quotation.get ? quotation.get({ plain: true }) : quotation
    if (String(plain.status || "").toLowerCase() !== "approved") {
      res.status(400).json({
        success: false,
        error: { code: "VAL_010", message: "Only approved quotations can be updated here" },
      })
      return
    }

    const body = req.body || {}
    const phasesInput = body.phases || body.installments || []
    if (!Array.isArray(phasesInput)) {
      res.status(400).json({ success: false, error: { code: "VAL_011", message: "phases must be an array" } })
      return
    }

    const replaceMode =
      body.replaceInstallments === true ||
      body.replace === true ||
      body.syncInstallments === "replace" ||
      req.method === "PUT"

    // When replaceMode is true (default for Account Management Submit), persist exactly
    // phasesInput.length rows — delete orphans. See BACKEND_INSTALLMENT_REPLACE.ts.
    void replaceMode

    const subtotal = pickQuotationSubtotalForPayments(quotation)
    let sumPaid = 0
    const phases = phasesInput.map((p, index) => {
      const paid = Math.max(0, Math.round(Number(p.paidAmount) || 0))
      const amount = Math.max(paid, Math.round(Number(p.amount) || 0))
      sumPaid += paid
      return {
        phaseNumber: Number(p.phaseNumber) || index + 1,
        phaseName: String(p.phaseName || `Installment ${index + 1}`),
        amount,
        paidAmount: paid,
        status: p.status || (paid >= amount ? "completed" : paid > 0 ? "partial" : "pending"),
        dueDate: p.dueDate || null,
        paymentDate: p.paymentDate || null,
        paymentMode: p.paymentMode || null,
        transactionId: p.transactionId || null,
      }
    })

    if (sumPaid > subtotal + 1) {
      res.status(400).json({
        success: false,
        error: {
          code: "VAL_012",
          message: `Total paid (${sumPaid}) cannot exceed subtotal (${subtotal})`,
        },
      })
      return
    }

    const remaining = Math.max(0, subtotal - sumPaid)
    let paymentStatus = body.paymentStatus
    if (!paymentStatus) {
      if (sumPaid <= 0) paymentStatus = "pending"
      else if (sumPaid >= subtotal) paymentStatus = "completed"
      else paymentStatus = "partial"
    }

    const subsidyNormalized = normalizeSubsidyChequesFromRequestBody(body)
    // Map keys to YOUR ORM / columns (e.g. payment_phases JSON, payment_status, remaining_amount, subsidy_cheques).
    const updates = {
      paymentPhases: phases,
      paymentStatus,
      remainingAmount: remaining,
      ...(subsidyNormalized !== undefined ? { subsidyCheques: subsidyNormalized } : {}),
      ...(body.paymentMode ? { paymentMode: String(body.paymentMode).toLowerCase() } : {}),
      ...(body.paymentType ? { paymentType: String(body.paymentType).toLowerCase() } : {}),
    }

    await quotation.update(updates)
    await quotation.reload()

    res.json({
      success: true,
      data: quotationToApiJson(quotation),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: { code: "SYS_001", message: "Internal error" } })
  }
}

/**
 * Route registration (Express example):
 *   router.patch('/admin/quotations/:quotationId/status', adminAuth, patchAdminQuotationStatus)
 *   router.patch('/admin/quotations/:quotationId/file-login', adminAuth, patchAdminQuotationFileLogin)
 *   router.patch('/quotations/:quotationId/payment-details', accountMgmtOrAdminAuth, patchQuotationPaymentDetails)
 *   router.put('/quotations/:quotationId/installments', accountMgmtOrAdminAuth, putQuotationInstallments)
 *   See BACKEND_INSTALLMENT_REPLACE.ts for full replace semantics (remove installment + Submit).
 */

/**
 * -----------------------------------------------------------------------------
 * HR BACKEND CHANGES (Database-first uploaded data + assignment queue)
 * -----------------------------------------------------------------------------
 *
 * Suggested tables:
 *
 * hr_lead_uploads
 *   id (uuid/pk)
 *   file_name
 *   uploaded_by (hr user id)
 *   uploaded_at
 *   row_count
 *   dealer_ids (json/array)   -- selected dealers at upload time
 *
 * hr_leads
 *   id (uuid/pk)
 *   upload_id (fk -> hr_lead_uploads.id)
 *   name
 *   mobile
 *   alt_mobile
 *   k_number
 *   address
 *   city
 *   state
 *   customer_note
 *   assigned_dealer_id (nullable)
 *   status (queued|assigned|in_progress|rescheduled|completed)
 *   created_at / updated_at
 *
 * Assignment rule required by frontend:
 *   activeLimitPerDealer = 1
 *   -> every selected dealer can hold only one lead in visible state at a time.
 *   -> When you set `assigned_dealer_id`, you MUST also set `status` to:
 *        - `assigned` (dealer sees it in Current Lead tab)
 *        - (or `in_progress` if you want it immediately started)
 *      NEVER leave it as `queued` if the dealer should see it as "Current Lead".
 */

function asArray(value) {
  if (Array.isArray(value)) return value
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : [value]
    } catch {
      return [value]
    }
  }
  return []
}

const UNASSIGNED_DEALER_ID_TOKENS = new Set([
  "",
  "unassigned",
  "null",
  "none",
  "-",
  "na",
  "n/a",
  "pool",
  "open",
])

const COMPLETED_LEAD_STATUSES = new Set(["completed", "done", "closed"])

function normalizeAssigneeId(value) {
  const id = String(value ?? "").trim()
  if (!id) return ""
  if (UNASSIGNED_DEALER_ID_TOKENS.has(id.toLowerCase())) return ""
  return id
}

function isCompletedLeadStatus(status) {
  return COMPLETED_LEAD_STATUSES.has(String(status ?? "").trim().toLowerCase())
}

/**
 * Live batch buckets for HR Uploaded Data (see BACKEND_CHANGES_REQUIRED.md §7.8).
 * assigned + unassigned + completed === rowCount
 */
export function computeHrUploadLeadCounts(leads) {
  const counts = { rowCount: 0, assignedCount: 0, unassignedCount: 0, completedCount: 0 }
  for (const lead of leads || []) {
    counts.rowCount += 1
    const status = lead?.status ?? lead?.assignmentStatus
    if (isCompletedLeadStatus(status)) {
      counts.completedCount += 1
      continue
    }
    if (normalizeAssigneeId(lead?.assignedDealerId ?? lead?.assigned_dealer_id)) {
      counts.assignedCount += 1
      continue
    }
    counts.unassignedCount += 1
  }
  return counts
}

function mapHrUploadLeadRow(r, dealerNameById) {
  const assignedDealerId = normalizeAssigneeId(r.assignedDealerId ?? r.assigned_dealer_id) || null
  const status = r.status || r.assignmentStatus || "queued"
  const assignedDealerName =
    assignedDealerId && dealerNameById?.get(assignedDealerId)
      ? dealerNameById.get(assignedDealerId)
      : r.assignedDealerName || r.assigned_dealer_name || null

  return {
    id: r.id,
    name: r.name,
    mobile: r.mobile,
    altMobile: r.altMobile,
    kNumber: r.kNumber,
    address: r.address,
    city: r.city,
    state: r.state,
    customerNote: r.customerNote,
    assignedDealerId,
    assignedDealerName,
    status,
    assignmentStatus: status,
  }
}

/**
 * POST /hr/leads/upload-csv
 * - Store upload metadata in hr_lead_uploads
 * - Store parsed rows in hr_leads
 * - Enforce per-dealer active cap (default 1) when assigning initial rows
 *
 * LIVE BUG (Jul 2026): SPA "Assign Leads" → after a delay → 500 "Internal server error".
 * Validation now passes (SPA sends activeLimitPerDealer=1, Zod max 50). The crash is
 * inside this handler. Harden as below — never let parse / insert / allocate throw uncaught.
 *
 * Multipart fields SPA sends (retries 3 shapes on 400/500):
 *   file | csvFile
 *   dealerIds[] | dealerIds (repeat) | dealerIds (JSON string)
 *   activeLimitPerDealer | activeLeadsLimit = 1..50
 *   (optional) assignmentMode=round_robin_all → ignore cap, assign every row
 */
export async function postHrLeadsUploadCsv(req, res, db) {
  try {
    const user = req.hr ?? req.user
    if (!user || user.role !== "hr") {
      res.status(401).json({ success: false, error: { code: "AUTH_003", message: "HR required" } })
      return
    }

    const file = req.file
    if (!file) {
      res.status(400).json({ success: false, error: { code: "VAL_001", message: "CSV file required" } })
      return
    }

    const dealerIds = asArray(req.body.dealerIds ?? req.body["dealerIds[]"]).filter(Boolean)
    if (dealerIds.length === 0) {
      res.status(400).json({ success: false, error: { code: "VAL_002", message: "At least one dealerId required" } })
      return
    }

    // Reject unknown dealer ids BEFORE insert/assign (avoids FK 500 mid-loop).
    const knownDealers = await db.dealers.findByIds(dealerIds)
    const knownIds = new Set((knownDealers || []).map((d) => String(d.id)))
    const missing = dealerIds.filter((id) => !knownIds.has(String(id)))
    if (missing.length > 0) {
      res.status(400).json({
        success: false,
        error: {
          code: "VAL_002",
          message: `Unknown dealerId(s): ${missing.slice(0, 5).join(", ")}`,
        },
      })
      return
    }

    // Frontend may send assignmentMode=round_robin_all to assign every row (Unassigned → 0).
    // Legacy active_cap keeps per-dealer open-lead limit (default 1).
    // CRITICAL: never require SPA to send a number > Zod max(50). When assign-all,
    // ignore the numeric cap server-side (use MAX_SAFE_INTEGER internally only).
    const assignmentMode = String(req.body.assignmentMode || "").trim().toLowerCase()
    const assignAllAtUpload = assignmentMode === "round_robin_all" || assignmentMode === "round-robin-all"

    const requestedLimit = Number(req.body.activeLimitPerDealer ?? req.body.activeLeadsLimit)
    // Cap accepted request value at 50 to match Zod — assign-all bypasses via flag, not via huge number.
    const cappedRequested =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(50, Math.floor(requestedLimit))
        : 1
    const activeLimitPerDealer = assignAllAtUpload ? Number.MAX_SAFE_INTEGER : cappedRequested

    // Parse CSV — bad file must be 400, never uncaught 500.
    let parsedRows
    try {
      parsedRows = await db.parseCsvRowsFromFile(file.path)
    } catch (parseErr) {
      console.error("[hr/upload-csv] CSV parse failed", parseErr)
      res.status(400).json({
        success: false,
        error: {
          code: "VAL_001",
          message: `Invalid CSV: ${parseErr?.message || "parse failed"}`,
        },
      })
      return
    }
    if (!Array.isArray(parsedRows) || parsedRows.length === 0) {
      res.status(400).json({
        success: false,
        error: { code: "VAL_001", message: "CSV has no data rows" },
      })
      return
    }
    const parsed = parsedRows.length

    const upload = await db.hrLeadUploads.create({
      fileName: file.originalname || "uploaded.csv",
      uploadedBy: user.id,
      uploadedAt: new Date(),
      rowCount: parsed,
      dealerIds,
    })

    let created = 0
    let skippedDuplicate = 0
    let skippedInvalid = 0
    const leadIds = []

    // Chunked insert — large CSVs (thousands of rows) otherwise timeout → 500.
    const CHUNK = 500
    for (let offset = 0; offset < parsedRows.length; offset += CHUNK) {
      const slice = parsedRows.slice(offset, offset + CHUNK)
      for (const row of slice) {
        try {
          const mobile = String(row.mobile || row.Mobile || row.phone || "")
            .replace(/\D/g, "")
            .slice(-10)
          if (mobile.length !== 10) {
            skippedInvalid += 1
            continue
          }

          const exists = await db.hrLeads.exists({ mobile, uploadId: upload.id })
          if (exists) {
            skippedDuplicate += 1
            continue
          }

          const lead = await db.hrLeads.create({
            uploadId: upload.id,
            name: row.name || row.Name || "",
            mobile,
            altMobile: row.altMobile || row.alt_mobile || "",
            kNumber: row.kNumber || row.k_number || "",
            address: row.address || "",
            city: row.city || "",
            state: row.state || "",
            customerNote: row.customerNote || row.customer_note || "",
            status: "queued",
            queuedAt: new Date(),
          })
          leadIds.push(lead.id)
          created += 1
        } catch (rowErr) {
          // Unique index / constraint → skip, do not abort whole upload with 500.
          const msg = String(rowErr?.message || rowErr || "")
          if (/unique|duplicate|23505/i.test(msg)) {
            skippedDuplicate += 1
            continue
          }
          console.error("[hr/upload-csv] row insert failed", rowErr)
          skippedInvalid += 1
        }
      }
    }

    // Queue allocator (DB-transaction recommended in real impl)
    let assigned = 0
    const activeCountByDealer = new Map()
    for (const dealerId of dealerIds) {
      const activeCount = await db.hrLeads.count({ assignedDealerId: dealerId, status: "assigned" })
      activeCountByDealer.set(dealerId, activeCount)
    }

    let dealerCursor = 0
    for (const leadId of leadIds) {
      let allocated = false
      for (let i = 0; i < dealerIds.length; i += 1) {
        const idx = (dealerCursor + i) % dealerIds.length
        const dealerId = dealerIds[idx]
        const currentActive = activeCountByDealer.get(dealerId) || 0
        if (currentActive < activeLimitPerDealer) {
          // Important: frontend "Current Lead" hides status=queued/completed.
          // So assigned leads must be marked `assigned` (or `in_progress`).
          try {
            await db.hrLeads.updateById(leadId, {
              assignedDealerId: dealerId,
              status: "assigned",
              assignedAt: new Date(),
            })
            activeCountByDealer.set(dealerId, currentActive + 1)
            dealerCursor = (idx + 1) % dealerIds.length
            assigned += 1
            allocated = true
            break
          } catch (assignErr) {
            // FK / lock failure on one dealer → try next, don't 500 the whole request.
            console.error("[hr/upload-csv] assign failed", dealerId, assignErr)
          }
        }
      }
      if (!allocated) {
        // stays queued (Unassigned badge) — drain later via assign-unassigned
      }
    }

    const queued = Math.max(0, created - assigned)

    res.json({
      success: true,
      parsed,
      created,
      assigned,
      assignedAtUpload: assigned,
      queued,
      queuedAtUpload: queued,
      skippedDuplicate,
      skippedInvalid,
      uploadId: upload.id,
    })
  } catch (e) {
    console.error("[hr/upload-csv] unhandled", e)
    // Prefer surfacing a short message so SPA / logs aren't just "Internal error".
    const message = e?.message ? String(e.message).slice(0, 200) : "Internal error"
    res.status(500).json({ success: false, error: { code: "SYS_001", message } })
  }
}

/**
 * GET /hr/leads/uploads?limit=200
 * Return DB-backed upload history for HR Uploaded Data tab.
 */
export async function getHrLeadsUploads(req, res, db) {
  try {
    const user = req.hr ?? req.user
    if (!user || user.role !== "hr") {
      res.status(401).json({ success: false, error: { code: "AUTH_003", message: "HR required" } })
      return
    }

    const limitRaw = Number(req.query.limit || 50)
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 50

    const uploads = await db.hrLeadUploads.findManyWithCounts({ limit, orderBy: "uploadedAt_DESC" })

    res.json({
      success: true,
      uploads: uploads.map((u) => {
        const counts =
          u.counts ||
          computeHrUploadLeadCounts(u.rows || [])
        const rowCount = Number(u.rowCount || counts.rowCount || 0)
        const assignedCount = Number(u.assignedCount ?? counts.assignedCount ?? 0)
        const unassignedCount = Number(u.unassignedCount ?? counts.unassignedCount ?? 0)
        const completedCount = Number(u.completedCount ?? counts.completedCount ?? 0)

        return {
          id: u.id,
          uploadedAt: u.uploadedAt,
          fileName: u.fileName,
          rowCount,
          assignedCount,
          unassignedCount,
          completedCount,
          counts: {
            assigned: assignedCount,
            unassigned: unassignedCount,
            completed: completedCount,
          },
          dealerIds: u.dealerIds || [],
        }
      }),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: { code: "SYS_001", message: "Internal error" } })
  }
}

/**
 * GET /hr/leads/uploads/:uploadId?page=1&limit=50
 * Paginated rows + batch-level live counts (full upload, not page-only).
 */
export async function getHrLeadsUploadById(req, res, db) {
  try {
    const user = req.hr ?? req.user
    if (!user || user.role !== "hr") {
      res.status(401).json({ success: false, error: { code: "AUTH_003", message: "HR required" } })
      return
    }

    const uploadId = req.params.uploadId || req.params.id
    if (!uploadId) {
      res.status(400).json({ success: false, error: { code: "VAL_001", message: "uploadId required" } })
      return
    }

    const pageRaw = Number(req.query.page || 1)
    const limitRaw = Number(req.query.limit || 50)
    const page = Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50

    const rawMobile = String(req.query.mobile || req.query.q || req.query.search || "").trim()
    const mobileDigits = rawMobile.replace(/\D/g, "")
    const mobileFilter = mobileDigits.length > 10 ? mobileDigits.slice(-10) : mobileDigits

    const upload = await db.hrLeadUploads.findByIdWithCounts(uploadId)
    if (!upload) {
      res.status(404).json({ success: false, error: { code: "RES_001", message: "Upload not found" } })
      return
    }

    const { rows, total } = await db.hrLeads.findByUploadIdPaginated(uploadId, {
      page,
      limit,
      mobile: mobileFilter || undefined,
    })
    const dealerNameById = await db.dealers.getNameMapByIds(upload.dealerIds || [])

    const counts = upload.counts || computeHrUploadLeadCounts(await db.hrLeads.findAllByUploadId(uploadId))
    const rowCount = Number(upload.rowCount || counts.rowCount || 0)
    const assignedCount = Number(upload.assignedCount ?? counts.assignedCount ?? 0)
    const unassignedCount = Number(upload.unassignedCount ?? counts.unassignedCount ?? 0)
    const completedCount = Number(upload.completedCount ?? counts.completedCount ?? 0)
    // When mobile filter is active, pagination.total = filtered match count
    const listTotal = mobileFilter ? Number(total || rows.length) : rowCount

    res.json({
      success: true,
      batch: {
        id: upload.id,
        uploadedAt: upload.uploadedAt,
        fileName: upload.fileName,
        rowCount,
        assignedCount,
        unassignedCount,
        completedCount,
        counts: {
          assigned: assignedCount,
          unassigned: unassignedCount,
          completed: completedCount,
        },
        dealerIds: upload.dealerIds || [],
      },
      rows: rows.map((r) => mapHrUploadLeadRow(r, dealerNameById)),
      totalRows: listTotal,
      pagination: {
        page,
        limit,
        total: listTotal,
        totalPages: Math.max(1, Math.ceil(listTotal / limit)),
      },
      mobile: mobileFilter || null,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: { code: "SYS_001", message: "Internal error" } })
  }
}

/**
 * POST /hr/leads/uploads/:uploadId/assign-unassigned
 * Drain Unassigned → Assigned for one upload: round-robin across upload.dealerIds.
 * Goal: unassignedCount === 0 after success (Assigned rises; Completed unchanged).
 * Process oldest uploads first when HR runs bulk (SPA does that client-side).
 */
export async function postHrLeadsUploadAssignUnassigned(req, res, db) {
  try {
    const user = req.hr ?? req.user
    if (!user || user.role !== "hr") {
      res.status(401).json({ success: false, error: { code: "AUTH_003", message: "HR required" } })
      return
    }

    const uploadId = req.params.uploadId || req.params.id
    const upload = await db.hrLeadUploads.findById(uploadId)
    if (!upload) {
      res.status(404).json({ success: false, error: { code: "NOT_001", message: "Upload not found" } })
      return
    }

    const dealerIds = asArray(upload.dealerIds).filter(Boolean)
    if (dealerIds.length === 0) {
      res.status(400).json({
        success: false,
        error: { code: "VAL_002", message: "Upload has no dealer pool — re-upload with dealers selected" },
      })
      return
    }

    // Oldest unassigned first (FCFS within the batch)
    const unassigned = await db.hrLeads.findMany({
      uploadId,
      // status queued/pending OR assignedDealerId null/unassigned sentinel
      unassignedOnly: true,
      orderBy: "queuedAt_ASC", // or createdAt ASC
    })

    let assigned = 0
    let cursor = 0
    for (const lead of unassigned) {
      const dealerId = dealerIds[cursor % dealerIds.length]
      cursor += 1
      await db.hrLeads.updateById(lead.id, {
        assignedDealerId: dealerId,
        assignedAt: new Date(),
        status: "assigned",
      })
      assigned += 1
    }

    const allLeads = await db.hrLeads.findAllByUploadId(uploadId)
    const counts = computeHrUploadLeadCounts(allLeads)

    res.json({
      success: true,
      uploadId,
      assigned,
      unassignedRemaining: counts.unassignedCount,
      unassignedCount: counts.unassignedCount,
      assignedCount: counts.assignedCount,
      completedCount: counts.completedCount,
      rowCount: counts.rowCount,
      counts: {
        assigned: counts.assignedCount,
        unassigned: counts.unassignedCount,
        completed: counts.completedCount,
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: { code: "SYS_001", message: "Internal error" } })
  }
}

/**
 * Additional routes (Express example):
 *   router.post('/hr/leads/upload-csv', hrAuth, upload.single('file'), postHrLeadsUploadCsv)
 *   router.get('/hr/leads/uploads', hrAuth, getHrLeadsUploads)
 *   router.get('/hr/leads/uploads/:uploadId', hrAuth, getHrLeadsUploadById)
 *   router.post('/hr/leads/uploads/:uploadId/assign-unassigned', hrAuth, postHrLeadsUploadAssignUnassigned)
 *   router.get('/hr/leads/search', hrAuth, getHrLeadsSearchByMobile)
 */

/**
 * GET /hr/leads/search?mobile=9602209955&limit=100
 * Global mobile search across all HR uploaded leads (SPA Uploaded Lead Data).
 * Also honor q / search query aliases.
 *
 * Match last-10 digits of mobile OR alt_mobile (contains / ends-with).
 * Include upload fileName so HR sees which CSV the lead came from.
 *
 * Response:
 * {
 *   success: true,
 *   mobile: "9602209955",
 *   total: 1,
 *   leads: [{
 *     id, name, mobile, altMobile, kNumber, address, city, state,
 *     status, assignedDealerId, assignedDealerName,
 *     uploadId, fileName, uploadedAt
 *   }]
 * }
 *
 * Detail filter (optional): GET /hr/leads/uploads/:uploadId?mobile=…&page=1&limit=50
 * should apply the same mobile filter within one batch.
 */
export async function getHrLeadsSearchByMobile(req, res, db) {
  try {
    const user = req.hr ?? req.user
    if (!user || user.role !== "hr") {
      res.status(401).json({ success: false, error: { code: "AUTH_003", message: "HR required" } })
      return
    }

    const rawMobile = String(req.query.mobile || req.query.q || req.query.search || "").trim()
    const digits = rawMobile.replace(/\D/g, "")
    const mobile = digits.length > 10 ? digits.slice(-10) : digits
    if (!mobile) {
      res.status(400).json({
        success: false,
        error: { code: "VAL_001", message: "mobile query required" },
      })
      return
    }

    const limitRaw = Number(req.query.limit || 100)
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 100

    // Prefer indexed LIKE / ends-with on normalized mobile columns.
    // SELECT l.*, u.file_name, u.uploaded_at
    // FROM hr_leads l
    // JOIN hr_lead_uploads u ON u.id = l.upload_id
    // WHERE RIGHT(regexp_replace(l.mobile, '\D', '', 'g'), 10) LIKE '%' || $mobile || '%'
    //    OR RIGHT(regexp_replace(COALESCE(l.alt_mobile,''), '\D', '', 'g'), 10) LIKE '%' || $mobile || '%'
    // ORDER BY u.uploaded_at DESC, l.created_at DESC
    // LIMIT $limit
    const rows = await db.hrLeads.searchByMobile({ mobile, limit })
    const dealerNameById = await db.dealers.getNameMapByIds(
      rows.map((r) => r.assignedDealerId || r.assigned_dealer_id).filter(Boolean),
    )

    const leads = rows.map((r) => ({
      ...mapHrUploadLeadRow(r, dealerNameById),
      uploadId: r.uploadId || r.upload_id,
      fileName: r.fileName || r.file_name || r.uploadFileName,
      uploadedAt: r.uploadedAt || r.uploaded_at,
    }))

    res.json({
      success: true,
      mobile,
      total: leads.length,
      leads,
      rows: leads,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: { code: "SYS_001", message: "Internal error" } })
  }
}

/**
 * -----------------------------------------------------------------------------
 * CALLING ACTIONS RESPONSE CONTRACT (for Calling Data page)
 * -----------------------------------------------------------------------------
 *
 * Frontend requirement:
 * 1) Status Category, Status, and Remark must come as separate fields from API.
 * 2) Recent Actions must return ALL rows (no fixed slice like 10).
 *
 * Frontend screens using this:
 *   - Dealer Calling Data > Recent Actions
 *   - Dealer Calling Data > Interested
 *
 * Expected response source keys (any one works):
 *   recentActions | actionHistory | completedActions
 */

export function parseTaggedCallRemark(rawRemark) {
  const raw = String(rawRemark || "").trim()
  if (!raw) return { statusCategory: null, status: null, remark: null }

  // Format saved by frontend: [Category] Status | optional free remark
  const match = raw.match(/^\[([^\]]+)\]\s*([^|]*?)\s*(?:\|\s*(.*))?$/)
  if (!match) {
    return { statusCategory: null, status: null, remark: raw }
  }

  const statusCategory = (match[1] || "").trim() || null
  const status = (match[2] || "").trim() || null
  const remark = (match[3] || "").trim() || null
  return { statusCategory, status, remark }
}

/**
 * Allowed backend statusCategory enum values.
 */
export const ALLOWED_STATUS_CATEGORIES = [
  "call_connectivity",
  "lead_validity",
  "customer_intent",
  "financial",
  "competition",
  "schedule",
  "other",
]

const STATUS_CATEGORY_ALIASES = {
  // UI labels (legacy/frontend display labels) -> backend enum keys
  "Part 1 — Call & lead quality": "call_connectivity",
  "Part 2 — Interest & qualification": "customer_intent",
  "Part 3 — Follow-up & sales": "schedule",
  "Part 4 — Rejection / lost": "competition",
  // keep raw keys idempotent
  call_connectivity: "call_connectivity",
  lead_validity: "lead_validity",
  customer_intent: "customer_intent",
  financial: "financial",
  competition: "competition",
  schedule: "schedule",
  other: "other",
}

export function normalizeStatusCategory(rawCategory) {
  const clean = String(rawCategory || "").trim()
  if (!clean) return null
  const mapped = STATUS_CATEGORY_ALIASES[clean] || clean
  return ALLOWED_STATUS_CATEGORIES.includes(mapped) ? mapped : null
}

/**
 * Action serializer (use this in /dealers/me/calling-queue/next and related APIs)
 */
export function callingActionToApiJson(row) {
  const a = row.get ? row.get({ plain: true }) : row
  const parsed = parseTaggedCallRemark(a.callRemark ?? a.call_remark)
  return {
    ...a,
    // Keep legacy combined field for compatibility
    callRemark: a.callRemark ?? a.call_remark ?? null,

    // New explicit fields required by frontend
    statusCategory: a.statusCategory ?? a.status_category ?? parsed.statusCategory,
    status: a.statusText ?? a.status_text ?? parsed.status ?? a.status ?? null,
    remark: a.remark ?? parsed.remark ?? null,

    // Required in Calling Data > Recent Actions card
    kNumber: a.kNumber ?? a.k_number ?? a.lead?.kNumber ?? a.lead?.k_number ?? null,
    address: a.address ?? a.leadAddress ?? a.lead_address ?? a.lead?.address ?? null,
  }
}

/**
 * GET /dealers/me/calling-queue/next
 * IMPORTANT backend behavior:
 * - Do not hard-cap action history to 10.
 * - Return full action history by default OR support client-controlled pagination.
 *
 * Recommended:
 *   const limit = req.query.limit ? clamp(Number(req.query.limit), 1, 5000) : 1000
 *   // If you must paginate, also return pagination metadata and let frontend request more.
 *
 * Response shape example:
 * {
 *   success: true,
 *   currentLead: {...},
 *   scheduledLeads: [...],
 *   recentActions: actionRows.map(callingActionToApiJson),  // no fixed 10-row slice
 *   counts: { pending, queued, scheduled, completed }
 * }
 */
/**
 * IMPORTANT UI requirement ("Submit Status should update same card"):
 * - The UI expects `recentActions` to contain at most ONE item per `leadId`.
 * - When dealer clicks "Submit Status" again for the same lead, backend must update
 *   the latest action state, not append another history item that would create
 *   a second card for the same customer/lead.
 *
 * Implementation options:
 * 1) If you store "latest state" in `dealerCallingLeads` (recommended),
 *    then GET should derive `recentActions` from that single-row-per-lead state.
 * 2) If you store full history in a separate table, then GET `/calling-queue/next`
 *    must return only the latest history row per `leadId` (e.g. DISTINCT ON or
 *    group-by leadId order by updatedAt/actionAt desc).
 *
 * Also set a stable identifier:
 * - Prefer `recentActions[i].id = leadId` (or `${dealerId}-${leadId}`) so React
 *   doesn't treat updates as new cards.
 *
 * IMPORTANT data mapping:
 * - Ensure each action row has lead details available for serializer:
 *   - k_number / kNumber
 *   - address
 * - If these are stored in leads table (not action table), include join in query:
 *     action JOIN lead ON action.lead_id = lead.id
 * - If you use Sequelize attributes whitelist, include:
 *     action attrs: ['id','lead_id','action','action_at','call_remark','status_category','status_text','remark','next_follow_up_at']
 *     lead attrs:   ['id','name','mobile','k_number','address','city','state']
 */

/**
 * PATCH /dealers/me/calling-queue/:leadId/action
 *
 * Frontend behavior (Calling Data page):
 * - "Submit Status" sends:
 *     {
 *       action: "called" | "follow_up" | "not_interested" | "rescheduled",
 *       callRemark: "[Status Category] Status | optional free remark",
 *       nextFollowUpAt?: ISO string,
 *       actionAt?: ISO string
 *     }
 *
 * Backend MUST:
 * - Parse payload.callRemark using parseTaggedCallRemark()
 * - Persist values separately:
 *     status_category   (or statusCategory)
 *     status_text       (or status)
 *     remark            (free text only, without tags)
 * - Keep legacy callRemark column updated (optional but recommended):
 *     call_remark = `[${status_category}] ${status_text}${remark ? " | "+remark : ""}`
 *
 * If you currently store only callRemark text, you can still pass these
 * values through by parsing during GET responses (parse on the fly).
 */
export async function patchDealerCallingQueueAction(req, res, db) {
  try {
    const dealer = req.dealer ?? req.user
    if (!dealer) {
      res.status(401).json({ success: false, error: { code: "AUTH_003", message: "Dealer required" } })
      return
    }

    const leadId = req.params.leadId || req.params.id
    if (!leadId) {
      res.status(400).json({ success: false, error: { code: "VAL_001", message: "Lead id required" } })
      return
    }

    const body = req.body || {}
    const action = body.action

    // For "start" actions, callRemark may be missing.
    const parsed = parseTaggedCallRemark(body.callRemark ?? body.call_remark)
    const normalizedCategory = normalizeStatusCategory(parsed.statusCategory)

    // Suggested DB fields on hr/dealer calling leads table:
    //   status_category, status_text, remark
    const updates = {
      action,
      nextFollowUpAt: body.nextFollowUpAt ?? null,
      actionAt: body.actionAt ?? new Date(),
    }

    if (body.callRemark || body.call_remark) {
      if (!normalizedCategory) {
        res.status(400).json({
          success: false,
          error: {
            code: "VAL_001",
            message: `Invalid statusCategory. Allowed values: ${ALLOWED_STATUS_CATEGORIES.join(",")}`,
          },
        })
        return
      }

      updates.status_category = normalizedCategory
      updates.status_text = parsed.status
      updates.remark = parsed.remark

      // Maintain legacy combined string if you have the column.
      updates.call_remark = `[${normalizedCategory}] ${parsed.status}${parsed.remark ? ` | ${parsed.remark}` : ""}`
    }

    // Persist:
    // - MUST update the "latest action state" for this leadId (so GET de-duplicates by leadId)
    // - If you keep a separate history table, upsert the "latest" record (unique by leadId)
    //   rather than always inserting new rows for the same lead.
    await db.dealerCallingLeads.updateById(leadId, updates)

    const updatedRow = await db.dealerCallingLeads.findById(leadId)
    res.json({
      success: true,
      lead: callingActionToApiJson(updatedRow),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: { code: "SYS_001", message: "Internal error" } })
  }
}

/**
 * Suggested DB columns (recommended):
 * - status_category   VARCHAR(...)
 * - status_text       VARCHAR(...)
 * - remark             TEXT / VARCHAR(...)
 *
 * Legacy fallback:
 * - If you only have call_remark, you may still return statusCategory/status/remark
 *   in GET responses by parsing call_remark on the server (parseTaggedCallRemark()).
 */

/**
 * -----------------------------------------------------------------------------
 * TRANSITION RULE UPDATE (fix "Invalid lead action transition" in Recent Actions)
 * -----------------------------------------------------------------------------
 *
 * Problem:
 * - Existing transition validator often allows only queue flow:
 *     assigned/in_progress -> called/follow_up/not_interested/rescheduled
 * - But Recent Actions cards are already completed/history rows, so editing status there
 *   can trigger LEAD_005 "Invalid lead action transition".
 *
 * Required backend behavior:
 * - Support an EDIT path for already-acted leads from Recent Actions.
 * - If lead belongs to current dealer and exists, allow updating:
 *     status_category, status_text, remark, call_remark, next_follow_up_at, action, action_at
 *   even when current status is completed/rescheduled.
 *
 * Recommended validation:
 * 1) Keep strict transition for current queue actions (`start` / first completion).
 * 2) Add "edit mode" for recent action updates:
 *    - Trigger when payload contains callRemark or status fields for an already-acted lead
 *    - Validate dealer ownership
 *    - Perform UPDATE (not INSERT) on latest row for that lead
 *    - Return updated row via callingActionToApiJson
 *
 * Pseudo-code:
 *   const lead = findLeadById(leadId)
 *   if (!lead || lead.dealerId !== dealer.id) -> LEAD_004
 *   const isEditMode = lead.status in ["completed","rescheduled"] || body.editMode === true
 *   if (isEditMode) {
 *     update latest action fields and return success
 *   } else {
 *     apply existing strict transition matrix
 *   }
 *
 * This removes false LEAD_005 failures from Recent Actions status edits.
 */

/**
 * -----------------------------------------------------------------------------
 * DEALER QUEUE REFRESH RULES (fix: HR uploaded leads not appearing for dealer)
 * -----------------------------------------------------------------------------
 *
 * Symptom:
 * - HR uploads new leads and assigns dealer pool.
 * - Dealer has completed previous leads.
 * - Dealer page still shows no new lead until hard refresh.
 *
 * Backend requirements:
 * 1) `/api/dealers/me/calling-queue/next` must always compute latest assignable lead
 *    from DB state (do not rely on stale in-memory cache).
 *
 * 2) Allocation on HR upload:
 *    - If dealer has active count < activeLimitPerDealer, assign immediately.
 *    - Newly assigned lead must have deterministic status visible to dealer:
 *        status in ('assigned','in_progress') for immediate pickup.
 *      Do NOT leave it as status='queued', because dealer "Current Lead"
 *      UI hides queued/completed items and depends on assigned/in_progress/rescheduled.
 *
 * 3) Completion flow:
 *    - On dealer action completion, allocator should attempt to attach next queued lead
 *      to same dealer (work-queue model) in same transaction if possible.
 *
 * 4) Socket events after assignment changes (recommended):
 *    Emit at least one of:
 *      - `calling:uploads-updated`
 *      - `calling:actions-updated`
 *      - `backend:mutation` with domain/path containing leads/calling
 *    so clients can refresh without manual reload.
 *
 * 5) Query consistency:
 *    - Ensure `/next` query filters by authenticated dealer id and valid statuses.
 *    - Recommended ordering: assignedAt ASC, createdAt ASC.
 *    - Recommended indexes:
 *        (assigned_dealer_id, status, assigned_at)
 *        (status, created_at)
 *
 * 6) HR "Dealer Actions" filter contract:
 *    - Actions endpoint should support:
 *        `dealerId`, `range` (daily|weekly|monthly|last_month|all), optional `startDate`, `endDate`.
 *    - Return normalized rows with:
 *        { id, leadId, dealerId, dealerName, action, callRemark, actionAt, nextFollowUpAt? }.
 *    - Prefer filtering by `dealerId` server-side; `dealerName` is display-only and may vary in formatting.
 *    - IMPORTANT: return `actionAt` as ISO-8601 UTC (e.g. 2026-04-14T11:47:00.000Z)
 *      so frontend date-range filters/sorting are consistent.
 *    - If old rows are stored in non-ISO formats, normalize in serializer before response.
 *
 * Example selection logic:
 *   SELECT * FROM calling_leads
 *   WHERE assigned_dealer_id = :dealerId
 *     AND status IN ('assigned','in_progress','rescheduled')
 *     AND (next_follow_up_at IS NULL OR next_follow_up_at <= NOW())
 *   ORDER BY COALESCE(assigned_at, created_at) ASC
 *   LIMIT 1;
 */

/**
 * -----------------------------------------------------------------------------
 * DEALER CALLING FLOW CONTRACT (Current Lead -> Dialled -> Connected/Not Connected)
 * -----------------------------------------------------------------------------
 *
 * Frontend UI flow now expects these stages and editable data tabs:
 *   1) Current Lead
 *   2) Dialled
 *   3) Connected
 *   4) Not Connected
 *
 * Backend MUST support:
 * - One active current lead per dealer from `/dealers/me/calling-queue/next`.
 * - Full editable history rows in dialled/connected/not-connected tabs.
 * - Update of existing rows from any tab (not only current queue step).
 *
 * -----------------------------------------------------------------------------
 * A) Canonical stage classification
 * -----------------------------------------------------------------------------
 *
 * Derive stage primarily from `status_text` (or parsed call_remark):
 *
 * NOT_CONNECTED:
 *   "Call Unanswered", "Switched Off", "Not Reachable", "Busy / Line Busy",
 *   "Call Disconnected", "Wrong Number", "Invalid Number", "Number Does Not Exist"
 *
 * CONNECTED:
 *   all other valid status_text values
 *
 * DIALLED:
 *   any row with action in ('called','follow_up','not_interested','rescheduled')
 *
 * CURRENT_LEAD:
 *   row from queue selector (assigned/in_progress/rescheduled due)
 *
 * -----------------------------------------------------------------------------
 * B) Required fields in action/list payload
 * -----------------------------------------------------------------------------
 *
 * For every action row returned in recentActions/actionHistory/completedActions:
 *   id, leadId, action, actionAt, nextFollowUpAt,
 *   statusCategory, status, remark, callRemark,
 *   name, mobile, kNumber, address, city, state
 *
 * Note:
 * - `statusCategory` must be backend enum key (normalized):
 *     call_connectivity | lead_validity | customer_intent | financial |
 *     competition | schedule | other
 * - `status` maps to displayed status text (e.g. "Interested", "Call Unanswered")
 * - `remark` is free text only
 *
 * -----------------------------------------------------------------------------
 * C) PATCH update behavior from all tabs
 * -----------------------------------------------------------------------------
 *
 * Endpoint:
 *   PATCH /api/dealers/me/calling-queue/:leadId/action
 *
 * Must allow updates from:
 * - Current lead step
 * - Dialled tab edit
 * - Connected tab edit
 * - Not Connected tab edit
 *
 * Implementation rule:
 * - If lead belongs to dealer, UPDATE latest row/state for that lead.
 * - Do not reject valid tab edits with transition-only guard.
 * - Preserve strict transition only for first-time queue movement if needed.
 *
 * -----------------------------------------------------------------------------
 * D) Flow action mapping (recommended)
 * -----------------------------------------------------------------------------
 *
 * Not Connected path:
 * - statusCategory: call_connectivity
 * - action: not_interested
 * - outcome: closed
 *
 * Connected -> Interested:
 * - statusCategory: customer_intent (or schedule when moved to visit/sales step)
 * - action: called
 *
 * Connected -> Not Interested:
 * - statusCategory: competition
 * - action: not_interested
 *
 * Connected -> Decision Pending (hold + reschedule):
 * - statusCategory: schedule
 * - action: rescheduled (preferred) OR follow_up
 * - nextFollowUpAt required
 *
 * -----------------------------------------------------------------------------
 * E.1) Reschedule PATCH — fix 500 "Internal server error" (Jun 2026)
 * -----------------------------------------------------------------------------
 *
 * Frontend (Current Lead): Connected -> Decision Pending -> Hold Reason
 * (e.g. Callback Scheduled) + datetime -> Submit with:
 *   action: "rescheduled"
 *   callRemark: "[schedule] Callback Scheduled | ..."
 *   nextFollowUpAt + next_follow_up_at (ISO)
 *   statusCategory/statusText/remark (camelCase + snake_case)
 *
 * On 500, frontend retries action: "follow_up" with same nextFollowUpAt.
 *
 * Backend MUST:
 * 1) Accept action "rescheduled" AND "follow_up" when next_follow_up_at is set.
 * 2) Map both to lead.status = "rescheduled" (not completed).
 * 3) Read nextFollowUpAt OR next_follow_up_at from body.
 * 4) REPLACE call_remark (do not CONCAT nested [schedule] tags) — use TEXT column.
 * 5) Return 400 VAL_001 for missing/invalid datetime — never uncaught 500.
 * 6) Allow in_progress -> rescheduled for assigned_dealer_id = JWT dealer.
 * 7) Response: lead + nextLead + scheduledLeads (future nextFollowUpAt).
 *
 * Suggested handler branch (pseudo):
 *   const nextAt = body.nextFollowUpAt ?? body.next_follow_up_at
 *   const action = body.action
 *   const isReschedule =
 *     action === "rescheduled" ||
 *     (action === "follow_up" && nextAt && normalizeCategory(...) === "schedule")
 *   if (isReschedule && !nextAt) return 400 VAL_001
 *   if (isReschedule) {
 *     updates.status = "rescheduled"
 *     updates.next_follow_up_at = nextAt
 *     // persist remark fields from parseTaggedCallRemark(body.callRemark ?? body.call_remark)
 *   }
 *
 * See BACKEND_CHANGES_HANDOFF.md §4.5.2 and BACKEND_CHANGES_REQUIRED.md §E.2.
 *
 * -----------------------------------------------------------------------------
 * E) Optional grouped response helper
 * -----------------------------------------------------------------------------
 *
 * To reduce frontend filtering, backend may return:
 * {
 *   currentLead: {...},
 *   dialledActions: [...],
 *   connectedActions: [...],
 *   notConnectedActions: [...],
 *   recentActions: [...]
 * }
 *
 * If not provided, frontend can still derive from recentActions.
 */

/**
 * =============================================================================
 * Installation release — Payment Management → Admin Installation tab
 * See BACKEND_INSTALLATION_RELEASE.md (BLOCKER if not implemented)
 * =============================================================================
 *
 * Frontend:
 *   PATCH /quotations/:id/installation-release  (lib/api.ts releaseForInstallation)
 *   GET   /admin/quotations                     (Admin → Installation tab)
 *   GET   /quotations?status=approved           (Payment Management list)
 *
 * Visibility rule: Admin Installation shows a row ONLY when
 *   installation_ready_for_installer = true OR installation_released_at IS NOT NULL
 */

export function serializeInstallationReleaseFields(row) {
  const ready = Boolean(row.installation_ready_for_installer ?? row.installationReadyForInstaller)
  const releasedAt =
    row.installation_released_at ?? row.installationReleasedAt ?? null
  const releasedIso =
    releasedAt instanceof Date ? releasedAt.toISOString() : releasedAt
  return {
    installationReadyForInstaller: ready,
    installation_ready_for_installer: ready,
    installationReleasedAt: releasedIso,
    installation_released_at: releasedIso,
    installationStatus: row.installation_status ?? row.installationStatus ?? null,
    installation_status: row.installation_status ?? row.installationStatus ?? null,
    installationScheduledAt: row.installation_scheduled_at ?? row.installationScheduledAt ?? null,
    installation_scheduled_at: row.installation_scheduled_at ?? row.installationScheduledAt ?? null,
    installationTeamId: row.installation_team_id ?? row.installationTeamId ?? null,
    installation_team_id: row.installation_team_id ?? row.installationTeamId ?? null,
  }
}

/**
 * PATCH /api/quotations/:quotationId/installation-release
 * Auth: account-management, admin
 */
export async function patchQuotationInstallationRelease(req, res) {
  try {
    const { quotationId } = req.params
    const body = req.body || {}
    const role = req.user?.role
    if (!["account-management", "admin"].includes(role)) {
      return res.status(403).json({
        success: false,
        error: { code: "AUTH_004", message: "Insufficient permissions" },
      })
    }

    const quotation = await Quotation.findByPk(quotationId)
    if (!quotation) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Quotation not found" },
      })
    }

    if (String(quotation.status || "").toLowerCase() !== "approved") {
      return res.status(400).json({
        success: false,
        error: { code: "VAL_001", message: "Quotation must be approved before release to installer" },
      })
    }

    const releasedAtRaw = body.installationReleasedAt ?? body.installation_released_at
    const releasedAt = releasedAtRaw ? new Date(releasedAtRaw) : new Date()
    if (Number.isNaN(releasedAt.getTime())) {
      return res.status(400).json({
        success: false,
        error: { code: "VAL_002", message: "Invalid installationReleasedAt" },
      })
    }

    quotation.installation_ready_for_installer = true
    quotation.installation_released_at = releasedAt

    const preInstallStatuses = new Set([null, "", "pending_installer"])
    const current = String(quotation.installation_status || "").toLowerCase()
    if (preInstallStatuses.has(quotation.installation_status) || preInstallStatuses.has(current)) {
      quotation.installation_status = "pending_installer"
    }

    await quotation.save()

    const payload = {
      id: quotation.id,
      ...serializeInstallationReleaseFields(quotation),
    }

    return res.status(200).json({ success: true, data: payload })
  } catch (err) {
    console.error("patchQuotationInstallationRelease", err)
    return res.status(500).json({
      success: false,
      error: { code: "SYS_001", message: "Failed to release quotation to installer" },
    })
  }
}

/**
 * Merge into GET /admin/quotations and GET /quotations list serializers:
 *
 *   return { ...baseFields, ...serializeInstallationReleaseFields(row) }
 *
 * Installer queue GET filter:
 *   WHERE installation_ready_for_installer = TRUE OR installation_released_at IS NOT NULL
 */

// -----------------------------------------------------------------------------
// FINAL CONFIRMATION DOCUMENT UPLOADS (Admin + Baldev)
// See BACKEND_CHANGES_REQUIRED.md §M and BACKEND_CHANGES_HANDOFF.md §10
// -----------------------------------------------------------------------------

const FINAL_CONFIRMATION_UPLOAD_FIELDS = [
  "customerFinalBillFile",
  "panelWarrantyFile",
  "inverterWarrantyFile",
  "workCompletionWarrantyFile",
] as const

type FinalConfirmationField = (typeof FINAL_CONFIRMATION_UPLOAD_FIELDS)[number]

const FINAL_CONFIRMATION_URL_COLUMNS: Record<FinalConfirmationField, string> = {
  customerFinalBillFile: "customer_final_bill_file_url",
  panelWarrantyFile: "panel_warranty_file_url",
  inverterWarrantyFile: "inverter_warranty_file_url",
  workCompletionWarrantyFile: "work_completion_warranty_file_url",
}

const FINAL_CONFIRMATION_NAME_COLUMNS: Record<FinalConfirmationField, string> = {
  customerFinalBillFile: "customer_final_bill_file_name",
  panelWarrantyFile: "panel_warranty_file_name",
  inverterWarrantyFile: "inverter_warranty_file_name",
  workCompletionWarrantyFile: "work_completion_warranty_file_name",
}

function isAllowedFinalConfirmationMime(mimetype: string, originalname: string): boolean {
  const mt = String(mimetype || "").toLowerCase()
  const name = String(originalname || "").toLowerCase()
  if (mt.startsWith("image/")) return true
  if (mt === "application/pdf" || name.endsWith(".pdf")) return true
  return false
}

/**
 * POST /api/admin/quotations/:quotationId/final-confirmation-documents
 * multipart/form-data — any subset of FINAL_CONFIRMATION_UPLOAD_FIELDS.
 *
 * Do NOT use PATCH /quotations/:id/documents (KYC allowlist only).
 */
export async function postAdminFinalConfirmationDocuments(req: any, res: any) {
  try {
    const role = String(req.user?.role || "").toLowerCase()
    if (role !== "admin" && role !== "baldev") {
      return res.status(403).json({
        success: false,
        error: { code: "AUTH_004", message: "Only admin or baldev may upload final confirmation documents" },
      })
    }

    const quotationId = String(req.params?.quotationId || "").trim()
    if (!quotationId) {
      return res.status(400).json({
        success: false,
        error: { code: "VAL_001", message: "Quotation ID required" },
      })
    }

    const files = (req.files || {}) as Record<string, Express.Multer.File[]>
    const present = FINAL_CONFIRMATION_UPLOAD_FIELDS.filter((field) => files[field]?.[0])
    if (present.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VAL_001",
          message: "Upload at least one final confirmation document",
          details: FINAL_CONFIRMATION_UPLOAD_FIELDS.map((field) => ({
            field,
            message: "Optional file; send one or more of these multipart keys",
          })),
        },
      })
    }

    // const quotation = await db.quotations.findById(quotationId)
    // if (!quotation) return 404 QUOTATION_NOT_FOUND

    const updates: Record<string, string> = {}
    for (const field of present) {
      const file = files[field][0]
      if (!isAllowedFinalConfirmationMime(file.mimetype, file.originalname)) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VAL_001",
            message: `Unsupported file type for ${field}`,
            details: [{ field, message: "PDF or image required" }],
          },
        })
      }

      // const key = `quotations/${quotationId}/final-confirmation/${field}-${uuid}${ext}`
      // const url = await s3.putObject({ Key: key, Body: file.buffer, ContentType: file.mimetype })
      const url = "" // replace with presigned/public URL from your storage layer
      updates[FINAL_CONFIRMATION_URL_COLUMNS[field]] = url
      updates[FINAL_CONFIRMATION_NAME_COLUMNS[field]] = file.originalname
    }

    // await db.quotations.update(quotationId, updates)

    const data = {
      quotationId,
      customerFinalBillFileUrl: updates.customer_final_bill_file_url ?? null,
      panelWarrantyFileUrl: updates.panel_warranty_file_url ?? null,
      inverterWarrantyFileUrl: updates.inverter_warranty_file_url ?? null,
      workCompletionWarrantyFileUrl: updates.work_completion_warranty_file_url ?? null,
    }

    return res.status(200).json({ success: true, data })
  } catch (err) {
    console.error("postAdminFinalConfirmationDocuments", err)
    return res.status(500).json({
      success: false,
      error: { code: "SYS_001", message: "Failed to save final confirmation documents" },
    })
  }
}

/**
 * Optional: extend POST /quotations/:id/documents/upload
 * When req.body.field is one of FINAL_CONFIRMATION_UPLOAD_FIELDS, store under
 * FINAL_CONFIRMATION_URL_COLUMNS[field] (same S3 prefix as batch route).
 *
 * Express route registration example:
 *   router.post(
 *     '/admin/quotations/:quotationId/final-confirmation-documents',
 *     adminOrBaldevAuth,
 *     upload.fields(FINAL_CONFIRMATION_UPLOAD_FIELDS.map((name) => ({ name, maxCount: 1 }))),
 *     postAdminFinalConfirmationDocuments,
 *   )
 */
