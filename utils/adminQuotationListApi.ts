type CustomerLike = {
  id?: string;
  firstName?: string | null;
  lastName?: string | null;
  mobile?: string | null;
  email?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
} | null | undefined;

const toIsoStringOrNull = (v: unknown): string | null => {
  if (v === undefined || v === null || v === '') return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Single-line address for Admin Metering Address column. */
export const formatCustomerAddressLine = (customer: CustomerLike): string | null => {
  if (!customer) return null;
  const parts = [
    customer.streetAddress,
    customer.city,
    customer.state,
    customer.pincode
  ]
    .map((p) => String(p || '').trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
};

/** Nested customer for admin list rows (matches detail GET shape). */
export const buildAdminListCustomerFields = (customer: CustomerLike) => {
  if (!customer) return { customer: null };
  return {
    customer: {
      id: customer.id ?? null,
      firstName: customer.firstName ?? null,
      lastName: customer.lastName ?? null,
      mobile: customer.mobile ?? null,
      email: customer.email ?? null,
      address: {
        street: customer.streetAddress ?? null,
        city: customer.city ?? null,
        state: customer.state ?? null,
        pincode: customer.pincode ?? null
      }
    }
  };
};

/** Visit location with customer-address fallback (Admin Metering Address column). */
export const adminQuotationLocationApiFields = (
  visitLocation: string | null | undefined,
  customer: CustomerLike
) => {
  const fromVisit = visitLocation?.trim() || null;
  const fromCustomer = formatCustomerAddressLine(customer);
  const location = fromVisit || fromCustomer;
  return {
    visitLocation: location,
    visit_location: location,
    location
  };
};

/** Date column fallback chain for Admin Metering tabs. */
export const adminQuotationStatusUpdatedAtFields = (q: {
  updatedAt?: Date | string | null;
  meteringActionAt?: Date | string | null;
  meteringApprovedAt?: Date | string | null;
  installerApprovedAt?: Date | string | null;
  approvedAt?: Date | string | null;
  mcoAt?: Date | string | null;
}) => {
  const statusUpdatedAt =
    toIsoStringOrNull(q.updatedAt) ??
    toIsoStringOrNull(q.meteringActionAt) ??
    toIsoStringOrNull(q.meteringApprovedAt) ??
    toIsoStringOrNull(q.mcoAt) ??
    toIsoStringOrNull(q.installerApprovedAt) ??
    toIsoStringOrNull(q.approvedAt);
  return {
    statusUpdatedAt,
    status_updated_at: statusUpdatedAt
  };
};

/** Nested `pricing` object (frontend reads `pricing.subtotal`). */
export const adminQuotationPricingNestedFields = (amounts: {
  subtotal: number;
  totalAmount: number;
  finalAmount: number;
}) => ({
  pricing: {
    subtotal: amounts.subtotal,
    totalAmount: amounts.totalAmount,
    finalAmount: amounts.finalAmount
  }
});

import {
  parseInrAmount,
  serializeLoanCashFields
} from './cashLoanAmounts';

/** Best-effort loan/cash split for Amount column when not stored on quotation row. */
export const deriveLoanCashAmountFields = (
  filePaymentType: string | null | undefined,
  subtotal: number,
  phases: Array<{ phaseNumber?: number; amount?: number }>,
  stored?: { loanAmount?: unknown; cashAmount?: unknown; loan_amount?: unknown; cash_amount?: unknown }
): { loanAmount?: number | null; cashAmount?: number | null; loan_amount?: number | null; cash_amount?: number | null } => {
  const storedLoan = parseInrAmount(stored?.loanAmount ?? stored?.loan_amount);
  const storedCash = parseInrAmount(stored?.cashAmount ?? stored?.cash_amount);
  // Prefer persisted approve split (§28) over phase/subtotal heuristics.
  if (storedLoan != null || storedCash != null) {
    return {
      loanAmount: storedLoan,
      loan_amount: storedLoan,
      cashAmount: storedCash,
      cash_amount: storedCash
    };
  }

  const type = String(filePaymentType || '').trim().toLowerCase();
  if (!type || subtotal <= 0) return {};

  const sorted = [...phases].sort(
    (a, b) => Number(a.phaseNumber ?? 0) - Number(b.phaseNumber ?? 0)
  );
  const phaseAmounts = sorted
    .map((p) => Math.round(Number(p.amount ?? 0)))
    .filter((n) => n > 0);

  if (type === 'loan') {
    const loan = phaseAmounts[0] ?? Math.round(subtotal);
    return { loanAmount: loan, loan_amount: loan };
  }
  if (type === 'cash') {
    const cash = phaseAmounts[0] ?? Math.round(subtotal);
    return { cashAmount: cash, cash_amount: cash };
  }
  if (type === 'mix' && phaseAmounts.length >= 2) {
    const loan = phaseAmounts[0];
    const cash = phaseAmounts[1];
    return {
      loanAmount: loan,
      loan_amount: loan,
      cashAmount: cash,
      cash_amount: cash
    };
  }
  if (type === 'mix' && phaseAmounts.length === 1) {
    const loan = phaseAmounts[0];
    const cash = Math.max(0, Math.round(subtotal) - loan);
    return {
      loanAmount: loan,
      loan_amount: loan,
      cashAmount: cash,
      cash_amount: cash
    };
  }
  return {};
};

export { serializeLoanCashFields };

/** First visit location per quotation (batch map). */
export const buildPrimaryVisitLocationByQuotationId = (
  visits: Array<{ quotationId?: string; location?: string | null }>
): Map<string, string> => {
  const map = new Map<string, string>();
  for (const visit of visits) {
    const qid = String(visit.quotationId || '');
    if (!qid || map.has(qid)) continue;
    const loc = String(visit.location || '').trim();
    if (loc) map.set(qid, loc);
  }
  return map;
};
