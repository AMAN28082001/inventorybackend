import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Customer, Quotation } from '../models/index-quotation';
import { Op } from 'sequelize';
import { logError, logInfo } from '../utils/loggerHelper';

// Create customer
export const createCustomer = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { firstName, lastName, mobile, email, address } = req.body;
    const normalizedLastName = (lastName ?? '').trim();
    const normalizedEmail = (email ?? '').trim();

    // Check if customer with mobile already exists
    const existingCustomer = await Customer.findOne({ where: { mobile } });
    if (existingCustomer) {
      res.status(400).json({
        success: false,
        error: {
          code: 'RES_002',
          message: 'Customer with this mobile number already exists',
          details: [{ field: 'mobile', message: 'Mobile number already exists' }]
        }
      });
      return;
    }

    const customer = await Customer.create({
      id: uuidv4(),
      firstName,
      lastName: normalizedLastName,
      mobile,
      email: normalizedEmail !== '' ? normalizedEmail : null,
      streetAddress: address.street,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      dealerId: req.dealer.id
    });

    logInfo('Customer created', { customerId: customer.id, dealerId: req.dealer.id });

    const customerData = customer.toJSON();
    res.status(201).json({
      success: true,
      data: {
        id: customerData.id,
        firstName: customerData.firstName,
        lastName: customerData.lastName ?? '',
        mobile: customerData.mobile,
        email: customerData.email ?? '',
        address: {
          street: customerData.streetAddress || '',
          city: customerData.city || '',
          state: customerData.state || '',
          pincode: customerData.pincode || ''
        },
        createdAt: customerData.createdAt,
        updatedAt: customerData.updatedAt
      }
    });
  } catch (error) {
    logError('Create customer error', error, { dealerId: req.dealer?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Get customers with pagination
export const getCustomers = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;
    const search = req.query.search as string;
    const sortBy = (req.query.sortBy as string) || 'createdAt';
    const sortOrder = (req.query.sortOrder as string) || 'desc';

    // Admins can see all customers, dealers only see their own
    const where: any = req.dealer.role === 'admin' ? {} : { dealerId: req.dealer.id };

    if (search) {
      where[Op.or] = [
        { firstName: { [Op.iLike]: `%${search}%` } },
        { lastName: { [Op.iLike]: `%${search}%` } },
        { mobile: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const { count, rows } = await Customer.findAndCountAll({
      where,
      limit,
      offset,
      order: [[sortBy, sortOrder.toUpperCase()]],
      attributes: ['id', 'firstName', 'lastName', 'mobile', 'email', 'streetAddress', 'city', 'state', 'pincode', 'createdAt']
    });

    // Format customers with address object (consistent with getCustomerById and updateCustomer)
    const customers = rows.map(customer => {
      const customerData = customer.toJSON();
      return {
        id: customerData.id,
        firstName: customerData.firstName,
        lastName: customerData.lastName ?? '',
        mobile: customerData.mobile,
        email: customerData.email ?? '',
        address: {
          street: customerData.streetAddress || '',
          city: customerData.city || '',
          state: customerData.state || '',
          pincode: customerData.pincode || ''
        },
        createdAt: customerData.createdAt
      };
    });

    res.json({
      success: true,
      data: {
        customers,
        pagination: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit),
          hasNext: page < Math.ceil(count / limit),
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    logError('Get customers error', error, { dealerId: req.dealer?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Get customer by ID
export const getCustomerById = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { customerId } = req.params;
    // Admins can see all customers, dealers only see their own
    const where: any = { id: customerId };
    if (req.dealer.role !== 'admin') {
      where.dealerId = req.dealer.id;
    }
    const customer = await Customer.findOne({ where });

    if (!customer) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Customer not found' }
      });
      return;
    }

    // Get customer's quotations
    const quotations = await Quotation.findAll({
      where: { customerId: customer.id },
      attributes: ['id', 'systemType', 'finalAmount', 'status', 'createdAt'],
      order: [['createdAt', 'DESC']]
    });

    const customerData = customer.toJSON();
    res.json({
      success: true,
      data: {
        id: customerData.id,
        firstName: customerData.firstName,
        lastName: customerData.lastName ?? '',
        mobile: customerData.mobile,
        email: customerData.email ?? '',
        address: {
          street: customerData.streetAddress || '',
          city: customerData.city || '',
          state: customerData.state || '',
          pincode: customerData.pincode || ''
        },
        createdAt: customerData.createdAt,
        updatedAt: customerData.updatedAt,
        quotations
      }
    });
  } catch (error) {
    logError('Get customer by ID error', error, { customerId: req.params.customerId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Update customer
export const updateCustomer = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { customerId } = req.params;
    const { firstName, lastName, mobile, email, address } = req.body;
    const normalizedLastName = (lastName ?? '').trim();
    const normalizedEmail = (email ?? '').trim();

    // Admins can update all customers, dealers only their own
    const where: any = { id: customerId };
    if (req.dealer.role !== 'admin') {
      where.dealerId = req.dealer.id;
    }
    const customer = await Customer.findOne({ where });

    if (!customer) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Customer not found' }
      });
      return;
    }

    // Check if mobile is already taken by another customer
    if (mobile && mobile !== customer.mobile) {
      const existingCustomer = await Customer.findOne({
        where: { mobile, id: { [Op.ne]: customer.id } }
      });
      if (existingCustomer) {
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
    }

    // Update customer fields
    const updateData: any = {};
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = normalizedLastName;
    if (mobile !== undefined) updateData.mobile = mobile;
    if (email !== undefined) updateData.email = normalizedEmail !== '' ? normalizedEmail : null;
    
    // Update address fields if address object is provided
    if (address) {
      if (address.street !== undefined) updateData.streetAddress = address.street;
      if (address.city !== undefined) updateData.city = address.city;
      if (address.state !== undefined) updateData.state = address.state;
      if (address.pincode !== undefined) updateData.pincode = address.pincode;
    }

    await customer.update(updateData);

    const updatedCustomer = await Customer.findByPk(customer.id);
    const customerData = updatedCustomer!.toJSON();

    res.json({
      success: true,
      data: {
        id: customerData.id,
        firstName: customerData.firstName,
        lastName: customerData.lastName ?? '',
        mobile: customerData.mobile,
        email: customerData.email ?? '',
        address: {
          street: customerData.streetAddress || '',
          city: customerData.city || '',
          state: customerData.state || '',
          pincode: customerData.pincode || ''
        },
        createdAt: customerData.createdAt,
        updatedAt: customerData.updatedAt
      }
    });
  } catch (error) {
    logError('Update customer error', error, { customerId: req.params.customerId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};


