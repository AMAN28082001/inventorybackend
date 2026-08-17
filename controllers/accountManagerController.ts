import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { AccountManager, AccountManagerHistory } from '../models';
import { Op } from 'sequelize';
import { logError, logInfo } from '../utils/loggerHelper';
import {
  accessFromRole,
  normalizeAccess,
  parseAccessFromBody,
  primaryRoleFromAccess,
  publicAccountManagerForApi
} from '../utils/userAccess';
import { parseProfilePatchFromBody } from '../utils/userProfile';
import { filterByListAccess, paginateRows, parseAccessQueryFromReq } from '../utils/accessLists';

const toPublicAccountManager = (am: AccountManager) => {
  const json = am.toJSON() as Record<string, unknown>;
  delete json.password;
  return publicAccountManagerForApi(json);
};

// Helper function to log account manager activity
const logAccountManagerActivity = async (
  accountManagerId: string,
  action: string,
  details?: string,
  req?: Request
): Promise<void> => {
  try {
    await AccountManagerHistory.create({
      id: uuidv4(),
      accountManagerId,
      action,
      details: details || `${action} performed`,
      ipAddress: req?.ip || req?.socket?.remoteAddress || null,
      userAgent: req?.headers['user-agent'] || null,
      timestamp: new Date()
    });
  } catch (error) {
    logError('Failed to log account manager activity', error, { accountManagerId, action });
  }
};

