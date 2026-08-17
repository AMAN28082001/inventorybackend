/**
 * June 2026 DCR catalog defaults — merged into API responses and validation when DB config is stale.
 */

import {
  EXTRA_INVERTER_BRAND_LABELS,
  EXTRA_METER_BRAND_LABELS
} from './quotationProductPdfDisplay';

export const DEFAULT_PANEL_BRANDS = [
  'Adani',
  'Tata',
  'Waaree',
  'Premier Energies',
  'INA',
  'Vikram Solar',
  'RenewSys',
  /** Non-DCR 80kW package brand — do not coerce to RenewSys / Adani */
  'Renew Energy',
  /** Crompton DCR set (§27) — form brand; package marker is panelType "Crompton set" */
  'Premier Energy',
  'Crompton set',
  'Crompton'
] as const;

/** DCR panel wattages used by frontend browse + PDF (incl. 555W Adani, INA 500W–600W). */
export const DEFAULT_PANEL_SIZES = [
  '440W',
  '445W',
  '500W',
  '510W',
  '520W',
  '530W',
  '540W',
  '545W',
  '550W',
  '555W',
  '560W',
  '570W',
  '580W',
  '590W',
  '600W',
  '605W',
  '610W',
  '615W',
  '620W',
  '625W',
  '630W',
  '640W',
  '650W',
  '700W',
  '705W'
] as const;

export const DEFAULT_INVERTER_TYPES = ['String Inverter', 'Hybrid Inverter'] as const;

/** Large Non-DCR packages (80 / 100 / 125kW) must validate when DB catalog is stale. */
export const DEFAULT_INVERTER_SIZES = [
  '3kW',
  '3.6kW',
  '5kW',
  '6kW',
  '8kW',
  '10kW',
  '12kW',
  '15kW',
  '20kW',
  '25kW',
  '30kW',
  '50kW',
  '80kW',
  '100kW',
  '125kW'
] as const;

export const DEFAULT_STRUCTURE_SIZES = [
  '1kW',
  '2kW',
  '3kW',
  '5kW',
  '10kW',
  '15kW',
  '20kW',
  '25kW',
  '30kW',
  '50kW',
  '80kW',
  '100kW',
  '125kW'
] as const;

export const DEFAULT_INVERTER_BRANDS = [
  'Growatt',
  'GoodWe',
  'Vsole',
  'Xwatt',
  'Saatvik',
  'Polycab',
  'Crompton',
  ...EXTRA_INVERTER_BRAND_LABELS
] as const;

export const DEFAULT_METER_BRANDS = ['L&T', 'Havells', 'Genus', ...EXTRA_METER_BRAND_LABELS] as const;

export const DEFAULT_CABLE_SIZES = [
  '4 sq mm',
  '6 sq mm',
  'As per Set',
  'As per the set'
] as const;

export const DEFAULT_CABLE_BRANDS = ['Polycab', 'Havells', 'Finolex'] as const;

export const DEFAULT_STRUCTURE_TYPES = ['GI Structure', 'Aluminum Structure', 'MS Structure'] as const;

export const DEFAULT_ACDB_OPTIONS = [
  'Havells (1-Phase)',
  'Havells (3-Phase)',
  'Crompton (1-Phase)',
  'Crompton (3-Phase)'
] as const;

export const DEFAULT_DCDB_OPTIONS = [
  'Havells (1-Phase)',
  'Havells (3-Phase)',
  'Crompton (1-Phase)',
  'Crompton (3-Phase)'
] as const;

export const normalizePanelSizeLabel = (size: unknown): string => {
  const s = String(size || '').trim();
  if (s === '545W') return '550W';
  return s;
};
