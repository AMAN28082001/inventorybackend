import { Request, Response } from 'express';
import { deleteFileFromS3IfExists } from '../middleware/upload';
import {
  Sale,
  SaleItem,
  Address,
  Product,
  User,
  AdminInventory,
  InventoryTransaction
} from '../models';
import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';
import sequelize from '../config/database';
import { Transaction } from 'sequelize';
import { logError, logInfo } from '../utils/loggerHelper';

const buildSaleIncludes = () => ([
  {
    model: User,
    as: 'creator',
    attributes: ['id', 'name'],
    required: false
  },
  {
    model: User,
    as: 'billConfirmer',
    attributes: ['id', 'name'],
    required: false
  },
  {
    model: SaleItem,
    as: 'items'
  },
  {
    model: Address,
    as: 'billingAddress'
  },
  {
    model: Address,
    as: 'deliveryAddress'
  }
]);

const serializeSale = (sale: any) => {
  const creator = sale.creator || sale.created_by;
  const createdByName = creator?.name || creator?.created_by_name || null;
  const saleDate = sale.sale_date || sale.created_at || null;

  return {
    ...sale.toJSON?.() || sale,
    created_by_name: createdByName,
    agent_name: createdByName,
    created_at: saleDate,
    sale_date: saleDate
  };
};

interface NormalizedSaleItem {
  product_id: string | null;
  product_name: string;
  model: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  gst_rate: number;
}

const normalizeSaleItems = async (rawItems: any, transaction: Transaction): Promise<NormalizedSaleItem[]> => {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error('At least one sale item is required');
  }

  const normalized: NormalizedSaleItem[] = [];

  for (const item of rawItems) {
    const quantity = Number(item.quantity);

    if (!quantity || quantity <= 0 || Number.isNaN(quantity)) {
      throw new Error('Each sale item must have a quantity greater than 0');
    }

    let productId: string | null = item.product_id || null;
    let productName = item.product_name;
    let model = item.model;
    let productRecord: Product | null = null;

    if (productId) {
      productRecord = await Product.findByPk(productId, { transaction });
      if (!productRecord) {
        throw new Error(`Product not found for id ${productId}`);
      }
      productName = productName || productRecord.name;
      model = model || productRecord.model;
    }

    if (!productName || !model) {
      throw new Error('product_name and model are required for each sale item if product_id is not provided');
    }

    let unitPrice: number;
    if (item.unit_price !== undefined) {
      unitPrice = Number(item.unit_price);
    } else if (productRecord && productRecord.selling_price !== null && productRecord.selling_price !== undefined) {
      unitPrice = Number(productRecord.selling_price);
    } else if (productRecord && productRecord.unit_price !== null && productRecord.unit_price !== undefined) {
      unitPrice = Number(productRecord.unit_price);
    } else if (productRecord && (productRecord as any).price !== null && (productRecord as any).price !== undefined) {
      unitPrice = Number((productRecord as any).price);
    } else {
      unitPrice = NaN;
    }

    if (Number.isNaN(unitPrice) || unitPrice < 0) {
      throw new Error('Each sale item must have a non-negative unit_price');
    }

    const lineTotal = item.line_total !== undefined ? Number(item.line_total) : quantity * unitPrice;

    if (Number.isNaN(lineTotal) || lineTotal < 0) {
      throw new Error('Each sale item must have a non-negative line_total');
    }

    const gstRate = item.gst_rate !== undefined ? Number(item.gst_rate) : 0;

    if (Number.isNaN(gstRate) || gstRate < 0) {
      throw new Error('Each sale item must have a non-negative gst_rate');
    }

    normalized.push({
      product_id: productId,
      product_name: productName,
      model,
      quantity,
      unit_price: unitPrice,
      line_total: lineTotal,
      gst_rate: gstRate
    });
  }

  return normalized;
};

/**
 * Build base WHERE conditions for sales based on the authenticated user's role.
 *
 * - Agent: only their own sales
 * - Admin: their own sales + sales from agents they created
 * - Account / Super-Admin: all sales
 */
