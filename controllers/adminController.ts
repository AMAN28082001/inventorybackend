import { Request, Response } from 'express';
import { Quotation, Dealer, Customer, Visitor } from '../models/index-quotation';
import { Op } from 'sequelize';
import { logError } from '../utils/loggerHelper';

const resolveDealerIdForInventoryUser = async (userId: string, username?: string): Promise<string | null> => {
  const candidate = (username || '').trim();
  const orClauses: any[] = [];
  if (candidate) {
    orClauses.push({ username: candidate });
    if (candidate.includes('@')) {
      orClauses.push({ email: candidate });
    }
    if (/^\d+$/.test(candidate)) {
      orClauses.push({ mobile: candidate });
    }
  }
  orClauses.push({ id: userId });

  const dealer = await Dealer.findOne({
    where: { [Op.or]: orClauses },
    attributes: ['id']
  });
  return dealer ? dealer.id : null;
};

// Get all quotations (admin)
export const getAllQuotations = async (req: Request, res: Response): Promise<void> => {
  try {
    const isQuotationAdmin = req.dealer && req.dealer.role === 'admin';
    const isQuotationDealer = req.dealer && req.dealer.role !== 'admin';
    const isInventoryAdmin = req.user && (req.user.role === 'admin' || req.user.role === 'super-admin' || req.user.role === 'super-admin-manager');
    const isInventoryAgent = req.user && (req.user.role === 'agent' || req.user.role === 'account');

    if (!isQuotationAdmin && !isQuotationDealer && !isInventoryAdmin && !isInventoryAgent) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const limitParam = req.query.limit as string | undefined;
    const limit = limitParam ? Math.min(parseInt(limitParam) || 20, 1000) : undefined;
    const offset = limit ? (page - 1) * limit : undefined;
    const status = req.query.status as string;
    const dealerId = req.query.dealerId as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const where: any = {};

    if (status) where.status = status;
    if (dealerId) where.dealerId = dealerId;

    if (isQuotationDealer && req.dealer) {
      where.dealerId = req.dealer.id;
    } else if (isInventoryAgent && req.user) {
      const mappedDealerId = await resolveDealerIdForInventoryUser(req.user.id, req.user.username);
      if (!mappedDealerId) {
        res.json({
          success: true,
          data: {
            quotations: [],
            pagination: {
              page,
              limit,
              total: 0,
              totalPages: 0
            }
          }
        });
        return;
      }
      where.dealerId = mappedDealerId;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate);
    }

    const quotations = await Quotation.findAndCountAll({
      where,
      include: [
        {
          model: Dealer,
          as: 'dealer',
          attributes: ['id', 'firstName', 'lastName']
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['firstName', 'lastName', 'mobile']
        }
      ],
      limit,
      offset,
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      data: {
        quotations: quotations.rows.map(q => {
          const qAny = q as any;
          return {
            id: q.id,
            dealer: qAny.dealer ? {
              id: qAny.dealer.id,
              firstName: qAny.dealer.firstName,
              lastName: qAny.dealer.lastName
            } : null,
            customer: qAny.customer ? {
              firstName: qAny.customer.firstName,
              lastName: qAny.customer.lastName,
              mobile: qAny.customer.mobile
            } : null,
            systemType: q.systemType,
            finalAmount: Number(q.finalAmount),
            status: q.status,
            createdAt: q.createdAt
          };
        }),
        pagination: {
          page,
          limit: limit || quotations.count,
          total: quotations.count,
          totalPages: limit ? Math.ceil(quotations.count / limit) : 1
        }
      }
    });
  } catch (error) {
    logError('Get all quotations error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Update quotation status (admin)
export const updateQuotationStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer || req.dealer.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const { quotationId } = req.params;
    const { status } = req.body;

    if (!['pending', 'approved', 'rejected', 'completed'].includes(status)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Invalid status',
          details: [{ field: 'status', message: 'Status must be one of: pending, approved, rejected, completed' }]
        }
      });
      return;
    }

    const quotation = await Quotation.findByPk(quotationId);
    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    await quotation.update({ status });

    res.json({
      success: true,
      data: {
        id: quotation.id,
        status: quotation.status,
        updatedAt: quotation.updatedAt
      }
    });
  } catch (error) {
    logError('Update quotation status error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Get all dealers (admin)
export const getAllDealers = async (req: Request, res: Response): Promise<void> => {
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

    const where: any = { role: 'dealer' };
    
    // Filter by isActive if provided
    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    // Search by name, email, mobile, username
    if (search) {
      where[Op.or] = [
        { firstName: { [Op.iLike]: `%${search}%` } },
        { lastName: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { mobile: { [Op.iLike]: `%${search}%` } },
        { username: { [Op.iLike]: `%${search}%` } },
        { company: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const dealers = await Dealer.findAndCountAll({
      where,
      attributes: { exclude: ['password'] },
      limit,
      offset,
      order: [['createdAt', 'DESC']]
    });

    // Get statistics for each dealer and format response
    const dealersWithStats = await Promise.all(
      dealers.rows.map(async (dealer) => {
        const quotationCount = await Quotation.count({ where: { dealerId: dealer.id } });
        const totalRevenue = await Quotation.sum('finalAmount', { where: { dealerId: dealer.id } }) || 0;

        const dealerData = dealer.toJSON() as any;
        
        // Format response with address object
        return {
          id: dealerData.id,
          username: dealerData.username,
          firstName: dealerData.firstName,
          lastName: dealerData.lastName,
          email: dealerData.email,
          mobile: dealerData.mobile,
          gender: dealerData.gender,
          dateOfBirth: dealerData.dateOfBirth,
          fatherName: dealerData.fatherName,
          fatherContact: dealerData.fatherContact,
          governmentIdType: dealerData.governmentIdType,
          governmentIdNumber: dealerData.governmentIdNumber,
          governmentIdImage: dealerData.governmentIdImage,
          address: {
            street: dealerData.addressStreet,
            city: dealerData.addressCity,
            state: dealerData.addressState,
            pincode: dealerData.addressPincode
          },
          company: dealerData.company,
          isActive: dealerData.isActive,
          emailVerified: dealerData.emailVerified,
          quotationCount,
          totalRevenue: Number(totalRevenue),
          createdAt: dealerData.createdAt,
          updatedAt: dealerData.updatedAt
        };
      })
    );

    res.json({
      success: true,
      data: {
        dealers: dealersWithStats,
        pagination: {
          page,
          limit,
          total: dealers.count,
          totalPages: Math.ceil(dealers.count / limit)
        }
      }
    });
  } catch (error) {
    logError('Get all dealers error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Update dealer (admin)
export const updateDealer = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer || req.dealer.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const { dealerId } = req.params;
    const updateData: any = {};

    const dealer = await Dealer.findByPk(dealerId);
    if (!dealer) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Dealer not found' }
      });
      return;
    }

    // Update basic fields
    if (req.body.firstName !== undefined) updateData.firstName = req.body.firstName;
    if (req.body.lastName !== undefined) updateData.lastName = req.body.lastName;
    if (req.body.email !== undefined) {
      // Check if email is already taken by another dealer
      const existingDealer = await Dealer.findOne({ 
        where: { email: req.body.email, id: { [Op.ne]: dealerId } } 
      });
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
      updateData.email = req.body.email;
    }
    if (req.body.mobile !== undefined) {
      // Check if mobile is already taken by another dealer
      const existingDealer = await Dealer.findOne({ 
        where: { mobile: req.body.mobile, id: { [Op.ne]: dealerId } } 
      });
      if (existingDealer) {
        res.status(400).json({
          success: false,
          error: {
            code: 'RES_002',
            message: 'Mobile number already exists',
            details: [{ field: 'mobile', message: 'Mobile number already exists' }]
          }
        });
        return;
      }
      updateData.mobile = req.body.mobile;
    }
    if (req.body.gender !== undefined) updateData.gender = req.body.gender;
    if (req.body.dateOfBirth !== undefined) updateData.dateOfBirth = new Date(req.body.dateOfBirth);
    if (req.body.fatherName !== undefined) updateData.fatherName = req.body.fatherName;
    if (req.body.fatherContact !== undefined) updateData.fatherContact = req.body.fatherContact;
    if (req.body.governmentIdType !== undefined) updateData.governmentIdType = req.body.governmentIdType;
    if (req.body.governmentIdNumber !== undefined) updateData.governmentIdNumber = req.body.governmentIdNumber;
    if (req.body.governmentIdImage !== undefined) updateData.governmentIdImage = req.body.governmentIdImage;
    if (req.body.company !== undefined) updateData.company = req.body.company;
    if (req.body.isActive !== undefined) updateData.isActive = req.body.isActive;
    if (req.body.emailVerified !== undefined) updateData.emailVerified = req.body.emailVerified;

    // Update address fields if provided
    if (req.body.address) {
      if (req.body.address.street) updateData.addressStreet = req.body.address.street;
      if (req.body.address.city) updateData.addressCity = req.body.address.city;
      if (req.body.address.state) updateData.addressState = req.body.address.state;
      if (req.body.address.pincode) updateData.addressPincode = req.body.address.pincode;
    }

    await dealer.update(updateData);

    const updatedDealer = await Dealer.findByPk(dealerId, {
      attributes: { exclude: ['password'] }
    });

    const dealerData = updatedDealer?.toJSON() as any;
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

    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    logError('Update dealer error', error, { dealerId: req.params.dealerId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Activate dealer (admin)
export const activateDealer = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer || req.dealer.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const { dealerId } = req.params;

    const dealer = await Dealer.findByPk(dealerId);
    if (!dealer) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Dealer not found' }
      });
      return;
    }

    await dealer.update({ isActive: true });

    res.json({
      success: true,
      message: 'Dealer activated successfully',
      data: {
        id: dealer.id,
        isActive: true,
        updatedAt: dealer.updatedAt
      }
    });
  } catch (error) {
    logError('Activate dealer error', error, { dealerId: req.params.dealerId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Get system statistics (admin)
export const getSystemStatistics = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer || req.dealer.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const where: any = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate);
    }

    const quotations = await Quotation.findAll({ where });
    const totalQuotations = quotations.length;
    const totalRevenue = quotations.reduce((sum, q) => sum + Number(q.finalAmount), 0);
    const uniqueCustomers = [...new Set(quotations.map(q => q.customerId))].length;
    const activeDealers = [...new Set(quotations.map(q => q.dealerId))].length;

    // This month's data
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthQuotations = quotations.filter(q => new Date(q.createdAt) >= startOfMonth);
    const thisMonth = {
      quotations: thisMonthQuotations.length,
      revenue: thisMonthQuotations.reduce((sum, q) => sum + Number(q.finalAmount), 0),
      newCustomers: [...new Set(thisMonthQuotations.map(q => q.customerId))].length,
      newVisitors: await Visitor.count({
        where: {
          createdAt: { [Op.gte]: startOfMonth }
        }
      })
    };

    // Status breakdown
    const statusBreakdown = {
      pending: quotations.filter(q => q.status === 'pending').length,
      approved: quotations.filter(q => q.status === 'approved').length,
      rejected: quotations.filter(q => q.status === 'rejected').length,
      completed: quotations.filter(q => q.status === 'completed').length
    };

    // Top dealers
    const dealerStats = new Map<string, { count: number; revenue: number }>();
    quotations.forEach(q => {
      const existing = dealerStats.get(q.dealerId) || { count: 0, revenue: 0 };
      dealerStats.set(q.dealerId, {
        count: existing.count + 1,
        revenue: existing.revenue + Number(q.finalAmount)
      });
    });

    const topDealers = Array.from(dealerStats.entries())
      .map(([dealerId, stats]) => ({ dealerId, ...stats }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // Get dealer names
    const dealerIds = topDealers.map(d => d.dealerId);
    const dealers = await Dealer.findAll({
      where: { id: { [Op.in]: dealerIds } },
      attributes: ['id', 'firstName', 'lastName']
    });

    const topDealersWithNames = topDealers.map(td => {
      const dealer = dealers.find(d => d.id === td.dealerId);
      return {
        dealerId: td.dealerId,
        dealerName: dealer ? `${dealer.firstName} ${dealer.lastName}` : 'Unknown',
        quotationCount: td.count,
        revenue: td.revenue
      };
    });

    res.json({
      success: true,
      data: {
        overview: {
          totalQuotations,
          totalRevenue,
          totalCustomers: uniqueCustomers,
          activeDealers,
          totalVisitors: await Visitor.count(),
          activeVisitors: await Visitor.count({ where: { isActive: true } })
        },
        thisMonth,
        statusBreakdown,
        topDealers: topDealersWithNames
      }
    });
  } catch (error) {
    logError('Get system statistics error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};


