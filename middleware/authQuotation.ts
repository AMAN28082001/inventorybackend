import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Dealer, Visitor } from '../models/index-quotation';
import { AccountManager, User } from '../models';

// Authenticate dealer or admin
export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_003',
          message: 'User not authenticated'
        }
      });
      return;
    }

    const token = authHeader.substring(7);
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      res.status(500).json({
        success: false,
        error: {
          code: 'SYS_001',
          message: 'JWT secret not configured'
        }
      });
      return;
    }

    try {
      const decoded = jwt.verify(token, jwtSecret) as { id: string; role?: string; type?: string };

      // Check if it's a dealer/admin
      if (decoded.role === 'dealer' || decoded.role === 'admin') {
        const dealer = await Dealer.findByPk(decoded.id);
        if (!dealer || !dealer.isActive) {
          res.status(401).json({
            success: false,
            error: {
              code: 'AUTH_005',
              message: 'Account suspended'
            }
          });
          return;
        }

        req.dealer = {
          id: dealer.id,
          username: dealer.username,
          role: dealer.role
        };
        req.user = {
          id: dealer.id,
          username: dealer.username,
          role: dealer.role
        };
        next();
        return;
      }

      // Check if it's a visitor
      if (decoded.role === 'visitor' || decoded.type === 'visitor') {
        const visitor = await Visitor.findByPk(decoded.id);
        if (!visitor || !visitor.isActive) {
          res.status(401).json({
            success: false,
            error: {
              code: 'AUTH_005',
              message: 'Account suspended'
            }
          });
          return;
        }

        req.visitor = {
          id: visitor.id,
          username: visitor.username
        };
        req.user = {
          id: visitor.id,
          username: visitor.username,
          role: 'visitor'
        };
        next();
        return;
      }

      // Check if it's an account manager
      if (
        decoded.role === 'account-management' ||
        decoded.role === 'installer' ||
        decoded.role === 'baldev' ||
        decoded.role === 'confirmation' ||
        decoded.role === 'hr'
      ) {
        const accountManager = await AccountManager.findByPk(decoded.id);
        if (!accountManager || !accountManager.isActive) {
          res.status(401).json({
            success: false,
            error: {
              code: 'AUTH_005',
              message: 'Account suspended'
            }
          });
          return;
        }

        req.user = {
          id: accountManager.id,
          username: accountManager.username,
          role: accountManager.role as any
        };
        next();
        return;
      }

      // Check if it's an Inventory System user (super-admin, admin, agent, account)
      if (
        decoded.role === 'super-admin' ||
        decoded.role === 'super-admin-manager' ||
        decoded.role === 'admin' ||
        decoded.role === 'agent' ||
        decoded.role === 'account' ||
        decoded.role === 'installer' ||
        decoded.role === 'baldev' ||
        decoded.role === 'confirmation' ||
        decoded.role === 'hr'
      ) {
        const user = await User.findByPk(decoded.id);
        if (!user || !user.is_active) {
          res.status(401).json({
            success: false,
            error: {
              code: 'AUTH_005',
              message: 'Account suspended'
            }
          });
          return;
        }

        req.user = {
          id: user.id,
          username: user.username,
          role: user.role as any
        } as any; // Type assertion needed due to union type differences
        next();
        return;
      }

      res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_003',
          message: 'User not authenticated'
        }
      });
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_002',
            message: 'Token expired'
          }
        });
        return;
      }
      res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_003',
          message: 'User not authenticated'
        }
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'SYS_001',
        message: 'Internal server error'
      }
    });
  }
};

// Authorize dealer only
export const authorizeDealer = (req: Request, res: Response, next: NextFunction): void => {
  if (req.user && (req.user.role === 'account-management' || req.user.role === 'hr')) {
    res.status(403).json({
      success: false,
      error: {
        code: 'AUTH_004',
        message: 'Insufficient permissions'
      }
    });
    return;
  }
  if (!req.dealer) {
    res.status(401).json({
      success: false,
      error: {
        code: 'AUTH_004',
        message: 'Insufficient permissions'
      }
    });
    return;
  }
  next();
};

// Authorize dealer or admin (both can access)
export const authorizeDealerOrAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (req.user && (req.user.role === 'account-management' || req.user.role === 'hr')) {
    res.status(403).json({
      success: false,
      error: {
        code: 'AUTH_004',
        message: 'Insufficient permissions'
      }
    });
    return;
  }
  if (!req.dealer) {
    res.status(401).json({
      success: false,
      error: {
        code: 'AUTH_004',
        message: 'Insufficient permissions'
      }
    });
    return;
  }
  // Both dealers and admins are stored in Dealer model, so req.dealer exists for both
  next();
};

