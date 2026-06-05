function toPlainRow(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  if (typeof (value as { toJSON?: () => unknown }).toJSON === 'function') {
    return (value as { toJSON: () => unknown }).toJSON() as Record<string, unknown>;
  }
  if (typeof (value as { get?: (opts: { plain: true }) => unknown }).get === 'function') {
    return (value as { get: (opts: { plain: true }) => unknown }).get({ plain: true }) as Record<
      string,
      unknown
    >;
  }
  return value as Record<string, unknown>;
}

/** Parse panel wattage from values like "610W", "610 W", "610", or range "540W-620W" (average). */
export function parsePanelWatts(size: unknown): number {
  if (size == null || size === '') return 0;
  const s = String(size).trim().toLowerCase();
  const rangeMatch = s.match(/(\d+(?:\.\d+)?)\s*w?\s*[-–—]\s*(\d+(?:\.\d+)?)\s*w?/);
  if (rangeMatch) {
    const low = Number(rangeMatch[1]);
    const high = Number(rangeMatch[2]);
    if (Number.isFinite(low) && Number.isFinite(high) && low > 0 && high > 0) {
      return (low + high) / 2;
    }
  }
  const withUnit = s.match(/(\d+(?:\.\d+)?)\s*w\b/);
  if (withUnit) return Number(withUnit[1]);
  const numeric = s.match(/^(\d+(?:\.\d+)?)$/);
  if (numeric) return Number(numeric[1]);
  const fallback = s.match(/(\d+(?:\.\d+)?)/);
  return fallback ? Number(fallback[1]) : 0;
}

/** Parse kW from inverter/structure strings like "5kW" or "5 kW". */
export function parseKwFromSizeString(value: unknown): number {
  if (value == null || value === '') return 0;
  const s = String(value).trim().toLowerCase();
  const match = s.match(/(\d+(?:\.\d+)?)\s*k?w\b/);
  if (match) return Number(match[1]);
  const n = Number(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function panelLineKw(panelSize: unknown, panelQuantity: unknown): number {
  const watts = parsePanelWatts(panelSize);
  const qty = Number(panelQuantity);
  if (!watts || !Number.isFinite(qty) || qty <= 0) return 0;
  return (watts * qty) / 1000;
}

function normalizeSystemType(
  products: Record<string, unknown> | null | undefined,
  quotationSystemType?: string | null
): string {
  const raw = products?.systemType ?? products?.system_type ?? quotationSystemType ?? '';
  return String(raw).trim().toLowerCase();
}

/**
 * Compute installed system kW from quotation product fields (matches frontend admin overview rules).
 */
export function computeSystemKwFromProducts(
  products: Record<string, unknown> | null | undefined,
  customPanels?: unknown[] | null,
  quotationSystemType?: string | null
): number {
  const plainProducts = products ? toPlainRow(products) : null;
  const panels = customPanels ?? plainProducts?.customPanels ?? plainProducts?.custom_panels;
  const systemType = normalizeSystemType(plainProducts, quotationSystemType);

  if (!plainProducts && (!panels || !Array.isArray(panels) || panels.length === 0)) {
    return 0;
  }

  const p = plainProducts || {};
  let kw = 0;

  if (systemType === 'both') {
    kw =
      panelLineKw(p.dcrPanelSize ?? p.dcr_panel_size, p.dcrPanelQuantity ?? p.dcr_panel_quantity) +
      panelLineKw(
        p.nonDcrPanelSize ?? p.non_dcr_panel_size,
        p.nonDcrPanelQuantity ?? p.non_dcr_panel_quantity
      );
  } else if (systemType === 'customize') {
    const rows = Array.isArray(panels) ? panels : [];
    for (const cp of rows) {
      const row = toPlainRow(cp);
      kw += panelLineKw(row.size ?? row.panelSize ?? row.panel_size, row.quantity ?? row.panelQuantity ?? row.panel_quantity);
    }
  } else {
    kw = panelLineKw(p.panelSize ?? p.panel_size, p.panelQuantity ?? p.panel_quantity);
    if (kw === 0 && systemType === 'dcr') {
      kw = panelLineKw(p.dcrPanelSize ?? p.dcr_panel_size, p.dcrPanelQuantity ?? p.dcr_panel_quantity);
    }
    if (kw === 0 && systemType === 'non-dcr') {
      kw = panelLineKw(
        p.nonDcrPanelSize ?? p.non_dcr_panel_size,
        p.nonDcrPanelQuantity ?? p.non_dcr_panel_quantity
      );
    }
  }

  if (kw === 0) {
    kw =
      parseKwFromSizeString(p.inverterSize ?? p.inverter_size) ||
      parseKwFromSizeString(p.structureSize ?? p.structure_size);
  }

  return Math.round(kw * 100) / 100;
}

export function formatSystemSizeKw(kw: number): string | null {
  if (!Number.isFinite(kw) || kw <= 0) return null;
  return `${kw}kW`;
}
