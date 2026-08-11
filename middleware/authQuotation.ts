import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Dealer, Visitor, InstallationTeam } from '../models/index-quotation';
import { isInstallationTeamJwtRole } from '../utils/installationTeamRole';
import { AccountManager, User } from '../models';
import { tryAuthenticateInventoryUser } from './auth';
import {
  isInventoryAdminLikeRole,
  isInventoryUserJwtRole,
  normalizeInventoryRole
} from '../utils/inventoryRole';

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

      // Installation field team (JWT; table login issues role installation-team + team id)
      if (isInstallationTeamJwtRole(decoded.role)) {
        const payload = decoded as { id: string; installationTeamId?: string };
        const teamId = (payload.installationTeamId || payload.id || '').trim();
        const team = teamId ? await InstallationTeam.findByPk(teamId) : null;
        if (!team || !team.isActive) {
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
          id: team.id,
          username: team.username,
          role: 'installation-team',
          installationTeamId: team.id,
          teamName: team.name,
          firstName: team.name,
          lastName: ''
        } as any;
        next();
        return;
      }

      // Check if it's an account manager
      if (
        decoded.role === 'account-management' ||
        decoded.role === 'installer' ||
        decoded.role === 'baldev' ||
        decoded.role === 'confirmation' ||
        decoded.role === 'hr' ||
        decoded.role === 'metering' ||
        decoded.role === 'meter' ||
        decoded.role === 'metering-team' ||
        decoded.role === 'mco'
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
      const decodedRole = normalizeInventoryRole(decoded.role) || decoded.role;
      if (isInventoryUserJwtRole(decoded.role) || isInventoryUserJwtRole(decodedRole)) {
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
          role: (normalizeInventoryRole(user.role) || user.role) as any
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

/** Inventory stock-out JWT (users table) or quotation-system JWT (dealers, visitors, account managers). */
export const authenticateInventoryOrQuotation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (await tryAuthenticateInventoryUser(req)) {
    next();
    return;
  }
  await authenticate(req, res, next);
};

/** Phone prefill from quotations — inventory agents + quotation readers. */
export const authorizeQuotationCustomerByPhone = (req: Request, res: Response, next: NextFunction): void => {
  const isDealerOrAdmin = req.dealer !== undefined;
  const isVisitor = req.visitor !== undefined;
  const isAccountManager = req.user && (req.user.role === 'account-management' || req.user.role === 'hr');
  const isInventoryStockOutRole =
    req.user &&
    (req.user.role === 'agent' ||
      req.user.role === 'admin' ||
      req.user.role === 'super-admin' ||
      req.user.role === 'super-admin-manager' ||
      req.user.role === 'account');

  if (isDealerOrAdmin || isVisitor || isAccountManager || isInventoryStockOutRole) {
    next();
    return;
  }

  authorizeDealerAdminOrVisitor(req, res, next);
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
  
  // Check Inventory System admin/super-admin (any username — not limited to "admin")
  const isInventoryAdmin = req.user && isInventoryAdminLikeRole(req.user.role);
  
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
        code: 'AUTH_003',
        message: 'User not authenticated'
      }
    });
    return;
  }
  next();
};