// Authorize admin only (Quotation System admin OR Inventory System admin/super-admin)
export const authorizeAdmin = (req: Request, res: Response, next: NextFunction): void => {
  // Check Quotation System admin (dealer with role 'admin')
  const isQuotationAdmin = req.dealer && req.dealer.role === 'admin';
  
  // Check Inventory System admin/super-admin
  const isInventoryAdmin = req.user && (
    req.user.role === 'admin' || 
    req.user.role === 'super-admin' ||
    req.user.role === 'super-admin-manager'
  );
  
  if (!isQuotationAdmin && !isInventoryAdmin) {
    res.status(403).json({
      success: false,
      error: {
        code: 'AUTH_004',
        message: 'Insufficient permissions. Admin access required.'
      }
    });
    return;
  }
  next();
};

// Authorize visitor only
export const authorizeVisitor = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.visitor) {
    res.status(401).json({
      success: false,
      error: {
        code: 'AUTH_004',
        message: 'Insufficient permissions'
      }
    });
    return;
  }
  next();
};

// Authorize dealer, admin, visitor, or account manager (for read operations)
export const authorizeDealerAdminOrVisitor = (req: Request, res: Response, next: NextFunction): void => {
  // Allow dealers/admins, visitors, or account managers
  const isDealerOrAdmin = req.dealer !== undefined;
  const isVisitor = req.visitor !== undefined;
  const isAccountManager = req.user && (req.user.role === 'account-management' || req.user.role === 'hr');
  const isInventoryUser = req.user && (
    req.user.role === 'agent' ||
    req.user.role === 'admin' ||
    req.user.role === 'super-admin' ||
    req.user.role === 'super-admin-manager' ||
    req.user.role === 'account' ||
    req.user.role === 'installer' ||
    req.user.role === 'baldev' ||
    req.user.role === 'confirmation' ||
    req.user.role === 'hr'
  );
  
  if (!isDealerOrAdmin && !isVisitor && !isAccountManager && !isInventoryUser) {
    res.status(401).json({
      success: false,
      error: {
        code: 'AUTH_004',
        message: 'Insufficient permissions'
      }
    });
    return;
  }
  next();
};

export const authorizeInstaller = (req: Request, res: Response, next: NextFunction): void => {
  if (req.user && req.user.role === 'installer') {
    next();
    return;
  }
  res.status(403).json({
    success: false,
    error: { code: 'AUTH_004', message: 'Insufficient permissions' }
  });
};

export const authorizeBaldev = (req: Request, res: Response, next: NextFunction): void => {
  if (req.user && (req.user.role === 'baldev' || req.user.role === 'confirmation')) {
    next();
    return;
  }
  res.status(403).json({
    success: false,
    error: { code: 'AUTH_004', message: 'Insufficient permissions' }
  });
};

// Allow dealer/admin or account manager
export const authorizeDealerOrAccountManager = (req: Request, res: Response, next: NextFunction): void => {
  if (req.dealer) {
    next();
    return;
  }
  if (req.user && (req.user.role === 'account-management' || req.user.role === 'hr')) {
    next();
    return;
  }
  res.status(401).json({
    success: false,
    error: {
      code: 'AUTH_004',
      message: 'Insufficient permissions'
    }
  });
};

// Reject account managers (used to hard-block read endpoints beyond approved list)
export const rejectAccountManager = (req: Request, res: Response, next: NextFunction): void => {
  if (req.user && (req.user.role === 'account-management' || req.user.role === 'hr')) {
    res.status(403).json({
      success: false,
      error: {
        code: 'AUTH_004',
        message: 'Insufficient permissions'
      }
    });
    return;
  }
  next();
};

// Allow dealer/admin or account manager for payment updates
export const authorizeDealerOrAccountManagerPayment = (req: Request, res: Response, next: NextFunction): void => {
  if (req.dealer) {
    next();
    return;
  }
  if (req.user && (req.user.role === 'account-management' || req.user.role === 'hr')) {
    next();
    return;
  }
  res.status(401).json({
    success: false,
    error: {
      code: 'AUTH_004',
      message: 'Insufficient permissions'
    }
  });
};


