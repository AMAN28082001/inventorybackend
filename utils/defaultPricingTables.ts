/**
 * Fallback DCR / Non-DCR / BOTH rows when DB `pricing_tables` is empty.
 * Prefer Aug 2026 FE seed (`utils/pricingTablesSeed.ts` / BACKEND_PRICING_TABLES_SEED.json).
 * Admin PUT /api/quotations/pricing-tables (and /api/config/pricing) is authoritative once stored.
 */

import { loadPricingTablesSeed, PRICING_TABLES_META } from './pricingTablesSeed';

export const JUNE_2026_PRICING_META = {
  effectiveFrom: PRICING_TABLES_META.effectiveFrom,
  effectiveTo: PRICING_TABLES_META.validTill
} as const;

export const JUNE_2026_DCR_PRICING_DEFAULTS = [
  {
    systemSize: '3kW',
    phase: '1-Phase' as const,
    inverterSize: '3kW',
    panelType: 'Adani 555W',
    price: 185000
  },
  {
    systemSize: '4kW',
    phase: '1-Phase' as const,
    inverterSize: '4kW',
    panelType: 'Adani 555W',
    price: 215000
  },
  {
    systemSize: '5kW',
    phase: '1-Phase' as const,
    inverterSize: '5kW',
    panelType: 'Adani 555W',
    price: 222000
  },
  {
    systemSize: '3kW',
    phase: '1-Phase' as const,
    inverterSize: '3kW',
    panelType: 'Adani Topcon 620W',
    price: 195000
  },
  {
    systemSize: '5kW',
    phase: '1-Phase' as const,
    inverterSize: '5kW',
    panelType: 'Adani Topcon 620W',
    price: 290000
  },
  {
    systemSize: '3kW',
    phase: '1-Phase' as const,
    inverterSize: '3kW',
    panelType: 'Waaree 540W',
    price: 180000
  },
  {
    systemSize: '5kW',
    phase: '1-Phase' as const,
    inverterSize: '5kW',
    panelType: 'Waaree 540W',
    price: 265000
  },
  {
    systemSize: '3kW',
    phase: '1-Phase' as const,
    inverterSize: '3kW',
    panelType: 'Premier Energies',
    price: 182000
  },
  {
    systemSize: '5kW',
    phase: '1-Phase' as const,
    inverterSize: '5kW',
    panelType: 'Premier Energies',
    price: 268000
  },
  {
    systemSize: '3kW',
    phase: '1-Phase' as const,
    inverterSize: '3kW',
    panelType: 'INA',
    price: 182000
  },
  {
    systemSize: '5kW',
    phase: '1-Phase' as const,
    inverterSize: '5kW',
    panelType: 'INA',
    price: 268000
  },
  {
    systemSize: '4kW',
    phase: '1-Phase' as const,
    inverterSize: '4kW',
    panelType: 'INA',
    price: 215000
  },
  {
    systemSize: '3.1kW',
    phase: '1-Phase' as const,
    inverterSize: '3kW',
    panelType: 'Tata DCR',
    price: 240000
  },
  {
    systemSize: '5.1kW',
    phase: '1-Phase' as const,
    inverterSize: '5kW',
    panelType: 'Tata DCR',
    price: 310000
  },
  {
    systemSize: '6kW',
    phase: '1-Phase' as const,
    inverterSize: '6kW',
    panelType: 'Tata DCR',
    price: 335000
  },
  {
    systemSize: '8kW',
    phase: '1-Phase' as const,
    inverterSize: '8kW',
    panelType: 'Tata DCR',
    price: 410000
  },
  {
    systemSize: '10kW',
    phase: '1-Phase' as const,
    inverterSize: '10kW',
    panelType: 'Tata DCR',
    price: 485000
  },
  /** Crompton DCR set — Premier Energy 600–610W + Crompton 3.6kW (§27) */
  {
    systemSize: '3kW',
    phase: '1-Phase' as const,
    inverterSize: '3.6kW',
    panelType: 'Crompton set',
    price: 210000
  },
  {
    systemSize: '5kW',
    phase: '1-Phase' as const,
    inverterSize: '3.6kW',
    panelType: 'Crompton set',
    price: 295000
  }
];

