import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models';
import { logInfo } from '../utils/loggerHelper';

// Verify JWT token
export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      res.status(401).json({ error: 'Access denied. No token provided.' });
      return;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: string; role: string };
    
    // Verify user still exists and is active
    const user = await User.findByPk(decoded.id, {
      attributes: ['id', 'username', 'name', 'role', 'is_active']
    });

    if (!user || !user.is_active) {
      res.status(401).json({ error: 'Invalid token or user inactive.' });
      return;
    }

    // Assign user with proper typing for inventory system
    req.user = {
      id: user.id,
      username: user.username,
      password: '', // Not needed in request
      name: user.name,
      role: user.role as 'super-admin' | 'super-admin-manager' | 'admin' | 'agent' | 'account' | 'installer' | 'baldev' | 'confirmation' | 'hr',
      is_active: user.is_active
    };
    next();
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



