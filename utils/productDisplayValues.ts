/**
 * Display / package-set labels shared across catalog validation (not used in pricing math).
 */

export const isAsPerTheSet = (value: unknown): boolean => {
  const s = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return s === 'as per the set' || s === 'as per set';
};

export const isAllowedDisplayCableSize = (
  size: unknown,
  catalogSizes?: string[]
): boolean => {
  if (isAsPerTheSet(size)) return true;
  const s = String(size || '').trim();
  if (!s) return true;
  if (!catalogSizes?.length) return true;
  return catalogSizes.includes(s);
};