// Get all account managers
export const getAllAccountManagers = async (req: Request, res: Response): Promise<void> => {
  try {
    // Authorization is handled by middleware (authorizeAdmin)

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 1000, 1000);
    const search = req.query.search as string;
    const isActive = req.query.isActive as string;
    const sortBy = (req.query.sortBy as string) || 'createdAt';
    const sortOrder = (req.query.sortOrder as string) || 'desc';
    const accessKey = parseAccessQueryFromReq(req);

    const where: any = {};

    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    if (search) {
      where[Op.or] = [
        { firstName: { [Op.iLike]: `%${search}%` } },
        { lastName: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { mobile: { [Op.iLike]: `%${search}%` } },
        { username: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const accountManagers = await AccountManager.findAll({
      where,
      attributes: { exclude: ['password'] },
      order: [[sortBy, sortOrder.toUpperCase()]]
    });

    const mapped = accountManagers.map((am) => toPublicAccountManager(am));
    const filtered = filterByListAccess(mapped, accessKey);
    const paged = paginateRows(filtered, page, limit);

    res.json({
      success: true,
      data: {
        accountManagers: paged.rows,
        pagination: {
          page: paged.page,
          limit: paged.limit,
          total: paged.total,
          totalPages: paged.totalPages,
          hasNext: paged.hasNext,
          hasPrev: paged.hasPrev
        }
      }
    });
  } catch (error) {
    logError('Get all account managers error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Get account manager by ID
export const getAccountManagerById = async (req: Request, res: Response): Promise<void> => {
  try {

    const { accountManagerId } = req.params;
    const accountManager = await AccountManager.findByPk(accountManagerId, {
      attributes: { exclude: ['password'] }
    });

    if (!accountManager) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Account manager not found' }
      });
      return;
    }

    res.json({
      success: true,
      data: toPublicAccountManager(accountManager)
    });
  } catch (error) {
    logError('Get account manager by ID error', error, { accountManagerId: req.params.accountManagerId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Create account manager
export const createAccountManager = async (req: Request, res: Response): Promise<void> => {
  try {
    // Authorization is handled by middleware (authorizeAdmin)
    const { username, password, firstName, lastName, email, mobile } = req.body;
    const accessParse = parseAccessFromBody(req.body || {});
    if (accessParse.error) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: accessParse.error }
      });
      return;
    }

    const bodyRole = req.body.role ? String(req.body.role).trim() : '';
    const access =
      accessParse.access && accessParse.access.length
        ? accessParse.access
        : bodyRole
          ? accessFromRole(bodyRole)
          : [];
    const role =
      (bodyRole === 'confirmation' ? 'baldev' : bodyRole) ||
      (access.length ? primaryRoleFromAccess(access) : 'account-management');
    const finalAccess = access.length ? access : accessFromRole(role);

    if (!finalAccess.length) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Select at least one dashboard access.',
          details: [{ field: 'access', message: 'access is required' }]
        }
      });
      return;
    }

    const allowedRoles = ['account-management', 'installer', 'baldev', 'hr', 'metering', 'admin'];
    if (!allowedRoles.includes(role)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Validation error',
          details: [{ field: 'role', message: 'Role must be one of: account-management, installer, baldev, hr, metering, admin' }]
        }
      });
      return;
    }

    // Check if username already exists
    const existingUsername = await AccountManager.findOne({ where: { username } });
    if (existingUsername) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Validation error',
          details: [{ field: 'username', message: 'Username already exists' }]
        }
      });
      return;
    }

    // Check if email already exists
    const existingEmail = await AccountManager.findOne({ where: { email } });
    if (existingEmail) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Validation error',
          details: [{ field: 'email', message: 'Email already exists' }]
        }
      });
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const profile = parseProfilePatchFromBody(req.body || {});
    const accountManager = await AccountManager.create({
      id: uuidv4(),
      username,
      password: hashedPassword,
      firstName,
      lastName,
      email,
      mobile,
      role,
      access: finalAccess,
      isActive: true,
      emailVerified: false,
      loginCount: 0,
      lastLogin: null,
      createdBy: req.user?.id || null,
      ...profile
    });

    // Log activity
    await logAccountManagerActivity(accountManager.id, 'account_created', 'Account manager created by admin', req);

    logInfo('Account manager created', { accountManagerId: accountManager.id, createdBy: req.user?.id });

    res.status(201).json({
      success: true,
      data: toPublicAccountManager(accountManager),
      message: 'Account manager created successfully'
    });
  } catch (error) {
    logError('Create account manager error', error, { createdBy: req.user?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Update account manager
export const updateAccountManager = async (req: Request, res: Response): Promise<void> => {
  try {
    // Authorization is handled by middleware (authorizeAdmin)
    const { accountManagerId } = req.params;
    const { firstName, lastName, email, mobile, password, role, isActive, emailVerified } = req.body;

    const accountManager = await AccountManager.findByPk(accountManagerId);

    if (!accountManager) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Account manager not found' }
      });
      return;
    }

    // Check if email is already taken by another account manager
    if (email && email !== accountManager.email) {
      const existingEmail = await AccountManager.findOne({
        where: { email, id: { [Op.ne]: accountManager.id } }
      });
      if (existingEmail) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_001',
            message: 'Validation error',
            details: [{ field: 'email', message: 'Email already exists' }]
          }
        });
        return;
      }
    }

    // Update fields
    const updateData: any = {};
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (email !== undefined) updateData.email = email;
    if (mobile !== undefined) updateData.mobile = mobile;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (emailVerified !== undefined) updateData.emailVerified = emailVerified;
    Object.assign(updateData, parseProfilePatchFromBody(req.body || {}));

    const accessParse = parseAccessFromBody(req.body || {});
    if (accessParse.error) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: accessParse.error }
      });
      return;
    }
    if (accessParse.access) {
      updateData.access = accessParse.access;
      if (role !== undefined) updateData.role = role;
      else updateData.role = primaryRoleFromAccess(accessParse.access);
    } else if (role !== undefined) {
      updateData.role = role;
      const existingAccess = normalizeAccess((accountManager as any).access);
      if (!existingAccess.length) {
        updateData.access = accessFromRole(role);
      }
    }
    
    // Handle password update: if provided and not empty, hash and update it
    // If empty string or not provided, keep current password
    if (password !== undefined && password !== null && password !== '') {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateData.password = hashedPassword;
      // Log password change activity
      await logAccountManagerActivity(accountManager.id, 'password_change', 'Password changed by admin', req);
    }

    await accountManager.update(updateData);

    // Log activity
    await logAccountManagerActivity(accountManager.id, 'profile_update', 'Account manager profile updated by admin', req);

    const updatedAccountManager = await AccountManager.findByPk(accountManager.id, {
      attributes: { exclude: ['password'] }
    });

    res.json({
      success: true,
      data: toPublicAccountManager(updatedAccountManager!),
      message: 'Account manager updated successfully'
    });
  } catch (error) {
    logError('Update account manager error', error, { accountManagerId: req.params.accountManagerId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Update account manager password
export const updateAccountManagerPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    // Authorization is handled by middleware (authorizeAdmin)
    const { accountManagerId } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Validation error',
          details: [{ field: 'newPassword', message: 'Password must be at least 8 characters long' }]
        }
      });
      return;
    }

    const accountManager = await AccountManager.findByPk(accountManagerId);

    if (!accountManager) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Account manager not found' }
      });
      return;
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await accountManager.update({ password: hashedPassword });

    // Log activity
    await logAccountManagerActivity(accountManager.id, 'password_change', 'Password changed by admin', req);

    res.json({
      success: true,
      message: 'Password updated successfully'
    });
  } catch (error) {
    logError('Update account manager password error', error, { accountManagerId: req.params.accountManagerId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Activate account manager
export const activateAccountManager = async (req: Request, res: Response): Promise<void> => {
  try {
    // Authorization is handled by middleware (authorizeAdmin)
    const { accountManagerId } = req.params;
    const accountManager = await AccountManager.findByPk(accountManagerId);

    if (!accountManager) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Account manager not found' }
      });
      return;
    }

    await accountManager.update({ isActive: true });

    // Log activity
    await logAccountManagerActivity(accountManager.id, 'account_activated', 'Account manager activated by admin', req);

    res.json({
      success: true,
      data: {
        id: accountManager.id,
        isActive: true
      },
      message: 'Account manager activated successfully'
    });
  } catch (error) {
    logError('Activate account manager error', error, { accountManagerId: req.params.accountManagerId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Deactivate account manager
export const deactivateAccountManager = async (req: Request, res: Response): Promise<void> => {
  try {
    // Authorization is handled by middleware (authorizeAdmin)
    const { accountManagerId } = req.params;
    const accountManager = await AccountManager.findByPk(accountManagerId);

    if (!accountManager) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Account manager not found' }
      });
      return;
    }

    await accountManager.update({ isActive: false });

    // Log activity
    await logAccountManagerActivity(accountManager.id, 'account_deactivated', 'Account manager deactivated by admin', req);

    res.json({
      success: true,
      data: {
        id: accountManager.id,
        isActive: false
      },
      message: 'Account manager deactivated successfully'
    });
  } catch (error) {
    logError('Deactivate account manager error', error, { accountManagerId: req.params.accountManagerId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Delete account manager (hard delete)
export const deleteAccountManager = async (req: Request, res: Response): Promise<void> => {
  try {
    // Authorization is handled by middleware (authorizeAdmin)
    const { accountManagerId } = req.params;
    const accountManager = await AccountManager.findByPk(accountManagerId);

    if (!accountManager) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Account manager not found' }
      });
      return;
    }

    await accountManager.destroy();

    logInfo('Account manager deleted', { accountManagerId, deletedBy: req.user?.id });

    res.json({
      success: true,
      message: 'Account manager deleted successfully'
    });
  } catch (error) {
    logError('Delete account manager error', error, { accountManagerId: req.params.accountManagerId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Get account manager history
export const getAccountManagerHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    // Authorization is handled by middleware (authorizeAdmin)
    const { accountManagerId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = (page - 1) * limit;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    // Verify account manager exists
    const accountManager = await AccountManager.findByPk(accountManagerId);
    if (!accountManager) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Account manager not found' }
      });
      return;
    }

    const where: any = { accountManagerId };

    // Add date range filter if provided
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) {
        where.timestamp[Op.gte] = new Date(startDate);
      }
      if (endDate) {
        where.timestamp[Op.lte] = new Date(endDate);
      }
    }

    const history = await AccountManagerHistory.findAndCountAll({
      where,
      limit,
      offset,
      order: [['timestamp', 'DESC']]
    });

    res.json({
      success: true,
      data: {
        history: history.rows.map(h => ({
          id: h.id,
          action: h.action,
          timestamp: h.timestamp,
          details: h.details,
          description: h.details, // Alias for details
          ipAddress: h.ipAddress,
          userAgent: h.userAgent
        })),
        pagination: {
          page,
          limit,
          total: history.count,
          totalPages: Math.ceil(history.count / limit),
          hasNext: page < Math.ceil(history.count / limit),
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    logError('Get account manager history error', error, { accountManagerId: req.params.accountManagerId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};
