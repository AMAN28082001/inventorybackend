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
