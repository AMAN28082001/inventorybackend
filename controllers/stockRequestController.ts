import { Request, Response } from 'express';
import { deleteFileFromS3IfExists } from '../middleware/upload';
import {
  StockRequest,
  StockRequestItem,
  Product,
  User,
  AdminInventory,
  InventoryTransaction,
  ProductSerialNumber
} from '../models';
import { v4 as uuidv4 } from 'uuid';
import sequelize from '../config/database';
import { logError, logInfo } from '../utils/loggerHelper';
import { Op, Transaction } from 'sequelize';

const isSuperAdminRole = (role: string | undefined): boolean =>
  role === 'super-admin' || role === 'super-admin-manager';

// Helper function to generate next integer ID for stock requests
const getNextStockRequestId = async (transaction: Transaction): Promise<string> => {
  const [results] = await sequelize.query(
    `SELECT id FROM stock_requests 
     WHERE id ~ '^[0-9]+$' 
     ORDER BY CAST(id AS INTEGER) DESC 
     LIMIT 1`,
    { transaction }
  ) as [any[], unknown];

  if (results && results.length > 0) {
    const lastId = parseInt(results[0].id, 10);
    if (!isNaN(lastId)) {
      return (lastId + 1).toString();
    }
  }

  return '1'; // Start from 1 if no numeric ID exists
};

const buildRequestIncludes = () => ([
  {
    model: StockRequestItem,
    as: 'items'
  },
  {
    model: User,
    as: 'requester',
    attributes: ['id', 'name', 'role']
  },
  {
    model: User,
    as: 'dispatcher',
    attributes: ['id', 'name']
  },
  {
    model: User,
    as: 'confirmer',
    attributes: ['id', 'name']
  }
]);

interface NormalizedItem {
  product_id: string | null;
  product_name: string;
  model: string;
  quantity: number;
}

const normalizeItemsPayload = async (rawItems: any, transaction: Transaction): Promise<NormalizedItem[]> => {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error('At least one line item is required');
  }

  const normalizedItems: NormalizedItem[] = [];

  for (const item of rawItems) {
    const quantity = Number(item.quantity);

    if (!quantity || quantity <= 0) {
      throw new Error('Each item must have a quantity greater than 0');
    }

    let productRecord: Product | null = null;
    let productName = item.product_name;
    let model = item.model;
    let productId: string | null = item.product_id || null;

    if (productId) {
      productRecord = await Product.findByPk(productId, { transaction });
      if (!productRecord) {
        throw new Error(`Product not found for id ${productId}`);
      }
      // Automatically fetch product details from the database
      productName = productName || productRecord.name;
      model = model || productRecord.model;
    }

    // If product_id is not provided, product_name and model are required
    if (!productId && (!productName || !model)) {
      throw new Error('product_id is required, or product_name and model must be provided');
    }

    normalizedItems.push({
      product_id: productId,
      product_name: productName,
      model,
      quantity
    });
  }

  return normalizedItems;
};

const attachStockRequestItems = async (stockRequestId: string, items: NormalizedItem[], transaction: Transaction): Promise<void> => {
  for (const item of items) {
    await StockRequestItem.create({
      id: uuidv4(),
      stock_request_id: stockRequestId,
      product_id: item.product_id,
      product_name: item.product_name,
      model: item.model,
      quantity: item.quantity
    }, { transaction });
  }
};