/** Non-DCR system pricing defaults (no central subsidy on frontend). */
export const JUNE_2026_NON_DCR_PRICING_DEFAULTS = [
  {
    systemSize: '3kW',
    phase: '1-Phase' as const,
    inverterSize: '3kW',
    panelType: 'Adani 555W',
    price: 200000
  },
  {
    systemSize: '5kW',
    phase: '1-Phase' as const,
    inverterSize: '5kW',
    panelType: 'Adani 555W',
    price: 245000
  },
  {
    systemSize: '3kW',
    phase: '1-Phase' as const,
    inverterSize: '3kW',
    panelType: 'Waaree 540W',
    price: 195000
  },
  {
    systemSize: '5kW',
    phase: '1-Phase' as const,
    inverterSize: '5kW',
    panelType: 'Waaree 540W',
    price: 280000
  },
  /** Non-DCR 80kW set — Renew Energy / Waaree / Adani (Vsole/Xwatt) — Jul 2026 */
  {
    systemSize: '80kW',
    phase: '3-Phase' as const,
    inverterSize: '80kW',
    panelType: 'Renew Energy',
    price: 2510000
  },
  {
    systemSize: '80kW',
    phase: '3-Phase' as const,
    inverterSize: '80kW',
    panelType: 'Waaree',
    price: 2590000
  },
  {
    systemSize: '80kW',
    phase: '3-Phase' as const,
    inverterSize: '80kW',
    panelType: 'Adani',
    price: 2590000
  }
];

/** BOTH (DCR + non-DCR split) pricing defaults. */
export const JUNE_2026_BOTH_PRICING_DEFAULTS = [
  {
    systemSize: '5kW',
    phase: '1-Phase' as const,
    inverterSize: '5kW',
    dcrCapacity: '3kW',
    nonDcrCapacity: '2kW',
    panelType: 'Adani 555W',
    price: 260000
  },
  {
    systemSize: '6kW',
    phase: '1-Phase' as const,
    inverterSize: '6kW',
    dcrCapacity: '3kW',
    nonDcrCapacity: '3kW',
    panelType: 'Adani 555W',
    price: 295000
  },
  {
    systemSize: '5kW',
    phase: '3-Phase' as const,
    inverterSize: '5kW',
    dcrCapacity: '3kW',
    nonDcrCapacity: '2kW',
    panelType: 'Adani 555W',
    price: 270000
  }
];

