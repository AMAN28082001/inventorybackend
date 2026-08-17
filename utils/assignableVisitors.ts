import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { Request } from 'express';
import { Dealer, Visitor } from '../models/index-quotation';
import { AccountManager } from '../models';
import { resolveAccess, type AccessKey } from './userAccess';

export type AssignableVisitor = {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  employeeId: string | null;
  isActive: boolean;
  role: string;
  access: AccessKey[];
  permissions: AccessKey[];
  fullName: string;
  createdAt?: Date;
};

const hasVisitorAccess = (userLike: {
  role?: string | null;
  access?: unknown;
  permissions?: unknown;
  username?: string | null;
}): boolean => {
  const access = resolveAccess(userLike);
  if (access.length) return access.includes('visitor') && !(access.length === 1 && access[0] === 'admin');
  return String(userLike.role || '').toLowerCase() === 'visitor';
};

const toAssignable = (
  row: {
    id: string;
    username: string;
    firstName: string;
    lastName: string;
    email: string;
    mobile: string;
    employeeId?: string | null;
    isActive: boolean;
    createdAt?: Date;
    access?: unknown;
    role?: string;
  },
  fallbackRole: string
): AssignableVisitor => {
  const role = row.role || fallbackRole;
  const access = resolveAccess({
    role,
    access: row.access,
    username: row.username
  });
  const finalAccess: AccessKey[] = access.length ? access : ['visitor'];
  return {
    id: row.id,
    username: row.username,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    mobile: row.mobile,
    employeeId: row.employeeId ?? null,
    isActive: row.isActive,
    role,
    access: finalAccess,
    permissions: finalAccess,
    fullName: `${row.firstName || ''} ${row.lastName || ''}`.trim(),
    createdAt: row.createdAt
  };
};

const matchesSearch = (row: AssignableVisitor, search: string): boolean => {
  if (!search) return true;
  const q = search.toLowerCase();
  return [row.firstName, row.lastName, row.email, row.mobile, row.employeeId, row.username, row.fullName]
    .some((v) => String(v || '').toLowerCase().includes(q));
};

const markSeen = (seen: Set<string>, row: AssignableVisitor): void => {
  seen.add(row.id);
  if (row.username) seen.add(row.username.toLowerCase());
  if (row.email) seen.add(row.email.toLowerCase());
};

const isSeen = (seen: Set<string>, id: string, username?: string | null, email?: string | null): boolean =>
  seen.has(id) ||
  (!!username && seen.has(username.toLowerCase())) ||
  (!!email && seen.has(email.toLowerCase()));