const buildSalesRoleConditions = async (req: Request): Promise<any[]> => {
  const conditions: any[] = [];

  if (!req.user) {
    return conditions;
  }

  const userRole = req.user.role;
  const userId = req.user.id;

  if (userRole === 'agent') {
    // Agents only see their own sales
    conditions.push({ created_by: userId });
  } else if (userRole === 'admin') {
    // Admins see:
    // - Their own sales
    // - Sales from agents they created
    const agents = await User.findAll({
      where: {
        role: 'agent',
        created_by_id: userId
      },
      attributes: ['id']
    });

    const agentIds = agents.map((agent) => agent.id);
    const ids = [userId, ...agentIds];

    conditions.push({
      created_by: {
        [Op.in]: ids
      }
    });
  }

  // Account and Super-Admin: no additional base filter (see everything)
  return conditions;
};

const createAddressIfNeeded = async (idParam: string | undefined, payload: any, transaction: Transaction): Promise<string | null> => {
  if (idParam) {
    return idParam;
  }

  if (!payload) {
    return null;
  }

  if (typeof payload === 'string') {
    return payload;
  }

  const { id, line1, city, state, postal_code, country, line2 } = payload;

  if (id) {
    return id;
  }

  if (!line1 || !city || !state || !postal_code || !country) {
    throw new Error('Address must include line1, city, state, postal_code, and country');
  }

  const address = await Address.create({
    id: uuidv4(),
    line1,
    line2: line2 || null,
    city,
    state,
    postal_code,
    country
  }, { transaction });

  return address.id;
};

const tryReduceAdminInventory = async (adminId: string, productId: string, quantity: number, transaction: Transaction): Promise<boolean> => {
  const inventory = await AdminInventory.findOne({
    where: { admin_id: adminId, product_id: productId },
    transaction,
    lock: transaction.LOCK.UPDATE
  });

  if (!inventory || inventory.quantity < quantity) {
    return false;
  }

  await inventory.decrement('quantity', { by: quantity, transaction });
  await inventory.reload({ transaction });
  if (inventory.quantity <= 0) {
    await inventory.destroy({ transaction });
  }

  return true;
};

const reduceCentralInventory = async (productId: string, quantity: number, transaction: Transaction): Promise<void> => {
  const product = await Product.findByPk(productId, { transaction, lock: transaction.LOCK.UPDATE });

  if (!product || product.quantity < quantity) {
    throw new Error('Insufficient central inventory for sale');
  }

  await product.decrement('quantity', { by: quantity, transaction });
};

interface LogSaleTransactionParams {
  productId: string;
  saleId: string;
  quantity: number;
  customerName: string;
  createdBy: string;
  transaction: Transaction;
}

const logSaleTransaction = async ({ productId, saleId, quantity, customerName, createdBy, transaction }: LogSaleTransactionParams): Promise<void> => {
  await InventoryTransaction.create({
    id: uuidv4(),
    product_id: productId,
    transaction_type: 'sale',
    quantity: -quantity,
    reference: saleId,
    related_sale_id: saleId,
    created_by: createdBy,
    notes: `Sale to ${customerName}`
  }, { transaction });
};

const buildProductSummary = (items: NormalizedSaleItem[]): string => items
  .map((item) => `${item.product_name} (${item.quantity})`)
  .join(', ');

// Get all sales (with role-based filtering)
export const getAllSales = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const { type, payment_status, customer_name, start_date, end_date } = req.query;
    const andConditions: any[] = await buildSalesRoleConditions(req);

    if (type) {
      andConditions.push({ type });
    }

    if (payment_status) {
      andConditions.push({ payment_status });
    }

    if (customer_name) {
      andConditions.push({
        customer_name: { [Op.iLike]: `%${customer_name}%` }
      });
    }

    if (start_date || end_date) {
      const dateCond: any = {};
      if (start_date) {
        dateCond[Op.gte] = new Date(start_date as string);
      }
      if (end_date) {
        dateCond[Op.lte] = new Date(end_date as string);
      }
      andConditions.push({ sale_date: dateCond });
    }

    const where = andConditions.length > 0 ? { [Op.and]: andConditions } : {};

    const sales = await Sale.findAll({
      where,
      include: buildSaleIncludes(),
      order: [['sale_date', 'DESC']]
    });

    logInfo('Get all sales', { count: sales.length, type: type as string || 'all', paymentStatus: payment_status as string || 'all' });
    res.json(sales.map((sale) => serializeSale(sale)));
  } catch (error) {
    logError('Get all sales error', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get sale by ID
export const getSaleById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const sale = await Sale.findByPk(id, {
      include: buildSaleIncludes()
    });

    if (!sale) {
      res.status(404).json({ error: 'Sale not found' });
      return;
    }

    logInfo('Get sale by ID', { saleId: id });
    res.json(serializeSale(sale));
  } catch (error) {
    logError('Get sale by ID error', error, { saleId: req.params.id });
    res.status(500).json({ error: 'Server error' });
  }
};