// Get all stock requests (with role-based filtering)
export const getAllStockRequests = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const { status, requested_by_id, requested_by, requested_from } = req.query;
    const andConditions: any[] = [];

    const userRole = req.user.role;
    const userId = req.user.id;

    if (userRole === 'agent') {
      res.status(403).json({ error: 'Agents cannot access stock requests' });
      return;
    } else if (userRole === 'admin') {
      // Admins only see their own requests to super-admin
      andConditions.push({
        requested_by_id: userId,
        requested_from: 'super-admin'
      });
    } else if (userRole === 'super-admin' || userRole === 'super-admin-manager') {
      // Super-admin sees requests from admins (requested_from = 'super-admin')
      andConditions.push({ requested_from: 'super-admin' });
    } else if (userRole === 'account') {
      // Account role sees all requests (no base filter)
    }

    if (status) {
      andConditions.push({ status });
    }

    if (requested_by_id || requested_by) {
      andConditions.push({ requested_by_id: requested_by_id || requested_by });
    }

    if (requested_from) {
      andConditions.push({ requested_from });
    }

    const where = andConditions.length > 0 ? { [Op.and]: andConditions } : {};

    const requests = await StockRequest.findAll({
      where,
      include: buildRequestIncludes(),
      order: [['requested_date', 'DESC']]
    });

    logInfo('Get all stock requests', { count: requests.length, status: status as string || 'all' });
    res.json(requests);
  } catch (error) {
    logError('Get all stock requests error', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get stock request by ID
export const getStockRequestById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const request = await StockRequest.findByPk(id, {
      include: buildRequestIncludes()
    });

    if (!request) {
      res.status(404).json({ error: 'Stock request not found' });
      return;
    }

    const serialRows = await ProductSerialNumber.findAll({
      where: {
        stock_request_id: id,
        status: { [Op.in]: ['dispatched', 'acknowledged'] }
      },
      order: [['created_at', 'DESC']]
    });

    const serialsByProduct: Record<string, string[]> = {};
    for (const serial of serialRows) {
      const productId = serial.product_id;
      if (!serialsByProduct[productId]) {
        serialsByProduct[productId] = [];
      }
      serialsByProduct[productId].push(serial.serial_number);
    }

    const response = request.toJSON() as any;
    if (Array.isArray(response.items)) {
      const productIds = response.items
        .map((item: { product_id?: string | null }) => item.product_id)
        .filter(Boolean) as string[];
      const products = productIds.length
        ? await Product.findAll({ where: { id: { [Op.in]: productIds } } })
        : [];
      const centralStockByProduct = new Map(
        products.map((p) => [p.id, Number(p.quantity)])
      );
      response.items = response.items.map((item: any) => ({
        ...item,
        central_stock: item.product_id ? centralStockByProduct.get(item.product_id) ?? 0 : null,
        quantity_available: item.product_id ? centralStockByProduct.get(item.product_id) ?? 0 : null,
        serial_numbers: item.product_id ? (serialsByProduct[item.product_id] || []) : []
      }));
    }
    if (Object.keys(serialsByProduct).length > 0) {
      response.dispatched_serial_numbers = serialsByProduct;
    }

    logInfo('Get stock request by ID', { requestId: id });
    res.json(response);
  } catch (error) {
    logError('Get stock request by ID error', error, { requestId: req.params.id });
    res.status(500).json({ error: 'Server error' });
  }
};