export const JUNE_2026_SYSTEM_CONFIG_DEFAULTS = [
  {
    systemType: 'dcr' as const,
    systemSize: '3kW',
    phase: '1-Phase' as const,
    panelBrand: 'Adani',
    panelSize: '555W',
    inverterBrand: 'Vsole/Xwatt',
    inverterSize: '3kW',
    inverterType: 'String Inverter',
    structureType: 'GI Structure',
    structureSize: '3kW',
    meterBrand: 'L&T',
    acCableBrand: 'Polycab',
    acCableSize: 'As per Set',
    dcCableBrand: 'Polycab',
    dcCableSize: 'As per Set',
    acdb: 'Havells (1-Phase)',
    dcdb: 'Havells (1-Phase)'
  },
  {
    systemType: 'dcr' as const,
    systemSize: '5kW',
    phase: '1-Phase' as const,
    panelBrand: 'Adani',
    panelSize: '555W',
    inverterBrand: 'Vsole/Xwatt',
    inverterSize: '5kW',
    inverterType: 'String Inverter',
    structureType: 'GI Structure',
    structureSize: '5kW',
    meterBrand: 'L&T',
    acCableBrand: 'Polycab',
    acCableSize: 'As per Set',
    dcCableBrand: 'Polycab',
    dcCableSize: 'As per Set',
    acdb: 'Havells (1-Phase)',
    dcdb: 'Havells (1-Phase)'
  },
  {
    systemType: 'non-dcr' as const,
    systemSize: '5kW',
    phase: '1-Phase' as const,
    panelBrand: 'Adani',
    panelSize: '555W',
    inverterBrand: 'Vsole/Xwatt',
    inverterSize: '5kW',
    inverterType: 'String Inverter',
    structureType: 'GI Structure',
    structureSize: '5kW',
    meterBrand: 'L&T',
    acCableBrand: 'Polycab',
    acCableSize: 'As per Set',
    dcCableBrand: 'Polycab',
    dcCableSize: 'As per Set',
    acdb: 'Havells (1-Phase)',
    dcdb: 'Havells (1-Phase)'
  },
  {
    systemType: 'both' as const,
    systemSize: '5kW',
    phase: '1-Phase' as const,
    panelBrand: 'Adani',
    panelSize: '555W',
    inverterBrand: 'Vsole/Xwatt',
    inverterSize: '5kW',
    inverterType: 'String Inverter',
    structureType: 'GI Structure',
    structureSize: '5kW',
    meterBrand: 'L&T',
    acCableBrand: 'Polycab',
    acCableSize: 'As per Set',
    dcCableBrand: 'Polycab',
    dcCableSize: 'As per Set',
    acdb: 'Havells (1-Phase)',
    dcdb: 'Havells (1-Phase)'
  },
  {
    systemType: 'dcr' as const,
    systemSize: '3kW',
    phase: '1-Phase' as const,
    panelBrand: 'Waaree',
    panelSize: '540W',
    inverterBrand: 'Vsole/Xwatt',
    inverterSize: '3kW',
    inverterType: 'String Inverter',
    structureType: 'GI Structure',
    structureSize: '3kW',
    meterBrand: 'L&T',
    acCableBrand: 'Polycab',
    acCableSize: 'As per Set',
    dcCableBrand: 'Polycab',
    dcCableSize: 'As per Set',
    acdb: 'Havells (1-Phase)',
    dcdb: 'Havells (1-Phase)'
  },
  {
    systemType: 'dcr' as const,
    systemSize: '5kW',
    phase: '1-Phase' as const,
    panelBrand: 'Adani',
    panelSize: '620W',
    inverterBrand: 'Vsole/Xwatt',
    inverterSize: '5kW',
    inverterType: 'String Inverter',
    structureType: 'GI Structure',
    structureSize: '5kW',
    meterBrand: 'L&T',
    acCableBrand: 'Polycab',
    acCableSize: 'As per Set',
    dcCableBrand: 'Polycab',
    dcCableSize: 'As per Set',
    acdb: 'Havells (1-Phase)',
    dcdb: 'Havells (1-Phase)'
  },
  {
    systemType: 'dcr' as const,
    systemSize: '5kW',
    phase: '1-Phase' as const,
    panelBrand: 'Premier Energies',
    panelSize: '610W',
    inverterBrand: 'Vsole/Xwatt',
    inverterSize: '5kW',
    inverterType: 'String Inverter',
    structureType: 'GI Structure',
    structureSize: '5kW',
    meterBrand: 'L&T',
    acCableBrand: 'Polycab',
    acCableSize: 'As per Set',
    dcCableBrand: 'Polycab',
    dcCableSize: 'As per Set',
    acdb: 'Havells (1-Phase)',
    dcdb: 'Havells (1-Phase)'
  },
  {
    systemType: 'dcr' as const,
    systemSize: '3kW',
    phase: '1-Phase' as const,
    panelBrand: 'INA',
    panelSize: '500W',
    inverterBrand: 'Vsole/Xwatt',
    inverterSize: '3kW',
    inverterType: 'String Inverter',
    structureType: 'GI Structure',
    structureSize: '3kW',
    meterBrand: 'L&T',
    acCableBrand: 'Polycab',
    acCableSize: 'As per Set',
    dcCableBrand: 'Polycab',
    dcCableSize: 'As per Set',
    acdb: 'Havells (1-Phase)',
    dcdb: 'Havells (1-Phase)'
  },
  {
    systemType: 'non-dcr' as const,
    systemSize: '80kW',
    phase: '3-Phase' as const,
    panelBrand: 'Renew Energy',
    panelSize: '600W',
    inverterBrand: 'Vsole/Xwatt',
    inverterSize: '80kW',
    inverterType: 'String Inverter',
    structureType: 'GI Structure',
    structureSize: '80kW',
    meterBrand: 'L&T',
    acCableBrand: 'Polycab',
    acCableSize: 'As per Set',
    dcCableBrand: 'Polycab',
    dcCableSize: 'As per Set',
    acdb: 'Havells (3-Phase)',
    dcdb: 'Havells (3-Phase)'
  },
  {
    systemType: 'non-dcr' as const,
    systemSize: '80kW',
    phase: '3-Phase' as const,
    panelBrand: 'Waaree',
    panelSize: '580W',
    inverterBrand: 'Vsole/Xwatt',
    inverterSize: '80kW',
    inverterType: 'String Inverter',
    structureType: 'GI Structure',
    structureSize: '80kW',
    meterBrand: 'L&T',
    acCableBrand: 'Polycab',
    acCableSize: 'As per Set',
    dcCableBrand: 'Polycab',
    dcCableSize: 'As per Set',
    acdb: 'Havells (3-Phase)',
    dcdb: 'Havells (3-Phase)'
  },
  {
    systemType: 'non-dcr' as const,
    systemSize: '80kW',
    phase: '3-Phase' as const,
    panelBrand: 'Adani',
    panelSize: '600W',
    inverterBrand: 'Vsole/Xwatt',
    inverterSize: '80kW',
    inverterType: 'String Inverter',
    structureType: 'GI Structure',
    structureSize: '80kW',
    meterBrand: 'L&T',
    acCableBrand: 'Polycab',
    acCableSize: 'As per Set',
    dcCableBrand: 'Polycab',
    dcCableSize: 'As per Set',
    acdb: 'Havells (3-Phase)',
    dcdb: 'Havells (3-Phase)'
  },
  {
    systemType: 'dcr' as const,
    systemSize: '5kW',
    phase: '1-Phase' as const,
    panelBrand: 'INA',
    panelSize: '500W',
    inverterBrand: 'Vsole/Xwatt',
    inverterSize: '5kW',
    inverterType: 'String Inverter',
    structureType: 'GI Structure',
    structureSize: '5kW',
    meterBrand: 'L&T',
    acCableBrand: 'Polycab',
    acCableSize: 'As per Set',
    dcCableBrand: 'Polycab',
    dcCableSize: 'As per Set',
    acdb: 'Havells (1-Phase)',
    dcdb: 'Havells (1-Phase)'
  },
  {
    systemType: 'dcr' as const,
    systemSize: '4kW',
    phase: '1-Phase' as const,
    panelBrand: 'INA',
    panelSize: '560W',
    inverterBrand: 'Vsole/Xwatt',
    inverterSize: '4kW',
    inverterType: 'String Inverter',
    structureType: 'GI Structure',
    structureSize: '4kW',
    meterBrand: 'L&T',
    acCableBrand: 'Polycab',
    acCableSize: 'As per Set',
    dcCableBrand: 'Polycab',
    dcCableSize: 'As per Set',
    acdb: 'Havells (1-Phase)',
    dcdb: 'Havells (1-Phase)'
  },
  {
    systemType: 'dcr' as const,
    systemSize: '5.1kW',
    phase: '1-Phase' as const,
    panelBrand: 'Tata',
    panelSize: '530W',
    inverterBrand: 'Vsole/Xwatt',
    inverterSize: '5kW',
    inverterType: 'String Inverter',
    structureType: 'GI Structure',
    structureSize: '5kW',
    meterBrand: 'L&T',
    acCableBrand: 'Polycab',
    acCableSize: 'As per Set',
    dcCableBrand: 'Polycab',
    dcCableSize: 'As per Set',
    acdb: 'Havells (1-Phase)',
    dcdb: 'Havells (1-Phase)'
  },
  /** Crompton DCR set (§27) */
  {
    systemType: 'dcr' as const,
    systemSize: '3kW',
    phase: '1-Phase' as const,
    panelBrand: 'Crompton set',
    panelSize: '610W',
    inverterBrand: 'Crompton',
    inverterSize: '3.6kW',
    inverterType: 'String Inverter',
    structureType: 'GI Structure',
    structureSize: '3kW',
    meterBrand: 'L&T',
    acCableBrand: 'Polycab',
    acCableSize: 'As per Set',
    dcCableBrand: 'Polycab',
    dcCableSize: 'As per Set',
    acdb: 'Crompton (1-Phase)',
    dcdb: 'Crompton (1-Phase)'
  },
  {
    systemType: 'dcr' as const,
    systemSize: '5kW',
    phase: '1-Phase' as const,
    panelBrand: 'Crompton set',
    panelSize: '610W',
    inverterBrand: 'Crompton',
    inverterSize: '3.6kW',
    inverterType: 'String Inverter',
    structureType: 'GI Structure',
    structureSize: '5kW',
    meterBrand: 'L&T',
    acCableBrand: 'Polycab',
    acCableSize: 'As per Set',
    dcCableBrand: 'Polycab',
    dcCableSize: 'As per Set',
    acdb: 'Crompton (1-Phase)',
    dcdb: 'Crompton (1-Phase)'
  }
];

