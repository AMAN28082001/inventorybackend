import { readSubsidyChequesFromRow } from './subsidyChequesNormalize';

export type QuotationStatusHistoryEntry = { status: string; at: string };

/**
 * Read statusHistory from DB row (JSON array, JSON string, or snake_case key).
 */
export function readStatusHistoryFromRow(q: Record<string, unknown>): QuotationStatusHistoryEntry[] {
  const raw = q.statusHistory ?? q.status_history;
  if (Array.isArray(raw)) {
    return raw.filter((e): e is QuotationStatusHistoryEntry => !!e && typeof e === 'object' && typeof (e as any).status === 'string' && typeof (e as any).at === 'string');
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const p = JSON.parse(raw) as unknown;
      return Array.isArray(p)
        ? p.filter((e): e is QuotationStatusHistoryEntry => !!e && typeof e === 'object' && typeof (e as any).status === 'string' && typeof (e as any).at === 'string')
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toIsoStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return null;
}

/** DATEONLY / YYYY-MM-DD for API responses (camelCase + snake_case consumers). */
export function toDateOnlyStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const s = v.trim();
    return s.length >= 10 ? s.slice(0, 10) : s;
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return null;
}

/**
 * Mirrors BACKEND_ADMIN_QUOTATION_STATUS.ts → quotationToApiJson (payment/bank slice).
 * Use on Sequelize instances or plain row objects.
 */
export type QuotationPricingSlice = {
  subtotal?: number;
  totalAmount?: number;
  finalAmount?: number;
};

/**
 * Root-level amounts for list/detail (dealer dashboard Total Value: subtotal → totalAmount → finalAmount).
 */
export function quotationAmountApiFields(
  row: Record<string, unknown>,
  pricing?: QuotationPricingSlice | null
) {
  const subtotalRaw = row.subtotal ?? row.sub_total;
  const subtotal =
    subtotalRaw !== undefined && subtotalRaw !== null
      ? Number(subtotalRaw)
      : pricing?.subtotal !== undefined
        ? Number(pricing.subtotal)
        : 0;

  const totalAmountRaw = row.totalAmount ?? row.total_amount;
  const totalAmount =
    totalAmountRaw !== undefined && totalAmountRaw !== null
      ? Number(totalAmountRaw)
      : pricing?.totalAmount !== undefined
        ? Number(pricing.totalAmount)
        : subtotal;

  const finalAmountRaw = row.finalAmount ?? row.final_amount;
  const finalAmount =
    finalAmountRaw !== undefined && finalAmountRaw !== null
      ? Number(finalAmountRaw)
      : pricing?.finalAmount !== undefined
        ? Number(pricing.finalAmount)
        : totalAmount;

  return {
    subtotal,
    totalAmount,
    finalAmount,
    total_amount: totalAmount,
    final_amount: finalAmount
  };
}

/** Approved-row amount for dealer dashboard (matches AMOUNT column: subtotal → totalAmount → finalAmount). */
export function approvedQuotationValueFromRow(row: {
  subtotal?: unknown;
  sub_total?: unknown;
  totalAmount?: unknown;
  total_amount?: unknown;
  finalAmount?: unknown;
  final_amount?: unknown;
}): number {
  const pick = (value: unknown): number | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  };
  const amount =
    pick(row.subtotal ?? row.sub_total) ??
    pick(row.totalAmount ?? row.total_amount) ??
    pick(row.finalAmount ?? row.final_amount) ??
    0;
  return Math.abs(amount);
}

export function quotationPaymentApiFields(q: Record<string, unknown>) {
  const paymentMode = (q.paymentMode ?? q.payment_mode ?? null) as string | null;
  const paymentType = (
    q.filePaymentType ??
    q.file_payment_type ??
    q.paymentType ??
    q.payment_type ??
    paymentMode ??
    null
  ) as string | null;
  const bankName = (q.bankName ?? q.bank_name ?? null) as string | null;
  const bankIfsc = (q.bankIfsc ?? q.bank_ifsc ?? null) as string | null;
  return {
    paymentMode,
    payment_mode: paymentMode,
    paymentType,
    payment_type: paymentType,
    bankName,
    bank_name: bankName,
    bankIfsc,
    bank_ifsc: bankIfsc
  };
}

/**
 * Subsidy cheque, file-login workflow, approval timestamp, status history (admin + detail APIs).
 */
export function quotationAdminMetadataFields(q: Record<string, unknown>) {
  const subsidyChequeDetails = (q.subsidyChequeDetails ?? q.subsidy_cheque_details ?? null) as string | null;
  const fileLoginStatus = (q.fileLoginStatus ?? q.file_login_status ?? null) as string | null;
  const filePaymentType = (q.filePaymentType ?? q.file_payment_type ?? null) as string | null;
  const fileBankName = (q.fileBankName ?? q.file_bank_name ?? null) as string | null;
  const fileBankIfsc = (q.fileBankIfsc ?? q.file_bank_ifsc ?? null) as string | null;
  const fileSubsidyChequeDetails = (q.fileSubsidyChequeDetails ?? q.file_subsidy_cheque_details ?? null) as string | null;
  const fileLoginAt = toIsoStringOrNull(q.fileLoginAt ?? q.file_login_at);
  const statusApprovedAt = toIsoStringOrNull(q.statusApprovedAt ?? q.status_approved_at);
  const approvedAt = toIsoStringOrNull(q.approvedAt ?? q.approved_at ?? statusApprovedAt);
  const installationReadyForInstaller = Boolean(
    q.installationReadyForInstaller ?? q.installation_ready_for_installer ?? false
  );
  const installationReleasedAt = toIsoStringOrNull(
    q.installationReleasedAt ?? q.installation_released_at
  );
  const installationScheduledAt = toDateOnlyStringOrNull(
    q.installationScheduledAt ?? q.installation_scheduled_at
  );
  const installationTeamId = (q.installationTeamId ?? q.installation_team_id ?? null) as string | null;
  const statusHistory = readStatusHistoryFromRow(q);
  const subsidyCheques = readSubsidyChequesFromRow(q);
  return {
    subsidyChequeDetails,
    subsidy_cheque_details: subsidyChequeDetails,
    subsidyCheques,
    subsidy_cheques: subsidyCheques,
    fileLoginStatus,
    file_login_status: fileLoginStatus,
    filePaymentType,
    file_payment_type: filePaymentType,
    fileBankName,
    file_bank_name: fileBankName,
    fileBankIfsc,
    file_bank_ifsc: fileBankIfsc,
    fileSubsidyChequeDetails,
    file_subsidy_cheque_details: fileSubsidyChequeDetails,
    fileLoginAt,
    file_login_at: fileLoginAt,
    statusApprovedAt,
    status_approved_at: statusApprovedAt,
    approvedAt,
    approved_at: approvedAt,
    installationReadyForInstaller,
    installation_ready_for_installer: installationReadyForInstaller,
    installationReleasedAt,
    installation_released_at: installationReleasedAt,
    installationScheduledAt,
    installation_scheduled_at: installationScheduledAt,
    installationTeamId,
    installation_team_id: installationTeamId,
    statusHistory,
    status_history: statusHistory
  };
}