// Create stock request
export const createStockRequest = async (req: Request, res: Response): Promise<void> => {
  const transaction = await sequelize.transaction();

  try {
    if (!req.user) {
      await transaction.rollback();
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    if (req.user.role === 'agent') {
      await transaction.rollback();
      res.status(403).json({ error: 'Agents cannot create stock requests' });
      return;
    }

    const { items: rawItems, requested_from, notes } = req.body;
    let itemsPayload: any = rawItems;

    if (typeof itemsPayload === 'string') {
      try {
        itemsPayload = JSON.parse(itemsPayload);
      } catch (parseError) {
        await transaction.rollback();
        res.status(400).json({ error: 'items must be a JSON array' });
        return;
      }
    }

    // Backward compatibility with legacy single-item payload
    if ((!itemsPayload || !itemsPayload.length) && req.body.product_id) {
      itemsPayload = [{
        product_id: req.body.product_id,
        product_name: req.body.product_name,
        model: req.body.model,
        quantity: req.body.quantity
      }];
    }

    if (!requested_from) {
      await transaction.rollback();
      res.status(400).json({ error: 'requested_from is required' });
      return;
    }

    const normalizedItems = await normalizeItemsPayload(itemsPayload, transaction);
    const totalQuantity = normalizedItems.reduce((sum, item) => sum + item.quantity, 0);

    const requestedByRole = req.user.role === 'admin' ? 'admin' : 'agent';
    const requestedFromRole = requested_from === 'super-admin' ? 'super-admin' : 'admin';

    // Validate requested_from based on requester role
    if (requestedFromRole === 'admin') {
      // If requester is an agent and requested_from is "admin" (placeholder), allow it
      // This is a special case where agents don't specify which admin yet
      if (requestedByRole === 'agent' && requested_from === 'admin') {
        // Allow "admin" as a placeholder for agent requests
        // The actual admin will be determined during dispatch
      } else {
        // For admin-to-admin transfers, requested_from must be a valid admin ID
        const fromUser = await User.findOne({
          where: { id: requested_from, role: 'admin' },
          transaction
        });

        if (!fromUser) {
          await transaction.rollback();
          res.status(400).json({ error: 'Requested from user not found or not an admin' });
          return;
        }
      }
    }
    const primaryItem = normalizedItems[0];

    const nextId = await getNextStockRequestId(transaction);

    const newRequest = await StockRequest.create({
      id: nextId,
      primary_product_id: primaryItem.product_id,
      primary_product_name: primaryItem.product_name,
      primary_model: primaryItem.model,
      total_quantity: totalQuantity,
      requested_by_id: req.user.id,
        requested_by_name: (req.user as any).name || req.user.username,
      requested_by_role: requestedByRole,
      requested_from,
      requested_from_role: requestedFromRole,
      notes: notes || null
    }, { transaction });

    await attachStockRequestItems(newRequest.id, normalizedItems, transaction);

    await transaction.commit();

    const created = await StockRequest.findByPk(newRequest.id, {
      include: buildRequestIncludes()
    });

    if (!created) {
      res.status(500).json({ error: 'Failed to retrieve created request' });
      return;
    }

    logInfo('Stock request created', { requestId: created.id, requestedBy: req.user.id, requestedFrom: requested_from, totalQuantity, createdBy: req.user.id });
    res.status(201).json(created);
  } catch (error: any) {
    await transaction.rollback();
    logError('Create stock request error', error, { requestedBy: req.user?.id, requestedFrom: req.body.requested_from });
    res.status(400).json({ error: error.message || 'Unable to create stock request' });
  }
};

const adjustAdminInventory = async (adminId: string, productId: string, quantity: number, transaction: Transaction): Promise<AdminInventory> => {
  let record = await AdminInventory.findOne({
    where: { admin_id: adminId, product_id: productId },
    transaction,
    lock: transaction.LOCK.UPDATE
  });

  if (record) {
    await record.increment('quantity', { by: quantity, transaction });
    await record.reload({ transaction });
  } else {
    record = await AdminInventory.create({
      id: uuidv4(),
      admin_id: adminId,
      product_id: productId,
      quantity
    }, { transaction });
  }

  return record;
};

interface DispatchStockValidationDetail {
  product_id: string;
  product_name: string;
  path: string;
  message: string;
  requested_quantity: number;
  central_stock?: number;
  available_stock?: number;
}

const validateCentralInventoryForDispatch = async (
  items: StockRequestItem[],
  transaction: Transaction
): Promise<DispatchStockValidationDetail[]> => {
  const details: DispatchStockValidationDetail[] = [];

  for (const item of items) {
    if (!item.product_id) continue;

    const product = await Product.findByPk(item.product_id, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    const centralStock = product ? Number(product.quantity) : 0;
    const requestedQty = Number(item.quantity);

    if (!product || centralStock < requestedQty) {
      details.push({
        product_id: item.product_id,
        product_name: item.product_name,
        path: `items.${item.product_id}.quantity`,
        message: `Insufficient stock for product ${item.product_name} in central inventory (available: ${centralStock}, requested: ${requestedQty})`,
        requested_quantity: requestedQty,
        central_stock: centralStock
      });
    }
  }

  return details;
};

const validateSourceAdminInventoryForDispatch = async (
  adminId: string,
  items: StockRequestItem[],
  transaction: Transaction
): Promise<DispatchStockValidationDetail[]> => {
  const details: DispatchStockValidationDetail[] = [];

  for (const item of items) {
    if (!item.product_id) {
      details.push({
        product_id: item.id,
        product_name: item.product_name,
        path: `items.${item.id}`,
        message: `Product ID is required for item ${item.product_name}`,
        requested_quantity: Number(item.quantity)
      });
      continue;
    }

    const inventory = await AdminInventory.findOne({
      where: { admin_id: adminId, product_id: item.product_id },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    const availableStock = inventory ? Number(inventory.quantity) : 0;
    const requestedQty = Number(item.quantity);

    if (availableStock < requestedQty) {
      details.push({
        product_id: item.product_id,
        product_name: item.product_name,
        path: `items.${item.product_id}.quantity`,
        message: `Insufficient stock for product ${item.product_name} in source admin inventory (available: ${availableStock}, requested: ${requestedQty})`,
        requested_quantity: requestedQty,
        available_stock: availableStock
      });
    }
  }

  return details;
};

const decrementAdminInventory = async (adminId: string, item: NormalizedItem, transaction: Transaction): Promise<void> => {
  if (!item.product_id) {
    throw new Error(`Product ID is required for item ${item.product_name}`);
  }
  const inventory = await AdminInventory.findOne({
    where: { admin_id: adminId, product_id: item.product_id },
    transaction,
    lock: transaction.LOCK.UPDATE
  });

  if (!inventory) {
    throw new Error(`Inventory record not found for product ${item.product_name}`);
  }

  await inventory.decrement('quantity', { by: item.quantity, transaction });
  await inventory.reload({ transaction });

  if (inventory.quantity <= 0) {
    await inventory.destroy({ transaction });
  }
};

interface CreateTransferTransactionsParams {
  sourceRole: string;
  sourceName: string;
  destinationRole: string;
  destinationName: string;
  item: NormalizedItem;
  requestId: string;
  userId: string;
  transaction: Transaction;
}

const parseJsonBodyField = (raw: unknown, fieldName: string): unknown => {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`Invalid ${fieldName} JSON`);
    }
  }
  return raw;
};

const productHasSerialNumbers = async (
  productId: string,
  transaction: Transaction
): Promise<boolean> => {
  const count = await ProductSerialNumber.count({
    where: { product_id: productId },
    transaction
  });
  return count > 0;
};

/**
 * Approver may reduce line quantities on dispatch (no prior PUT required).
 * Each override: 1 ≤ quantity ≤ originally requested for that product_id.
 */
const applyDispatchItemQuantityOverrides = async (
  lineItems: StockRequestItem[],
  rawItems: unknown,
  transaction: Transaction
): Promise<StockRequestItem[]> => {
  if (rawItems === undefined || rawItems === null) {
    return lineItems;
  }

  const parsed = parseJsonBodyField(rawItems, 'items');
  if (!Array.isArray(parsed)) {
    throw new Error('items must be a JSON array');
  }

  if (parsed.length === 0) {
    return lineItems;
  }

  const originalQtyByProduct = new Map<string, number>();
  for (const line of lineItems) {
    if (!line.product_id) continue;
    originalQtyByProduct.set(line.product_id, Number(line.quantity));
  }

  const overrideByProduct = new Map<string, number>();
  for (const entry of parsed) {
    const productId = entry?.product_id != null ? String(entry.product_id) : '';
    const quantity = Number(entry?.quantity);
    if (!productId) {
      throw new Error('Each items entry must include product_id');
    }
    if (!Number.isFinite(quantity) || quantity < 1) {
      throw new Error(`Quantity for product ${productId} must be at least 1`);
    }
    const original = originalQtyByProduct.get(productId);
    if (original === undefined) {
      throw new Error(`Product ${productId} is not on this stock request`);
    }
    if (quantity > original) {
      throw new Error(
        `Quantity for product ${productId} cannot exceed originally requested quantity (${original})`
      );
    }
    overrideByProduct.set(productId, quantity);
  }

  for (const line of lineItems) {
    if (!line.product_id) continue;
    const overrideQty = overrideByProduct.get(line.product_id);
    if (overrideQty !== undefined && overrideQty !== Number(line.quantity)) {
      await line.update({ quantity: overrideQty }, { transaction });
      line.quantity = overrideQty;
    }
  }

  return lineItems;
};

const validateSerialCountsMatchDispatchQuantity = async (
  lineItems: StockRequestItem[],
  serialNumbersMap: Record<string, string[]> | null,
  serialNumberRanges: Record<string, { from: string; to: string }> | null,
  transaction: Transaction
): Promise<void> => {
  for (const item of lineItems) {
    if (!item.product_id) continue;
    const tracked = await productHasSerialNumbers(item.product_id, transaction);
    if (!tracked) continue;

    const qty = Number(item.quantity);
    if (serialNumberRanges?.[item.product_id]) {
      continue;
    }
    if (serialNumbersMap?.[item.product_id]) {
      const serialsList = serialNumbersMap[item.product_id];
      if (!Array.isArray(serialsList) || serialsList.length !== qty) {
        throw new Error(
          `Serial count (${Array.isArray(serialsList) ? serialsList.length : 0}) must match dispatched quantity (${qty}) for product ${item.product_id}`
        );
      }
      continue;
    }

    throw new Error(
      `Product ${item.product_name} requires serial numbers matching dispatched quantity (${qty})`
    );
  }
};

const createTransferTransactions = async ({
  sourceRole,
  sourceName,
  destinationRole,
  destinationName,
  item,
  requestId,
  userId,
  transaction
}: CreateTransferTransactionsParams): Promise<void> => {
  if (!item.product_id) {
    throw new Error('Product ID is required for transfer transaction');
  }

  const baseNote = `${item.product_name} (${item.quantity})`;

  await InventoryTransaction.create({
    id: uuidv4(),
    product_id: item.product_id,
    transaction_type: 'transfer',
    quantity: -item.quantity,
    reference: requestId,
    related_stock_request_id: requestId,
    created_by: userId,
    notes: `Transfer-out ${baseNote} from ${sourceRole === 'super-admin' ? 'Super Admin' : sourceName}`
  }, { transaction });

  if (destinationRole === 'admin') {
    await InventoryTransaction.create({
      id: uuidv4(),
      product_id: item.product_id,
      transaction_type: 'transfer',
      quantity: item.quantity,
      reference: requestId,
      related_stock_request_id: requestId,
      created_by: userId,
      notes: `Transfer-in ${baseNote} to ${destinationName}`
    }, { transaction });
  } else if (destinationRole === 'agent') {
    await InventoryTransaction.create({
      id: uuidv4(),
      product_id: item.product_id,
      transaction_type: 'transfer',
      quantity: item.quantity,
      reference: requestId,
      related_stock_request_id: requestId,
      created_by: userId,
      notes: `Issued ${baseNote} to agent ${destinationName}`
    }, { transaction });
  }
};

// Dispatch stock request
export const dispatchStockRequest = async (req: Request, res: Response): Promise<void> => {
  const transaction = await sequelize.transaction();

  try {
    if (!req.user) {
      await transaction.rollback();
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const { id } = req.params;
    const { rejection_reason } = req.body;
    const dispatchItemsRaw = (req.body as any).items;
    const serialNumberRangesRaw = (req.body as any).serial_number_ranges;
    const serialNumbersRaw = (req.body as any).serial_numbers;
    let serialNumberRanges: Record<string, { from: string; to: string }> | null = null;
    let serialNumbersMap: Record<string, string[]> | null = null;

    if (serialNumberRangesRaw) {
      if (!isSuperAdminRole(req.user.role)) {
        await transaction.rollback();
        res.status(403).json({ error: 'Only super-admin can specify serial number ranges' });
        return;
      }
      try {
        serialNumberRanges = parseJsonBodyField(serialNumberRangesRaw, 'serial_number_ranges') as
          | Record<string, { from: string; to: string }>
          | null;
      } catch (parseErr: any) {
        await transaction.rollback();
        res.status(400).json({ error: parseErr.message || 'Invalid serial_number_ranges JSON' });
        return;
      }
    }

    if (serialNumbersRaw) {
      try {
        serialNumbersMap = parseJsonBodyField(serialNumbersRaw, 'serial_numbers') as
          | Record<string, string[]>
          | null;
      } catch (parseErr: any) {
        await transaction.rollback();
        res.status(400).json({ error: parseErr.message || 'Invalid serial_numbers JSON' });
        return;
      }
    }

    // Lock the stock request first without include (PostgreSQL doesn't allow FOR UPDATE with LEFT OUTER JOIN)
    const request = await StockRequest.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (!request) {
      await transaction.rollback();
      res.status(404).json({ error: 'Stock request not found' });
      return;
    }

    if (request.status !== 'pending') {
      await transaction.rollback();
      res.status(400).json({ error: `Cannot dispatch request. Current status: ${request.status}` });
      return;
    }

    // Determine if user can dispatch
    // Super-admin can dispatch any request
    // Admin can dispatch if:
    //   1. Request is from super-admin (admin is dispatching to themselves or agent)
    //   2. Request is from another admin and they are the source (admin-to-admin transfer)
    //   3. Request is from agent with requested_from="admin" (any admin can dispatch to their agents)
    const canDispatch =
      isSuperAdminRole(req.user.role) ||
      (req.user.role === 'admin' &&
       (request.requested_from_role === 'super-admin' ||
        (request.requested_from_role === 'admin' && request.requested_from === req.user.id) ||
        (request.requested_by_role === 'agent' && request.requested_from === 'admin')));

    if (!canDispatch) {
      await transaction.rollback();
      res.status(403).json({ error: 'You do not have permission to dispatch this request' });
      return;
    }

    // Fetch items separately after locking the request
    let items = await StockRequestItem.findAll({
      where: { stock_request_id: id },
      transaction
    });

    if (rejection_reason) {
      await request.update({
        status: 'rejected',
        rejection_reason
      }, { transaction });

      await transaction.commit();

      const updated = await StockRequest.findByPk(id, {
        include: buildRequestIncludes()
      });

      res.json(updated);
      return;
    }

    if (!items.length) {
      await transaction.rollback();
      res.status(400).json({ error: 'Stock request has no line items' });
      return;
    }

    try {
      items = await applyDispatchItemQuantityOverrides(items, dispatchItemsRaw, transaction);
    } catch (overrideErr: any) {
      await transaction.rollback();
      res.status(400).json({ error: overrideErr.message || 'Invalid dispatch items' });
      return;
    }

    const dispatchTotalQuantity = items.reduce((sum, line) => sum + Number(line.quantity), 0);
    if (dispatchItemsRaw !== undefined && dispatchItemsRaw !== null) {
      await request.update({ total_quantity: dispatchTotalQuantity }, { transaction });
    }

    for (const item of items) {
      if (!item.product_id) {
        await transaction.rollback();
        res.status(400).json({ error: `Cannot dispatch item ${item.id} without a linked product` });
        return;
      }
    }

    if (serialNumberRanges && request.requested_by_role !== 'admin') {
      await transaction.rollback();
      res.status(400).json({ error: 'Serial number ranges are only supported for admin destinations' });
      return;
    }

    const transferredSerialsByProduct: Record<string, string[]> = {};

    // Determine the actual source admin ID
    // If requested_from is "admin" (placeholder for agent requests), use the dispatching admin's ID
    const actualSourceAdminId =
      request.requested_from === 'admin' && req.user.role === 'admin'
        ? req.user.id
        : request.requested_from;

    const sourceName =
      request.requested_from_role === 'super-admin'
        ? 'Super Admin'
        : request.requested_from === 'admin'
        ? (req.user as any).name || req.user.username
        : (await User.findByPk(request.requested_from, { transaction }))?.name || 'Unknown Admin';

    if (request.requested_from_role === 'super-admin') {
      const centralStockFailures = await validateCentralInventoryForDispatch(items, transaction);
      if (centralStockFailures.length > 0) {
        await transaction.rollback();
        res.status(400).json({
          error: 'Insufficient stock',
          details: centralStockFailures
        });
        return;
      }

      try {
        await validateSerialCountsMatchDispatchQuantity(
          items,
          serialNumbersMap,
          serialNumberRanges,
          transaction
        );
      } catch (serialErr: any) {
        await transaction.rollback();
        res.status(400).json({ error: serialErr.message || 'Serial number validation failed' });
        return;
      }

      for (const item of items) {
        if (!item.product_id) continue;
        const product = await Product.findByPk(item.product_id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!product) {
          await transaction.rollback();
          res.status(400).json({ error: `Product ${item.product_id} not found` });
          return;
        }

        if (serialNumberRanges) {
          const range = serialNumberRanges[item.product_id];
          if (!range || !range.from || !range.to) {
            await transaction.rollback();
            res.status(400).json({ error: `Serial number range missing for product ${item.product_id}` });
            return;
          }

          const serialsInRange = await ProductSerialNumber.findAll({
            where: {
              product_id: item.product_id,
              serial_number: { [Op.between]: [range.from, range.to] },
              status: 'available',
              [Op.or]: [
                { owner_id: null },
                { owner_type: 'super-admin' },
                { owner_id: req.user.id }
              ]
            },
            order: [['serial_number', 'ASC']],
            transaction,
            lock: transaction.LOCK.UPDATE
          });

          if (serialsInRange.length !== item.quantity) {
            await transaction.rollback();
            res.status(400).json({
              error: 'Validation error',
              details: [{
                path: `serial_number_ranges.${item.product_id}`,
                message: `Range contains ${serialsInRange.length} serial numbers, but quantity is ${item.quantity}`
              }]
            });
            return;
          }

          await ProductSerialNumber.update(
            {
              owner_id: request.requested_by_id,
              owner_type: 'admin',
              status: 'dispatched',
              stock_request_id: request.id,
              dispatched_to_admin_id: request.requested_by_id,
              dispatched_at: new Date()
            },
            {
              where: { id: { [Op.in]: serialsInRange.map((s) => s.id) } },
              transaction
            }
          );

          transferredSerialsByProduct[item.product_id] = serialsInRange.map((s) => s.serial_number);
        }

        if (serialNumbersMap && serialNumbersMap[item.product_id]) {
          const serialsList = serialNumbersMap[item.product_id];
          if (!Array.isArray(serialsList) || serialsList.length === 0) {
            await transaction.rollback();
            res.status(400).json({ error: `serial_numbers for product ${item.product_id} must be a non-empty array` });
            return;
          }
          if (serialsList.length !== item.quantity) {
            await transaction.rollback();
            res.status(400).json({
              error: `Serial count (${serialsList.length}) must match dispatched quantity (${item.quantity}) for product ${item.product_id}`
            });
            return;
          }

          const serialRows = await ProductSerialNumber.findAll({
            where: {
              product_id: item.product_id,
              serial_number: { [Op.in]: serialsList },
              status: 'available'
            },
            transaction,
            lock: transaction.LOCK.UPDATE
          });

          if (serialRows.length !== serialsList.length) {
            await transaction.rollback();
            res.status(400).json({ error: `Some serial numbers are invalid or not available for product ${item.product_id}` });
            return;
          }

          const destinationRole = request.requested_by_role === 'admin' ? 'admin' : 'agent';
          await ProductSerialNumber.update(
            {
              owner_id: request.requested_by_id,
              owner_type: destinationRole,
              status: 'dispatched',
              stock_request_id: request.id,
              dispatched_to_admin_id: request.requested_by_id,
              dispatched_at: new Date()
            },
            {
              where: { id: { [Op.in]: serialRows.map((s) => s.id) } },
              transaction
            }
          );

          transferredSerialsByProduct[item.product_id] = [
            ...(transferredSerialsByProduct[item.product_id] || []),
            ...serialRows.map((s) => s.serial_number)
          ];
        }

        await product.decrement('quantity', { by: item.quantity, transaction });

        if (request.requested_by_role === 'admin' && request.requested_by_id) {
          await adjustAdminInventory(request.requested_by_id, item.product_id, item.quantity, transaction);
        }
      }
    } else {
      // Admin-to-admin or admin-to-agent transfer
      // Validate that actualSourceAdminId is a valid admin ID (not the placeholder string)
      if (actualSourceAdminId === 'admin' || !actualSourceAdminId) {
        await transaction.rollback();
        res.status(400).json({ error: 'Invalid source admin ID for transfer' });
        return;
      }

      // Verify the source admin exists and is actually an admin
      const sourceAdmin = await User.findByPk(actualSourceAdminId, { transaction });
      if (!sourceAdmin || sourceAdmin.role !== 'admin') {
        await transaction.rollback();
        res.status(400).json({ error: 'Source admin not found or invalid role' });
        return;
      }

      const adminStockFailures = await validateSourceAdminInventoryForDispatch(
        actualSourceAdminId,
        items,
        transaction
      );
      if (adminStockFailures.length > 0) {
        await transaction.rollback();
        res.status(400).json({
          error: 'Insufficient stock',
          details: adminStockFailures
        });
        return;
      }

      // Decrease source admin's inventory (this is critical for admin-to-agent transfers)
      for (const item of items) {
        const normalizedItem: NormalizedItem = {
          product_id: item.product_id,
          product_name: item.product_name,
          model: item.model,
          quantity: item.quantity
        };
        
        // This MUST execute to decrease admin inventory when dispatching to agent
        // Log for debugging
        logInfo('Decrementing admin inventory', {
          adminId: actualSourceAdminId,
          productId: item.product_id,
          quantity: item.quantity,
          requestedByRole: request.requested_by_role,
          requestedById: request.requested_by_id
        });
        
        await decrementAdminInventory(actualSourceAdminId, normalizedItem, transaction);

        // If destination is an admin (admin-to-admin transfer), increase their inventory
        if (request.requested_by_role === 'admin' && request.requested_by_id && item.product_id) {
          if (serialNumberRanges) {
            const range = serialNumberRanges[item.product_id];
            if (!range || !range.from || !range.to) {
              await transaction.rollback();
              res.status(400).json({ error: `Serial number range missing for product ${item.product_id}` });
              return;
            }

            const serialsInRange = await ProductSerialNumber.findAll({
              where: {
                product_id: item.product_id,
                serial_number: { [Op.between]: [range.from, range.to] },
                status: 'available',
                owner_id: actualSourceAdminId,
                owner_type: 'admin'
              },
              order: [['serial_number', 'ASC']],
              transaction,
              lock: transaction.LOCK.UPDATE
            });

            if (serialsInRange.length !== item.quantity) {
              await transaction.rollback();
              res.status(400).json({
                error: 'Validation error',
                details: [{
                  path: `serial_number_ranges.${item.product_id}`,
                  message: `Range contains ${serialsInRange.length} serial numbers, but quantity is ${item.quantity}`
                }]
              });
              return;
            }

            await ProductSerialNumber.update(
              {
                owner_id: request.requested_by_id,
                owner_type: 'admin'
              },
              {
                where: { id: { [Op.in]: serialsInRange.map((s) => s.id) } },
                transaction
              }
            );

            transferredSerialsByProduct[item.product_id] = serialsInRange.map((s) => s.serial_number);
          }

          await adjustAdminInventory(request.requested_by_id, item.product_id, item.quantity, transaction);
        }
        // Note: If destination is an agent (admin-to-agent transfer), they don't have inventory records
        // The stock is just issued to them, and the source admin's inventory is decreased above
      }
    }

    const uploadedS3DispatchImage = req.file ? (req.file as any).s3Location : null;
    if (req.file && !uploadedS3DispatchImage) {
      throw new Error('Dispatch image upload failed. Could not store file in S3.');
    }
    const dispatchImage = uploadedS3DispatchImage || request.dispatch_image;
    
    // Delete old dispatch image from S3 if it exists
    if (request.dispatch_image && req.file) {
      await deleteFileFromS3IfExists(request.dispatch_image);
    }

    // Update request with dispatch info
    // If requested_from was "admin" (placeholder), update it to the actual admin ID
    const updateData: any = {
      status: 'dispatched',
      dispatched_by_id: req.user.id,
      dispatched_by_name: (req.user as any).name || req.user.username,
      dispatched_date: new Date(),
      dispatch_image: dispatchImage,
      rejection_reason: null
    };

    // If this was an agent request with "admin" placeholder, update to actual admin ID
    if (request.requested_from === 'admin' && req.user.role === 'admin') {
      updateData.requested_from = req.user.id;
    }

    await request.update(updateData, { transaction });

    for (const item of items) {
      if (!item.product_id) continue;
      const normalizedItem: NormalizedItem = {
        product_id: item.product_id,
        product_name: item.product_name,
        model: item.model,
        quantity: item.quantity
      };
      await createTransferTransactions({
        sourceRole: request.requested_from_role,
        sourceName,
        destinationRole: request.requested_by_role,
        destinationName: request.requested_by_name,
        item: normalizedItem,
        requestId: request.id,
        userId: req.user.id,
        transaction
      });
    }

    await transaction.commit();

    const updated = await StockRequest.findByPk(id, {
      include: buildRequestIncludes()
    });

    if (!updated) {
      await transaction.rollback();
      res.status(500).json({ error: 'Failed to retrieve updated request' });
      return;
    }

    logInfo('Stock request dispatched', { requestId: id, dispatchedBy: req.user.id, status: updated.status });
    const response = updated.toJSON() as any;
    if (Object.keys(transferredSerialsByProduct).length > 0) {
      response.serial_numbers = transferredSerialsByProduct;
    }
    res.json(response);
  } catch (error: any) {
    await transaction.rollback();
    logError('Dispatch stock request error', error, { requestId: req.params.id, dispatchedBy: req.user?.id });
    res.status(400).json({ error: error.message || 'Unable to dispatch stock request' });
  }
};

// Confirm stock request receipt
export const confirmStockRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const { id } = req.params;

    const request = await StockRequest.findByPk(id);
    if (!request) {
      res.status(404).json({ error: 'Stock request not found' });
      return;
    }

    if (request.status !== 'dispatched') {
      res.status(400).json({
        error: `Cannot confirm request. Current status: ${request.status}`
      });
      return;
    }

    const canConfirm = request.requested_by_id === req.user.id;
    if (!canConfirm) {
      res.status(403).json({
        error: 'You do not have permission to confirm this request'
      });
      return;
    }

    const uploadedS3ConfirmationImage = req.file ? (req.file as any).s3Location : null;
    if (req.file && !uploadedS3ConfirmationImage) {
      res.status(500).json({ error: 'Confirmation image upload failed. Could not store file in S3.' });
      return;
    }
    const confirmationImage = uploadedS3ConfirmationImage || request.confirmation_image;
    
    // Delete old confirmation image from S3 if it exists
    if (request.confirmation_image && req.file) {
      await deleteFileFromS3IfExists(request.confirmation_image);
    }
    await request.update({
      status: 'confirmed',
      confirmed_by_id: req.user.id,
      confirmed_by_name: (req.user as any).name || req.user.username,
      confirmed_date: new Date(),
      confirmation_image: confirmationImage
    });

    await ProductSerialNumber.update(
      { status: 'acknowledged' },
      {
        where: {
          stock_request_id: request.id,
          status: 'dispatched',
          dispatched_to_admin_id: request.requested_by_id
        }
      }
    );

    const updated = await StockRequest.findByPk(id, {
      include: buildRequestIncludes()
    });

    logInfo('Stock request confirmed', { requestId: id, confirmedBy: req.user.id });
    res.json(updated);
  } catch (error) {
    logError('Confirm stock request error', error, { requestId: req.params.id, confirmedBy: req.user?.id });
    res.status(500).json({ error: 'Server error' });
  }
};

