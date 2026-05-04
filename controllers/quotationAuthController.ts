import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { Dealer, Visitor, InstallationTeam } from '../models/index-quotation';
import { User, AccountManager, AccountManagerHistory } from '../models';
import { logError, logInfo } from '../utils/loggerHelper';
import { v4 as uuidv4 } from 'uuid';

// Login - for dealers and visitors
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_002',
          message: 'Username and password are required'
        }
      });
      return;
    }

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

    // Try dealer first
    let dealer = await Dealer.findOne({ where: { username } });
    if (dealer) {
      if (!dealer.isActive) {
        logError('Login attempt - account inactive', new Error('Account inactive'), { username, dealerId: dealer.id });
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_005',
            message: 'Account is pending approval. Please contact administrator.'
          }
        });
        return;
      }

      const isValidPassword = await bcrypt.compare(password, dealer.password);
      if (!isValidPassword) {
        logError('Login attempt - invalid password', new Error('Invalid password'), { username, dealerId: dealer.id });
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_001',
            message: 'Invalid username or password'
          }
        });
        return;
      }

      const expiresIn: string = process.env.JWT_EXPIRE || '7d';
      const token = jwt.sign(
        { id: dealer.id, role: dealer.role },
        jwtSecret,
        { expiresIn } as SignOptions
      );

      // Generate refresh token
      const refreshToken = jwt.sign(
        { id: dealer.id, role: dealer.role, type: 'refresh' },
        jwtSecret,
        { expiresIn: '30d' } as SignOptions
      );

      res.json({
        success: true,
        data: {
          token,
          refreshToken,
          user: {
            id: dealer.id,
            username: dealer.username,
            firstName: dealer.firstName,
            lastName: dealer.lastName,
            email: dealer.email,
            role: dealer.role
          },
          expiresIn: 3600
        }
      });
      return;
    }

    // Try visitor
    const visitor = await Visitor.findOne({ where: { username } });
    if (visitor) {
      if (!visitor.isActive) {
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_005',
            message: 'Account suspended'
          }
        });
        return;
      }

      const isValidPassword = await bcrypt.compare(password, visitor.password);
      if (!isValidPassword) {
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_001',
            message: 'Invalid username or password'
          }
        });
        return;
      }

      const expiresIn: string = process.env.JWT_EXPIRE || '7d';
      const token = jwt.sign(
        { id: visitor.id, role: 'visitor', type: 'visitor' },
        jwtSecret,
        { expiresIn } as SignOptions
      );

      const refreshToken = jwt.sign(
        { id: visitor.id, role: 'visitor', type: 'refresh' },
        jwtSecret,
        { expiresIn: '30d' } as SignOptions
      );

      res.json({
        success: true,
        data: {
          token,
          refreshToken,
          user: {
            id: visitor.id,
            username: visitor.username,
            firstName: visitor.firstName,
            lastName: visitor.lastName,
            email: visitor.email,
            role: 'visitor'
          },
          expiresIn: 3600
        }
      });
      return;
    }

    // Installation field team (username/password on installation_teams)
    const installationTeam = await InstallationTeam.findOne({ where: { username } });
    if (installationTeam) {
      if (!installationTeam.isActive) {
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_005',
            message: 'Account is inactive'
          }
        });
        return;
      }

      const isValidTeamPassword = await bcrypt.compare(password, installationTeam.password);
      if (!isValidTeamPassword) {
        logError('Login attempt - invalid password', new Error('Invalid password'), { username, installationTeamId: installationTeam.id });
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_001',
            message: 'Invalid username or password'
          }
        });
        return;
      }

      const expiresIn: string = process.env.JWT_EXPIRE || '7d';
      const token = jwt.sign(
        {
          id: installationTeam.id,
          role: 'installation-team',
          installationTeamId: installationTeam.id
        },
        jwtSecret,
        { expiresIn } as SignOptions
      );

      const refreshToken = jwt.sign(
        {
          id: installationTeam.id,
          role: 'installation-team',
          installationTeamId: installationTeam.id,
          type: 'refresh'
        },
        jwtSecret,
        { expiresIn: '30d' } as SignOptions
      );

      res.json({
        success: true,
        data: {
          token,
          refreshToken,
          user: {
            id: installationTeam.id,
            username: installationTeam.username,
            role: 'installation-team',
            installationTeamId: installationTeam.id,
            teamName: installationTeam.name,
            firstName: installationTeam.name,
            lastName: '',
            isActive: installationTeam.isActive
          },
          expiresIn: 3600
        }
      });
      return;
    }

    // Try Account Manager
    const accountManager = await AccountManager.findOne({ where: { username } });
    if (accountManager) {
      if (!accountManager.isActive) {
        logError('Login attempt - account manager inactive', new Error('Account manager inactive'), { username, accountManagerId: accountManager.id });
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_005',
            message: 'Account is deactivated'
          }
        });
        return;
      }

      const isValidPassword = await bcrypt.compare(password, accountManager.password);
      if (!isValidPassword) {
        logError('Login attempt - invalid password', new Error('Invalid password'), { username, accountManagerId: accountManager.id });
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_001',
            message: 'Invalid username or password'
          }
        });
        return;
      }

      // Update login count and last login
      const updatedLoginCount = (accountManager.loginCount || 0) + 1;
      await accountManager.update({
        loginCount: updatedLoginCount,
        lastLogin: new Date()
      });

      // Log login history
      try {
        await AccountManagerHistory.create({
          id: uuidv4(),
          accountManagerId: accountManager.id,
          action: 'login',
          details: 'User logged in successfully',
          ipAddress: req.headers['x-forwarded-for']?.toString().split(',')[0] 
            || req.headers['x-real-ip']?.toString()
            || req.ip 
            || req.socket?.remoteAddress 
            || 'unknown',
          userAgent: req.headers['user-agent'] || null,
          timestamp: new Date()
        });
      } catch (historyError) {
        // Log error but don't fail login
        logError('Failed to log account manager login history', historyError, { accountManagerId: accountManager.id });
      }

      const expiresIn: string = process.env.JWT_EXPIRE || '7d';
      const token = jwt.sign(
        { id: accountManager.id, role: accountManager.role },
        jwtSecret,
        { expiresIn } as SignOptions
      );

      const refreshToken = jwt.sign(
        { id: accountManager.id, role: accountManager.role, type: 'refresh' },
        jwtSecret,
        { expiresIn: '30d' } as SignOptions
      );

      // Reload account manager to get updated loginCount and lastLogin
      const updatedAccountManager = await AccountManager.findByPk(accountManager.id, {
        attributes: { exclude: ['password'] }
      });

      res.json({
        success: true,
        data: {
          token,
          refreshToken,
          user: {
            id: updatedAccountManager!.id,
            username: updatedAccountManager!.username,
            firstName: updatedAccountManager!.firstName,
            lastName: updatedAccountManager!.lastName,
            email: updatedAccountManager!.email,
            mobile: updatedAccountManager!.mobile || '',
            role: updatedAccountManager!.role,
            isActive: updatedAccountManager!.isActive,
            emailVerified: updatedAccountManager!.emailVerified || false,
            loginCount: updatedAccountManager!.loginCount,
            lastLogin: updatedAccountManager!.lastLogin,
            createdAt: updatedAccountManager!.createdAt
          },
          expiresIn: 3600
        }
      });
      return;
    }

    // Try User model (Inventory System) as fallback
    const user = await User.findOne({ where: { username } });
    if (user) {
      if (!user.is_active) {
        logError('Login attempt - account inactive', new Error('Account inactive'), { username, userId: user.id });
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_005',
            message: 'Account is inactive'
          }
        });
        return;
      }

      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        logError('Login attempt - invalid password', new Error('Invalid password'), { username, userId: user.id });
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_001',
            message: 'Invalid username or password'
          }
        });
        return;
      }

      const expiresIn: string = process.env.JWT_EXPIRE || '7d';
      const token = jwt.sign(
        { id: user.id, role: user.role },
        jwtSecret,
        { expiresIn } as SignOptions
      );

      const refreshToken = jwt.sign(
        { id: user.id, role: user.role, type: 'refresh' },
        jwtSecret,
        { expiresIn: '30d' } as SignOptions
      );

      res.json({
        success: true,
        data: {
          token,
          refreshToken,
          user: {
            id: user.id,
            username: user.username,
            firstName: user.name.split(' ')[0] || user.name,
            lastName: user.name.split(' ').slice(1).join(' ') || '',
            name: user.name,
            role: user.role
          },
          expiresIn: 3600
        }
      });
      return;
    }

    // User not found in any system
    logError(
      'Login attempt - user not found',
      new Error('User not found in dealers, visitors, installation teams, account managers, or users'),
      { username }
    );
    res.status(401).json({
      success: false,
      error: {
        code: 'AUTH_001',
        message: 'Invalid username or password'
      }
    });
  } catch (error) {
    logError('Login error', error, { username: req.body.username });
    res.status(500).json({
      success: false,
      error: {
        code: 'SYS_001',
        message: 'Internal server error'
      }
    });
  }
};

