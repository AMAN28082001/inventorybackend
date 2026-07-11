import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { User } from '../models';
import { Dealer } from '../models/index-quotation';
import { logError } from '../utils/loggerHelper';
import { isQuotationAdminInventorySession, normalizeInventoryRole } from '../utils/inventoryRole';

// Login
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const user = await User.findOne({ where: { username } });

    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (!user.is_active) {
      res.status(401).json({ error: 'Account is inactive' });
      return;
    }

    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      res.status(500).json({ error: 'JWT secret not configured' });
      return;
    }

    const expiresIn: string = process.env.JWT_EXPIRE || '7d';
    const canonicalRole = normalizeInventoryRole(user.role) || user.role;
    const token = jwt.sign(
      { id: user.id, role: canonicalRole },
      jwtSecret,
      { expiresIn } as SignOptions
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: canonicalRole,
        is_active: user.is_active,
        created_by_id: user.created_by_id,
        created_by_name: user.created_by_name
      }
    });
  } catch (error) {
    logError('Login error', error, { username: req.body.username });
    res.status(500).json({ error: 'Server error during login' });
  }
};

// Get current user (inventory User OR quotation Admin session — no re-login)
export const getCurrentUser = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    // Quotation Admin already logged in via POST /api/auth/login — reuse same JWT (§AD)
    if (isQuotationAdminInventorySession(req.user as { authSource?: string })) {
      let dealerId = req.user.id;
      let username = req.user.username;
      let name = (req.user as { name?: string }).name || req.user.username;

      if (req.dealer) {
        dealerId = req.dealer.id;
        username = req.dealer.username;
      } else {
        const dealer = await Dealer.findByPk(req.user.id, {
          attributes: ['id', 'username', 'firstName', 'lastName', 'role', 'isActive']
        });
        if (!dealer || !dealer.isActive || dealer.role !== 'admin') {
          res.status(401).json({ error: 'Invalid token or user inactive.' });
          return;
        }
        dealerId = dealer.id;
        username = dealer.username;
        name = `${dealer.firstName || ''} ${dealer.lastName || ''}`.trim() || dealer.username;
      }

      res.json({
        id: dealerId,
        username,
        name,
        role: 'super-admin',
        is_active: true,
        created_by_id: null,
        created_by_name: null,
        created_at: null,
        authSource: 'quotation-admin',
        auth_source: 'quotation-admin',
        inventoryAccess: true,
        inventory_access: true,
        requiresInventoryLogin: false,
        requires_inventory_login: false
      });
      return;
    }

    const user = await User.findByPk(req.user.id, {
      attributes: [
        'id',
        'username',
        'name',
        'role',
        'is_active',
        'created_by_id',
        'created_by_name',
        'created_at'
      ]
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const role = normalizeInventoryRole(user.role) || user.role;
    res.json({
      ...user.toJSON(),
      role,
      authSource: 'inventory-user',
      auth_source: 'inventory-user',
      inventoryAccess: true,
      inventory_access: true,
      requiresInventoryLogin: false,
      requires_inventory_login: false
    });
  } catch (error) {
    logError('Get current user error', error, { userId: req.user?.id });
    res.status(500).json({ error: 'Server error' });
  }
};

// Forgot password - Generate reset token
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username } = req.body;

    if (!username) {
      res.status(400).json({ error: 'Username is required' });
      return;
    }

    const user = await User.findOne({ where: { username } });

    if (!user) {
      // Don't reveal if user exists or not for security
      res.json({
        message: 'If the username exists, a password reset token has been generated'
      });
      return;
    }

    if (!user.is_active) {
      res.status(401).json({ error: 'Account is inactive. Please contact administrator' });
      return;
    }

    // Generate reset token (expires in 1 hour)
    const resetToken = jwt.sign(
      { id: user.id, type: 'password_reset' },
      process.env.JWT_SECRET as string,
      { expiresIn: '1h' }
    );

    // In a production system, you would send this token via email
    // For now, we'll return it in the response (in production, remove this)
    res.json({
      message: 'Password reset token generated successfully',
      resetToken: resetToken, // Remove this in production and send via email instead
      expiresIn: '1 hour'
    });
  } catch (error) {
    logError('Forgot password error', error, { username: req.body.username });
    res.status(500).json({ error: 'Server error' });
  }
};

// Reset password - Reset password using token
export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken || !newPassword) {
      res.status(400).json({ error: 'Reset token and new password are required' });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters long' });
      return;
    }

    // Verify reset token
    let decoded: { id: string; type?: string };
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET as string) as { id: string; type?: string };

      if (decoded.type !== 'password_reset') {
        res.status(400).json({ error: 'Invalid reset token' });
        return;
      }
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        res.status(400).json({ error: 'Reset token has expired. Please request a new one' });
        return;
      }
      res.status(400).json({ error: 'Invalid reset token' });
      return;
    }

    const user = await User.findByPk(decoded.id);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (!user.is_active) {
      res.status(401).json({ error: 'Account is inactive. Please contact administrator' });
      return;
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await user.update({ password: hashedPassword });

    res.json({
      message: 'Password reset successfully. Please login with your new password'
    });
  } catch (error) {
    logError('Reset password error', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Change password - For authenticated users
export const changePassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current password and new password are required' });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters long' });
      return;
    }

    if (!req.user) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const user = await User.findByPk(req.user.id);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);

    if (!isValidPassword) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    // Check if new password is same as current
    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      res.status(400).json({ error: 'New password must be different from current password' });
      return;
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await user.update({ password: hashedPassword });

    res.json({
      message: 'Password changed successfully'
    });
  } catch (error) {
    logError('Change password error', error, { userId: req.user?.id });
    res.status(500).json({ error: 'Server error' });
  }
};

// Get mapped dealer for inventory agent (for quotation access)
export const getAgentDealerMapping = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    if (req.user.role !== 'agent') {
      res.status(403).json({ error: 'Only agents can access dealer mapping' });
      return;
    }    let dealer: Dealer | null = null;
    const dealerById = await Dealer.findByPk(req.user.id);
    if (dealerById) {
      dealer = dealerById;
    } else if (req.user.username) {
      const dealerByUsername = await Dealer.findOne({ where: { username: req.user.username } });
      if (dealerByUsername) {
        dealer = dealerByUsername;
      } else if (req.user.username.includes('@')) {
        dealer = await Dealer.findOne({ where: { email: req.user.username } });
      } else if (/^\d{8,}$/.test(req.user.username)) {
        dealer = await Dealer.findOne({ where: { mobile: req.user.username } });
      }
    }

    if (!dealer) {
      res.status(404).json({
        success: false,
        error: { code: 'AUTH_004', message: 'No dealer mapping found for agent' }
      });
      return;
    }

    res.json({
      success: true,
      data: {
        dealerId: dealer.id,
        dealer: {
          id: dealer.id,
          firstName: dealer.firstName,
          lastName: dealer.lastName,
          email: dealer.email,
          mobile: dealer.mobile,
          username: dealer.username
        }
      }
    });
  } catch (error) {
    logError('Get agent dealer mapping error', error, { userId: req.user?.id });
    res.status(500).json({ error: 'Server error' });
  }
};