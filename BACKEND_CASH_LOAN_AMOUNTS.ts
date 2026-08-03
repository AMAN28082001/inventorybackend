/**
 * Backend handoff helpers — Cash + loan amounts & phase payment modes — Aug 2026
 *
 * Full spec: BACKEND_CASH_LOAN_AMOUNTS.md
 * Wire into: PATCH admin quotation status (approve), GET quotation/list serialize,
 *            PATCH/PUT payment-details / installments replace.
 */

export type PaymentType = "loan" | "cash" | "mix"

export const LOAN_PHASE_MODES = ["loan"] as const
export const CASH_PHASE_MODES = [
  "cash",
  "upi",
  "cheque",
  "netbanking",
  "bank_transfer",
  "card",
] as const

export function normalizePaymentType(raw?: string | null): PaymentType | null {
  const t = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_+-]+/g, "")
  if (t === "loan") return "loan"
  if (t === "cash") return "cash"
  if (t === "mix" || t === "cashloan" || t === "cashandloan") return "mix"
  return null
}

export function normalizePhasePaymentMode(raw?: string | null): string | null {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
  if (!s) return null
  const aliases: Record<string, string> = {
    cash: "cash",
    upi: "upi",
    loan: "loan",
    cheque: "cheque",
    check: "cheque",
    netbanking: "netbanking",
    net_banking: "netbanking",
    bank_transfer: "bank_transfer",
    banktransfer: "bank_transfer",
    neft: "bank_transfer",
    rtgs: "bank_transfer",
    imps: "bank_transfer",
    card: "card",
  }
  return aliases[s] ?? null
}

export function isLoanPhaseMode(mode?: string | null): boolean {
  return normalizePhasePaymentMode(mode) === "loan"
}

export function allowedPhaseModesForPaymentType(paymentType: PaymentType): readonly string[] {
  if (paymentType === "loan") return LOAN_PHASE_MODES
  if (paymentType === "cash") return CASH_PHASE_MODES
  return [...LOAN_PHASE_MODES, ...CASH_PHASE_MODES]
}

export function isPhaseModeAllowedForPaymentType(
  paymentType: PaymentType,
  phaseMode?: string | null,
): boolean {
  const mode = normalizePhasePaymentMode(phaseMode)
  if (!mode) return false
  return allowedPhaseModesForPaymentType(paymentType).includes(mode)
}

/** Parse INR amount from body (loanAmount / cashAmount). */
export function parseInrAmount(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[₹,\s]/g, ""))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n)
}

export type ApproveAmountResult =
  | { ok: true; loanAmount: number | null; cashAmount: number | null }
  | { ok: false; code: string; message: string }

/**
 * Resolve loan/cash amounts on approve.
 * quotationSubtotal = set price / pricing.subtotal (integer INR).
 */
export function resolveApproveLoanCashAmounts(args: {
  paymentType: PaymentType
  loanAmountRaw?: unknown
  cashAmountRaw?: unknown
  quotationSubtotal: number
}): ApproveAmountResult {
  const { paymentType, quotationSubtotal } = args
  const loan = parseInrAmount(args.loanAmountRaw)
  const cash = parseInrAmount(args.cashAmountRaw)
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

  // mix
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

/** Sum paid by side from installment phases. */
export function sumPaidBySide(
  phases: Array<{ paidAmount?: number; paymentMode?: string | null }>,
  side: "loan" | "cash",
): number {
  return phases.reduce((sum, ph) => {
    const paid = Math.max(0, Math.round(Number(ph.paidAmount) || 0))
    if (paid <= 0) return sum
    const isLoan = isLoanPhaseMode(ph.paymentMode)
    if (side === "loan") return isLoan ? sum + paid : sum
    return !isLoan ? sum + paid : sum
  }, 0)
}

export function remainingBySide(args: {
  loanAmount?: number | null
  cashAmount?: number | null
  phases: Array<{ paidAmount?: number; paymentMode?: string | null }>
}): { loanRemaining: number; cashRemaining: number } {
  const loanCap = Math.max(0, Math.round(Number(args.loanAmount) || 0))
  const cashCap = Math.max(0, Math.round(Number(args.cashAmount) || 0))
  return {
    loanRemaining: Math.max(0, loanCap - sumPaidBySide(args.phases, "loan")),
    cashRemaining: Math.max(0, cashCap - sumPaidBySide(args.phases, "cash")),
  }
}

/** Fields to merge into GET / list serializers. */
export function serializeLoanCashFields(q: Record<string, unknown>) {
  const paymentType =
    normalizePaymentType(
      String(q.paymentType ?? q.payment_type ?? q.paymentMode ?? q.payment_mode ?? ""),
    ) ?? null
  const loanAmount = parseInrAmount(q.loanAmount ?? q.loan_amount)
  const cashAmount = parseInrAmount(q.cashAmount ?? q.cash_amount)
  return {
    paymentType,
    paymentMode: paymentType,
    loanAmount,
    cashAmount,
    loan_amount: loanAmount,
    cash_amount: cashAmount,
  }
}
