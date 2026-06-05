/**
 * Default DCR system pricing rows (June 2026 matrix) when DB config is empty or stale.
 * Admin can override via PUT /api/config/pricing; API merge keeps these rows authoritative.
 */

export const JUNE_2026_PRICING_META = {
  effectiveFrom: '2026-06-03',
  effectiveTo: '2026-06-30'
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
  }
];

type DcrRow = (typeof JUNE_2026_DCR_PRICING_DEFAULTS)[number];
type SystemConfigRow = (typeof JUNE_2026_SYSTEM_CONFIG_DEFAULTS)[number];

const dcrRowKey = (row: { systemSize: string; phase: string; panelType: string }) =>
  `${row.systemSize}|${row.phase}|${row.panelType}`;

const systemConfigKey = (row: {
  systemType: string;
  systemSize: string;
  panelBrand: string;
}) => `${row.systemType}|${row.systemSize}|${row.panelBrand}`;

/** June 2026 DCR rows override stale stored rows with the same key. */
export function mergeDefaultDcrPricing(stored: unknown): DcrRow[] {
  if (!Array.isArray(stored) || stored.length === 0) {
    return [...JUNE_2026_DCR_PRICING_DEFAULTS];
  }
  const map = new Map<string, DcrRow>();
  for (const row of stored) {
    if (!row || typeof row !== 'object') continue;
    const typed = row as DcrRow;
    if (!typed.systemSize || !typed.phase || !typed.panelType) continue;
    map.set(dcrRowKey(typed), typed);
  }
  for (const row of JUNE_2026_DCR_PRICING_DEFAULTS) {
    map.set(dcrRowKey(row), row);
  }
  return Array.from(map.values());
}

export function mergeDefaultSystemConfigs(stored: unknown): SystemConfigRow[] {
  if (!Array.isArray(stored) || stored.length === 0) {
    return [...JUNE_2026_SYSTEM_CONFIG_DEFAULTS];
  }
  const map = new Map<string, SystemConfigRow>();
  for (const row of stored) {
    if (!row || typeof row !== 'object') continue;
    const typed = row as SystemConfigRow;
    if (!typed.systemType || !typed.systemSize || !typed.panelBrand) continue;
    map.set(systemConfigKey(typed), typed);
  }
  for (const row of JUNE_2026_SYSTEM_CONFIG_DEFAULTS) {
    map.set(systemConfigKey(row), row);
  }
  return Array.from(map.values());
}