// Refresh token
export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_003',
          message: 'Invalid token'
        }
      });
      return;
    }

    const refreshToken = authHeader.substring(7);
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
      const decoded = jwt.verify(refreshToken, jwtSecret) as {
        id: string;
        role?: string;
        type?: string;
        installationTeamId?: string;
      };

      if (decoded.type !== 'refresh') {
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_003',
            message: 'Invalid refresh token'
          }
        });
        return;
      }

      const expiresIn: string = process.env.JWT_EXPIRE || '7d';
      const accessPayload: Record<string, string> = {
        id: decoded.id,
        role: decoded.role || ''
      };
      if (decoded.installationTeamId) {
        accessPayload.installationTeamId = decoded.installationTeamId;
      }
      const token = jwt.sign(accessPayload, jwtSecret, { expiresIn } as SignOptions);

      res.json({
        success: true,
        data: {
          token,
          expiresIn: 3600
        }
      });
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_002',
            message: 'Refresh token expired'
          }
        });
        return;
      }
      res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_003',
          message: 'Invalid refresh token'
        }
      });
    }
  } catch (error) {
    logError('Refresh token error', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SYS_001',
        message: 'Internal server error'
      }
    });
  }
};

// Logout
export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    // Log logout history for account managers
    if (req.user && (req.user.role === 'account-management' || req.user.role === 'hr')) {
      try {
        await AccountManagerHistory.create({
          id: uuidv4(),
          accountManagerId: req.user.id,
          action: 'logout',
          details: 'User logged out',
          ipAddress: req.headers['x-forwarded-for']?.toString().split(',')[0] 
            || req.headers['x-real-ip']?.toString()
            || req.ip 
            || req.socket?.remoteAddress 
            || 'unknown',
          userAgent: req.headers['user-agent'] || null,
          timestamp: new Date()
        });
      } catch (historyError) {
        // Log error but don't fail logout
        logError('Failed to log account manager logout history', historyError, { accountManagerId: req.user.id });
      }
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    logError('Logout error', error);
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  }
};

