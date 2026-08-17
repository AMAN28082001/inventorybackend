import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { AccountManager } from '../models';
import { Dealer, Visitor } from '../models/index-quotation';
import { hasListAccess } from './accessLists';
import { normalizeAccess, resolveAccess, type AccessKey } from './userAccess';

export type QuotationAssignable = {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  isActive: boolean;
  role: string;
  access: AccessKey[];
  permissions: AccessKey[];
  fullName: string;
  emailVerified?: boolean;
};

const toAssignable = (
  row: {
    id: string;
    username: string;
    firstName: string;
    lastName: string;
    email: string;
    mobile: string;
    isActive: boolean;
    emailVerified?: boolean;
    access?: unknown;
    permissions?: unknown;
    role?: string;
  },
  fallbackRole: string
): QuotationAssignable => {
  const role = row.role || fallbackRole;
  const access = resolveAccess({
    role,
    access: row.access,
    permissions: row.permissions,
    username: row.username
  });
  return {
    id: row.id,
    username: row.username,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    mobile: row.mobile,
    isActive: row.isActive,
    emailVerified: row.emailVerified,
    role,
    access,
    permissions: access,
    fullName: `${row.firstName || ''} ${row.lastName || ''}`.trim()
  };
};

const normalizeUsernameKey = (username?: string | null): string =>
  String(username || '')
    .trim()
    .toLowerCase()
    .replace(/@+$/, '');

const profileRichness = (row: QuotationAssignable, storedAccess?: unknown): number => {
  const explicitQuotation = normalizeAccess(storedAccess).includes('quotation') ? 4 : 0;
  const realName =
    row.firstName && row.firstName !== 'SYSTEM' ? 2 : 0;
  const realLast =
    row.lastName && row.lastName !== 'SYSTEM' ? 1 : 0;
  const realEmail =
    row.email && !String(row.email).includes('@local.invalid') ? 1 : 0;
  const realMobile = row.mobile && row.mobile.length >= 10 && !row.mobile.startsWith('90') ? 1 : 0;
  const preferVisitorKind = row.role === 'visitor' ? 1 : 0;
  return explicitQuotation + realName + realLast + realEmail + realMobile + preferVisitorKind;
};

const matchesSearch = (row: QuotationAssignable, search: string): boolean => {
  if (!search) return true;
  const q = search.toLowerCase();
  return [row.firstName, row.lastName, row.email, row.mobile, row.username, row.fullName]
    .some((v) => String(v || '').toLowerCase().includes(q));
};

const hasQuotationAccess = (userLike: {
  role?: string | null;
  access?: unknown;
  permissions?: unknown;
  username?: string | null;
}): boolean => hasListAccess({ ...userLike, isActive: true }, 'quotation', { allowInactive: true });

/**
 * HR Select/Manage dealers — all active users with Admin Quotation checkbox
 * (dealers + visitors + ops). Example: visitor Jagdish with ["visitor","quotation"].
 * HR token is enough — this is not admin-only.
 */
