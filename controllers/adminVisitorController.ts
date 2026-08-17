import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { Visitor, VisitAssignment, Visit } from '../models/index-quotation';
import { Op } from 'sequelize';
import { logError, logInfo } from '../utils/loggerHelper';
import { parseAccessFromBody, resolveAccess } from '../utils/userAccess';
import { parseProfilePatchFromBody, publicVisitorForApi } from '../utils/userProfile';
import { listAssignableVisitors } from '../utils/assignableVisitors';
import {
  filterByListAccess,
  includeAccessUsersFromReq,
  paginateRows,
  parseAccessQueryFromReq
} from '../utils/accessLists';

const visitorRecord = (row: Visitor) => row.toJSON() as unknown as Record<string, unknown>;

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
    const accessParse = parseAccessFromBody(req.body || {});
    if (accessParse.error) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: accessParse.error }
      });
      return;
    }
    const access =
      accessParse.access && accessParse.access.length
        ? accessParse.access
        : resolveAccess({ role: 'visitor', access: req.body.access });
    const profile = parseProfilePatchFromBody(req.body || {});

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
      employeeId: employeeId || profile.employeeId || null,
      access: access.length ? access : ['visitor'],
      gender: profile.gender ?? null,
      dateOfBirth: profile.dateOfBirth ?? null,
      fatherName: profile.fatherName ?? null,
      fatherContact: profile.fatherContact ?? null,
      governmentIdType: profile.governmentIdType ?? null,
      governmentIdNumber: profile.governmentIdNumber ?? null,
      addressStreet: profile.addressStreet ?? null,
      addressCity: profile.addressCity ?? null,
      addressState: profile.addressState ?? null,
      addressPincode: profile.addressPincode ?? null,
      emailVerified: req.body.emailVerified === true,
      isActive: req.body.isActive !== false
    });

    logInfo('Visitor created by admin', { visitorId: visitor.id, createdBy: req.dealer.id });

    const created = await Visitor.findByPk(visitor.id, { attributes: { exclude: ['password'] } });
    res.status(201).json({
      success: true,
      data: publicVisitorForApi(visitorRecord(created || visitor))
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
    const limit = Math.min(parseInt(req.query.limit as string) || 1000, 1000);
    const search = req.query.search as string;
    const isActive = req.query.isActive as string;
    const sortBy = (req.query.sortBy as string) || 'createdAt';
    const sortOrder = (req.query.sortOrder as string) || 'desc';
    const accessKey = parseAccessQueryFromReq(req);
    const includeAccessUsers = includeAccessUsersFromReq(req) || accessKey === 'visitor';

    if (includeAccessUsers) {
      const union = await listAssignableVisitors({
        search,
        isActive: isActive === undefined ? true : isActive === 'true' || isActive === '1'
      });
      const filtered = filterByListAccess(union, accessKey || 'visitor');
      const paged = paginateRows(filtered, page, limit);
      res.json({
        success: true,
        data: {
          visitors: paged.rows,
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
      return;
    }

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

    const visitors = await Visitor.findAll({
      where,
      attributes: { exclude: ['password'] },
      order: [[sortBy, sortOrder.toUpperCase()]]
    });

    const visitorsWithStats = await Promise.all(
      visitors.map(async (visitor) => {
        const visitCount = await VisitAssignment.count({
          where: { visitorId: visitor.id }
        });

        return publicVisitorForApi({
          ...visitorRecord(visitor),
          visitCount
        });
      })
    );
    const filtered = filterByListAccess(visitorsWithStats, accessKey);
    const paged = paginateRows(filtered, page, limit);

    res.json({
      success: true,
      data: {
        visitors: paged.rows,
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
        ...publicVisitorForApi(visitorRecord(visitor)),
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
    const { firstName, lastName, email, mobile, employeeId, isActive, emailVerified, password } = req.body;
    const accessParse = parseAccessFromBody(req.body || {});
    if (accessParse.error) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: accessParse.error }
      });
      return;
    }
    const profile = parseProfilePatchFromBody(req.body || {});

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

    const updateData: Record<string, unknown> = {
      firstName: firstName !== undefined ? firstName : visitor.firstName,
      lastName: lastName !== undefined ? lastName : visitor.lastName,
      email: email !== undefined ? email : visitor.email,
      mobile: mobile !== undefined ? mobile : visitor.mobile,
      employeeId: employeeId !== undefined ? employeeId : visitor.employeeId,
      isActive: isActive !== undefined ? isActive : visitor.isActive,
      ...profile
    };
    if (emailVerified !== undefined) updateData.emailVerified = emailVerified;
    if (accessParse.access) updateData.access = accessParse.access;
    if (password && String(password).trim()) {
      updateData.password = await bcrypt.hash(String(password), 10);
    }

    await visitor.update(updateData);

    const updatedVisitor = await Visitor.findByPk(visitor.id, {
      attributes: { exclude: ['password'] }
    });

    res.json({
      success: true,
      data: publicVisitorForApi(visitorRecord(updatedVisitor || visitor))
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