// Create sale
export const createSale = async (req: Request, res: Response): Promise<void> => {
  const transaction = await sequelize.transaction();

  try {
    if (!req.user) {
      await transaction.rollback();
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const {
      type,
      customer_name,
      items: rawItems,
      product_summary,
      subtotal,
      tax_amount,
      discount_amount,
      payment_status,
      sale_date,
      company_name,
      gst_number,
      contact_person,
      billing_address_id,
      billing_address,
      delivery_address_id,
      delivery_address,
      delivery_matches_billing,
      customer_email,
      customer_phone,
      delivery_instructions,
      notes
    } = req.body;

    if (!type || !customer_name) {
      await transaction.rollback();
      res.status(400).json({ error: 'type and customer_name are required' });
      return;
    }

    if (!['B2B', 'B2C'].includes(type)) {
      await transaction.rollback();
      res.status(400).json({ error: 'Type must be B2B or B2C' });
      return;
    }

    let saleItems: any = rawItems;

    if (typeof saleItems === 'string') {
      try {
        saleItems = JSON.parse(saleItems);
      } catch (parseError) {
        await transaction.rollback();
        res.status(400).json({ 
          error: 'items must be a valid JSON array',
          details: 'Failed to parse items JSON string'
        });
        return;
      }
    }

    // Legacy single-item payload support
    if ((!saleItems || !saleItems.length) && req.body.product_id) {
      saleItems = [{
        product_id: req.body.product_id,
        product_name: req.body.product_name,
        model: req.body.model,
        quantity: req.body.quantity,
        unit_price: req.body.unit_price,
        line_total: req.body.line_total
      }];
    }

    // Validate items are provided
    if (!saleItems || !Array.isArray(saleItems) || saleItems.length === 0) {
      await transaction.rollback();
      res.status(400).json({ 
        error: 'At least one sale item is required',
        details: 'Please provide an items array with at least one product'
      });
      return;
    }

    const normalizedItems = await normalizeSaleItems(saleItems, transaction);
    const totalQuantity = normalizedItems.reduce((sum, item) => sum + item.quantity, 0);
    const computedSubtotal = normalizedItems.reduce((sum, item) => sum + item.line_total, 0);
    const subtotalValue = subtotal !== undefined ? Number(subtotal) : computedSubtotal;
    const taxAmountValue = tax_amount !== undefined ? Number(tax_amount) : 0;
    const discountAmountValue = discount_amount !== undefined ? Number(discount_amount) : 0;
    const totalAmountValue = subtotalValue + taxAmountValue - discountAmountValue;

    if (Number.isNaN(subtotalValue) || subtotalValue < 0) {
      await transaction.rollback();
      res.status(400).json({ error: 'Subtotal must be a non-negative number' });
      return;
    }

    if (Number.isNaN(taxAmountValue) || taxAmountValue < 0) {
      await transaction.rollback();
      res.status(400).json({ error: 'Tax amount must be a non-negative number' });
      return;
    }

    if (Number.isNaN(discountAmountValue) || discountAmountValue < 0) {
      await transaction.rollback();
      res.status(400).json({ error: 'Discount amount must be a non-negative number' });
      return;
    }

    if (Number.isNaN(totalAmountValue) || totalAmountValue < 0) {
      await transaction.rollback();
      res.status(400).json({ error: 'Total amount must be a non-negative number' });
      return;
    }

    if (totalQuantity <= 0) {
      await transaction.rollback();
      res.status(400).json({ error: 'Total quantity must be greater than 0' });
      return;
    }

    const billingAddressId = await createAddressIfNeeded(billing_address_id, billing_address, transaction);
    let deliveryAddressId = await createAddressIfNeeded(delivery_address_id, delivery_address, transaction);

    const matchesBilling = delivery_matches_billing === true || delivery_matches_billing === 'true';

    if (matchesBilling && billingAddressId && !deliveryAddressId) {
      deliveryAddressId = billingAddressId;
    }

    // Use S3 URL if available, otherwise fall back to local path
    const imagePath = req.file 
      ? ((req.file as any).s3Location || `/uploads/${req.file.filename}`)
      : null;

    const saleRecord = await Sale.create({
      id: uuidv4(),
      type,
      customer_name,
      product_summary: product_summary || buildProductSummary(normalizedItems),
      total_quantity: totalQuantity,
      subtotal: subtotalValue,
      tax_amount: taxAmountValue,
      discount_amount: discountAmountValue,
      total_amount: totalAmountValue,
      payment_status: payment_status || 'pending',
      approval_status: 'pending',
      sale_date: sale_date ? new Date(sale_date) : new Date(),
      image: imagePath,
      created_by: req.user.id,
      company_name: company_name || null,
      gst_number: gst_number || null,
      contact_person: contact_person || null,
      billing_address_id: billingAddressId,
      delivery_address_id: deliveryAddressId,
      delivery_matches_billing: matchesBilling,
      customer_email: customer_email || null,
      customer_phone: customer_phone || null,
      delivery_instructions: delivery_instructions || null,
      notes: notes || null
    }, { transaction });

    for (const item of normalizedItems) {
      await SaleItem.create({
        id: uuidv4(),
        sale_id: saleRecord.id,
        product_id: item.product_id,
        product_name: item.product_name,
        model: item.model,
        quantity: item.quantity,
        unit_price: item.unit_price,
        line_total: item.line_total,
        gst_rate: item.gst_rate
      }, { transaction });
    }

    let adminInventoryOwnerId: string | null = null;
    if (req.user.role === 'agent') {
      const agentRecord = await User.findByPk(req.user.id, {
        attributes: ['id', 'created_by_id']
      });
      adminInventoryOwnerId = agentRecord?.created_by_id || null;
      if (!adminInventoryOwnerId) {
        throw new Error('Admin mapping not found for agent');
      }
    } else if (req.user.role === 'admin') {
      adminInventoryOwnerId = req.user.id;
    }

    for (const item of normalizedItems) {
      if (!item.product_id) {
        continue;
      }

      if (adminInventoryOwnerId) {
        const reduced = await tryReduceAdminInventory(adminInventoryOwnerId, item.product_id, item.quantity, transaction);
        if (!reduced) {
          throw new Error(`Insufficient admin inventory for product ${item.product_id}`);
        }
      } else if (req.user.role === 'super-admin') {
        await reduceCentralInventory(item.product_id, item.quantity, transaction);
      } else {
        throw new Error('Insufficient permissions to deduct inventory');
      }

      await logSaleTransaction({
        productId: item.product_id,
        saleId: saleRecord.id,
        quantity: item.quantity,
        customerName: customer_name,
        createdBy: req.user.id,
        transaction
      });
    }

    await transaction.commit();

    const created = await Sale.findByPk(saleRecord.id, {
      include: buildSaleIncludes()
    });

    logInfo('Sale created', { saleId: saleRecord.id, type, customerName: customer_name, totalAmount: totalAmountValue, createdBy: req.user.id });
    res.status(201).json(serializeSale(created));
  } catch (error: any) {
    await transaction.rollback();
    logError('Create sale error', error, { 
      type: req.body.type, 
      customerName: req.body.customer_name, 
      createdBy: req.user?.id,
      hasItems: !!req.body.items,
      itemsType: typeof req.body.items,
      itemsLength: Array.isArray(req.body.items) ? req.body.items.length : 'N/A'
    });
    
    // Provide detailed error message
    const errorMessage = error.message || 'Unable to create sale';
    const errorResponse: any = { error: errorMessage };
    
    // Add helpful details for common errors
    if (errorMessage.includes('item') || errorMessage.includes('product')) {
      errorResponse.details = 'Please check that all items have valid product_id, product_name, model, quantity, unit_price, and line_total';
    } else if (errorMessage.includes('inventory')) {
      errorResponse.details = 'Insufficient stock available. Please check inventory levels.';
    }
    
    res.status(400).json(errorResponse);
  }
};

// Update sale
export const updateSale = async (req: Request, res: Response): Promise<void> => {
  const transaction = await sequelize.transaction();
  try {
    if (!req.user) {
      await transaction.rollback();
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const { id } = req.params;
    const {
      customer_name,
      payment_status,
      approval_status,
      subtotal,
      tax_amount,
      discount_amount,
      total_amount,
      product_summary,
      company_name,
      gst_number,
      contact_person,
      billing_address_id,
      billing_address,
      delivery_address_id,
      delivery_address,
      delivery_matches_billing,
      customer_email,
      customer_phone,
      delivery_instructions,
      notes
    } = req.body;

    const sale = await Sale.findByPk(id, { transaction });
    if (!sale) {
      await transaction.rollback();
      res.status(404).json({ error: 'Sale not found' });
      return;
    }

    const canUpdate =
      sale.created_by === req.user.id ||
      req.user.role === 'super-admin' ||
      req.user.role === 'admin' ||
      req.user.role === 'account';

    if (!canUpdate) {
      await transaction.rollback();
      res.status(403).json({
        error: 'You do not have permission to update this sale'
      });
      return;
    }

    const updates: any = {};

    if (customer_name) {
      updates.customer_name = customer_name;
    }

    if (payment_status) {
      if (!['pending', 'completed'].includes(payment_status)) {
        await transaction.rollback();
        res.status(400).json({ error: 'Invalid payment status' });
        return;
      }
      updates.payment_status = payment_status;
    }

    if (approval_status !== undefined) {
      if (req.user.role !== 'account') {
        await transaction.rollback();
        res.status(403).json({ error: 'Only account managers can approve sales' });
        return;
      }
      if (!['pending', 'approved'].includes(approval_status)) {
        await transaction.rollback();
        res.status(400).json({ error: 'Invalid approval status' });
        return;
      }
      updates.approval_status = approval_status;
    }

    if (subtotal !== undefined) {
      const value = Number(subtotal);
      if (Number.isNaN(value) || value < 0) {
        await transaction.rollback();
        res.status(400).json({ error: 'Subtotal must be a non-negative number' });
        return;
      }
      updates.subtotal = value;
    }

    if (tax_amount !== undefined) {
      const value = Number(tax_amount);
      if (Number.isNaN(value) || value < 0) {
        await transaction.rollback();
        res.status(400).json({ error: 'Tax amount must be a non-negative number' });
        return;
      }
      updates.tax_amount = value;
    }

    if (discount_amount !== undefined) {
      const value = Number(discount_amount);
      if (Number.isNaN(value) || value < 0) {
        await transaction.rollback();
        res.status(400).json({ error: 'Discount amount must be a non-negative number' });
        return;
      }
      updates.discount_amount = value;
    }

    if (total_amount !== undefined) {
      const value = Number(total_amount);
      if (Number.isNaN(value) || value < 0) {
        await transaction.rollback();
        res.status(400).json({ error: 'Total amount must be a non-negative number' });
        return;
      }
      updates.total_amount = value;
    }

    if (product_summary) {
      updates.product_summary = product_summary;
    }

    if (company_name !== undefined) {
      updates.company_name = company_name;
    }

    if (gst_number !== undefined) {
      updates.gst_number = gst_number;
    }

    if (contact_person !== undefined) {
      updates.contact_person = contact_person;
    }

    if (delivery_matches_billing !== undefined) {
      updates.delivery_matches_billing = delivery_matches_billing === true || delivery_matches_billing === 'true';
    }

    const billingAddressId = await createAddressIfNeeded(billing_address_id, billing_address, transaction);
    const deliveryAddressId = await createAddressIfNeeded(delivery_address_id, delivery_address, transaction);

    if (billingAddressId) {
      updates.billing_address_id = billingAddressId;
    }

    if (deliveryAddressId) {
      updates.delivery_address_id = deliveryAddressId;
    }

    if (updates.delivery_matches_billing && updates.billing_address_id && !updates.delivery_address_id) {
      updates.delivery_address_id = updates.billing_address_id;
    }

    if (customer_email !== undefined) {
      updates.customer_email = customer_email;
    }

    if (customer_phone !== undefined) {
      updates.customer_phone = customer_phone;
    }

    if (delivery_instructions !== undefined) {
      updates.delivery_instructions = delivery_instructions;
    }

    if (notes !== undefined) {
      updates.notes = notes;
    }

    if (req.file) {
      // Use S3 URL if available, otherwise fall back to local path
      updates.image = (req.file as any).s3Location || `/uploads/${req.file.filename}`;
      
      // Delete old image from S3 if it exists
      if (sale.image) {
        await deleteFileFromS3IfExists(sale.image);
      }
    }

    await sale.update(updates, { transaction });

    await transaction.commit();

    const updated = await Sale.findByPk(id, {
      include: buildSaleIncludes()
    });

    logInfo('Sale updated', { saleId: id, updatedBy: req.user.id, updates: Object.keys(updates) });
    res.json(serializeSale(updated));
  } catch (error) {
    await transaction.rollback();
    logError('Update sale error', error, { saleId: req.params.id, updatedBy: req.user?.id });
    res.status(500).json({ error: 'Server error' });
  }
};

// Confirm B2B bill
export const confirmB2BBill = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const { id } = req.params;

    const sale = await Sale.findByPk(id);
    if (!sale) {
      res.status(404).json({ error: 'Sale not found' });
      return;
    }

    if (sale.type !== 'B2B') {
      res.status(400).json({ error: 'Only B2B sales can have bill confirmation' });
      return;
    }

    if (req.user.role !== 'account') {
      res.status(403).json({
        error: 'Only account managers can confirm bills'
      });
      return;
    }

    // Use S3 URL if available, otherwise fall back to local path or existing image
    const billImage = req.file 
      ? ((req.file as any).s3Location || `/uploads/${req.file.filename}`)
      : sale.bill_image;
    
    // Delete old bill image from S3 if it exists
    if (sale.bill_image && req.file) {
      await deleteFileFromS3IfExists(sale.bill_image);
    }

    if (!billImage) {
      res.status(400).json({ error: 'Bill image is required' });
      return;
    }

    await sale.update({
      bill_image: billImage,
      bill_confirmed_date: new Date(),
      bill_confirmed_by_id: req.user.id,
      bill_confirmed_by_name: req.user.name,
      payment_status: 'completed',
      approval_status: 'approved'
    });

    const updated = await Sale.findByPk(id, {
      include: buildSaleIncludes()
    });

    logInfo('B2B bill confirmed', { saleId: id, confirmedBy: req.user.id });
    res.json(serializeSale(updated));
  } catch (error) {
    logError('Confirm B2B bill error', error, { saleId: req.params.id, confirmedBy: req.user?.id });
    res.status(500).json({ error: 'Server error' });
  }
};