// Change password
export const changePassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_002',
          message: 'Current password and new password are required'
        }
      });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Password must be at least 6 characters long',
          details: [{
            field: 'newPassword',
            message: 'Password must be at least 6 characters long'
          }]
        }
      });
      return;
    }

    if (!req.user) {
      res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_003',
          message: 'User not authenticated'
        }
      });
      return;
    }

    // Check if dealer
    if (req.dealer) {
      const dealer = await Dealer.findByPk(req.dealer.id);
      if (!dealer) {
        res.status(404).json({
          success: false,
          error: {
            code: 'RES_001',
            message: 'User not found'
          }
        });
        return;
      }

      const isValidPassword = await bcrypt.compare(currentPassword, dealer.password);
      if (!isValidPassword) {
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_001',
            message: 'Current password is incorrect'
          }
        });
        return;
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await dealer.update({ password: hashedPassword });

      res.json({
        success: true,
        message: 'Password changed successfully'
      });
      return;
    }

    // Check if visitor
    if (req.visitor) {
      const visitor = await Visitor.findByPk(req.visitor.id);
      if (!visitor) {
        res.status(404).json({
          success: false,
          error: {
            code: 'RES_001',
            message: 'User not found'
          }
        });
        return;
      }

      const isValidPassword = await bcrypt.compare(currentPassword, visitor.password);
      if (!isValidPassword) {
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_001',
            message: 'Current password is incorrect'
          }
        });
        return;
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await visitor.update({ password: hashedPassword });

      res.json({
        success: true,
        message: 'Password changed successfully'
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
  } catch (error) {
    logError('Change password error', error, { userId: req.user?.id });
    res.status(500).json({
      success: false,
      error: {
        code: 'SYS_001',
        message: 'Internal server error'
      }
    });
  }
};

