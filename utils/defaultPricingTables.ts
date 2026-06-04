/**
 * Default DCR system pricing rows (June 2026 matrix) when DB config has no `dcr` array.
 * Admin can override via PUT /api/config/pricing.
 */
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
    price: 272000
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

export function mergeDefaultDcrPricing(stored: unknown): typeof JUNE_2026_DCR_PRICING_DEFAULTS {
  if (Array.isArray(stored) && stored.length > 0) {
    return stored as typeof JUNE_2026_DCR_PRICING_DEFAULTS;
  }
  return JUNE_2026_DCR_PRICING_DEFAULTS;
}
