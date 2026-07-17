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
  'tata_530_570',
  'ina_500_600_bifacial'
] as const;

export type PdfPanelRangeKey = (typeof PDF_PANEL_RANGE_KEYS)[number];

/** Human-readable panel spec for PDF/overview (client mirrors `lib/quotation-pdf-display.ts`). */
export const PDF_PANEL_RANGE_LABELS: Record<PdfPanelRangeKey, string> = {
  waaree_540_560_bifacial: '540-560W Bifacial',
  waaree_580_700_bifacial_topcon: '580-700W Bifacial Topcon',
  adani_540_580_bifacial: '540-580W Bifacial',
  adani_610_625_bifacial_topcon: '610-625W Bifacial Topcon',
  premier_600_625_bifacial_topcon: '600-625W Bifacial Topcon',
  tata_530_570: '530W - 570W',
  ina_500_600_bifacial: '500W - 600W'
};

/** PDF range label sent as panelSize (e.g. INA) — not a catalog wattage. */
export const isPdfPanelRangeDisplaySize = (size: unknown): boolean => {
  const s = String(size || '').trim();
  if (!s) return false;
  return (Object.values(PDF_PANEL_RANGE_LABELS) as string[]).includes(s);
};

export const parseInaDcrPackageFlag = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return undefined;
};

export const isInaDcrPackage = (products: Record<string, unknown> | null | undefined): boolean => {
  if (!products) return false;
  const flag = parseInaDcrPackageFlag(products.inaDcrPackage ?? products.ina_dcr_package);
  if (flag === true) return true;
  const panelType = String(products.panelType ?? products.panel_type ?? '').trim().toUpperCase();
  if (panelType === 'INA') return true;
  const brand = String(products.panelBrand ?? products.panel_brand ?? '').trim().toUpperCase();
  return brand === 'INA' && Boolean(products.pdfPanelRangeKey ?? products.pdf_panel_range_key);
};

/** Coerce INA package fields so panelBrand/panelType are not lost on save. */
export const normalizeInaPackageProductFields = (
  products: Record<string, unknown> | null | undefined
): Record<string, unknown> => {
  if (!products) return {};
  if (!isInaDcrPackage(products)) return products;
  const panelType = String(products.panelType ?? products.panel_type ?? 'INA').trim() || 'INA';
  return {
    ...products,
    panelBrand: products.panelBrand ?? products.panel_brand ?? 'INA',
    panel_brand: products.panel_brand ?? products.panelBrand ?? 'INA',
    dcrPanelBrand: products.dcrPanelBrand ?? products.dcr_panel_brand ?? 'INA',
    dcr_panel_brand: products.dcr_panel_brand ?? products.dcrPanelBrand ?? 'INA',
    panelType,
    panel_type: panelType,
    inaDcrPackage: true,
    ina_dcr_package: true
  };
};

export const buildQuotationProductInaPersistFields = (
  products: Record<string, unknown> | null | undefined
): Partial<{ panelType: string | null; inaDcrPackage: boolean }> => {
  const normalized = normalizeInaPackageProductFields(products);
  const panelTypeRaw = normalized.panelType ?? normalized.panel_type;
  const panelType =
    panelTypeRaw === undefined || panelTypeRaw === null || panelTypeRaw === ''
      ? null
      : String(panelTypeRaw).trim();
  const inaFlag = parseInaDcrPackageFlag(normalized.inaDcrPackage ?? normalized.ina_dcr_package);
  return {
    panelType: panelType || (isInaDcrPackage(normalized) ? 'INA' : null),
    inaDcrPackage: inaFlag ?? isInaDcrPackage(normalized)
  };
};

export const buildQuotationProductInaPersistFieldsForUpdate = (
  products: Record<string, unknown> | null | undefined
): Partial<{ panelType: string | null; inaDcrPackage: boolean }> => {
  if (!products) return {};
  const out: Partial<{ panelType: string | null; inaDcrPackage: boolean }> = {};
  const hasPanelType =
    Object.prototype.hasOwnProperty.call(products, 'panelType') ||
    Object.prototype.hasOwnProperty.call(products, 'panel_type');
  const hasInaFlag =
    Object.prototype.hasOwnProperty.call(products, 'inaDcrPackage') ||
    Object.prototype.hasOwnProperty.call(products, 'ina_dcr_package');
  if (hasPanelType) {
    const raw = products.panelType ?? products.panel_type;
    out.panelType = raw === null || raw === '' ? null : String(raw).trim();
  }
  if (hasInaFlag) {
    out.inaDcrPackage = parseInaDcrPackageFlag(products.inaDcrPackage ?? products.ina_dcr_package) ?? false;
  } else if (hasPanelType && out.panelType?.toUpperCase() === 'INA') {
    out.inaDcrPackage = true;
  }
  return out;
};

