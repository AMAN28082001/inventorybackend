/**
 * PDF-only display flags on quotation products (§X).
 * Do not use for catalog validation or pricing calculations.
 */

export type PdfDisplayFlags = {
  pdfUsePanelSizeRange: boolean;
  pdfUseInverterBrandOptions: boolean;
};

export const parsePdfDisplayFlag = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return undefined;
};

export const extractPdfDisplayFlagsFromProducts = (products: Record<string, unknown> | null | undefined): Partial<PdfDisplayFlags> => {
  if (!products) return {};
  const out: Partial<PdfDisplayFlags> = {};
  const panel =
    parsePdfDisplayFlag(products.pdfUsePanelSizeRange) ??
    parsePdfDisplayFlag(products.pdf_use_panel_size_range);
  const inverter =
    parsePdfDisplayFlag(products.pdfUseInverterBrandOptions) ??
    parsePdfDisplayFlag(products.pdf_use_inverter_brand_options);
  if (panel !== undefined) out.pdfUsePanelSizeRange = panel;
  if (inverter !== undefined) out.pdfUseInverterBrandOptions = inverter;
  return out;
};

export const quotationProductPdfDisplayApiFields = (
  products: Record<string, unknown> | null | undefined
): Record<string, boolean> => {
  if (!products) return {};
  const panel = Boolean(
    products.pdfUsePanelSizeRange ?? products.pdf_use_panel_size_range ?? false
  );
  const inverter = Boolean(
    products.pdfUseInverterBrandOptions ?? products.pdf_use_inverter_brand_options ?? false
  );
  return {
    pdfUsePanelSizeRange: panel,
    pdf_use_panel_size_range: panel,
    pdfUseInverterBrandOptions: inverter,
    pdf_use_inverter_brand_options: inverter
  };
};