// Approve sale (account role)
export const approveSale = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    if (req.user.role !== 'account') {
      res.status(403).json({ error: 'Only account managers can approve sales' });
      return;
    }

    const { id } = req.params;
    const sale = await Sale.findByPk(id);
    if (!sale) {
      res.status(404).json({ error: 'Sale not found' });
      return;
    }

    await sale.update({ approval_status: 'approved' });

    const updated = await Sale.findByPk(id, {
      include: buildSaleIncludes()
    });

    res.json(serializeSale(updated));
  } catch (error) {
    logError('Approve sale error', error, { saleId: req.params.id, approvedBy: req.user?.id });
    res.status(500).json({ error: 'Server error' });
  }
};

// Delete sale
export const deleteSale = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const { id } = req.params;

    const sale = await Sale.findByPk(id);
    if (!sale) {
      res.status(404).json({ error: 'Sale not found' });
      return;
    }

    const canDelete =
      sale.created_by === req.user.id ||
      req.user.role === 'super-admin';

    if (!canDelete) {
      res.status(403).json({
        error: 'You do not have permission to delete this sale'
      });
      return;
    }

    await SaleItem.destroy({ where: { sale_id: id } });
    await sale.destroy();
    logInfo('Sale deleted', { saleId: id, customerName: sale.customer_name, deletedBy: req.user.id });
    res.json({ message: 'Sale deleted successfully' });
  } catch (error) {
    logError('Delete sale error', error, { saleId: req.params.id, deletedBy: req.user?.id });
    res.status(500).json({ error: 'Server error' });
  }
};

// Get sales summary
export const getSalesSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const andConditions: any[] = await buildSalesRoleConditions(req);
    const where = andConditions.length > 0 ? { [Op.and]: andConditions } : undefined;

    const summary = await Sale.findAll({
      attributes: [
        'type',
        'payment_status',
        [sequelize.fn('COUNT', sequelize.col('id')), 'sale_count'],
        [sequelize.fn('SUM', sequelize.col('total_quantity')), 'total_quantity'],
        [sequelize.fn('SUM', sequelize.col('total_amount')), 'total_revenue'],
        [sequelize.fn('SUM', sequelize.col('subtotal')), 'total_subtotal']
      ],
      where,
      group: ['type', 'payment_status'],
      order: [['type', 'ASC'], ['payment_status', 'ASC']],
      raw: true
    });

    logInfo('Get sales summary', { summaryCount: summary.length });
    res.json(summary);
  } catch (error) {
    logError('Get sales summary error', error);
    res.status(500).json({ error: 'Server error' });
  }
};

