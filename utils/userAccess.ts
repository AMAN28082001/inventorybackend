import {
  parseModuleFieldPermissionsFromBody,
  parseOfficeLocationFromBody,
  workflowPermissionFieldsForApi
} from './moduleFieldPermissions';

export const ACCESS_KEYS = [
  'admin',
  'quotation',
  'accounts',
  'installation',
  'metering',
  'final_confirmation',
  'hr',
  'visitor'
] as const;

export type AccessKey = (typeof ACCESS_KEYS)[number];

const ACCESS_SET = new Set<string>(ACCESS_KEYS);

const ACCESS_TO_ROLE: Record<AccessKey, string> = {
  admin: 'admin',
  quotation: 'dealer',
  accounts: 'account-management',
  installation: 'installer',
  metering: 'metering',
  final_confirmation: 'baldev',
  hr: 'hr',
  visitor: 'visitor'
};

const PRIMARY_PRIORITY: AccessKey[] = [
  'admin',
  'accounts',
  'installation',
  'metering',
  'final_confirmation',
  'hr',
  'visitor',
  'quotation'
];

/** Normalize FE / DB values into canonical access keys. */
export const normalizeAccess = (raw: unknown): AccessKey[] => {
  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) list = parsed;
      } catch {
        list = trimmed.split(',');
      }
    } else if (trimmed.includes(',')) {
      list = trimmed.split(',');
    } else if (trimmed) {
      list = [trimmed];
    }
  } else if (raw && typeof raw === 'object') {
    list = Object.entries(raw as Record<string, unknown>)
      .filter(([, v]) => v === true || v === 'true' || v === 1 || v === '1')
      .map(([k]) => k);
    if (!list.length) list = Object.keys(raw as Record<string, unknown>);
  }
  const out: AccessKey[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    let key = String(item || '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    if (key === 'account_management' || key === 'account' || key === 'payments') key = 'accounts';
    if (key === 'installer' || key === 'install' || key === 'installation_team') key = 'installation';
    if (key === 'baldev' || key === 'final' || key === 'confirmation') key = 'final_confirmation';
    if (key === 'dealer' || key === 'quotations') key = 'quotation';
    if (!ACCESS_SET.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key as AccessKey);
  }
  return out;
};

