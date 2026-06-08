/** Display names and API codes accepted from Product Manager frontend. */
const UNIT_CODE_TO_DISPLAY: Record<string, string> = {
  PCS: 'Pieces',
  KGS: 'Kilograms',
  MTR: 'Meters',
  NOS: 'Quantity',
  W: 'Watts',
  PAC: 'Pack'
};

export const ALLOWED_PRODUCT_UNITS = new Set([
  'Pieces',
  'PCS',
  'Kilograms',
  'KGS',
  'Meters',
  'MTR',
  'Quantity',
  'NOS',
  'Watts',
  'W',
  'Pack',
  'PAC',
  'Fixed',
  'Pillar'
]);

export const isAllowedProductUnit = (unit: unknown): boolean => {
  if (unit === undefined || unit === null || unit === '') return true;
  return ALLOWED_PRODUCT_UNITS.has(String(unit).trim());
};

/** Normalize API code to display name for storage; pass-through display names. */
export const normalizeProductUnit = (unit: unknown): string | null => {
  if (unit === undefined || unit === null || unit === '') return null;
  const raw = String(unit).trim();
  if (!ALLOWED_PRODUCT_UNITS.has(raw)) return null;
  return UNIT_CODE_TO_DISPLAY[raw] ?? raw;
};

/** Round monetary values to 2 decimal places; reject negative. */
export const roundProductPrice = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
};
