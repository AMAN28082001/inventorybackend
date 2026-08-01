/**
 * Crompton DCR set (1-Phase) — Aug 2026 (§27).
 * See BACKEND_CROMPTON_DCR_SET.md
 *
 * Package identity (do not coerce to Premier Energies Topcon):
 *   panelType === "Crompton set" (package marker — required for set price)
 *   panelBrand / dcrPanelBrand === "Premier Energy"
 *   inverterBrand === "Crompton", inverterSize === "3.6kW"
 *   pdfPanelRangeKey === "premier_energy_600_610"
 *   prices: 3kW → 210000, 5kW → 295000
 */

export const CROMPTON_DCR_SET_NAME = 'Crompton set';
export const CROMPTON_PANEL_BRAND = 'Premier Energy';
export const CROMPTON_INVERTER_BRAND = 'Crompton';
export const CROMPTON_INVERTER_SIZE = '3.6kW';
export const CROMPTON_PDF_PANEL_RANGE_KEY = 'premier_energy_600_610';
export const CROMPTON_ACDB_DCDB_1_PHASE = 'Crompton (1-Phase)';

export const DCR_CROMPTON_SET_PRICES = [
  {
    systemSize: '3kW',
    phase: '1-Phase' as const,
    inverterSize: CROMPTON_INVERTER_SIZE,
    panelType: CROMPTON_DCR_SET_NAME,
    price: 210000,
    notes: 'Premier Energy 600W–610W panels; Crompton 3.6kW inverter + ACDB/DCDB'
  },
  {
    systemSize: '5kW',
    phase: '1-Phase' as const,
    inverterSize: CROMPTON_INVERTER_SIZE,
    panelType: CROMPTON_DCR_SET_NAME,
    price: 295000,
    notes: 'Premier Energy 600W–610W panels; Crompton 3.6kW inverter + ACDB/DCDB'
  }
] as const;

/** Browse / pricing-tables presets use column brand "Crompton set". */
export const DCR_CROMPTON_SYSTEM_CONFIGS = [
  {
    systemType: 'dcr' as const,
    systemSize: '3kW',
    phase: '1-Phase' as const,
    panelBrand: CROMPTON_DCR_SET_NAME,
    panelSize: '610W',
    inverterBrand: CROMPTON_INVERTER_BRAND,
    inverterSize: CROMPTON_INVERTER_SIZE,
    inverterType: 'String Inverter',
    structureType: 'GI Structure',
    structureSize: '3kW',
    meterBrand: 'L&T',
    acCableBrand: 'Polycab',
    acCableSize: 'As per Set',
    dcCableBrand: 'Polycab',
    dcCableSize: 'As per Set',
    acdb: CROMPTON_ACDB_DCDB_1_PHASE,
    dcdb: CROMPTON_ACDB_DCDB_1_PHASE,
    centralSubsidy: 78000
  },
  {
    systemType: 'dcr' as const,
    systemSize: '5kW',
    phase: '1-Phase' as const,
    panelBrand: CROMPTON_DCR_SET_NAME,
    panelSize: '610W',
    inverterBrand: CROMPTON_INVERTER_BRAND,
    inverterSize: CROMPTON_INVERTER_SIZE,
    inverterType: 'String Inverter',
    structureType: 'GI Structure',
    structureSize: '5kW',
    meterBrand: 'L&T',
    acCableBrand: 'Polycab',
    acCableSize: 'As per Set',
    dcCableBrand: 'Polycab',
    dcCableSize: 'As per Set',
    acdb: CROMPTON_ACDB_DCDB_1_PHASE,
    dcdb: CROMPTON_ACDB_DCDB_1_PHASE,
    centralSubsidy: 78000
  }
] as const;