/** Active users who may be assigned to a visit (visitors + dealers + ops with access.visitor). */
export const listAssignableVisitors = async (opts?: {
  search?: string;
  isActive?: boolean;
}): Promise<AssignableVisitor[]> => {
  const activeWhere: Record<string, unknown> = {};
  if (opts?.isActive !== undefined) activeWhere.isActive = opts.isActive;

  const [visitors, dealers, ops] = await Promise.all([
    Visitor.findAll({
      where: activeWhere,
      attributes: { exclude: ['password'] },
      order: [['firstName', 'ASC'], ['lastName', 'ASC']]
    }),
    Dealer.findAll({
      where: activeWhere,
      attributes: { exclude: ['password'] },
      order: [['firstName', 'ASC'], ['lastName', 'ASC']]
    }),
    AccountManager.findAll({
      where: opts?.isActive !== undefined ? { isActive: opts.isActive } : {},
      attributes: { exclude: ['password'] }
    })
  ]);

  const out: AssignableVisitor[] = [];
  const seen = new Set<string>();

  // Dealers with Visitor checkbox first so JWT sub (dealer uuid) is the assignable id
  // (e.g. Saurav / aman4119 with access ["quotation","visitor"]).
  for (const dealer of dealers) {
    const json = dealer.toJSON() as typeof dealer;
    if (!json.isActive && opts?.isActive !== false) continue;
    if (!hasVisitorAccess({ role: json.role, access: (json as any).access, username: json.username })) continue;
    const row = toAssignable(
      {
        id: json.id,
        username: json.username,
        firstName: json.firstName,
        lastName: json.lastName,
        email: json.email,
        mobile: json.mobile,
        employeeId: null,
        isActive: json.isActive,
        createdAt: json.createdAt,
        access: (json as any).access,
        role: json.role || 'dealer'
      },
      'dealer'
    );
    if (!matchesSearch(row, opts?.search || '')) continue;
    if (isSeen(seen, row.id, row.username, row.email)) continue;
    markSeen(seen, row);
    out.push(row);
  }

  for (const v of visitors) {
    const json = v.toJSON() as typeof v;
    if (!hasVisitorAccess({ role: 'visitor', access: (json as any).access, username: json.username })) continue;
    const row = toAssignable({ ...json, role: 'visitor' }, 'visitor');
    if (!matchesSearch(row, opts?.search || '')) continue;
    if (isSeen(seen, row.id, row.username, row.email)) continue;
    markSeen(seen, row);
    out.push(row);
  }

  for (const am of ops) {
    const json = am.toJSON() as typeof am;
    if (!json.isActive && opts?.isActive !== false) continue;
    if (!hasVisitorAccess({ role: json.role, access: (json as any).access, username: json.username })) continue;
    if (isSeen(seen, json.id, json.username, json.email)) continue;
    const linked = visitors.find(
      (v) =>
        v.id === json.id ||
        v.username.toLowerCase() === String(json.username || '').toLowerCase() ||
        (json.email && v.email && v.email.toLowerCase() === String(json.email).toLowerCase())
    );
    const id = linked?.id || json.id;
    if (seen.has(id)) continue;
    const row = toAssignable(
      {
        id,
        username: json.username,
        firstName: json.firstName,
        lastName: json.lastName,
        email: json.email,
        mobile: json.mobile,
        employeeId: (json as any).employeeId ?? null,
        isActive: json.isActive,
        createdAt: json.createdAt,
        access: (json as any).access,
        role: json.role
      },
      json.role || 'visitor'
    );
    if (!matchesSearch(row, opts?.search || '')) continue;
    markSeen(seen, row);
    out.push(row);
  }

  out.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return out;
};

export const findAssignableVisitor = async (visitorId: string): Promise<AssignableVisitor | null> => {
  const id = String(visitorId || '').trim();
  if (!id) return null;
  const all = await listAssignableVisitors({ isActive: true });
  const lower = id.toLowerCase();
  return all.find((v) => v.id === id || v.username.toLowerCase() === lower) || null;
};

/**
 * Visit assignments FK to `visitors.id`. Keep the assignable user's real id
 * (dealer uuid OK) so GET /visitors/me/visits matches JWT sub.
 */
export const ensureVisitorRowForAssignment = async (
  target: AssignableVisitor
): Promise<{ id: string; fullName: string }> => {
  const existing = await Visitor.findByPk(target.id);
  if (existing) {
    if (!existing.isActive) {
      throw Object.assign(new Error('Visitor is inactive'), { code: 'VAL_001' });
    }
    return { id: existing.id, fullName: `${existing.firstName} ${existing.lastName}`.trim() };
  }

  const placeholderPassword = await bcrypt.hash(`visit-link-${target.id}-${Date.now()}`, 10);
  let username = target.username;
  const usernameTaken = await Visitor.findOne({
    where: { username: { [Op.iLike]: username } }
  });
  if (usernameTaken && usernameTaken.id !== target.id) {
    username = `${target.username}_v`.slice(0, 50);
  }

  let email = target.email;
  const emailTaken = email
    ? await Visitor.findOne({ where: { email: { [Op.iLike]: target.email } } })
    : null;
  if ((emailTaken && emailTaken.id !== target.id) || !email) {
    email = `visit+${String(target.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}@local.invalid`;
  }

  const created = await Visitor.create({
    id: target.id,
    username,
    password: placeholderPassword,
    firstName: target.firstName || target.username,
    lastName: target.lastName || '',
    email,
    mobile: target.mobile || '0000000000',
    employeeId: target.employeeId,
    access: target.access.length ? target.access : ['visitor'],
    isActive: true
  });

  return { id: created.id, fullName: `${created.firstName} ${created.lastName}`.trim() };
};

/** JWT sub + attached visitor/dealer ids so dealer-with-visitor-access sees assigned visits. */
export const assignmentVisitorIdsForRequest = (req: Request): string[] => {
  const ids = [req.visitor?.id, req.user?.id, req.dealer?.id]
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  return [...new Set(ids)];
};