type DcrRow = (typeof JUNE_2026_DCR_PRICING_DEFAULTS)[number];
type NonDcrRow = (typeof JUNE_2026_NON_DCR_PRICING_DEFAULTS)[number];
type BothRow = (typeof JUNE_2026_BOTH_PRICING_DEFAULTS)[number];
type SystemConfigRow = (typeof JUNE_2026_SYSTEM_CONFIG_DEFAULTS)[number];

/** Map stored DCR row panelType → matrix column key (Aug 2026 dealer matrix). */
const DCR_PANEL_TYPE_MATRIX_COLUMN: Record<
  string,
  'adani' | 'adaniTopcon' | 'waaree' | 'waareeTopcon' | 'premierTopcon' | 'ina' | 'tata' | 'cromptonSet'
> = {
  Adani: 'adani',
  'Adani 555W': 'adani',
  'Adani Topcon': 'adaniTopcon',
  'Adani Topcon 620W': 'adaniTopcon',
  Waaree: 'waaree',
  'Waaree 540W': 'waaree',
  'Waaree Topcon': 'waareeTopcon',
  'Premier Energies': 'premierTopcon',
  INA: 'ina',
  'INA 500W': 'ina',
  Tata: 'tata',
  'Tata DCR': 'tata',
  'Crompton set': 'cromptonSet'
};