// Reset Password - User remembers old password
export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, oldPassword, newPassword } = req.body;

    // Validation
    if (!username || !oldPassword || !newPassword) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Validation error',
          details: [{
            field: !username ? 'username' : !oldPassword ? 'oldPassword' : 'newPassword',
            message: 'All fields are required'
          }]
        }
      });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Validation error',
          details: [{
            field: 'newPassword',
            message: 'New password must be at least 6 characters long'
          }]
        }
      });
      return;
    }

    // Find dealer by username
    const dealer = await Dealer.findOne({ where: { username } });
    if (!dealer) {
      // Don't reveal if user exists for security
      logError('Reset password attempt - user not found', new Error('User not found'), { username });
      res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid username or old password'
        }
      });
      return;
    }

    // Verify old password
    const isOldPasswordValid = await bcrypt.compare(oldPassword, dealer.password);
    if (!isOldPasswordValid) {
      logError('Reset password attempt - invalid old password', new Error('Invalid old password'), { username, dealerId: dealer.id });
      res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid username or old password'
        }
      });
      return;
    }

    // Check if new password is different from old password
    const isSamePassword = await bcrypt.compare(newPassword, dealer.password);
    if (isSamePassword) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Validation error',
          details: [{
            field: 'newPassword',
            message: 'New password must be different from old password'
          }]
        }
      });
      return;
    }

    // Hash and update password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await dealer.update({ password: hashedPassword });

    logInfo('Password reset successful', { username, dealerId: dealer.id });

    res.status(200).json({
      success: true,
      message: 'Password reset successfully',
      data: null
    });
  } catch (error) {
    logError('Reset password error', error, { username: req.body.username });
    res.status(500).json({
      success: false,
      error: {
        code: 'SYS_001',
        message: 'Internal server error'
      }
    });
  }
};

// Forgot Password - User forgot password, uses date of birth for verification
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, dateOfBirth, newPassword } = req.body;

    // Validation
    if (!username || !dateOfBirth || !newPassword) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Validation error',
          details: [{
            field: !username ? 'username' : !dateOfBirth ? 'dateOfBirth' : 'newPassword',
            message: 'All fields are required'
          }]
        }
      });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Validation error',
          details: [{
            field: 'newPassword',
            message: 'New password must be at least 6 characters long'
          }]
        }
      });
      return;
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateOfBirth)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Validation error',
          details: [{
            field: 'dateOfBirth',
            message: 'Date of birth must be in YYYY-MM-DD format'
          }]
        }
      });
      return;
    }

    // Find dealer by username
    const dealer = await Dealer.findOne({ where: { username } });
    if (!dealer) {
      // Don't reveal if user exists for security
      logError('Forgot password attempt - user not found', new Error('User not found'), { username });
      res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_VERIFICATION',
          message: 'Username or date of birth does not match our records'
        }
      });
      return;
    }

    // Verify date of birth (compare dates only, ignore time)
    const userDOB = new Date(dealer.dateOfBirth).toISOString().split('T')[0];
    const providedDOB = new Date(dateOfBirth).toISOString().split('T')[0];

    if (userDOB !== providedDOB) {
      logError('Forgot password attempt - invalid date of birth', new Error('Invalid date of birth'), { username, dealerId: dealer.id });
      res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_VERIFICATION',
          message: 'Username or date of birth does not match our records'
        }
      });
      return;
    }

    // Hash and update password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await dealer.update({ password: hashedPassword });

    logInfo('Password reset via forgot password successful', { username, dealerId: dealer.id });

    res.status(200).json({
      success: true,
      message: 'Password reset successfully',
      data: null
    });
  } catch (error) {
    logError('Forgot password error', error, { username: req.body.username });
    res.status(500).json({
      success: false,
      error: {
        code: 'SYS_001',
        message: 'Internal server error'
      }
    });
  }
};

//pushing
