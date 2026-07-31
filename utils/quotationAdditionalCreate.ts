/**
 * Additional quotation for same customer (§23).
 * Skip duplicate-mobile guard when FE sends revise/additional flags.
 * See BACKEND_QUOTATION_SYSTEM_HISTORY.ts
 */

import { Op } from 'sequelize';
import { Quotation } from '../models/index-quotation';

export const resolveSourceQuotationId = (body: Record<string, unknown> | null | undefined): string => {
  if (!body) return '';
  return String(
    body.sourceQuotationId ||
      body.source_quotation_id ||
      body.previousQuotationId ||
      body.previous_quotation_id ||
      body.revisesQuotationId ||
      body.revises_quotation_id ||
      ''
  ).trim();
};

export const isAdditionalQuotationRequest = (
  body: Record<string, unknown> | null | undefined
): boolean => {
  if (!body) return false;
  if (body.allowAdditionalQuotation === true || body.allow_additional_quotation === true) {
    return true;
  }
  if (body.allowDuplicateMobile === true || body.allow_duplicate_mobile === true) {
    return true;
  }
  return Boolean(resolveSourceQuotationId(body));
};

export const resolveQuotationCreateNotes = (
  body: Record<string, unknown> | null | undefined,
  sourceId: string
): string | null => {
  const fromBody = String(body?.notes ?? '').trim();
  if (fromBody) return fromBody;
  if (sourceId) return `Additional quotation revised from ${sourceId}`;
  return null;
};

/**
 * Make `quotationId` the sole current quotation for its customer.
 * Does not delete/update products on other rows — only flips isCurrent.
 */
export const markQuotationAsCurrentForCustomer = async (
  customerId: string,
  quotationId: string
): Promise<void> => {
  if (!customerId || !quotationId) return;
  await Quotation.update(
    { isCurrent: false },
    {
      where: {
        customerId,
        id: { [Op.ne]: quotationId }
      }
    }
  );
  await Quotation.update({ isCurrent: true }, { where: { id: quotationId } });
};

/** Echo Current / Previous badges for list + detail. */
export const quotationCurrentApiFields = (row: Record<string, unknown> | null | undefined) => {
  const raw = row?.isCurrent ?? row?.is_current;
  const resolved =
    raw === undefined || raw === null
      ? true
      : raw === true || raw === 'true' || raw === 1;
  return {
    isCurrent: resolved,
    is_current: resolved,
    sourceQuotationId: (row?.sourceQuotationId ?? row?.source_quotation_id ?? null) as string | null,
    source_quotation_id: (row?.sourceQuotationId ?? row?.source_quotation_id ?? null) as
      | string
      | null
  };
};