// Update stock request
export const updateStockRequest = async (req: Request, res: Response): Promise<void> => {
  const transaction = await sequelize.transaction();

  try {
    if (!req.user) {
      await transaction.rollback();
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const { id } = req.params;
    const { items: rawItems, notes } = req.body;

    // Lock the stock request first without include (PostgreSQL doesn't allow FOR UPDATE with LEFT OUTER JOIN)
    const request = await StockRequest.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (!request) {
      await transaction.rollback();
      res.status(404).json({ error: 'Stock request not found' });
      return;
    }

    if (request.status !== 'pending') {
      await transaction.rollback();
      res.status(400).json({ error: 'Can only update pending requests' });
      return;
    }

    const canUpdate = request.requested_by_id === req.user.id;
    if (!canUpdate) {
      await transaction.rollback();
      res.status(403).json({ error: 'You do not have permission to update this request' });
      return;
    }

    const updates: any = {};

    if (notes !== undefined) {
      updates.notes = notes;
    }

    if (rawItems) {
      let parsedItems = rawItems;
      if (typeof parsedItems === 'string') {
        try {
          parsedItems = JSON.parse(parsedItems);
        } catch (parseError) {
          await transaction.rollback();
          res.status(400).json({ error: 'items must be a JSON array' });
          return;
        }
      }

      const normalizedItems = await normalizeItemsPayload(parsedItems, transaction);
      const totalQuantity = normalizedItems.reduce((sum, item) => sum + item.quantity, 0);
      const primaryItem = normalizedItems[0];

      updates.total_quantity = totalQuantity;
      updates.primary_product_id = primaryItem.product_id;
      updates.primary_product_name = primaryItem.product_name;
      updates.primary_model = primaryItem.model;

      await StockRequestItem.destroy({
        where: { stock_request_id: id },
        transaction
      });

      await attachStockRequestItems(id, normalizedItems, transaction);
    }

    await request.update(updates, { transaction });

    await transaction.commit();

    const updated = await StockRequest.findByPk(id, {
      include: buildRequestIncludes()
    });

    logInfo('Stock request updated', { requestId: id, updatedBy: req.user.id });
    res.json(updated);
  } catch (error: any) {
    await transaction.rollback();
    logError('Update stock request error', error, { requestId: req.params.id, updatedBy: req.user?.id });
    res.status(400).json({ error: error.message || 'Unable to update stock request' });
  }
};

// Delete stock request
export const deleteStockRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const { id } = req.params;

    const request = await StockRequest.findByPk(id);
    if (!request) {
      res.status(404).json({ error: 'Stock request not found' });
      return;
    }

    if (request.status !== 'pending') {
      res.status(400).json({
        error: 'Can only delete pending requests'
      });
      return;
    }

    const canDelete =
      request.requested_by_id === req.user.id ||
      req.user.role === 'super-admin';

    if (!canDelete) {
      res.status(403).json({
        error: 'You do not have permission to delete this request'
      });
      return;
    }

    await StockRequestItem.destroy({ where: { stock_request_id: id } });
    await request.destroy();
    logInfo('Stock request deleted', { requestId: id, deletedBy: req.user.id });
    res.json({ message: 'Stock request deleted successfully' });
  } catch (error) {
    logError('Delete stock request error', error, { requestId: req.params.id, deletedBy: req.user?.id });
    res.status(500).json({ error: 'Server error' });
  }
};