export const quotationProductInaApiFields = (
  products: Record<string, unknown> | null | undefined
): Record<string, string | boolean | null> => {
  if (!products) return {};
  const panelTypeRaw = products.panelType ?? products.panel_type;
  const panelType =
    panelTypeRaw === undefined || panelTypeRaw === null || panelTypeRaw === ''
      ? null
      : String(panelTypeRaw);
  const inaDcrPackage = Boolean(products.inaDcrPackage ?? products.ina_dcr_package ?? false);
  return {
    panelType,
    panel_type: panelType,
    inaDcrPackage,
    ina_dcr_package: inaDcrPackage
  };
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
  /** Commercial set — hide subsidy lines on proposal PDF */
  pdfCommercialSet: boolean;
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
  const commercialSet =
    parsePdfDisplayFlag(products.pdfCommercialSet) ??
    parsePdfDisplayFlag(products.pdf_commercial_set);
  if (panel !== undefined) out.pdfUsePanelSizeRange = panel;
  if (inverter !== undefined) out.pdfUseInverterBrandOptions = inverter;
  if (commercialSet !== undefined) out.pdfCommercialSet = commercialSet;
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
    pdfCommercialSet: flags.pdfCommercialSet ?? false,
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
  if (pdfFieldWasSent(products, 'pdfCommercialSet', 'pdf_commercial_set')) {
    out.pdfCommercialSet =
      parsePdfDisplayFlag(products.pdfCommercialSet) ??
      parsePdfDisplayFlag(products.pdf_commercial_set) ??
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
  'panelType',
  'inaDcrPackage',
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
  panel_type: 'panelType',
  ina_dcr_package: 'inaDcrPackage',
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

/**
 * Commercial DCR/BOTH have no subsidy. Read the commercial flag from any source object
 * (request root, `products`, or `pricing`) in the three interchangeable spellings the
 * frontend sends. See BACKEND_COMMERCIAL_DCR_SUBSIDY.md.
 */
export const readCommercialFlag = (
  source: Record<string, unknown> | null | undefined
): boolean => {
  if (!source) return false;
  const truthy = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1';
  return (
    truthy(source.pdfCommercialSet) ||
    truthy(source.pdf_commercial_set) ||
    truthy((source as Record<string, unknown>).isCommercial)
  );
};

/** True when the request (root, `products`, or `pricing`) marks the quotation commercial. */
export const isCommercialRequestBody = (
  body: Record<string, unknown> | null | undefined
): boolean => {
  if (!body) return false;
  const products = (body.products as Record<string, unknown> | undefined) || undefined;
  const pricing = (body.pricing as Record<string, unknown> | undefined) || undefined;
  return readCommercialFlag(body) || readCommercialFlag(products) || readCommercialFlag(pricing);
};

/** True when the commercial flag is explicitly present (any spelling) in the request body. */
export const commercialFlagDefinedInBody = (
  body: Record<string, unknown> | null | undefined
): boolean => {
  const has = (s: Record<string, unknown> | null | undefined) =>
    Boolean(
      s &&
        (s.pdfCommercialSet !== undefined ||
          s.pdf_commercial_set !== undefined ||
          (s as Record<string, unknown>).isCommercial !== undefined)
    );
  if (!body) return false;
  return (
    has(body) ||
    has(body.products as Record<string, unknown> | undefined) ||
    has(body.pricing as Record<string, unknown> | undefined)
  );
};

/**
 * Resolve the effective commercial flag for an update: an explicit flag in the request body
 * wins (so unchecking clears it), otherwise fall back to the persisted `products` value.
 */
export const resolveCommercialFlag = (
  body: Record<string, unknown> | null | undefined,
  persistedProducts: Record<string, unknown> | null | undefined
): boolean => {
  if (commercialFlagDefinedInBody(body)) return isCommercialRequestBody(body);
  return readCommercialFlag(persistedProducts);
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
  const commercialSet = Boolean(
    products.pdfCommercialSet ?? products.pdf_commercial_set ?? false
  );
  const rangeKeys = extractPdfPanelRangeKeysFromProducts(products);
  return {
    pdfUsePanelSizeRange: panel,
    pdf_use_panel_size_range: panel,
    pdfUseInverterBrandOptions: inverter,
    pdf_use_inverter_brand_options: inverter,
    pdfCommercialSet: commercialSet,
    pdf_commercial_set: commercialSet,
    pdfPanelRangeKey: rangeKeys.pdfPanelRangeKey,
    pdf_panel_range_key: rangeKeys.pdfPanelRangeKey,
    pdfDcrPanelRangeKey: rangeKeys.pdfDcrPanelRangeKey,
    pdf_dcr_panel_range_key: rangeKeys.pdfDcrPanelRangeKey,
    pdfNonDcrPanelRangeKey: rangeKeys.pdfNonDcrPanelRangeKey,
    pdf_non_dcr_panel_range_key: rangeKeys.pdfNonDcrPanelRangeKey
  };
};
