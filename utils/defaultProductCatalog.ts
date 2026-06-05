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
  'Vikram Solar',
  'RenewSys'
] as const;

/** DCR panel wattages used by frontend browse + PDF (incl. 555W Adani column). */
export const DEFAULT_PANEL_SIZES = [
  '440W',
  '445W',
  '530W',
  '540W',
  '545W',
  '550W',
  '555W',
  '610W',
  '620W'
] as const;

export const DEFAULT_INVERTER_TYPES = ['String Inverter', 'Hybrid Inverter'] as const;

export const DEFAULT_INVERTER_BRANDS = [
  'Growatt',
  'GoodWe',
  'Vsole',
  'Xwatt',
  'Saatvik',
  'Polycab',
  ...EXTRA_INVERTER_BRAND_LABELS
] as const;

export const DEFAULT_METER_BRANDS = ['L&T', 'Havells', 'Genus', ...EXTRA_METER_BRAND_LABELS] as const;

export const DEFAULT_CABLE_SIZES = [
  '4 sq mm',
  '6 sq mm',
  'As per Set',
  'As per the set'
] as const;

export const normalizePanelSizeLabel = (size: unknown): string => {
  const s = String(size || '').trim();
  if (s === '545W') return '550W';
  return s;
};
