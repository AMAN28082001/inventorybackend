import { Quotation, QuotationProduct, CustomPanel } from '../models/index-quotation';
import { computeSystemKwFromProducts } from './quotationSystemKw';

/**
 * Recompute kW from quotation_products (+ custom panels) and persist on quotations.system_kw.
 */
export async function persistQuotationSystemKw(
  quotationId: string,
  quotationSystemType?: string | null
): Promise<number> {
  const [quotation, qp, customPanelRows] = await Promise.all([
    Quotation.findByPk(quotationId, { attributes: ['id', 'systemType'] }),
    QuotationProduct.findOne({ where: { quotationId } }),
    CustomPanel.findAll({ where: { quotationId } })
  ]);

  const plainProducts = qp
    ? (qp.get({ plain: true }) as unknown as Record<string, unknown>)
    : null;
  const customPanels = customPanelRows.map((row) => row.get({ plain: true }));
  const sysType = quotationSystemType ?? quotation?.systemType ?? null;
  const kw = computeSystemKwFromProducts(plainProducts, customPanels, sysType);

  await Quotation.update({ systemKw: kw }, { where: { id: quotationId } });
  return kw;
}