export const listQuotationAssignable = async (opts?: {
  search?: string;
  isActive?: boolean;
}): Promise<QuotationAssignable[]> => {
  const activeWhere: Record<string, unknown> = {};
  if (opts?.isActive !== undefined) activeWhere.isActive = opts.isActive;

  const [dealers, visitors, ops] = await Promise.all([
    Dealer.findAll({
      where: activeWhere,
      attributes: { exclude: ['password'] },
      order: [['firstName', 'ASC'], ['lastName', 'ASC']]
    }),
    Visitor.findAll({
      where: activeWhere,
      attributes: { exclude: ['password'] },
      order: [['firstName', 'ASC'], ['lastName', 'ASC']]
    }),
    AccountManager.findAll({
      where: opts?.isActive !== undefined ? { isActive: opts.isActive } : {},
      attributes: { exclude: ['password'] }
    })
  ]);

  type Candidate = { row: QuotationAssignable; score: number };
  const byUsername = new Map<string, Candidate>();
  const byId = new Map<string, Candidate>();

  const consider = (row: QuotationAssignable, storedAccess: unknown): void => {
    if (!matchesSearch(row, opts?.search || '')) return;
    const score = profileRichness(row, storedAccess);
    const usernameKey = normalizeUsernameKey(row.username);
    const replace = (existing?: Candidate) => !existing || score > existing.score;

    const idExisting = byId.get(row.id);
    if (!replace(idExisting)) return;

    if (usernameKey) {
      const userExisting = byUsername.get(usernameKey);
      if (userExisting && userExisting.row.id !== row.id && !replace(userExisting)) return;
      if (userExisting && userExisting.row.id !== row.id) {
        byId.delete(userExisting.row.id);
      }
      byUsername.set(usernameKey, { row, score });
    }
    byId.set(row.id, { row, score });
  };

  for (const dealer of dealers) {
    const json = dealer.toJSON() as typeof dealer;
    if (!json.isActive && opts?.isActive !== false) continue;
    const govId = String((json as any).governmentIdNumber || '');
    if (
      json.id === 'unassigned' ||
      String(json.username || '').startsWith('__') ||
      govId.startsWith('QUOTE-LINK') ||
      govId.startsWith('CALLING-POOL')
    ) {
      continue;
    }
    const storedAccess = (json as any).access;
    const storedPermissions = (json as any).permissions;
    if (String(json.role || '').toLowerCase() === 'admin' && !normalizeAccess(storedAccess).includes('quotation')) {
      continue;
    }
    if (
      !hasQuotationAccess({
        role: json.role || 'dealer',
        access: storedAccess,
        permissions: storedPermissions,
        username: json.username
      })
    ) {
      continue;
    }
    consider(
      toAssignable(
        {
          id: json.id,
          username: json.username,
          firstName: json.firstName,
          lastName: json.lastName,
          email: json.email,
          mobile: json.mobile,
          isActive: json.isActive,
          emailVerified: json.emailVerified,
          access: storedAccess,
          permissions: storedPermissions,
          role: json.role || 'dealer'
        },
        'dealer'
      ),
      storedAccess
    );
  }

  for (const v of visitors) {
    const json = v.toJSON() as typeof v;
    if (!json.isActive && opts?.isActive !== false) continue;
    const storedAccess = (json as any).access;
    const storedPermissions = (json as any).permissions;
    if (
      !hasQuotationAccess({
        role: 'visitor',
        access: storedAccess,
        permissions: storedPermissions,
        username: json.username
      })
    ) {
      continue;
    }
    consider(toAssignable({ ...json, role: 'visitor' }, 'visitor'), storedAccess);
  }

  for (const am of ops) {
    const json = am.toJSON() as typeof am;
    if (!json.isActive && opts?.isActive !== false) continue;
    const storedAccess = (json as any).access;
    const storedPermissions = (json as any).permissions;
    if (
      !hasQuotationAccess({
        role: json.role,
        access: storedAccess,
        permissions: storedPermissions,
        username: json.username
      })
    ) {
      continue;
    }
    consider(
      toAssignable(
        {
          id: json.id,
          username: json.username,
          firstName: json.firstName,
          lastName: json.lastName,
          email: json.email,
          mobile: json.mobile,
          isActive: json.isActive,
          emailVerified: json.emailVerified,
          access: storedAccess,
          permissions: storedPermissions,
          role: json.role
        },
        json.role || 'account-management'
      ),
      storedAccess
    );
  }

  const out = Array.from(byId.values()).map((c) => c.row);
  out.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return out;
};

/**
 * Calling-queue assignments FK to dealers.id. Keep the assignable user's real id
 * (visitor/ops uuid OK) so GET /dealers/me/calling-queue/next matches JWT sub.
 */
export const ensureDealerRowForAssignment = async (target: QuotationAssignable): Promise<Dealer> => {
  const existing = await Dealer.findByPk(target.id);
  if (existing) {
    if (!existing.isActive && target.isActive) {
      await existing.update({ isActive: true });
    }
    return existing;
  }

  const placeholderPassword = await bcrypt.hash(`quote-link-${target.id}-${Date.now()}`, 10);
  let username = String(target.username || target.id).slice(0, 50);
  const usernameTaken = await Dealer.findOne({ where: { username: { [Op.iLike]: username } } });
  if (usernameTaken && usernameTaken.id !== target.id) {
    username = `${username}_q`.slice(0, 50);
  }

  let email = target.email;
  const emailTaken = email
    ? await Dealer.findOne({ where: { email: { [Op.iLike]: email } } })
    : null;
  if ((emailTaken && emailTaken.id !== target.id) || !email) {
    email = `quote+${String(target.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}@local.invalid`;
  }

  let mobile = String(target.mobile || '').replace(/\D/g, '').slice(0, 15);
  const mobileTaken = mobile
    ? await Dealer.findOne({ where: { mobile } })
    : null;
  if ((mobileTaken && mobileTaken.id !== target.id) || mobile.length < 10) {
    mobile = `9${String(target.id).replace(/\D/g, '0').slice(0, 9).padEnd(9, '0')}`;
  }

  return Dealer.create({
    id: target.id,
    username,
    password: placeholderPassword,
    firstName: target.firstName || target.username,
    lastName: target.lastName || '',
    email,
    mobile,
    company: null,
    gender: 'Other',
    dateOfBirth: new Date('1970-01-01'),
    fatherName: 'SYSTEM',
    fatherContact: mobile,
    governmentIdType: 'Passport',
    governmentIdNumber: `QUOTE-LINK-${String(target.id).slice(0, 20)}`,
    addressStreet: 'SYSTEM',
    addressCity: 'SYSTEM',
    addressState: 'SYSTEM',
    addressPincode: '000000',
    role: 'dealer',
    access: target.access.length ? target.access : ['quotation'],
    isActive: true,
    emailVerified: true
  });
};
