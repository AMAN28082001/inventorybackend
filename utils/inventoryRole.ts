/**
 * Inventory / Quotation shared role helpers (§AD).
 * Canonical inventory admin role is `super-admin` (hyphenated).
 */

const ROLE_ALIASES: Record<string, string> = {
  superadmin: 'super-admin',
  'super_admin': 'super-admin',
  'super-admin': 'super-admin',
  'superadminmanager': 'super-admin-manager',
  'super_admin_manager': 'super-admin-manager',
  'super-admin-manager': 'super-admin-manager',
  admin: 'admin',
  agent: 'agent',
  account: 'account',
  installer: 'installer',
  baldev: 'baldev',
  confirmation: 'confirmation',
  hr: 'hr',
  metering: 'metering',
  meter: 'metering',
  'metering-team': 'metering',
  'metering_team': 'metering',
  mco: 'mco'
};

/** Normalize JWT / DB role strings to canonical hyphenated form. */
export const normalizeInventoryRole = (role: unknown): string => {
  const raw = String(role ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-');
  if (!raw) return '';
  const compact = raw.replace(/-/g, '');
  if (ROLE_ALIASES[raw]) return ROLE_ALIASES[raw];
  if (ROLE_ALIASES[compact]) return ROLE_ALIASES[compact];
  return raw;
};

export const isSuperAdminRole = (role: unknown): boolean =>
  normalizeInventoryRole(role) === 'super-admin';

export const isSuperAdminManagerRole = (role: unknown): boolean =>
  normalizeInventoryRole(role) === 'super-admin-manager';

export const isInventoryAdminLikeRole = (role: unknown): boolean => {
  const normalized = normalizeInventoryRole(role);
  return (
    normalized === 'admin' ||
    normalized === 'super-admin' ||
    normalized === 'super-admin-manager'
  );
};

/** Roles accepted on inventory `users` JWT for quotation + inventory routes. */
export const INVENTORY_USER_JWT_ROLES = new Set([
  'super-admin',
  'super-admin-manager',
  'admin',
  'agent',
  'account',
  'installer',
  'baldev',
  'confirmation',
  'hr',
  'metering',
  'meter',
  'metering-team',
  'mco'
]);

export const isInventoryUserJwtRole = (role: unknown): boolean => {
  const normalized = normalizeInventoryRole(role);
  return INVENTORY_USER_JWT_ROLES.has(normalized) || INVENTORY_USER_JWT_ROLES.has(String(role ?? ''));
};

/** Quotation Admin (Dealer) session on inventory routes — same access as super-admin (§AD). */
export const isQuotationAdminInventorySession = (
  user: { authSource?: string; role?: string } | null | undefined
): boolean => user?.authSource === 'quotation-admin';

/**
 * Effective inventory role for authorize + controller scoping.
 * Quotation Admin is treated as super-admin for Accounts → Open Inventory.
 */
export const effectiveInventoryRole = (
  user: { authSource?: string; role?: string } | null | undefined
): string => {
  if (!user) return '';
  if (isQuotationAdminInventorySession(user)) return 'super-admin';
  return normalizeInventoryRole(user.role) || String(user.role || '');
};

