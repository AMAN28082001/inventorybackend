import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { Dealer, Quotation, Visitor } from '../models/index-quotation';
import { Op, Sequelize } from 'sequelize';
import { approvedQuotationValueFromRow } from '../utils/quotationApiJson';
import { logError, logInfo } from '../utils/loggerHelper';

// Register new dealer (PUBLIC)
export const registerDealer = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      username,
      password,
      firstName,
      lastName,
      email,
      mobile,
      gender,
      dateOfBirth,
      fatherName,
      fatherContact,
      governmentIdType,
      governmentIdNumber,
      governmentIdImage,
      address
    } = req.body;

    // Check if username already exists
    const existingUsername = await Dealer.findOne({ where: { username } });
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
    const existingEmail = await Dealer.findOne({ where: { email } });
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

    // Check if mobile already exists
    const existingMobile = await Dealer.findOne({ where: { mobile } });
    if (existingMobile) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Validation error',
          details: [{ field: 'mobile', message: 'Mobile number already exists' }]
        }
      });
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create dealer
    const dealerId = `dealer_${uuidv4()}`;
    const newDealer = await Dealer.create({
      id: dealerId,
      username,
      password: hashedPassword,
      firstName,
      lastName,
      email,
      mobile,
      gender,
      dateOfBirth: new Date(dateOfBirth),
      fatherName,
      fatherContact,
      governmentIdType,
      governmentIdNumber,
      governmentIdImage: governmentIdImage || null,
      addressStreet: address.street,
      addressCity: address.city,
      addressState: address.state,
      addressPincode: address.pincode,
      role: 'dealer',
      isActive: false, // New dealers are inactive by default, require admin approval
      emailVerified: false
    });

    // Return dealer without password
    const dealerResponse = await Dealer.findByPk(newDealer.id, {
      attributes: { exclude: ['password'] }
    });

    const dealerData = dealerResponse?.toJSON() as any;
    const responseData = {
      ...dealerData,
      address: {
        street: dealerData.addressStreet,
        city: dealerData.addressCity,
        state: dealerData.addressState,
        pincode: dealerData.addressPincode
      }
    };

    // Remove individual address fields from response
    delete responseData.addressStreet;
    delete responseData.addressCity;
    delete responseData.addressState;
    delete responseData.addressPincode;

    res.status(201).json({
      success: true,
      message: 'Dealer registered successfully. Please verify your email to activate your account.',
      data: responseData
    });
  } catch (error) {
    logError('Register dealer error', error, { body: req.body });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Get dealer profile
export const getDealerProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const dealer = await Dealer.findByPk(req.dealer.id, {
      attributes: { exclude: ['password'] }
    });

    if (!dealer) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Dealer not found' }
      });
      return;
    }

    res.json({
      success: true,
      data: dealer
    });
  } catch (error) {
    logError('Get dealer profile error', error, { dealerId: req.dealer?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Update dealer profile
export const updateDealerProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { firstName, lastName, email, mobile, company } = req.body;
    const dealer = await Dealer.findByPk(req.dealer.id);

    if (!dealer) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Dealer not found' }
      });
      return;
    }

    // Check if email is already taken by another dealer
    if (email && email !== dealer.email) {
      const existingDealer = await Dealer.findOne({ where: { email, id: { [Op.ne]: dealer.id } } });
      if (existingDealer) {
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

    await dealer.update({
      firstName: firstName || dealer.firstName,
      lastName: lastName || dealer.lastName,
      email: email || dealer.email,
      mobile: mobile || dealer.mobile,
      company: company !== undefined ? company : dealer.company
    });

    const updatedDealer = await Dealer.findByPk(dealer.id, {
      attributes: { exclude: ['password'] }
    });

    res.json({
      success: true,
      data: updatedDealer
    });
  } catch (error) {
    logError('Update dealer profile error', error, { dealerId: req.dealer?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

const buildDealerDashboardMetrics = async (dealerId: string) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const baseWhere = { dealerId };
  const approvedStatusWhere = Sequelize.where(
    Sequelize.fn('LOWER', Sequelize.fn('TRIM', Sequelize.col('status'))),
    'approved'
  );

  const [totalQuotations, uniqueCustomers, thisMonthQuotations, approvedRows] = await Promise.all([
    Quotation.count({ where: baseWhere }),
    Quotation.count({ where: baseWhere, distinct: true, col: 'customerId' }),
    Quotation.count({
      where: {
        ...baseWhere,
        createdAt: { [Op.gte]: startOfMonth }
      }
    }),
    Quotation.findAll({
      where: {
        ...baseWhere,
        [Op.and]: [approvedStatusWhere]
      },
      attributes: ['subtotal', 'totalAmount', 'finalAmount']
    })
  ]);

  const approvedQuotationCount = approvedRows.length;
  const approvedQuotationValue = approvedRows.reduce(
    (sum, row) => sum + approvedQuotationValueFromRow(row),
    0
  );

  return {
    totalQuotations,
    uniqueCustomers,
    thisMonthQuotations,
    approvedQuotationCount,
    approvedQuotationValue
  };
};

/** Dealer dashboard cards — approved quotation value/count (§7.9). */
export const getDealerDashboardStats = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const data = await buildDealerDashboardMetrics(req.dealer.id);

    res.json({
      success: true,
      data
    });
  } catch (error) {
    logError('Get dealer dashboard stats error', error, { dealerId: req.dealer?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Get dealer statistics
export const getDealerStatistics = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { startDate, endDate } = req.query;
    const where: any = { dealerId: req.dealer.id };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate as string);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate as string);
    }

    const allQuotations = await Quotation.findAll({ where });
    const dashboard = await buildDealerDashboardMetrics(req.dealer.id);

    const amountForRow = (q: Quotation) => approvedQuotationValueFromRow(q);
    const totalRevenue = allQuotations.reduce((sum, q) => sum + amountForRow(q), 0);
    const totalCustomers = dashboard.uniqueCustomers;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthRows = allQuotations.filter((q) => {
      const created = q.createdAt ? new Date(q.createdAt) : null;
      return created ? created >= startOfMonth : false;
    });
    const thisMonth = {
      quotations: dashboard.thisMonthQuotations,
      revenue: thisMonthRows.reduce((sum, q) => sum + amountForRow(q), 0)
    };

    const statusBreakdown = {
      pending: allQuotations.filter((q) => q.status === 'pending').length,
      approved: allQuotations.filter((q) => q.status === 'approved').length,
      rejected: allQuotations.filter((q) => q.status === 'rejected').length,
      completed: allQuotations.filter((q) => q.status === 'completed').length
    };

    res.json({
      success: true,
      data: {
        totalQuotations: dashboard.totalQuotations,
        totalCustomers,
        totalRevenue,
        thisMonth,
        statusBreakdown,
        approvedQuotationCount: dashboard.approvedQuotationCount,
        approvedQuotationValue: dashboard.approvedQuotationValue,
        uniqueCustomers: dashboard.uniqueCustomers,
        thisMonthQuotations: dashboard.thisMonthQuotations
      }
    });
  } catch (error) {
    logError('Get dealer statistics error', error, { dealerId: req.dealer?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Get visitors list (for dealers to assign to visits)
export const getVisitors = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const search = req.query.search as string;
    const isActive = req.query.isActive as string;

    const where: any = {};

    // Filter by active status if specified, otherwise show all visitors
    // (Dealers need to see all visitors to assign them, not just active ones)
    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }
    // If isActive is not specified, don't filter - show all visitors

    // Search by name, email, mobile, employeeId
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
      order: [['firstName', 'ASC'], ['lastName', 'ASC']]
    });

    logInfo('Get visitors', { dealerId: req.dealer.id, count: visitors.length });

    const formattedVisitors = visitors.map(v => ({
      id: v.id,
      username: v.username,
      firstName: v.firstName,
      lastName: v.lastName,
      email: v.email,
      mobile: v.mobile,
      employeeId: v.employeeId,
      isActive: v.isActive,
      fullName: `${v.firstName} ${v.lastName}`,
      createdAt: v.createdAt
    }));

    res.json({
      success: true,
      data: {
        visitors: formattedVisitors
      }
    });
  } catch (error) {
    logError('Get visitors error', error, { dealerId: req.dealer?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};


