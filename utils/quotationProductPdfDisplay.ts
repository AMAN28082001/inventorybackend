/**
 * PDF-only fields on quotation products (§X).
 * Do not use for catalog validation or pricing calculations.
 */

export const PDF_PANEL_RANGE_KEYS = [
  'waaree_540_560_bifacial',
  'waaree_580_700_bifacial_topcon',
  'adani_540_580_bifacial',
  'adani_610_625_bifacial_topcon',
  'premier_600_625_bifacial_topcon',
  'tata_530_570'
] as const;

export type PdfPanelRangeKey = (typeof PDF_PANEL_RANGE_KEYS)[number];

/** Human-readable panel spec for PDF/overview (client mirrors `lib/quotation-pdf-display.ts`). */
export const PDF_PANEL_RANGE_LABELS: Record<PdfPanelRangeKey, string> = {
  waaree_540_560_bifacial: '540-560W Bifacial',
  waaree_580_700_bifacial_topcon: '580-700W Bifacial Topcon',
  adani_540_580_bifacial: '540-580W Bifacial',
  adani_610_625_bifacial_topcon: '610-625W Bifacial Topcon',
  premier_600_625_bifacial_topcon: '600-625W Bifacial Topcon',
  tata_530_570: '530W - 570W'
};

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

const pdfFieldWasSent = (
  products: Record<string, unknown>,
  camel: string,
  snake: string
): boolean => Object.prototype.hasOwnProperty.call(products, camel) || Object.prototype.hasOwnProperty.call(products, snake);

/** Persisted PDF-only columns for create (defaults booleans to false when omitted). */
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

/**
 * PATCH /products — only overwrite PDF columns the client sent.
 * Explicit null / "" / false clears stored values (checkbox uncheck fix).
 */
export const buildQuotationProductPdfPersistFieldsForUpdate = (
  products: Record<string, unknown> | null | undefined
): Partial<PdfDisplayFlags & PdfPanelRangeKeys> => {
  if (!products) return {};
  const out: Partial<PdfDisplayFlags & PdfPanelRangeKeys> = {};

  if (pdfFieldWasSent(products, 'pdfUsePanelSizeRange', 'pdf_use_panel_size_range')) {
    out.pdfUsePanelSizeRange =
      parsePdfDisplayFlag(products.pdfUsePanelSizeRange) ??
      parsePdfDisplayFlag(products.pdf_use_panel_size_range) ??
      false;
  }
  if (pdfFieldWasSent(products, 'pdfUseInverterBrandOptions', 'pdf_use_inverter_brand_options')) {
    out.pdfUseInverterBrandOptions =
      parsePdfDisplayFlag(products.pdfUseInverterBrandOptions) ??
      parsePdfDisplayFlag(products.pdf_use_inverter_brand_options) ??
      false;
  }
  if (pdfFieldWasSent(products, 'pdfPanelRangeKey', 'pdf_panel_range_key')) {
    out.pdfPanelRangeKey =
      normalizePanelRangeKey(products.pdfPanelRangeKey) ??
      normalizePanelRangeKey(products.pdf_panel_range_key);
  }
  if (pdfFieldWasSent(products, 'pdfDcrPanelRangeKey', 'pdf_dcr_panel_range_key')) {
    out.pdfDcrPanelRangeKey =
      normalizePanelRangeKey(products.pdfDcrPanelRangeKey) ??
      normalizePanelRangeKey(products.pdf_dcr_panel_range_key);
  }
  if (pdfFieldWasSent(products, 'pdfNonDcrPanelRangeKey', 'pdf_non_dcr_panel_range_key')) {
    out.pdfNonDcrPanelRangeKey =
      normalizePanelRangeKey(products.pdfNonDcrPanelRangeKey) ??
      normalizePanelRangeKey(products.pdf_non_dcr_panel_range_key);
  }

  return out;
};

/** Keys allowed on quotation_products — excludes PDF (separate) and customPanels. */
const QUOTATION_PRODUCT_COLUMN_KEYS = [
  'systemType',
  'phase',
  'panelBrand',
  'panelSize',
  'panelQuantity',
  'panelPrice',
  'dcrPanelBrand',
  'dcrPanelSize',
  'dcrPanelQuantity',
  'nonDcrPanelBrand',
  'nonDcrPanelSize',
  'nonDcrPanelQuantity',
  'inverterType',
  'inverterBrand',
  'inverterSize',
  'inverterPrice',
  'structureType',
  'structureSize',
  'structurePrice',
  'meterBrand',
  'meterPrice',
  'acCableBrand',
  'acCableSize',
  'acCablePrice',
  'dcCableBrand',
  'dcCableSize',
  'dcCablePrice',
  'acdb',
  'acdbPrice',
  'dcdb',
  'dcdbPrice',
  'hybridInverter',
  'batteryCapacity',
  'batteryPrice',
  'centralSubsidy',
  'stateSubsidy',
  'subtotal',
  'totalAmount',
  'finalAmount'
] as const;

const PRODUCT_SNAKE_TO_CAMEL: Record<string, (typeof QUOTATION_PRODUCT_COLUMN_KEYS)[number]> = {
  system_type: 'systemType',
  panel_brand: 'panelBrand',
  panel_size: 'panelSize',
  panel_quantity: 'panelQuantity',
  panel_price: 'panelPrice',
  dcr_panel_brand: 'dcrPanelBrand',
  dcr_panel_size: 'dcrPanelSize',
  dcr_panel_quantity: 'dcrPanelQuantity',
  non_dcr_panel_brand: 'nonDcrPanelBrand',
  non_dcr_panel_size: 'nonDcrPanelSize',
  non_dcr_panel_quantity: 'nonDcrPanelQuantity',
  inverter_type: 'inverterType',
  inverter_brand: 'inverterBrand',
  inverter_size: 'inverterSize',
  inverter_price: 'inverterPrice',
  structure_type: 'structureType',
  structure_size: 'structureSize',
  structure_price: 'structurePrice',
  meter_brand: 'meterBrand',
  meter_price: 'meterPrice',
  ac_cable_brand: 'acCableBrand',
  ac_cable_size: 'acCableSize',
  ac_cable_price: 'acCablePrice',
  dc_cable_brand: 'dcCableBrand',
  dc_cable_size: 'dcCableSize',
  dc_cable_price: 'dcCablePrice',
  acdb_price: 'acdbPrice',
  dcdb_price: 'dcdbPrice',
  hybrid_inverter: 'hybridInverter',
  battery_capacity: 'batteryCapacity',
  battery_price: 'batteryPrice',
  central_subsidy: 'centralSubsidy',
  state_subsidy: 'stateSubsidy',
  total_amount: 'totalAmount',
  final_amount: 'finalAmount'
};

/** Strip PDF flags and nested customPanels before Sequelize product update/create. */
export const pickQuotationProductPersistPayload = (
  products: Record<string, unknown> | null | undefined
): Record<string, unknown> => {
  if (!products) return {};
  const out: Record<string, unknown> = {};

  for (const key of QUOTATION_PRODUCT_COLUMN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(products, key) && products[key] !== undefined) {
      out[key] = products[key];
    }
  }
  for (const [snake, camel] of Object.entries(PRODUCT_SNAKE_TO_CAMEL)) {
    if (Object.prototype.hasOwnProperty.call(products, snake) && products[snake] !== undefined) {
      out[camel] = products[snake];
    }
  }

  return out;
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