/** Visitor JWT or quotation-system dealer/admin (for visit reschedule from dealer dashboard). */
export const authorizeVisitorOrQuotationsDealer = (req: Request, res: Response, next: NextFunction): void => {
  if (req.visitor) {
    next();
    return;
  }
  if (req.dealer && (req.dealer.role === 'dealer' || req.dealer.role === 'admin')) {
    next();
    return;
  }
  // Inventory admins (User JWT) may reschedule any visit for support / ops (no req.dealer).
  if (req.user && isInventoryAdminLikeRole(req.user.role)) {
    next();
    return;
  }
  res.status(403).json({
    success: false,
    error: {
      code: 'AUTH_004',
      message: 'Insufficient permissions. Visitor, quotation dealer/admin, or inventory admin access required.'
    }
  });
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
    req.user.role === 'hr' ||
    req.user.role === 'metering' ||
    req.user.role === 'meter' ||
    req.user.role === 'metering-team' ||
    req.user.role === 'mco'
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

/** Account-manager installer or installation field team (not dealer admin). */
export const authorizeInstallerOrInstallationTeam = (req: Request, res: Response, next: NextFunction): void => {
  if (req.user && (req.user.role === 'installer' || isInstallationTeamJwtRole(req.user.role))) {
    next();
    return;
  }
  res.status(403).json({
    success: false,
    error: { code: 'AUTH_004', message: 'Insufficient permissions' }
  });
};

/** @deprecated Use authorizeInstallerOrInstallationTeam */
export const authorizeInstaller = authorizeInstallerOrInstallationTeam;

export const authorizeInstallerOrAdmin = (req: Request, res: Response, next: NextFunction): void => {
  // Quotation-system admin lives on `req.dealer` (Dealer row with role `admin`).
  if (req.dealer?.role === 'admin') {
    next();
    return;
  }
  if (
    req.user &&
    (req.user.role === 'installer' ||
      req.user.role === 'admin' ||
      req.user.role === 'super-admin' ||
      req.user.role === 'super-admin-manager' ||
      isInstallationTeamJwtRole(req.user.role))
  ) {
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

export const authorizeMetering = (req: Request, res: Response, next: NextFunction): void => {
  if (req.dealer?.role === 'admin') {
    next();
    return;
  }
  if (req.user && (
    req.user.role === 'admin' ||
    req.user.role === 'super-admin' ||
    req.user.role === 'super-admin-manager' ||
    req.user.role === 'metering' ||
    req.user.role === 'meter' ||
    req.user.role === 'metering-team' ||
    req.user.role === 'mco' ||
    // §17 Installer → Metering tab (same metering panel)
    req.user.role === 'installer' ||
    isInstallationTeamJwtRole(req.user.role)
  )) {
    next();
    return;
  }
  res.status(403).json({
    success: false,
    error: { code: 'AUTH_004', message: 'Insufficient permissions' }
  });
};

/** Metering workflow updates from quotation-scoped fallback routes (metering team, admin, or installer). */
export const authorizeMeteringOrAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (req.dealer?.role === 'admin') {
    next();
    return;
  }
  if (req.user && (
    req.user.role === 'admin' ||
    req.user.role === 'super-admin' ||
    req.user.role === 'super-admin-manager' ||
    req.user.role === 'metering' ||
    req.user.role === 'meter' ||
    req.user.role === 'metering-team' ||
    req.user.role === 'mco' ||
    req.user.role === 'installer' ||
    isInstallationTeamJwtRole(req.user.role)
  )) {
    next();
    return;
  }
  res.status(403).json({
    success: false,
    error: { code: 'AUTH_004', message: 'Insufficient permissions' }
  });
};

/** Inventory System roles that may edit any quotation (products/pricing), same as `authorizeAdmin` inventory branch. */
const isInventorySystemAdminRole = (role: string | undefined): boolean =>
  isInventoryAdminLikeRole(role);

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
  if (req.user && isInventorySystemAdminRole(req.user.role)) {
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

/** Admin / Baldev final confirmation uploads — §M (not KYC PATCH). */
export const authorizeFinalConfirmationUploader = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (
    req.user &&
    (
      req.user.role === 'baldev' ||
      req.user.role === 'confirmation' ||
      req.user.role === 'admin' ||
      req.user.role === 'super-admin' ||
      req.user.role === 'super-admin-manager'
    )
  ) {
    next();
    return;
  }
  res.status(403).json({
    success: false,
    error: {
      code: 'AUTH_004',
      message: 'Insufficient permissions'
    }
  });
};

// Allow quotation-document editors: dealer/admin, account-management/hr, baldev/confirmation.
export const authorizeQuotationDocumentsEditor = (req: Request, res: Response, next: NextFunction): void => {
  if (req.dealer) {
    next();
    return;
  }
  if (
    req.user &&
    (
      req.user.role === 'account-management' ||
      req.user.role === 'hr' ||
      req.user.role === 'baldev' ||
      req.user.role === 'confirmation' ||
      req.user.role === 'admin' ||
      req.user.role === 'super-admin' ||
      req.user.role === 'super-admin-manager'
    )
  ) {
    next();
    return;
  }
  res.status(403).json({
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

/**
 * Dealer Payments tab is read-only — regular dealers must not PATCH payment-details.
 * Account Management / inventory admin / quotation-system admin may write.
 */
export const authorizeAccountManagerOrAdminPayment = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const isQuotationAdmin = !!(req.dealer && req.dealer.role === 'admin');
  const isAccountManager =
    !!(req.user && (req.user.role === 'account-management' || req.user.role === 'hr'));
  const isInventoryAdmin = !!(req.user && isInventorySystemAdminRole(req.user.role));

  if (isQuotationAdmin || isAccountManager || isInventoryAdmin) {
    next();
    return;
  }

  res.status(403).json({
    success: false,
    error: {
      code: 'AUTH_004',
      message: 'Insufficient permissions. Payment details are Account Management only.'
    }
  });
};