export type DcrPricingMatrixRow = {
  systemSize: string;
  phase: string;
  adani?: number;
  adaniTopcon?: number;
  waaree?: number;
  waareeTopcon?: number;
  premierTopcon?: number;
  ina?: number;
  tata?: number;
  cromptonSet?: number;
};

/** Pivot flat `dcr` rows into brand-column matrix for frontend pricing UI. */
export function buildDcrPricingMatrix(dcrRows: DcrRow[]): DcrPricingMatrixRow[] {
  const byKey = new Map<string, DcrPricingMatrixRow>();
  for (const row of dcrRows) {
    if (!row?.systemSize || !row?.phase || !row?.panelType) continue;
    const key = `${row.systemSize}|${row.phase}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { systemSize: row.systemSize, phase: row.phase };
      byKey.set(key, entry);
    }
    const col = DCR_PANEL_TYPE_MATRIX_COLUMN[row.panelType];
    if (col) entry[col] = row.price;
  }
  return Array.from(byKey.values());
}

/**
 * DB / Admin PUT wins. When key is an array (including empty after Delete→Save), keep it.
 * Seed only when the key is missing (null/undefined) — never refill emptied tables.
 */
export function mergeDefaultDcrPricing(stored: unknown): DcrRow[] {
  if (Array.isArray(stored)) {
    return stored.filter(
      (row): row is DcrRow =>
        !!row &&
        typeof row === 'object' &&
        !!(row as DcrRow).systemSize &&
        !!(row as DcrRow).phase &&
        !!(row as DcrRow).panelType
    );
  }
  try {
    return loadPricingTablesSeed().dcr as DcrRow[];
  } catch {
    return [...JUNE_2026_DCR_PRICING_DEFAULTS];
  }
}

export function mergeDefaultNonDcrPricing(stored: unknown): NonDcrRow[] {
  if (Array.isArray(stored)) {
    return stored.filter(
      (row): row is NonDcrRow =>
        !!row &&
        typeof row === 'object' &&
        !!(row as NonDcrRow).systemSize &&
        !!(row as NonDcrRow).phase &&
        !!(row as NonDcrRow).panelType
    );
  }
  try {
    return loadPricingTablesSeed().nonDcr as NonDcrRow[];
  } catch {
    return [...JUNE_2026_NON_DCR_PRICING_DEFAULTS];
  }
}

export function mergeDefaultBothPricing(stored: unknown): BothRow[] {
  if (Array.isArray(stored)) {
    return stored.filter(
      (row): row is BothRow =>
        !!row &&
        typeof row === 'object' &&
        !!(row as BothRow).systemSize &&
        !!(row as BothRow).phase &&
        !!(row as BothRow).panelType
    );
  }
  try {
    return loadPricingTablesSeed().both as BothRow[];
  } catch {
    return [...JUNE_2026_BOTH_PRICING_DEFAULTS];
  }
}

export function mergeDefaultSystemConfigs(stored: unknown): SystemConfigRow[] {
  if (Array.isArray(stored)) {
    return stored.filter(
      (row): row is SystemConfigRow =>
        !!row &&
        typeof row === 'object' &&
        !!(row as SystemConfigRow).systemType &&
        !!(row as SystemConfigRow).systemSize &&
        !!(row as SystemConfigRow).panelBrand
    );
  }
  try {
    return loadPricingTablesSeed().systemConfigs as SystemConfigRow[];
  } catch {
    return [...JUNE_2026_SYSTEM_CONFIG_DEFAULTS];
  }
}
