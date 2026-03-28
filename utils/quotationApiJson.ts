/**
 * Mirrors BACKEND_ADMIN_QUOTATION_STATUS.ts → quotationToApiJson (payment/bank slice).
 * Use on Sequelize instances or plain row objects.
 */
export function quotationPaymentApiFields(q: Record<string, unknown>) {
  const paymentMode = (q.paymentMode ?? q.payment_mode ?? null) as string | null;
  const paymentType = (q.paymentType ?? q.payment_type ?? paymentMode ?? null) as string | null;
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
