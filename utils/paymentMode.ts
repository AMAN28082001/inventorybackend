/** Canonical payment mode values stored and returned by the API (lowercase). */
export const ALLOWED_PAYMENT_MODES = [
  'cash',
  'upi',
  'loan',
  'netbanking',
  'bank_transfer',
  'cheque',
  'card',
  'mix'
] as const;

export type CanonicalPaymentMode = (typeof ALLOWED_PAYMENT_MODES)[number];

const allowedSet = new Set<string>(ALLOWED_PAYMENT_MODES);

/**
 * Normalize client input (any casing, spaces, hyphens) to a canonical mode or undefined.
 */
export function normalizePaymentModeInput(input: unknown): CanonicalPaymentMode | undefined {
  if (input === undefined || input === null || input === '') return undefined;
  let s = String(input).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (s === 'banktransfer') s = 'bank_transfer';
  if (allowedSet.has(s)) return s as CanonicalPaymentMode;
  return undefined;
}

export function normalizePaymentModeForStorage(input: unknown): string | null {
  const n = normalizePaymentModeInput(input);
  return n ?? null;
}

/**
 * Final Settlement is only for Cash and Cash + loan (mix).
 * Loan-only quotations must not settle via API (FE also hides the button).
 * Prefer paymentType (loan|cash|mix); fall back to paymentMode when type is missing.
 */
export function isLoanOnlyPaymentType(quotation: {
  paymentType?: string | null;
  paymentMode?: string | null;
  payment_type?: string | null;
  payment_mode?: string | null;
} | null | undefined): boolean {
  if (!quotation) return false;
  const type = String(
    quotation.paymentType ?? quotation.payment_type ?? ''
  )
    .trim()
    .toLowerCase();
  const mode = String(
    quotation.paymentMode ?? quotation.payment_mode ?? ''
  )
    .trim()
    .toLowerCase();
  const key = type || mode;
  return key === 'loan';
}

export const FINAL_SETTLEMENT_LOAN_ONLY_MESSAGE =
  'Final settlement is only for Cash and Cash + loan';
