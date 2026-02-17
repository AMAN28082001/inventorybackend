import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models';
import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';
import { logError, logInfo } from '../utils/loggerHelper';

// Get all users (with role-based filtering for agents)
export const getAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { role } = req.query;
    const where: any = {};

    if (!req.user) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const userRole = req.user.role;
    const userId = req.user.id;

    // Role-based filtering primarily focused on agents
    if (userRole === 'admin') {
      // Admins only see their own agents
      where.role = 'agent';
      where.created_by_id = userId;
    } else if (userRole === 'account') {
      // Account role sees all agents by default
      if (role) {
        where.role = role;
      } else {
        where.role = 'agent';
      }
    } else if (userRole === 'super-admin') {
      // Super-admin can see any role, optionally filtered by query
      if (role) {
        where.role = role;
      }
    } else {
      // Agents and other roles are not allowed here
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const users = await User.findAll({
      where,
      attributes: [
        'id',
        'username',
        'name',
        'role',
        'is_active',
        'created_by_id',
        'created_by_name',
        'created_at',
        'updated_at'
      ],
      order: [['created_at', 'DESC']]
    });

    logInfo('Get all users', { count: users.length, role: role as string || 'all', userId: req.user?.id });
    res.json(users);
  } catch (error) {
    logError('Get all users error', error, { userId: req.user?.id });
    res.status(500).json({ error: 'Server error' });
  }
};

// Get user by ID
export const getUserById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id, {
      attributes: [
        'id',
        'username',
        'name',
        'role',
        'is_active',
        'created_by_id',
        'created_by_name',
        'created_at',
        'updated_at'
      ]
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    logInfo('Get user by ID', { userId: id, requestedBy: req.user?.id });
    res.json(user);
  } catch (error) {
    logError('Get user by ID error', error, { userId: req.params.id, requestedBy: req.user?.id });
    res.status(500).json({ error: 'Server error' });
  }
};

// Create user
export const createUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password, name, role } = req.body;

    if (!username || !password || !name || !role) {
      res.status(400).json({ error: 'All fields are required' });
      return;
    }

    if (!req.user) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const validRoles = ['super-admin', 'super-admin-manager', 'admin', 'agent', 'account'];
    if (!validRoles.includes(role)) {
      res.status(400).json({ error: 'Invalid role' });
      return;
    }

    if (role === 'super-admin-manager' && req.user.role !== 'super-admin') {
      res.status(403).json({ error: 'Only super-admin can create super-admin-manager accounts' });
      return;
    }

    if (req.user.role !== 'super-admin') {
      if (req.user.role === 'admin' && role !== 'agent') {
        res.status(403).json({ error: 'Admins can only create agent accounts' });
        return;
      }

      if (req.user.role !== 'admin') {
        res.status(403).json({ error: 'You do not have permission to create users' });
        return;
      }
    }

    // Check if username already exists
    const existingUser = await User.findOne({ where: { username } });

    if (existingUser) {
      res.status(400).json({ error: 'Username already exists' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const id = uuidv4();
    const isActive = req.user.role === 'super-admin';

    const newUser = await User.create({
      id,
      username,
      password: hashedPassword,
      name,
      role,
      is_active: isActive,
      created_by_id: req.user.id,
      created_by_name: (req.user as any).name || req.user.username
    });

    res.status(201).json({
      id: newUser.id,
      username: newUser.username,
      name: newUser.name,
      role: newUser.role,
      is_active: newUser.is_active,
      created_by_id: newUser.created_by_id,
      created_by_name: newUser.created_by_name,
      created_at: newUser.created_at,
      updated_at: newUser.updated_at
    });
    logInfo('User created', { userId: newUser.id, username: newUser.username, role: newUser.role, createdBy: req.user?.id });
  } catch (error) {
    logError('Create user error', error, { username: req.body.username, createdBy: req.user?.id });
    res.status(500).json({ error: 'Server error' });
  }
};

// Update user
export const updateUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { username, password, name, role, is_active } = req.body;

    if (!req.user) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const user = await User.findByPk(id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (req.user.role === 'account') {
      if (user.role !== 'agent') {
        res.status(403).json({ error: 'Account role can only approve agents' });
        return;
      }
      const onlyIsActive = Object.keys(req.body).every((key) => key === 'is_active');
      if (!onlyIsActive) {
        res.status(403).json({ error: 'Account role can only update is_active' });
        return;
      }
    }

    const updates: any = {};

    if (username) {
      // Check if username is already taken by another user
      const existingUser = await User.findOne({
        where: { username, id: { [Op.ne]: id } }
      });
      if (existingUser) {
        res.status(400).json({ error: 'Username already exists' });
        return;
      }
      updates.username = username;
    }

    if (password) {
      updates.password = await bcrypt.hash(password, 10);
    }

    if (name) {
      updates.name = name;
    }

    if (role) {
      const validRoles = ['super-admin', 'super-admin-manager', 'admin', 'agent', 'account'];
      if (!validRoles.includes(role)) {
        res.status(400).json({ error: 'Invalid role' });
        return;
      }
      updates.role = role;
    }

    if (is_active !== undefined) {
      updates.is_active = is_active;
    }

    await user.update(updates);

    res.json({
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      is_active: user.is_active,
      created_by_id: user.created_by_id,
      created_by_name: user.created_by_name,
      created_at: user.created_at,
      updated_at: user.updated_at
    });
    logInfo('User updated', { userId: id, updatedBy: req.user?.id, updates: Object.keys(updates) });
  } catch (error) {
    logError('Update user error', error, { userId: req.params.id, updatedBy: req.user?.id });
    res.status(500).json({ error: 'Server error' });
  }
};

// Delete user
export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!req.user) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    // Prevent deleting yourself
    if (id === req.user.id) {
      res.status(400).json({ error: 'Cannot delete your own account' });
      return;
    }

    const user = await User.findByPk(id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    await user.destroy();
    logInfo('User deleted', { userId: id, deletedBy: req.user?.id, username: user.username });
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    logError('Delete user error', error, { userId: req.params.id, deletedBy: req.user?.id });
    res.status(500).json({ error: 'Server error' });
  }
};