/** Infer access from legacy single role. */
export const accessFromRole = (role?: string | null): AccessKey[] => {
  const r = String(role || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (!r) return [];
  if (r === 'admin' || r === 'super_admin' || r === 'superadmin' || r === 'super_admin_manager') {
    return ['admin'];
  }
  if (r === 'dealer') return ['quotation'];
  if (r === 'account_management' || r === 'accountmanager' || r === 'account_manager') {
    return ['accounts'];
  }
  if (r === 'installer' || r === 'installation' || r === 'installation_team') return ['installation'];
  if (r === 'metering' || r === 'meter' || r === 'mco' || r === 'metering_team') return ['metering'];
  if (r === 'baldev' || r === 'confirmation') return ['final_confirmation'];
  if (r === 'hr' || r === 'human_resources') return ['hr'];
  if (r === 'visitor') return ['visitor'];
  return [];
};

export const primaryRoleFromAccess = (access: AccessKey[]): string => {
  const list = normalizeAccess(access);
  for (const key of PRIMARY_PRIORITY) {
    if (list.includes(key)) return ACCESS_TO_ROLE[key];
  }
  return 'account-management';
};

export const resolveAccess = (userLike: {
  role?: string | null;
  access?: unknown;
  permissions?: unknown;
  username?: string | null;
}): AccessKey[] => {
  const stored = normalizeAccess(userLike.access);
  if (stored.length > 0) return stored;
  const fromBody = normalizeAccess(userLike.permissions);
  if (fromBody.length > 0) return fromBody;
  const fromRole = accessFromRole(userLike.role);
  if (fromRole.length > 0) return fromRole;
  if (String(userLike.username || '').trim().toLowerCase() === 'admin') {
    return ['admin'];
  }
  return [];
};

export const canAccessSection = (
  user: { role?: string | null; access?: unknown; permissions?: unknown; username?: string | null },
  key: AccessKey
): boolean => resolveAccess(user).includes(key);

export const parseAccessFromBody = (body: Record<string, unknown>): {
  access?: AccessKey[];
  error?: string;
} => {
  const raw = body.access ?? body.permissions;
  if (raw === undefined) return {};
  const parsed = normalizeAccess(raw);
  if (!parsed.length) {
    return { error: 'access must be a non-empty array of known dashboard keys' };
  }
  return { access: parsed };
};

export const parseWorkflowPermissionPatchFromBody = (
  body: Record<string, unknown>
): { officeLocation?: string | null; moduleFieldPermissions?: Record<string, unknown> } | { error: string } => {
  const patch: { officeLocation?: string | null; moduleFieldPermissions?: Record<string, unknown> } = {};
  try {
    const office = parseOfficeLocationFromBody(body);
    if (office !== undefined) patch.officeLocation = office;
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Invalid officeLocation' };
  }
  try {
    const perms = parseModuleFieldPermissionsFromBody(body);
    if (perms !== undefined) patch.moduleFieldPermissions = perms as Record<string, unknown>;
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Invalid moduleFieldPermissions' };
  }
  return patch;
};

export const publicUserAccessFields = (userLike: {
  id?: string;
  username?: string;
  role?: string | null;
  access?: unknown;
  permissions?: unknown;
  firstName?: string;
  lastName?: string;
  email?: string;
  mobile?: string;
  isActive?: boolean;
  emailVerified?: boolean;
  loginCount?: number;
  lastLogin?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}) => {
  const access = resolveAccess(userLike);
  return {
    access,
    permissions: access
  };
};

export const publicDealerForApi = (dealer: Record<string, unknown>) => {
  const access = resolveAccess({
    role: (dealer.role as string) || 'dealer',
    access: dealer.access,
    permissions: dealer.permissions,
    username: dealer.username as string
  });
  return {
    ...dealer,
    role: dealer.role || 'dealer',
    access,
    permissions: access,
    ...workflowPermissionFieldsForApi(dealer)
  };
};

export const publicAccountManagerForApi = (row: Record<string, unknown>) => {
  const access = resolveAccess({
    role: row.role as string,
    access: row.access,
    permissions: row.permissions,
    username: row.username as string
  });
  const address = {
    street: (row.addressStreet as string) || '',
    city: (row.addressCity as string) || '',
    state: (row.addressState as string) || '',
    pincode: (row.addressPincode as string) || ''
  };
  return {
    ...row,
    gender: row.gender ?? null,
    dateOfBirth: row.dateOfBirth ?? null,
    fatherName: row.fatherName ?? null,
    fatherContact: row.fatherContact ?? null,
    governmentIdType: row.governmentIdType ?? null,
    governmentIdNumber: row.governmentIdNumber ?? null,
    employeeId: row.employeeId ?? null,
    address,
    access,
    permissions: access,
    ...workflowPermissionFieldsForApi(row)
  };
};

/** Admin panel routes (Users tab, dealer directory). */
export const hasAdminPanelAccess = (req: {
  dealer?: { role?: string; access?: unknown; username?: string };
  user?: { role?: string; access?: unknown; permissions?: unknown; username?: string };
}): boolean => {
  if (req.dealer?.role === 'admin') return true;
  const role = req.user?.role;
  if (role === 'admin' || role === 'super-admin' || role === 'super-admin-manager' || role === 'superadmin') {
    return true;
  }
  return canAccessSection(
    {
      role: req.user?.role ?? req.dealer?.role,
      access: req.user?.access ?? req.dealer?.access,
      username: req.user?.username ?? req.dealer?.username
    },
    'admin'
  );
};

/** True when this request should use dealer quotation APIs (own data), even if JWT role is hr. */
export const isActingAsQuotationDealer = (req: {
  dealer?: { id?: string; role?: string; access?: unknown; username?: string };
  user?: { role?: string; access?: unknown; permissions?: unknown; username?: string };
}): boolean => {
  if (!req.dealer?.id) return false;
  if (req.dealer.role === 'admin') return false;
  return canAccessSection(
    {
      role: req.user?.role ?? req.dealer.role,
      access: req.user?.access ?? req.dealer.access,
      username: req.user?.username ?? req.dealer.username
    },
    'quotation'
  );
};

/** Account-management approved-list view — not the dealer quotation dashboard. */
export const isOpsAccountManagerView = (req: {
  dealer?: { id?: string; role?: string; access?: unknown; username?: string };
  user?: { role?: string; access?: unknown; permissions?: unknown; username?: string };
}): boolean => {
  const role = req.user?.role;
  if (role !== 'account-management' && role !== 'hr') return false;
  return !isActingAsQuotationDealer(req);
};