const norm = (v?: string | null): string =>
  String(v || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

/** True when quotation products are the Crompton DCR package. */
export const isCromptonDcrSet = (
  products: Record<string, unknown> | null | undefined
): boolean => {
  if (!products) return false;
  if (String(products.systemType || '').trim().toLowerCase() === 'non-dcr') return false;
  const brand = norm(
    String(products.panelBrand ?? products.panel_brand ?? products.dcrPanelBrand ?? '')
  );
  const panelType = norm(String(products.panelType ?? products.panel_type ?? ''));
  const range = norm(String(products.pdfPanelRangeKey ?? products.pdf_panel_range_key ?? ''));
  const inverter = norm(String(products.inverterBrand ?? ''));
  return (
    panelType === 'crompton set' ||
    brand === 'crompton set' ||
    range === CROMPTON_PDF_PANEL_RANGE_KEY ||
    (brand === 'premier energy' && inverter === 'crompton')
  );
};

/** Relaxed catalog validation for Crompton DCR package — returns error strings (empty = OK). */
export const validateCromptonDcrProductSelection = (
  products: Record<string, unknown>,
  _catalog?: unknown
): string[] => {
  const errors: string[] = [];
  if (!isCromptonDcrSet(products)) return errors;

  const phase = norm(String(products.phase ?? ''));
  if (phase && phase !== '1-phase') {
    errors.push('Crompton set is 1-Phase only');
  }

  const invBrand = String(products.inverterBrand ?? '').trim();
  if (invBrand && norm(invBrand) !== 'crompton') {
    errors.push(`Crompton set expects inverterBrand "${CROMPTON_INVERTER_BRAND}"`);
  }

  return errors;
};

export const getCromptonDcrSetPrice = (
  systemSize: string,
  phase?: string
): number | null => {
  if (phase && norm(phase) !== '1-phase') return null;
  const size = String(systemSize || '').trim();
  const row = DCR_CROMPTON_SET_PRICES.find((r) => r.systemSize === size);
  return row ? row.price : null;
};

/**
 * Set-price when panelType is Crompton set.
 * Do NOT price plain Premier Energy / Premier Energies under this table.
 * Inverter is fixed 3.6kW — ignore inverterSize ≠ systemSize.
 */
export const resolveDcrSetPriceForProducts = (
  products: Record<string, unknown> | null | undefined
): number | null => {
  if (!products || !isCromptonDcrSet(products)) return null;
  const size = String(
    products.systemSize ?? products.structureSize ?? products.systemKw ?? ''
  ).trim();
  return getCromptonDcrSetPrice(size, String(products.phase ?? '') || undefined);
};

/** Keep Premier Energy brand + Crompton set marker — never remap to Premier Energies. */
export const preserveCromptonSetIdentity = (
  products: Record<string, unknown> | null | undefined
): Record<string, unknown> => {
  if (!products || !isCromptonDcrSet(products)) return products || {};
  const rangeKey =
    String(products.pdfPanelRangeKey || products.pdf_panel_range_key || '').trim() ||
    CROMPTON_PDF_PANEL_RANGE_KEY;
  return {
    ...products,
    panelBrand: CROMPTON_PANEL_BRAND,
    panel_brand: CROMPTON_PANEL_BRAND,
    dcrPanelBrand: CROMPTON_PANEL_BRAND,
    dcr_panel_brand: CROMPTON_PANEL_BRAND,
    panelType: CROMPTON_DCR_SET_NAME,
    panel_type: CROMPTON_DCR_SET_NAME,
    inverterBrand: String(products.inverterBrand || '').trim() || CROMPTON_INVERTER_BRAND,
    inverterSize: String(products.inverterSize || '').trim() || CROMPTON_INVERTER_SIZE,
    acdb: String(products.acdb || '').trim() || CROMPTON_ACDB_DCDB_1_PHASE,
    dcdb: String(products.dcdb || '').trim() || CROMPTON_ACDB_DCDB_1_PHASE,
    pdfPanelRangeKey: rangeKey,
    pdf_panel_range_key: rangeKey
  };
};

export const isAllowedCromptonPanelBrand = (brand: unknown): boolean => {
  const n = norm(String(brand || ''));
  return n === 'premier energy' || n === 'crompton set' || n === 'crompton';
};

export const isAllowedCromptonInverterBrand = (brand: unknown): boolean =>
  norm(String(brand || '')) === 'crompton';

export const isAllowedCromptonInverterSize = (size: unknown): boolean => {
  const n = norm(String(size || '')).replace(/\s/g, '');
  return n === '3.6kw' || n === '3.6';
};

export const isAllowedCromptonAcdbDcdb = (label: unknown): boolean => {
  const n = norm(String(label || ''));
  return n.includes('crompton');
};
