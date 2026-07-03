/** Max decimal places for B2B/B2C sale quantities (e.g. 2.5 meters). */
export const SALE_QUANTITY_DECIMALS = 3;

export const normalizeSaleQuantity = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  const factor = 10 ** SALE_QUANTITY_DECIMALS;
  return Math.round(n * factor) / factor;
};

export const isWholeSaleQuantity = (value: number): boolean => {
  if (!Number.isFinite(value)) return false;
  return Math.abs(value - Math.round(value)) < 1e-6;
};

export const hasSufficientStock = (available: number, requested: number): boolean => {
  const a = normalizeSaleQuantity(available);
  const r = normalizeSaleQuantity(requested);
  if (!Number.isFinite(a) || !Number.isFinite(r)) return false;
  return a + 1e-6 >= r;
};
