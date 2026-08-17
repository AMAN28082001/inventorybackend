import { Request } from 'express';
import { AccountManager } from '../models';
import { Dealer, Visitor } from '../models/index-quotation';
import { ensureDealerRowForAssignment, listQuotationAssignable } from './assignableQuotation';
import { canAccessSection, normalizeAccess, type AccessKey } from './userAccess';

export type ListUserLike = {
  id?: string;
  role?: string | null;
  access?: unknown;
  permissions?: unknown;
  username?: string | null;
  isActive?: boolean | null;
};

/** Parse `?access=quotation` / `?access=visitor` (comma-separated takes the first known key). */
export const parseAccessQuery = (raw: unknown): AccessKey | null => {
  const first = String(raw || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (!first) return null;
  const keys = normalizeAccess([first]);
  return keys[0] || null;
};

export const parseAccessQueryFromReq = (req: Request): AccessKey | null =>
  parseAccessQuery(req.query.access ?? req.query.accessKey);

export const includeAccessUsersFromReq = (req: Request): boolean => {
  const raw = String(req.query.includeAccessUsers ?? req.query.include_access_users ?? '')
    .trim()
    .toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
};

/**
 * Directory / dropdown eligibility from Admin access checkboxes.
 * Empty access falls back to legacy role defaults (dealer → quotation, visitor → visitor).
 */
export const hasListAccess = (user: ListUserLike, key: AccessKey, opts?: { allowInactive?: boolean }): boolean => {
  if (!opts?.allowInactive && user.isActive === false) return false;
  return canAccessSection(
    {
      role: user.role,
      access: user.access,
      permissions: user.permissions,
      username: user.username
    },
    key
  );
};

export const filterByListAccess = <T extends ListUserLike>(
  rows: T[],
  key: AccessKey | null,
  opts?: { allowInactive?: boolean }
): T[] => {
  if (!key) return rows;
  return rows.filter((row) => hasListAccess(row, key, opts));
};

export const paginateRows = <T>(rows: T[], page: number, limit: number) => {
  const safePage = Math.max(1, page);
  const safeLimit = Math.max(1, limit);
  const offset = (safePage - 1) * safeLimit;
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / safeLimit) || 1);
  return {
    rows: rows.slice(offset, offset + safeLimit),
    total,
    page: safePage,
    limit: safeLimit,
    totalPages,
    hasNext: safePage < totalPages,
    hasPrev: safePage > 1
  };
};

export type QuotationDealerCheck = {
  dealers: Dealer[];
  missing: string[];
  ineligible: string[];
};

/** Active quotation-eligible users (dealers + visitors + ops). Materializes a dealers row for FK. */
export const loadQuotationEligibleDealers = async (ids: string[]): Promise<QuotationDealerCheck> => {
  const unique = Array.from(new Set(ids.map((id) => String(id || '').trim()).filter(Boolean)));
  if (!unique.length) return { dealers: [], missing: [], ineligible: [] };

  const assignable = await listQuotationAssignable({ isActive: true });
  const byId = new Map(assignable.map((row) => [row.id, row]));
  const missing: string[] = [];
  const ineligible: string[] = [];
  const profiles = [];

  for (const id of unique) {
    const row = byId.get(id);
    if (row) {
      profiles.push(row);
      continue;
    }
    const [dealer, visitor, ops] = await Promise.all([
      Dealer.findByPk(id, { attributes: ['id', 'isActive', 'role', 'access', 'username'] }),
      Visitor.findByPk(id, { attributes: ['id', 'isActive', 'access', 'username'] }),
      AccountManager.findByPk(id, { attributes: ['id', 'isActive', 'role', 'access', 'username'] })
    ]);
    if (dealer || visitor || ops) ineligible.push(id);
    else missing.push(id);
  }

  const dealers: Dealer[] = [];
  for (const profile of profiles) {
    dealers.push(await ensureDealerRowForAssignment(profile));
  }

  return { dealers, missing, ineligible };
};

export const quotationEligibilityHttpError = (check: QuotationDealerCheck) => {
  if (check.missing.length) {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          code: 'VAL_001',
          message: `Dealer not found or inactive: ${check.missing[0]}`,
          details: check.missing.map((id) => ({ field: 'dealerIds', message: `Invalid dealer id: ${id}` }))
        }
      }
    };
  }
  if (check.ineligible.length) {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Dealer does not have Quotation access',
          details: check.ineligible.map((id) => ({
            field: 'dealerIds',
            message: `Dealer ${id} is missing access: quotation`
          }))
        }
      }
    };
  }
  return null;
};
