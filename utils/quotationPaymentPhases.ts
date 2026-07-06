import { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { QuotationPaymentPhase } from '../models/index-quotation';
import { normalizePaymentModeInput } from './paymentMode';

export type PaymentPhaseRecord = {
  phaseNumber: number;
  phaseName: string;
  amount: number;
  paidAmount: number;
  status: 'pending' | 'partial' | 'completed';
  dueDate?: string | null;
  paymentDate?: string | null;
  paymentMode?: 'cash' | 'upi' | 'loan' | 'netbanking' | 'bank_transfer' | 'cheque' | 'card' | 'mix' | null;
  transactionId?: string | null;
  note?: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
};

/** True when request must delete all existing rows and save only body.phases (including []). */
export const shouldReplacePaymentPhases = (req: Request, hasPhasePayload: boolean): boolean => {
  if (!hasPhasePayload) return false;
  if (req.method === 'PUT') return true;

  const body = req.body as Record<string, unknown>;
  if (body.replaceInstallments === true || body.replace === true) return true;

  const target = `${req.path || ''}${req.originalUrl || ''}`;
  return target.includes('/installments');
};

export const serializePaymentPhaseRow = (row: {
  phaseNumber: number;
  phaseName?: string | null;
  amount?: number | null;
  paidAmount?: number | null;
  status?: string | null;
  dueDate?: Date | string | null;
  paymentDate?: Date | string | null;
  paymentMode?: string | null;
  transactionId?: string | null;
  note?: string | null;
  updatedBy?: string | null;
  updatedAtPhase?: Date | string | null;
}): PaymentPhaseRecord => ({
  phaseNumber: Number(row.phaseNumber),
  phaseName: String(row.phaseName || ''),
  amount: Number(row.amount || 0),
  paidAmount: Number(row.paidAmount || 0),
  status: (['pending', 'partial', 'completed'].includes(String(row.status))
    ? row.status
    : 'pending') as PaymentPhaseRecord['status'],
  dueDate: row.dueDate ? new Date(row.dueDate).toISOString() : null,
  paymentDate: row.paymentDate ? new Date(row.paymentDate).toISOString() : null,
  paymentMode: normalizePaymentModeInput(row.paymentMode) ?? null,
  transactionId: row.transactionId || null,
  note: row.note || null,
  updatedBy: row.updatedBy || null,
  updatedAt: row.updatedAtPhase ? new Date(row.updatedAtPhase).toISOString() : null
});

const phaseRowPayload = (quotationId: string, phase: PaymentPhaseRecord, actorId: string | null) => ({
  quotationId,
  phaseNumber: phase.phaseNumber,
  phaseName: phase.phaseName,
  amount: phase.amount,
  paidAmount: phase.paidAmount,
  status: phase.status,
  dueDate: phase.dueDate ? new Date(phase.dueDate) : null,
  paymentDate: phase.paymentDate ? new Date(phase.paymentDate) : null,
  paymentMode: phase.paymentMode || null,
  transactionId: phase.transactionId || null,
  note: phase.note || null,
  updatedBy: actorId,
  updatedAtPhase: new Date()
});

/** Delete all installment rows for quotation, then insert body phases (0 rows if []). */
export const replaceQuotationPaymentPhases = async (
  quotationId: string,
  phases: PaymentPhaseRecord[],
  actorId: string | null
): Promise<void> => {
  await QuotationPaymentPhase.destroy({ where: { quotationId } });
  for (const phase of phases) {
    await QuotationPaymentPhase.create({
      id: uuidv4(),
      ...phaseRowPayload(quotationId, phase, actorId)
    });
  }
};

/** Legacy upsert by phaseNumber — leaves orphan rows when installments are removed. */
export const upsertQuotationPaymentPhases = async (
  quotationId: string,
  phases: PaymentPhaseRecord[],
  actorId: string | null
): Promise<void> => {
  for (const phase of phases) {
    const existing = await QuotationPaymentPhase.findOne({
      where: { quotationId, phaseNumber: phase.phaseNumber }
    });
    const payload = phaseRowPayload(quotationId, phase, actorId);
    if (existing) {
      await existing.update(payload);
    } else {
      await QuotationPaymentPhase.create({ id: uuidv4(), ...payload });
    }
  }
};

export const loadQuotationPaymentPhases = async (quotationId: string): Promise<PaymentPhaseRecord[]> => {
  const rows = await QuotationPaymentPhase.findAll({
    where: { quotationId },
    order: [['phaseNumber', 'ASC']]
  });
  return rows.map((row) => serializePaymentPhaseRow(row as Parameters<typeof serializePaymentPhaseRow>[0]));
};
