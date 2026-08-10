/**
 * Aug 2026 pricing-tables seed loader + normalize (FE catalog snapshot).
 * Payload: `BACKEND_PRICING_TABLES_SEED.json` at repo root.
 */
import fs from 'fs';
import path from 'path';

export const PRICING_TABLES_META = {
  source: 'lib/pricing-tables.ts',
  effectiveFrom: '2026-08-04',
  validTill: '2026-08-31',
  panelTypes: [
    'Adani',
    'Adani Topcon',
    'Waaree',
    'Waaree Topcon',
    'Premier Energies',
    'INA',
    'Tata',
    'Crompton set'
  ] as const
} as const;

export type SystemPricingRow = {
  systemSize: string;
  phase: string;
  inverterSize: string;
  panelType: string;
  price: number;
  notes?: string;
};

export type BothPricingRow = {
  systemSize: string;
  phase: string;
  inverterSize: string;
  dcrCapacity: string;
  nonDcrCapacity: string;
  panelType: string;
  price: number;
};

export type PricingTablesPayload = {
  dcr: SystemPricingRow[];
  nonDcr: SystemPricingRow[];
  both: BothPricingRow[];
  panels: unknown[];
  inverters: unknown[];
  structures: unknown[];
  meters: unknown[];
  cables: unknown[];
  acdb: unknown[];
  dcdb: unknown[];
  systemConfigs: unknown[];
  meta?: {
    effectiveFrom?: string;
    validTill?: string;
    panelTypes?: string[];
  };
};

const asArray = (v: unknown) => (Array.isArray(v) ? v : []);

/** Normalize FE body / seed JSON into GET `data`. */
export function normalizePricingTablesPayload(raw: unknown): PricingTablesPayload {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const body =
    src.data && typeof src.data === 'object' ? (src.data as Record<string, unknown>) : src;
  const metaObj = (body.meta && typeof body.meta === 'object' ? body.meta : {}) as Record<
    string,
    unknown
  >;

  return {
    dcr: asArray(body.dcr) as SystemPricingRow[],
    nonDcr: asArray(body.nonDcr) as SystemPricingRow[],
    both: asArray(body.both) as BothPricingRow[],
    panels: asArray(body.panels),
    inverters: asArray(body.inverters),
    structures: asArray(body.structures),
    meters: asArray(body.meters),
    cables: asArray(body.cables),
    acdb: asArray(body.acdb),
    dcdb: asArray(body.dcdb),
    systemConfigs: asArray(body.systemConfigs ?? body.systemConfigurations),
    meta: {
      effectiveFrom:
        (typeof metaObj.effectiveFrom === 'string' && metaObj.effectiveFrom) ||
        (typeof body.effectiveFrom === 'string' && body.effectiveFrom) ||
        PRICING_TABLES_META.effectiveFrom,
      validTill:
        (typeof metaObj.validTill === 'string' && metaObj.validTill) ||
        (typeof body.validTill === 'string' && body.validTill) ||
        (typeof body.effectiveTo === 'string' && body.effectiveTo) ||
        PRICING_TABLES_META.validTill,
      panelTypes: [...PRICING_TABLES_META.panelTypes]
    }
  };
}

/** Merge PUT body onto existing (replace only keys sent as arrays). */
export function mergePricingTablesPayload(
  existing: PricingTablesPayload,
  patch: unknown
): PricingTablesPayload {
  const keys = [
    'dcr',
    'nonDcr',
    'both',
    'panels',
    'inverters',
    'structures',
    'meters',
    'cables',
    'acdb',
    'dcdb',
    'systemConfigs'
  ] as const;
  const out: PricingTablesPayload = { ...existing, systemConfigs: [...existing.systemConfigs] };
  const patchObj = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(patchObj[key])) {
      (out as Record<string, unknown>)[key] = patchObj[key];
    }
  }
  if (patchObj.systemConfigurations && !Array.isArray(patchObj.systemConfigs)) {
    if (Array.isArray(patchObj.systemConfigurations)) {
      out.systemConfigs = patchObj.systemConfigurations;
    }
  }
  const next = normalizePricingTablesPayload(patch);
  if (next.meta) out.meta = { ...existing.meta, ...next.meta };
  return normalizePricingTablesPayload(out);
}

let cached: PricingTablesPayload | null = null;

export function pricingTablesSeedJsonPath(): string {
  return path.join(__dirname, '..', 'BACKEND_PRICING_TABLES_SEED.json');
}

export function loadPricingTablesSeed(): PricingTablesPayload {
  if (cached) return cached;
  const raw = JSON.parse(fs.readFileSync(pricingTablesSeedJsonPath(), 'utf8'));
  cached = normalizePricingTablesPayload(raw);
  return cached;
}

export function clearPricingTablesSeedCache(): void {
  cached = null;
}

export const DCR_AUG_2026_SPOT_CHECKS: ReadonlyArray<{
  systemSize: string;
  phase: '1-Phase' | '3-Phase';
  panelType: string;
  price: number;
}> = [
  { systemSize: '3kW', phase: '1-Phase', panelType: 'Adani', price: 186_000 },
  { systemSize: '3kW', phase: '1-Phase', panelType: 'Adani Topcon', price: 190_000 },
  { systemSize: '3kW', phase: '1-Phase', panelType: 'Waaree', price: 185_000 },
  { systemSize: '3kW', phase: '1-Phase', panelType: 'Waaree Topcon', price: 190_000 },
  { systemSize: '5kW', phase: '1-Phase', panelType: 'Waaree Topcon', price: 280_000 },
  { systemSize: '10kW', phase: '3-Phase', panelType: 'Adani', price: 499_000 },
  { systemSize: '10kW', phase: '3-Phase', panelType: 'Waaree Topcon', price: 515_000 },
  { systemSize: '15kW', phase: '3-Phase', panelType: 'Waaree', price: 680_000 },
  { systemSize: '15kW', phase: '3-Phase', panelType: 'Waaree Topcon', price: 740_000 },
  { systemSize: '3kW', phase: '1-Phase', panelType: 'Crompton set', price: 210_000 },
  { systemSize: '5kW', phase: '1-Phase', panelType: 'Crompton set', price: 295_000 }
];

export function assertAug2026DcrSeed(dcr: SystemPricingRow[]): string[] {
  const errors: string[] = [];
  for (const expect of DCR_AUG_2026_SPOT_CHECKS) {
    const row = dcr.find(
      (r) =>
        r.systemSize === expect.systemSize &&
        r.phase === expect.phase &&
        r.panelType === expect.panelType
    );
    if (!row) {
      errors.push(`Missing DCR row ${expect.panelType} ${expect.systemSize} ${expect.phase}`);
      continue;
    }
    if (Number(row.price) !== expect.price) {
      errors.push(
        `Price mismatch ${expect.panelType} ${expect.systemSize} ${expect.phase}: got ${row.price}, want ${expect.price}`
      );
    }
  }
  if (!dcr.some((r) => r.panelType === 'Waaree Topcon')) {
    errors.push('Missing panelType "Waaree Topcon" (610W set)');
  }
  return errors;
}
