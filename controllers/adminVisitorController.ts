import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { Visitor, VisitAssignment, Visit } from '../models/index-quotation';
import { Op } from 'sequelize';
import { logError, logInfo } from '../utils/loggerHelper';

// Create visitor (admin)
export const createVisitor = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer || req.dealer.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const { username, password, firstName, lastName, email, mobile, employeeId } = req.body;

    // Check if username already exists
    const existingVisitor = await Visitor.findOne({ where: { username } });
    if (existingVisitor) {
      res.status(400).json({
        success: false,
        error: {
          code: 'RES_002',
          message: 'Username already exists',
          details: [{ field: 'username', message: 'Username already exists' }]
        }
      });
      return;
    }

    // Check if email already exists
    if (email) {
      const existingEmail = await Visitor.findOne({ where: { email } });
      if (existingEmail) {
        res.status(400).json({
          success: false,
          error: {
            code: 'RES_002',
            message: 'Email already exists',
            details: [{ field: 'email', message: 'Email already exists' }]
          }
        });
        return;
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const visitor = await Visitor.create({
      id: uuidv4(),
      username,
      password: hashedPassword,
      firstName,
      lastName,
      email,
      mobile,
      employeeId: employeeId || null,
      isActive: true
    });

    logInfo('Visitor created by admin', { visitorId: visitor.id, createdBy: req.dealer.id });

    res.status(201).json({
      success: true,
      data: {
        id: visitor.id,
        username: visitor.username,
        firstName: visitor.firstName,
        lastName: visitor.lastName,
        email: visitor.email,
        mobile: visitor.mobile,
        employeeId: visitor.employeeId,
        createdBy: req.dealer.id,
        isActive: visitor.isActive,
        createdAt: visitor.createdAt
      }
    });
  } catch (error) {
    logError('Create visitor error', error, { createdBy: req.dealer?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Get all visitors (admin)
export const getAllVisitors = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer || req.dealer.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;
    const search = req.query.search as string;
    const isActive = req.query.isActive as string;
    const sortBy = (req.query.sortBy as string) || 'createdAt';
    const sortOrder = (req.query.sortOrder as string) || 'desc';

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
        { employeeId: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const visitors = await Visitor.findAndCountAll({
      where,
      attributes: { exclude: ['password'] },
      limit,
      offset,
      order: [[sortBy, sortOrder.toUpperCase()]]
    });

    // Get visit counts for each visitor
    const visitorsWithStats = await Promise.all(
      visitors.rows.map(async (visitor) => {
        const visitCount = await VisitAssignment.count({
          where: { visitorId: visitor.id }
        });

        return {
          ...visitor.toJSON(),
          visitCount
        };
      })
    );

    res.json({
      success: true,
      data: {
        visitors: visitorsWithStats,
        pagination: {
          page,
          limit,
          total: visitors.count,
          totalPages: Math.ceil(visitors.count / limit),
          hasNext: page < Math.ceil(visitors.count / limit),
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    logError('Get all visitors error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Get visitor by ID (admin)
export const getVisitorById = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer || req.dealer.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const { visitorId } = req.params;
    const visitor = await Visitor.findByPk(visitorId, {
      attributes: { exclude: ['password'] }
    });

    if (!visitor) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Visitor not found' }
      });
      return;
    }

    // Get visit statistics
    const visitCount = await VisitAssignment.count({
      where: { visitorId: visitor.id }
    });

    const completedVisits = await Visit.count({
      include: [{
        model: VisitAssignment,
        as: 'assignments',
        where: { visitorId: visitor.id },
        required: true
      }],
      where: { status: 'completed' }
    });

    const pendingVisits = await Visit.count({
      include: [{
        model: VisitAssignment,
        as: 'assignments',
        where: { visitorId: visitor.id },
        required: true
      }],
      where: { status: 'pending' }
    });

    const rejectedVisits = await Visit.count({
      include: [{
        model: VisitAssignment,
        as: 'assignments',
        where: { visitorId: visitor.id },
        required: true
      }],
      where: { status: 'rejected' }
    });

    res.json({
      success: true,
      data: {
        ...visitor.toJSON(),
        visitCount,
        completedVisits,
        pendingVisits,
        rejectedVisits
      }
    });
  } catch (error) {
    logError('Get visitor by ID error', error, { visitorId: req.params.visitorId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Update visitors (admin)
export const updateVisitor = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer || req.dealer.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const { visitorId } = req.params;
    const { firstName, lastName, email, mobile, employeeId, isActive } = req.body;

    const visitor = await Visitor.findByPk(visitorId);

    if (!visitor) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Visitor not found' }
      });
      return;
    }

    // Check if email is already taken by another visitor
    if (email && email !== visitor.email) {
      const existingVisitor = await Visitor.findOne({
        where: { email, id: { [Op.ne]: visitor.id } }
      });
      if (existingVisitor) {
        res.status(400).json({
          success: false,
          error: {
            code: 'RES_002',
            message: 'Email already exists',
            details: [{ field: 'email', message: 'Email already exists' }]
          }
        });
        return;
      }
    }

    await visitor.update({
      firstName: firstName !== undefined ? firstName : visitor.firstName,
      lastName: lastName !== undefined ? lastName : visitor.lastName,
      email: email !== undefined ? email : visitor.email,
      mobile: mobile !== undefined ? mobile : visitor.mobile,
      employeeId: employeeId !== undefined ? employeeId : visitor.employeeId,
      isActive: isActive !== undefined ? isActive : visitor.isActive
    });

    const updatedVisitor = await Visitor.findByPk(visitor.id, {
      attributes: { exclude: ['password'] }
    });

    res.json({
      success: true,
      data: updatedVisitor
    });
  } catch (error) {
    logError('Update visitor error', error, { visitorId: req.params.visitorId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Update visitor password (admin)
export const updateVisitorPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer || req.dealer.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const { visitorId } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Password must be at least 6 characters long',
          details: [{ field: 'newPassword', message: 'Password must be at least 6 characters long' }]
        }
      });
      return;
    }

    const visitor = await Visitor.findByPk(visitorId);

    if (!visitor) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Visitor not found' }
      });
      return;
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await visitor.update({ password: hashedPassword });

    res.json({
      success: true,
      message: 'Password updated successfully'
    });
  } catch (error) {
    logError('Update visitor password error', error, { visitorId: req.params.visitorId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Delete/Deactivate visitor (admin)
export const deleteVisitor = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer || req.dealer.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const { visitorId } = req.params;
    const visitor = await Visitor.findByPk(visitorId);

    if (!visitor) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Visitor not found' }
      });
      return;
    }

    // Deactivate instead of deleting
    await visitor.update({ isActive: false });

    res.json({
      success: true,
      message: 'Visitor deactivated successfully'
    });
  } catch (error) {
    logError('Delete visitor error', error, { visitorId: req.params.visitorId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

