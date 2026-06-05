import {
  DEFAULT_CABLE_SIZES,
  DEFAULT_INVERTER_BRANDS,
  DEFAULT_INVERTER_TYPES,
  DEFAULT_METER_BRANDS,
  DEFAULT_PANEL_BRANDS,
  DEFAULT_PANEL_SIZES,
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
      types: Array.isArray(catalog?.structures?.types) ? catalog.structures.types : [],
      sizes: []
    },
    meters: {
      brands: mergeUniqueStrings(catalog?.meters?.brands, DEFAULT_METER_BRANDS)
    },
    cables: {
      brands: Array.isArray(catalog?.cables?.brands) ? catalog.cables.brands : [],
      sizes: mergeUniqueStrings(catalog?.cables?.sizes, DEFAULT_CABLE_SIZES)
    },
    acdb: {
      options: Array.isArray(catalog?.acdb?.options) ? catalog.acdb.options : []
    },
    dcdb: {
      options: Array.isArray(catalog?.dcdb?.options) ? catalog.dcdb.options : []
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
