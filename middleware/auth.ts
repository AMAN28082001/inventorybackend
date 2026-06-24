import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models';
import { logInfo } from '../utils/loggerHelper';

const INVENTORY_USER_JWT_ROLES = new Set([
  'super-admin',
  'super-admin-manager',
  'admin',
  'agent',
  'account',
  'installer',
  'baldev',
  'confirmation',
  'hr',
  'metering'
]);

/** Load inventory `users` row from Bearer JWT without sending an HTTP response. */
export const tryAuthenticateInventoryUser = async (req: Request): Promise<boolean> => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return false;

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) return false;

    const decoded = jwt.verify(token, jwtSecret) as { id: string; role: string };
    if (!INVENTORY_USER_JWT_ROLES.has(decoded.role)) return false;

    const user = await User.findByPk(decoded.id, {
      attributes: ['id', 'username', 'name', 'role', 'is_active']
    });
    if (!user || !user.is_active) return false;

    req.user = {
      id: user.id,
      username: user.username,
      password: '',
      name: user.name,
      role: user.role as 'super-admin' | 'super-admin-manager' | 'admin' | 'agent' | 'account' | 'installer' | 'baldev' | 'confirmation' | 'hr' | 'metering',
      is_active: user.is_active
    };
    return true;
  } catch {
    return false;
  }
};

// Verify JWT token
export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      res.status(401).json({ error: 'Access denied. No token provided.' });
      return;
    }

    if (await tryAuthenticateInventoryUser(req)) {
      next();
      return;
    }

    res.status(401).json({ error: 'Invalid token or user inactive.' });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token.' });
  }
};

const normalizeRole = (role: string) =>
  role.toString().trim().toLowerCase().replace(/_/g, '-').replace(/\s+/g, '-');

// Role-based authorization middleware
export const authorize = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const userRole = normalizeRole(req.user.role);
    const allowedRoles = roles.map(normalizeRole);

    const isSuperAdminManagerLike =
      allowedRoles.includes('super-admin-manager') &&
      userRole.includes('super') &&
      userRole.includes('admin') &&
      userRole.includes('manager');

    if (!allowedRoles.includes(userRole) && !isSuperAdminManagerLike) {
      logInfo('Authorization denied', {
        role: req.user.role,
        normalizedRole: userRole,
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



