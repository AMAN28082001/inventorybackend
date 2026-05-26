/**
 * PDF-only fields on quotation products (§X).
 * Do not use for catalog validation or pricing calculations.
 */

export const PDF_PANEL_RANGE_KEYS = [
  'waaree_540_560_bifacial',
  'waaree_580_700_bifacial_topcon',
  'adani_540_580_bifacial',
  'adani_610_625_bifacial_topcon'
] as const;

export type PdfPanelRangeKey = (typeof PDF_PANEL_RANGE_KEYS)[number];

/** Combined inverter labels shown in the UI / PDF (not a separate PDF flag). */
export const EXTRA_INVERTER_BRAND_LABELS = [
  'Vsole/Xwatt/Saatvik',
  'Vsole/Xwatt'
] as const;

/** Combined meter labels on proposal PDF (not a separate field). */
export const EXTRA_METER_BRAND_LABELS = ['L&T/HPL/Genus/Secure'] as const;

export type PdfDisplayFlags = {
  pdfUsePanelSizeRange: boolean;
  pdfUseInverterBrandOptions: boolean;
};

export type PdfPanelRangeKeys = {
  pdfPanelRangeKey: string | null;
  pdfDcrPanelRangeKey: string | null;
  pdfNonDcrPanelRangeKey: string | null;
};

export const parsePdfDisplayFlag = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return undefined;
};

const normalizePanelRangeKey = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null;
  const key = String(value).trim();
  if (!key) return null;
  if ((PDF_PANEL_RANGE_KEYS as readonly string[]).includes(key)) return key;
  return null;
};

export const extractPdfPanelRangeKeysFromProducts = (
  products: Record<string, unknown> | null | undefined
): PdfPanelRangeKeys => ({
  pdfPanelRangeKey:
    normalizePanelRangeKey(products?.pdfPanelRangeKey) ??
    normalizePanelRangeKey(products?.pdf_panel_range_key),
  pdfDcrPanelRangeKey:
    normalizePanelRangeKey(products?.pdfDcrPanelRangeKey) ??
    normalizePanelRangeKey(products?.pdf_dcr_panel_range_key),
  pdfNonDcrPanelRangeKey:
    normalizePanelRangeKey(products?.pdfNonDcrPanelRangeKey) ??
    normalizePanelRangeKey(products?.pdf_non_dcr_panel_range_key)
});

export const extractPdfDisplayFlagsFromProducts = (
  products: Record<string, unknown> | null | undefined
): Partial<PdfDisplayFlags> => {
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

/** Persisted PDF-only columns + legacy booleans for create/update. */
export const buildQuotationProductPdfPersistFields = (
  products: Record<string, unknown> | null | undefined
): Partial<PdfDisplayFlags & PdfPanelRangeKeys> => {
  const flags = extractPdfDisplayFlagsFromProducts(products);
  const rangeKeys = extractPdfPanelRangeKeysFromProducts(products);
  return {
    pdfUsePanelSizeRange: flags.pdfUsePanelSizeRange ?? false,
    pdfUseInverterBrandOptions: flags.pdfUseInverterBrandOptions ?? false,
    pdfPanelRangeKey: rangeKeys.pdfPanelRangeKey,
    pdfDcrPanelRangeKey: rangeKeys.pdfDcrPanelRangeKey,
    pdfNonDcrPanelRangeKey: rangeKeys.pdfNonDcrPanelRangeKey
  };
};

export const isAllowedInverterBrandForCatalog = (
  brand: string | null | undefined,
  catalogBrands: string[] | undefined
): boolean => {
  const normalized = String(brand || '').trim();
  if (!normalized) return true;
  if ((EXTRA_INVERTER_BRAND_LABELS as readonly string[]).includes(normalized)) return true;
  if (!catalogBrands?.length) return true;
  return catalogBrands.includes(normalized);
};

export const isAllowedMeterBrandForCatalog = (
  brand: string | null | undefined,
  catalogBrands: string[] | undefined
): boolean => {
  const normalized = String(brand || '').trim();
  if (!normalized) return true;
  if ((EXTRA_METER_BRAND_LABELS as readonly string[]).includes(normalized)) return true;
  if (!catalogBrands?.length) return true;
  return catalogBrands.includes(normalized);
};

export const hasPdfPanelRangeKey = (products: Record<string, unknown> | null | undefined): boolean => {
  const keys = extractPdfPanelRangeKeysFromProducts(products);
  return Boolean(keys.pdfPanelRangeKey || keys.pdfDcrPanelRangeKey || keys.pdfNonDcrPanelRangeKey);
};

export const quotationProductPdfDisplayApiFields = (
  products: Record<string, unknown> | null | undefined
): Record<string, string | boolean | null> => {
  if (!products) return {};
  const panel = Boolean(
    products.pdfUsePanelSizeRange ?? products.pdf_use_panel_size_range ?? false
  );
  const inverter = Boolean(
    products.pdfUseInverterBrandOptions ?? products.pdf_use_inverter_brand_options ?? false
  );
  const rangeKeys = extractPdfPanelRangeKeysFromProducts(products);
  return {
    pdfUsePanelSizeRange: panel,
    pdf_use_panel_size_range: panel,
    pdfUseInverterBrandOptions: inverter,
    pdf_use_inverter_brand_options: inverter,
    pdfPanelRangeKey: rangeKeys.pdfPanelRangeKey,
    pdf_panel_range_key: rangeKeys.pdfPanelRangeKey,
    pdfDcrPanelRangeKey: rangeKeys.pdfDcrPanelRangeKey,
    pdf_dcr_panel_range_key: rangeKeys.pdfDcrPanelRangeKey,
    pdfNonDcrPanelRangeKey: rangeKeys.pdfNonDcrPanelRangeKey,
    pdf_non_dcr_panel_range_key: rangeKeys.pdfNonDcrPanelRangeKey
  };
};
