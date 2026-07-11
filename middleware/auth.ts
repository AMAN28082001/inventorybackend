import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models';
import Dealer from '../models/Dealer';
import { logInfo } from '../utils/loggerHelper';
import {
  effectiveInventoryRole,
  isInventoryUserJwtRole,
  isQuotationAdminInventorySession,
  normalizeInventoryRole
} from '../utils/inventoryRole';

const extractBearerToken = (req: Request): string | null => {
  const raw = req.header('Authorization') || req.header('authorization') || '';
  const match = raw.match(/^Bearer\s+(.+)$/i);
  if (match?.[1]) return match[1].trim();
  if (raw && !raw.includes(' ') && raw.split('.').length === 3) return raw.trim();
  return null;
};

/** Load inventory `users` row from Bearer JWT without sending an HTTP response. */
export const tryAuthenticateInventoryUser = async (req: Request): Promise<boolean> => {
  try {
    const token = extractBearerToken(req);
    if (!token) return false;

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) return false;

    const decoded = jwt.verify(token, jwtSecret) as { id: string; role?: string };
    if (!decoded?.id) return false;

    const user = await User.findByPk(decoded.id, {
      attributes: ['id', 'username', 'name', 'role', 'is_active']
    });
    if (!user || !user.is_active) return false;

    const canonicalRole = normalizeInventoryRole(user.role) || user.role;
    if (!isInventoryUserJwtRole(canonicalRole) && !isInventoryUserJwtRole(decoded.role)) {
      return false;
    }

    req.user = {
      id: user.id,
      username: user.username,
      password: '',
      name: user.name,
      role: canonicalRole as 'super-admin' | 'super-admin-manager' | 'admin' | 'agent' | 'account' | 'installer' | 'baldev' | 'confirmation' | 'hr' | 'metering',
      is_active: user.is_active,
      authSource: 'inventory-user'
    };
    return true;
  } catch {
    return false;
  }
};

/**
 * Quotation Admin (Dealer.role === 'admin') from POST /auth/login.
 * Effective inventory role = super-admin so Accounts → Open Inventory matches Super Admin access (§AD).
 */
export const tryAuthenticateQuotationAdminForInventory = async (req: Request): Promise<boolean> => {
  try {
    const token = extractBearerToken(req);
    if (!token) return false;

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) return false;

    const decoded = jwt.verify(token, jwtSecret) as { id: string; role?: string };
    if (!decoded?.id) return false;

    const jwtRole = normalizeInventoryRole(decoded.role) || String(decoded.role || '').trim().toLowerCase();
    if (jwtRole && jwtRole !== 'admin' && jwtRole !== 'dealer') {
      return false;
    }

    const dealer = await Dealer.findByPk(decoded.id, {
      attributes: ['id', 'username', 'firstName', 'lastName', 'role', 'isActive']
    });
    if (!dealer || !dealer.isActive) return false;

    const dealerRole = normalizeInventoryRole(dealer.role) || String(dealer.role || '').toLowerCase();
    if (dealerRole !== 'admin') return false;

    const displayName = `${dealer.firstName || ''} ${dealer.lastName || ''}`.trim() || dealer.username;

    // Present as super-admin for inventory authorize() + controller role checks.
    req.user = {
      id: dealer.id,
      username: dealer.username,
      password: '',
      name: displayName,
      role: 'super-admin',
      is_active: true,
      authSource: 'quotation-admin'
    };
    req.dealer = {
      id: dealer.id,
      username: dealer.username,
      role: 'admin'
    };
    return true;
  } catch {
    return false;
  }
};

/** Inventory User OR quotation Admin dealer — no token errors on Open Inventory routes. */
export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Access denied. No token provided.' });
      return;
    }

    if (await tryAuthenticateInventoryUser(req)) {
      next();
      return;
    }

    if (await tryAuthenticateQuotationAdminForInventory(req)) {
      next();
      return;
    }

    res.status(401).json({
      error: 'Invalid token or user inactive.',
      hint: 'Inventory routes accept inventory super-admin/admin users and quotation Admin (Dealer) JWTs from POST /api/auth/login (§AD).'
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token.' });
  }
};

const normalizeRole = (role: string) =>
  normalizeInventoryRole(role) ||
  role.toString().trim().toLowerCase().replace(/_/g, '-').replace(/\s+/g, '-');

export const authorize = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const userRole = effectiveInventoryRole(req.user);
    const allowedRoles = roles.map(normalizeRole);

    const isSuperAdminManagerLike =
      allowedRoles.includes('super-admin-manager') &&
      userRole.includes('super') &&
      userRole.includes('admin') &&
      userRole.includes('manager');

    // Quotation Admin ≡ super-admin for inventory panel
    if (isQuotationAdminInventorySession(req.user) && allowedRoles.includes('super-admin')) {
      next();
      return;
    }

    if (!allowedRoles.includes(userRole) && !isSuperAdminManagerLike) {
      logInfo('Authorization denied', {
        role: req.user.role,
        effectiveRole: userRole,
        authSource: (req.user as { authSource?: string }).authSource,
        allowedRoles,
        path: req.originalUrl,
        method: req.method
      });
      res.status(403).json({ error: 'Access denied. Insufficient permissions.' });
      return;
    }

    next();
  };
};

export const authorizeProductManagement = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  // Quotation Admin Open Inventory — same as super-admin product management
  if (isQuotationAdminInventorySession(req.user)) {
    next();
    return;
  }

  const userRole = normalizeRole(req.user.role);
  const compactRole = userRole.replace(/-/g, '');
  const isSuperAdmin =
    userRole === 'super-admin' ||
    compactRole === 'superadmin';
  const isSuperAdminManager =
    userRole === 'super-admin-manager' ||
    compactRole === 'superadminmanager' ||
    (compactRole.includes('super') && compactRole.includes('admin') && compactRole.includes('manager'));
  const isProductManager =
    isSuperAdminManager ||
    userRole === 'product-manager' ||
    (userRole.includes('product') && userRole.includes('manager'));

  if (!isSuperAdmin && !isProductManager) {
    res.status(403).json({ error: 'Access denied. Insufficient permissions.' });
    return;
  }

  next();
};
