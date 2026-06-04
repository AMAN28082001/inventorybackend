/**
 * Tata DCR fixed package sets (§X.1) — relaxed catalog validation, no VAL_003 for package payloads.
 */

import {
  extractPdfPanelRangeKeysFromProducts,
  isAllowedInverterBrandForCatalog,
  isAllowedMeterBrandForCatalog
} from './quotationProductPdfDisplay';

export const TATA_DCR_ALLOWED_STRUCTURE_SIZES = [
  '3.1kW',
  '5.1kW',
  '3kW',
  '5kW',
  '6kW',
  '8kW',
  '10kW'
] as const;

export const isAsPerTheSet = (value: unknown): boolean => {
  const s = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return s === 'as per the set' || s === 'as per set';
};

export const isTataDcrPackageSet = (products: Record<string, unknown> | null | undefined): boolean => {
  if (!products) return false;
  const systemType = String(products.systemType ?? products.system_type ?? '')
    .trim()
    .toLowerCase();
  if (systemType !== 'dcr') return false;
  const brand = String(
    products.panelBrand ??
      products.panel_brand ??
      products.dcrPanelBrand ??
      products.dcr_panel_brand ??
      ''
  )
    .trim()
    .toLowerCase();
  return brand === 'tata';
};

export const isPackageSetPanelComplete = (products: Record<string, unknown>): boolean => {
  const brand = String(products.panelBrand ?? products.panel_brand ?? '').trim();
  if (!brand) return false;
  const rangeKeys = extractPdfPanelRangeKeysFromProducts(products);
  if (rangeKeys.pdfPanelRangeKey) return true;
  if (isAsPerTheSet(products.panelSize ?? products.panel_size)) return true;
  const size = String(products.panelSize ?? products.panel_size ?? '').trim();
  if (size) return true;
  return Number(products.panelQuantity ?? products.panel_quantity ?? 0) > 0;
};

const normalizeStructureSizeKey = (value: unknown): string =>
  String(value || '')
    .trim()
    .replace(/\s/g, '')
    .toLowerCase();

export const isAllowedTataStructureSize = (size: unknown): boolean => {
  const normalized = normalizeStructureSizeKey(size);
  if (!normalized) return true;
  return TATA_DCR_ALLOWED_STRUCTURE_SIZES.some(
    (allowed) => normalizeStructureSizeKey(allowed) === normalized
  );
};

/** Tata DCR packages use placeholders (530W, As per the set) — not strict catalog wattage match. */
export const isAllowedTataPanelSize = (size: unknown, _catalogSizes?: unknown): boolean => {
  if (isAsPerTheSet(size)) return true;
  const s = String(size || '').trim();
  if (!s) return true;
  return true;
};

export const isAllowedPackageCableSize = (size: unknown, catalogSizes?: string[]): boolean => {
  if (isAsPerTheSet(size)) return true;
  const s = String(size || '').trim();
  if (!s) return true;
  if (!catalogSizes?.length) return true;
  return catalogSizes.includes(s);
};

/**
 * Catalog validation for Tata DCR package quotations only.
 */
export const validateTataDcrProductSelection = (
  products: Record<string, unknown>,
  catalog: {
    panels?: { brands?: string[]; sizes?: string[] };
    inverters?: { brands?: string[]; types?: string[] };
    structures?: { types?: string[]; sizes?: string[] };
    meters?: { brands?: string[] };
    cables?: { brands?: string[]; sizes?: string[] };
    acdb?: { options?: string[] };
    dcdb?: { options?: string[] };
  }
): string[] => {
  const errors: string[] = [];

  const panelBrand = String(products.panelBrand ?? products.panel_brand ?? '').trim();
  if (!panelBrand) {
    errors.push('Panel brand is required');
  } else if (
    catalog.panels?.brands?.length &&
    !catalog.panels.brands.includes(panelBrand) &&
    panelBrand.toLowerCase() !== 'tata'
  ) {
    errors.push(`Invalid panel brand: ${panelBrand}`);
  }

  if (!isPackageSetPanelComplete(products)) {
    errors.push('Panel information is required');
  }

  const panelSize = products.panelSize ?? products.panel_size;
  if (panelSize && !isAllowedTataPanelSize(panelSize, catalog.panels?.sizes)) {
    errors.push(`Invalid panel size: ${panelSize}`);
  }

  const structureSize = products.structureSize ?? products.structure_size;
  if (structureSize && !isAllowedTataStructureSize(structureSize)) {
    errors.push(`Invalid structure size: ${structureSize}`);
  }

  const inverterBrand = products.inverterBrand ?? products.inverter_brand;
  const inverterSize = products.inverterSize ?? products.inverter_size;
  if (!isAsPerTheSet(inverterBrand) && !isAsPerTheSet(inverterSize)) {
    if (!String(inverterBrand || '').trim() || !String(inverterSize || '').trim()) {
      errors.push('Inverter information is required');
    }
    if (
      inverterBrand &&
      catalog.inverters?.brands?.length &&
      !isAllowedInverterBrandForCatalog(String(inverterBrand), catalog.inverters.brands)
    ) {
      errors.push(`Invalid inverter brand: ${inverterBrand}`);
    }
  }

  if (products.inverterType && catalog.inverters?.types?.length) {
    if (!catalog.inverters.types.includes(String(products.inverterType))) {
      errors.push(`Invalid inverter type: ${products.inverterType}`);
    }
  }

  if (products.structureType && catalog.structures?.types?.length) {
    if (!catalog.structures.types.includes(String(products.structureType))) {
      errors.push(`Invalid structure type: ${products.structureType}`);
    }
  }

  if (
    products.meterBrand &&
    catalog.meters?.brands?.length &&
    !isAllowedMeterBrandForCatalog(String(products.meterBrand), catalog.meters.brands)
  ) {
    errors.push(`Invalid meter brand: ${products.meterBrand}`);
  }

  const cableSizes = catalog.cables?.sizes;
  if (
    products.acCableSize &&
    cableSizes?.length &&
    !isAllowedPackageCableSize(products.acCableSize, cableSizes)
  ) {
    errors.push(`Invalid AC cable size: ${products.acCableSize}`);
  }
  if (
    products.dcCableSize &&
    cableSizes?.length &&
    !isAllowedPackageCableSize(products.dcCableSize, cableSizes)
  ) {
    errors.push(`Invalid DC cable size: ${products.dcCableSize}`);
  }

  if (products.acdb && catalog.acdb?.options?.length && !catalog.acdb.options.includes(String(products.acdb))) {
    errors.push(`Invalid ACDB option: ${products.acdb}`);
  }
  if (products.dcdb && catalog.dcdb?.options?.length && !catalog.dcdb.options.includes(String(products.dcdb))) {
    errors.push(`Invalid DCDB option: ${products.dcdb}`);
  }

  return errors;
};
