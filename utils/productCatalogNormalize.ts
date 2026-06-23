import {
  DEFAULT_CABLE_BRANDS,
  DEFAULT_CABLE_SIZES,
  DEFAULT_ACDB_OPTIONS,
  DEFAULT_DCDB_OPTIONS,
  DEFAULT_INVERTER_BRANDS,
  DEFAULT_INVERTER_TYPES,
  DEFAULT_METER_BRANDS,
  DEFAULT_PANEL_BRANDS,
  DEFAULT_PANEL_SIZES,
  DEFAULT_STRUCTURE_TYPES,
  normalizePanelSizeLabel
} from './defaultProductCatalog';

/** Catalog-safe aliases when DB still has legacy sizes. */
export const panelSizeVariants = (value: unknown): string[] => {
  const size = normalizePanelSizeLabel(value);
  if (!size) return [];
  if (size === '550W') return ['550W', '545W', '555W'];
  if (size === '555W') return ['555W', '550W', '545W'];
  if (size === '545W') return ['545W', '550W', '555W'];
  return [size];
};

/** Always allow June 2026 default brands (e.g. INA) even if DB catalog is stale. */
export const isAllowedPanelBrandForCatalog = (
  brand: string | null | undefined,
  catalogBrands: string[] | undefined
): boolean => {
  const normalized = String(brand || '').trim();
  if (!normalized) return true;
  const inDefaults = (DEFAULT_PANEL_BRANDS as readonly string[]).some(
    (b) => b.toLowerCase() === normalized.toLowerCase()
  );
  if (inDefaults) return true;
  if (!catalogBrands?.length) return true;
  return catalogBrands.includes(normalized);
};

export const isPanelSizeAllowed = (selectedSize: unknown, catalogSizes: unknown): boolean => {
  const selected = panelSizeVariants(selectedSize);
  if (selected.length === 0) return true;
  const allowed = new Set(
    (Array.isArray(catalogSizes) ? catalogSizes : [])
      .map((v) => normalizePanelSizeLabel(v))
      .filter(Boolean)
  );
  if (allowed.size === 0) {
    return selected.some((candidate) =>
      (DEFAULT_PANEL_SIZES as readonly string[]).includes(candidate)
    );
  }
  return selected.some((candidate) => allowed.has(candidate));
};

/** Ensures DCR panel sizes + combined brands exist even when system_config is stale. */
export const normalizeProductCatalog = (catalog: any): any => {
  const rawPanelSizes = Array.isArray(catalog?.panels?.sizes) ? catalog.panels.sizes : [];
  const normalizedPanelSizes = mergeUniqueStrings(
    rawPanelSizes.map(normalizePanelSizeLabel),
    DEFAULT_PANEL_SIZES
  );

  return {
    panels: {
      brands: mergeUniqueStrings(catalog?.panels?.brands, DEFAULT_PANEL_BRANDS),
      sizes: normalizedPanelSizes
    },
    inverters: {
      types: mergeUniqueStrings(catalog?.inverters?.types, DEFAULT_INVERTER_TYPES),
      brands: mergeUniqueStrings(catalog?.inverters?.brands, DEFAULT_INVERTER_BRANDS),
      sizes: Array.isArray(catalog?.inverters?.sizes) ? catalog.inverters.sizes : []
    },
    structures: {
      types: mergeUniqueStrings(catalog?.structures?.types, DEFAULT_STRUCTURE_TYPES),
      sizes: Array.isArray(catalog?.structures?.sizes) ? catalog.structures.sizes : []
    },
    meters: {
      brands: mergeUniqueStrings(catalog?.meters?.brands, DEFAULT_METER_BRANDS)
    },
    cables: {
      brands: mergeUniqueStrings(catalog?.cables?.brands, DEFAULT_CABLE_BRANDS),
      sizes: mergeUniqueStrings(catalog?.cables?.sizes, DEFAULT_CABLE_SIZES)
    },
    acdb: {
      options: mergeUniqueStrings(catalog?.acdb?.options, DEFAULT_ACDB_OPTIONS)
    },
    dcdb: {
      options: mergeUniqueStrings(catalog?.dcdb?.options, DEFAULT_DCDB_OPTIONS)
    }
  };
};

function mergeUniqueStrings(primary: unknown, extras: readonly string[]): string[] {
  const out = new Set<string>();
  if (Array.isArray(primary)) {
    for (const item of primary) {
      const s = String(item || '').trim();
      if (s) out.add(s);
    }
  }
  for (const item of extras) out.add(item);
  return Array.from(out);
}
