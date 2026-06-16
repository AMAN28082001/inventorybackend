import { Request, Response } from 'express';
import { Product, AdminInventory, ProductSerialNumber, InventoryTransaction } from '../models';
import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';
import sequelize from '../config/database';
import { logError, logInfo } from '../utils/loggerHelper';
import { deleteFileFromS3IfExists } from '../middleware/upload';
import { SYS_STORAGE_CREDENTIALS_MESSAGE, SYS_STORAGE_OPTIONAL_NO_IMAGE_HINT } from '../utils/mapAwsStorageError';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { formatProductForApi } from '../utils/productApiFormat';
import { normalizeProductUnit, roundProductPrice } from '../utils/productUnit';
import {
  findProductSerialNumbers,
  productRequiresSerialOnDispatch
} from '../utils/productSerialLookup';

const logProductInventoryTransaction = async ({
  productId,
  transactionType,
  quantity,
  reference,
  notes,
  createdBy,
  transaction
}: {
  productId: string;
  transactionType: 'purchase' | 'adjustment' | 'sale' | 'transfer' | 'return';
  quantity: number;
  reference: string;
  notes?: string | null;
  createdBy?: string | null;
  transaction?: any;
}) => {
  if (!quantity || Number.isNaN(quantity)) return;
  await InventoryTransaction.create({
    id: uuidv4(),
    product_id: productId,
    transaction_type: transactionType,
    quantity,
    reference,
    notes: notes || null,
    created_by: createdBy || null
  }, transaction ? { transaction } : undefined);
};

// Get all products
export const getAllProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const { category, search } = req.query;
    const where: any = {};

    if (category) {
      where.category = category;
    }

    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { model: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const products = await Product.findAll({
      where,
      order: [['name', 'ASC']]
    });

    logInfo('Get all products', { count: products.length, category: category as string || 'all', search: search as string || 'none' });
    res.json(products.map((p) => formatProductForApi(p)));
  } catch (error) {
    logError('Get all products error', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get product by ID
export const getProductById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const product = await Product.findByPk(id);

    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const serials = await ProductSerialNumber.findAll({
      where: { product_id: id },
      order: [['created_at', 'DESC']]
    });

    logInfo('Get product by ID', { productId: id });
    const formatted = formatProductForApi(product);
    res.json({
      ...formatted,
      selling_price: formatted.selling_price !== undefined && formatted.selling_price !== null
        ? formatted.selling_price
        : formatted.unit_price,
      serial_numbers: serials.map((s) => ({
        id: s.id,
        serial_number: s.serial_number,
        product_id: s.product_id,
        cost_price: s.cost_price !== undefined && s.cost_price !== null
          ? Number(s.cost_price)
          : s.price !== undefined && s.price !== null
            ? Number(s.price)
            : null,
        status: s.status,
        created_at: s.created_at
      }))
    });
  } catch (error) {
    logError('Get product by ID error', error, { productId: req.params.id });
    res.status(500).json({ error: 'Server error' });
  }
};

// Get serial numbers for a product
export const getProductSerialNumbers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const statusFilter = req.query.status as string | undefined;

    const product = await Product.findByPk(id);
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const scope = (req.query.scope as string | undefined)?.trim().toLowerCase() as
      | 'central'
      | 'all'
      | undefined;

    if (!productRequiresSerialOnDispatch(product.category)) {
      res.json({
        product_id: id,
        total_serial_numbers: 0,
        available_count: statusFilter === 'available' ? 0 : undefined,
        serial_numbers: []
      });
      return;
    }

    const serials = await findProductSerialNumbers({
      productId: id,
      productName: product.name,
      status: statusFilter === 'available' ? 'available' : statusFilter,
      scope: scope === 'central' ? 'central' : 'all',
      userId: req.user?.id,
      userRole: req.user?.role
    });

    logInfo('Get product serial numbers', {
      productId: id,
      status: statusFilter || 'all',
      scope: scope || 'all',
      count: serials.length
    });

    res.json({
      product_id: id,
      total_serial_numbers: serials.length,
      available_count: statusFilter === 'available' ? serials.length : undefined,
      serial_numbers: serials.map((s) => {
        const resolvedCost = s.cost_price !== undefined && s.cost_price !== null
          ? Number(s.cost_price)
          : s.price !== undefined && s.price !== null
            ? Number(s.price)
            : null;
        return {
          id: s.id,
          serial_number: s.serial_number,
          product_id: s.product_id,
          cost_price: resolvedCost,
          price: resolvedCost,
          product_name: s.product_name,
          category: s.category,
          status: s.status,
          created_at: s.created_at
        };
      })
    });
  } catch (error) {
    logError('Get product serial numbers error', error, { productId: req.params.id });
    res.status(500).json({ error: 'Server error' });
  }
};

// Create product
export const createProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      name,
      model,
      wattage,
      category,
      quantity,
      unit,
      unit_price,
      selling_price,
      image,
      serial_numbers,
      default_price,
      cost_price,
      serial_number_prices,
      product_name,
      product_category
    } = req.body;

    if (!name || !model || !category) {
      res.status(400).json({
        error: 'Name, model, and category are required'
      });
      return;
    }

    if (!req.user) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const normalizedName = name.trim().toLowerCase();
    const normalizedModel = model.trim().toLowerCase();

    // Check if product with same name and model already exists (case-insensitive, trimmed)
    const existingProduct = await Product.findOne({
      where: {
        [Op.and]: [
          sequelize.where(
            sequelize.fn('lower', sequelize.fn('trim', sequelize.col('name'))),
            normalizedName
          ),
          sequelize.where(
            sequelize.fn('lower', sequelize.fn('trim', sequelize.col('model'))),
            normalizedModel
          )
        ]
      }
    });

    if (existingProduct) {
      res.status(400).json({
        success: false,
        error: 'Validation error',
        details: [
          {
            path: 'name',
            message: `Product with name '${name}' and model '${model}' already exists. Please edit the existing product to add quantity.`
          }
        ]
      });
      return;
    }

    const serialNumbers = serial_numbers ? parseSerialNumbers(serial_numbers) : [];
    const priceMap = parseSerialNumberPrices(serial_number_prices);
    const defaultPriceInput =
      default_price !== undefined && default_price !== null && default_price !== ''
        ? roundProductPrice(default_price) ?? undefined
        : cost_price !== undefined && cost_price !== null && cost_price !== ''
          ? roundProductPrice(cost_price) ?? undefined
          : undefined;
    const hasDefaultPrice = defaultPriceInput !== undefined && !isNaN(defaultPriceInput);
    const hasPriceMap = Object.keys(priceMap).length > 0;
    const maxSerialPrice = hasDefaultPrice
      ? defaultPriceInput!
      : hasPriceMap && serialNumbers.length > 0
        ? Math.max(
            ...serialNumbers
              .map((sn) => Number((priceMap as any)[sn]))
              .filter((price) => !isNaN(price))
          )
        : undefined;

    const id = uuidv4();
    // S3-only upload path for product images (ignore empty multipart file parts)
    const imageDiskFile =
      req.file && req.file.size !== 0 ? req.file : null;
    const uploadedS3Image = imageDiskFile ? (imageDiskFile as any).s3Location : null;
    if (imageDiskFile && !uploadedS3Image) {
      res.status(503).json({
        success: false,
        error: {
          code: 'SYS_STORAGE',
          message: SYS_STORAGE_CREDENTIALS_MESSAGE,
          hint: SYS_STORAGE_OPTIONAL_NO_IMAGE_HINT
        }
      });
      return;
    }
    const imagePath = uploadedS3Image || image;

    const resolvedCostPrice =
      unit_price !== undefined && unit_price !== null
        ? roundProductPrice(unit_price)
        : maxSerialPrice !== undefined && !isNaN(maxSerialPrice)
          ? roundProductPrice(maxSerialPrice)
          : null;
    const resolvedSellingPrice =
      selling_price !== undefined && selling_price !== null ? roundProductPrice(selling_price) : null;
    const resolvedUnit = unit !== undefined ? normalizeProductUnit(unit) : null;

    const newProduct = await Product.create({
      id,
      name,
      model,
      wattage: wattage || null,
      category,
      quantity: quantity || 0,
      unit: resolvedUnit,
      unit_price: resolvedCostPrice,
      selling_price: resolvedSellingPrice,
      image: imagePath || null,
      created_by: req.user.id
    });

    const normalizedCategory = category ? String(category).toLowerCase() : '';
    const requiresSerials = ['panels', 'panel', 'inverters', 'inverter', 'meter', 'meters'].includes(normalizedCategory);
    const hasQuantity = quantity !== undefined && Number(quantity) > 0;

    let createdSerials: string[] = [];
    if (serial_numbers) {
      const defaultPrice = defaultPriceInput;

      if (serialNumbers.length === 0) {
        res.status(400).json({ error: 'Serial numbers array is empty' });
        return;
      }

      if (hasDefaultPrice && hasPriceMap) {
        res.status(400).json({ error: 'Cannot provide both default_price and serial_number_prices' });
        return;
      }

      if (hasDefaultPrice && defaultPrice! <= 0) {
        res.status(400).json({ error: 'default_price must be greater than 0' });
        return;
      }

      if (hasPriceMap) {
        const missingPrices = serialNumbers.filter((sn) => {
          const price = Number((priceMap as any)[sn]);
          return isNaN(price) || price <= 0;
        });
        if (missingPrices.length > 0) {
          res.status(400).json({
            error: 'Validation error',
            details: [{
              path: 'serial_number_prices',
              message: `Missing or invalid prices for serial numbers: ${missingPrices.join(', ')}`
            }]
          });
          return;
        }
      }

      if (quantity && serialNumbers.length !== Number(quantity)) {
        res.status(400).json({
          error: 'Validation error',
          details: [{
            path: 'serial_numbers',
            message: `Expected ${quantity} serial numbers, got ${serialNumbers.length}`
          }]
        });
        return;
      }

      const uniqueSerials = Array.from(new Set(serialNumbers));
      if (uniqueSerials.length !== serialNumbers.length) {
        res.status(400).json({ error: 'Duplicate serial numbers provided' });
        return;
      }

      const existingSerials = await ProductSerialNumber.findAll({
        where: { serial_number: { [Op.in]: uniqueSerials } },
        attributes: ['serial_number']
      });
      if (existingSerials.length > 0) {
        const duplicates = existingSerials.map((s) => s.serial_number);
        res.status(400).json({ error: `Duplicate serial numbers found: ${duplicates.join(', ')}` });
        return;
      }

      const ownerType = req.user?.role === 'super-admin' ? 'super-admin' : req.user?.role === 'admin' ? 'admin' : null;
      const ownerId = ownerType ? req.user?.id : null;
      const serialProductName = (product_name || name).toString();
      const serialCategory = (product_category || category).toString();

      for (const serial of uniqueSerials) {
        const rawSerialPrice = hasDefaultPrice
          ? defaultPrice!
          : hasPriceMap
            ? Number((priceMap as any)[serial])
            : null;
        const serialPrice = rawSerialPrice !== null ? roundProductPrice(rawSerialPrice) : null;
        await ProductSerialNumber.create({
          id: uuidv4(),
          product_id: newProduct.id,
          serial_number: serial,
          owner_id: ownerId,
          owner_type: ownerType,
          status: 'available',
          price: serialPrice,
          cost_price: serialPrice,
          product_name: serialProductName,
          category: serialCategory
        });
      }
      createdSerials = uniqueSerials;
    }

    if (requiresSerials && hasQuantity && createdSerials.length === 0) {
      res.status(400).json({ error: 'Serial numbers are required for this category' });
      return;
    }

    const initialQuantity = Number(newProduct.quantity || 0);
    if (initialQuantity > 0) {
      await logProductInventoryTransaction({
        productId: newProduct.id,
        transactionType: 'purchase',
        quantity: initialQuantity,
        reference: 'product_create',
        notes: 'Initial stock on product creation',
        createdBy: req.user?.id || null
      });
    }

    logInfo('Product created', { productId: newProduct.id, name: newProduct.name, model: newProduct.model, createdBy: req.user?.id });
    res.status(201).json({
      ...formatProductForApi(newProduct),
      serial_numbers: createdSerials
    });
  } catch (error) {
    logError('Create product error', error, { name: req.body.name, model: req.body.model, createdBy: req.user?.id });
    res.status(500).json({ error: 'Server error' });
  }
};

// Update product
const parseSerialNumbers = (raw: any): string[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map(String).map((val) => val.trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(String).map((val) => val.trim()).filter(Boolean);
      }
    } catch {
      // fall through to split
    }
    return raw
      .split(/[\n,]+/)
      .map((val) => val.trim())
      .filter(Boolean);
  }
  return [];
};

const parseSerialNumberPrices = (raw: any): Record<string, number> => {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw;
  }
  return {};
};

const parseSerialNumbersFromFile = (file: Express.Multer.File): string[] => {
  const ext = path.extname(file.originalname || '').toLowerCase();

  if (ext === '.csv') {
    const text = fs.readFileSync(file.path, 'utf8');
    const lines = text.split(/\r?\n/).filter(Boolean);
    let startRow = 0;
    if (lines[0] && /serial|number|sn/i.test(lines[0])) {
      startRow = 1;
    }
    const serials: string[] = [];
    for (let i = startRow; i < lines.length; i += 1) {
      const firstColumn = lines[i].split(',')[0]?.trim();
      if (firstColumn) serials.push(firstColumn);
    }
    return serials;
  }

  if (ext === '.xlsx' || ext === '.xls') {
    const buffer = fs.readFileSync(file.path);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' }) as Array<Array<string | number>>;
    let startRow = 0;
    if (data.length > 0 && typeof data[0][0] === 'string' && /serial|number|sn/i.test(data[0][0])) {
      startRow = 1;
    }
    const serials: string[] = [];
    for (let i = startRow; i < data.length; i += 1) {
      const cell = data[i][0];
      if (cell !== undefined && cell !== null && String(cell).trim() !== '') {
        serials.push(String(cell).trim());
      }
    }
    return serials;
  }

  throw new Error('Unsupported serial_number_excel file type');
};

export const updateProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      name,
      model,
      wattage,
      category,
      quantity,
      unit,
      unit_price,
      selling_price,
      image,
      stock_to_add,
      serial_numbers,
      default_price,
      cost_price,
      serial_number_prices,
      product_name,
      product_category,
      use_max_cost_price
    } = req.body;

    const product = await Product.findByPk(id);
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const updates: any = {};

    if (name) {
      updates.name = name;
    }

    if (model) {
      updates.model = model;
    }

    if (wattage !== undefined) {
      updates.wattage = wattage;
    }

    if (category) {
      updates.category = category;
    }

    if (unit !== undefined) {
      const normalizedUnit = normalizeProductUnit(unit);
      if (unit !== null && unit !== '' && normalizedUnit === null) {
        res.status(400).json({ error: 'Invalid unit value' });
        return;
      }
      updates.unit = normalizedUnit;
    }

    /**
     * Stock semantics (single rule):
     * - quantity alone: sets absolute on-hand quantity (delta logged as adjustment).
     * - stock_to_add alone: adds to current quantity (logged as purchase).
     * - both: quantity must equal current + stock_to_add (frontend consistency check).
     */
    const stockToAdd = stock_to_add !== undefined ? Number(stock_to_add) : undefined;
    if (stockToAdd !== undefined && (isNaN(stockToAdd) || stockToAdd < 0 || !Number.isInteger(stockToAdd))) {
      res.status(400).json({ error: 'stock_to_add must be a non-negative whole number (pieces)' });
      return;
    }

    const quantityNumber = quantity !== undefined ? Number(quantity) : undefined;
    if (quantityNumber !== undefined) {
      if (!Number.isFinite(quantityNumber) || quantityNumber < 0) {
        res.status(400).json({ error: 'Quantity cannot be negative' });
        return;
      }
      if (stockToAdd === undefined) {
        updates.quantity = quantityNumber;
      }
    }

    if (unit_price !== undefined) {
      const unitPriceNumber =
        unit_price === null || unit_price === '' ? null : roundProductPrice(unit_price);
      if (unit_price !== null && unit_price !== '' && unitPriceNumber === null) {
        res.status(400).json({ error: 'Unit price cannot be negative' });
        return;
      }
      updates.unit_price = unitPriceNumber;
    }

    if (selling_price !== undefined) {
      const sellingPriceNumber =
        selling_price === null || selling_price === '' ? null : roundProductPrice(selling_price);
      if (selling_price !== null && selling_price !== '' && sellingPriceNumber === null) {
        res.status(400).json({ error: 'Selling price cannot be negative' });
        return;
      }
      updates.selling_price = sellingPriceNumber;
    }

    const rawImageFile =
      (req.file as Express.Multer.File) || ((req as any).files?.image?.[0] as Express.Multer.File | undefined);
    const imageFile =
      rawImageFile && rawImageFile.size !== 0 ? rawImageFile : null;
    if (imageFile) {
      const uploadedS3Image = (imageFile as any).s3Location;
      if (!uploadedS3Image) {
        res.status(503).json({
          success: false,
          error: {
            code: 'SYS_STORAGE',
            message: SYS_STORAGE_CREDENTIALS_MESSAGE,
            hint: SYS_STORAGE_OPTIONAL_NO_IMAGE_HINT
          }
        });
        return;
      }
      updates.image = uploadedS3Image;
      
      // Delete old image from S3 if it exists
      if (product.image) {
        await deleteFileFromS3IfExists(product.image);
      }
    } else if (image !== undefined) {
      updates.image = image;
    }

    // Check for duplicate name-model combination if name or model is being updated
    if (name || model) {
      const checkName = name || product.name;
      const checkModel = model || product.model;

      const existingProduct = await Product.findOne({
        where: { name: checkName, model: checkModel, id: { [Op.ne]: id } }
      });

      if (existingProduct) {
        res.status(400).json({
          error: 'Product with this name and model combination already exists'
        });
        return;
      }
    }

    const effectiveCategory = (category || product.category || '').toString().toLowerCase();
    const requiresSerials = ['panels', 'panel', 'inverters', 'inverter', 'meter', 'meters'].includes(effectiveCategory);
    const baseQuantityBeforeUpdate = Number(product.quantity || 0);
    const plannedAbsoluteQuantity = updates.quantity !== undefined ? Number(updates.quantity) : undefined;

    let createdSerials: string[] = [];
    await sequelize.transaction(async (transaction) => {
      if (Object.keys(updates).length > 0) {
        await product.update(updates, { transaction });
      }

      if (
        plannedAbsoluteQuantity !== undefined &&
        Number.isFinite(plannedAbsoluteQuantity) &&
        plannedAbsoluteQuantity !== baseQuantityBeforeUpdate
      ) {
        const quantityDelta = plannedAbsoluteQuantity - baseQuantityBeforeUpdate;
        await logProductInventoryTransaction({
          productId: product.id,
          transactionType: 'adjustment',
          quantity: quantityDelta,
          reference: 'manual_quantity_update',
          notes: `Manual quantity set from ${baseQuantityBeforeUpdate} to ${plannedAbsoluteQuantity}`,
          createdBy: req.user?.id || null,
          transaction
        });
      }

      if (stockToAdd !== undefined) {
        const excelFile = (req as any).files?.serial_number_excel?.[0] as Express.Multer.File | undefined;
        const serialNumbers = parseSerialNumbers(serial_numbers);
        const excelSerials = excelFile ? parseSerialNumbersFromFile(excelFile) : [];
        const finalSerials = serialNumbers.length > 0 ? serialNumbers : excelSerials;
        const priceMap = parseSerialNumberPrices(serial_number_prices);
        const defaultPriceInput =
          default_price !== undefined && default_price !== null && default_price !== ''
            ? roundProductPrice(default_price) ?? undefined
            : cost_price !== undefined && cost_price !== null && cost_price !== ''
              ? roundProductPrice(cost_price) ?? undefined
              : undefined;
        const hasDefaultPrice = defaultPriceInput !== undefined && defaultPriceInput !== null;
        const hasPriceMap = Object.keys(priceMap).length > 0;

        const currentQuantity = Number(product.quantity);
        if (!Number.isFinite(currentQuantity) || currentQuantity < 0) {
          throw new Error('Current product quantity is invalid');
        }

        // Contract (delta mode): stock_to_add is always additive.
        // If frontend also sends quantity, it must match current + stock_to_add.
        if (quantityNumber !== undefined) {
          const expectedQuantity = currentQuantity + stockToAdd;
          if (quantityNumber !== expectedQuantity) {
            throw new Error(
              `quantity must match current quantity + stock_to_add (${currentQuantity} + ${stockToAdd} = ${expectedQuantity})`
            );
          }
        }

        if (finalSerials.length === 0) {
          if (requiresSerials && stockToAdd > 0) {
            throw new Error('Serial numbers are required for this category');
          }
          if (stockToAdd > 0) {
            await product.increment('quantity', { by: stockToAdd, transaction });
            await logProductInventoryTransaction({
              productId: product.id,
              transactionType: 'purchase',
              quantity: stockToAdd,
              reference: 'manual_add_stock',
              notes: `Stock added via product update${finalSerials.length > 0 ? ` (${finalSerials.length} serials)` : ''}`,
              createdBy: req.user?.id || null,
              transaction
            });
          }
          if (excelFile) {
            try {
              fs.unlinkSync(excelFile.path);
            } catch (error) {
              logError('Failed to delete serial_number_excel file', error, { path: excelFile.path });
            }
          }
          return;
        }

        if (hasDefaultPrice && hasPriceMap) {
          throw new Error('Cannot provide both default_price and serial_number_prices');
        }

        if (hasDefaultPrice && defaultPriceInput! <= 0) {
          throw new Error('default_price must be greater than 0');
        }

        if (hasPriceMap) {
          const missingPrices = finalSerials.filter((sn) => {
            const price = Number((priceMap as any)[sn]);
            return isNaN(price) || price <= 0;
          });
          if (missingPrices.length > 0) {
            throw new Error(`Missing or invalid prices for serial numbers: ${missingPrices.join(', ')}`);
          }
        }

        if (stockToAdd > 0 && finalSerials.length !== stockToAdd) {
          throw new Error(`Expected ${stockToAdd} serial numbers, got ${finalSerials.length}`);
        }

        const uniqueSerials = Array.from(new Set(finalSerials));
        if (uniqueSerials.length !== finalSerials.length) {
          throw new Error('Duplicate serial numbers provided');
        }

        const existingSerials = await ProductSerialNumber.findAll({
          where: { serial_number: { [Op.in]: uniqueSerials } },
          attributes: ['serial_number'],
          transaction
        });
        if (existingSerials.length > 0) {
          const duplicates = existingSerials.map((s) => s.serial_number);
          throw new Error(`Duplicate serial numbers found: ${duplicates.join(', ')}`);
        }

        const isAssigningSerialsToExistingStock = stockToAdd === 0 && finalSerials.length > 0;
        if (isAssigningSerialsToExistingStock) {
          const existingSerialCount = await ProductSerialNumber.count({
            where: { product_id: product.id },
            transaction
          });
          const availableSlots = currentQuantity - existingSerialCount;
          if (availableSlots <= 0) {
            throw new Error('No unassigned stock available to map serial numbers');
          }
          if (finalSerials.length > availableSlots) {
            throw new Error(`Only ${availableSlots} stock units are available for serial assignment`);
          }
        }

        const ownerType = req.user?.role === 'super-admin' ? 'super-admin' : req.user?.role === 'admin' ? 'admin' : null;
        const ownerId = ownerType ? req.user?.id : null;
        const serialProductName = (product_name || product.name).toString();
        const serialCategory = (product_category || product.category).toString();

        for (const serial of uniqueSerials) {
          const serialPrice = hasDefaultPrice
            ? defaultPriceInput!
            : hasPriceMap
              ? Number((priceMap as any)[serial])
              : null;
          await ProductSerialNumber.create({
            id: uuidv4(),
            product_id: product.id,
            serial_number: serial,
            owner_id: ownerId,
            owner_type: ownerType,
            status: 'available',
            price: serialPrice,
            cost_price: serialPrice,
            product_name: serialProductName,
            category: serialCategory
          }, { transaction });
        }
        createdSerials = uniqueSerials;

        if (stockToAdd > 0) {
          await product.increment('quantity', { by: stockToAdd, transaction });
          await logProductInventoryTransaction({
            productId: product.id,
            transactionType: 'purchase',
            quantity: stockToAdd,
            reference: 'manual_add_stock',
            notes: `Stock added via product update (${uniqueSerials.length} serials)`,
            createdBy: req.user?.id || null,
            transaction
          });
        }

        if (selling_price === undefined && use_max_cost_price !== false) {
          const maxRow = await ProductSerialNumber.findOne({
            where: { product_id: product.id },
            attributes: [[sequelize.literal('COALESCE(MAX(cost_price), MAX(price))'), 'max_price']],
            raw: true,
            transaction
          });
          const maxPrice = maxRow && (maxRow as any).max_price !== null
            ? Number((maxRow as any).max_price)
            : null;
          if (maxPrice !== null && !isNaN(maxPrice)) {
            await product.update({ selling_price: maxPrice }, { transaction });
          }
        }

        if (excelFile) {
          try {
            fs.unlinkSync(excelFile.path);
          } catch (error) {
            logError('Failed to delete serial_number_excel file', error, { path: excelFile.path });
          }
        }
      }

      if (use_max_cost_price === true && selling_price === undefined) {
        const maxRow = await ProductSerialNumber.findOne({
          where: { product_id: product.id },
          attributes: [[sequelize.literal('COALESCE(MAX(cost_price), MAX(price))'), 'max_price']],
          raw: true,
          transaction
        });
        const maxPrice = maxRow && (maxRow as any).max_price !== null
          ? Number((maxRow as any).max_price)
          : null;
        if (maxPrice !== null && !isNaN(maxPrice)) {
          await product.update({ selling_price: maxPrice }, { transaction });
        }
      }
    });

    const updatedProduct = await Product.findByPk(id);

    logInfo('Product updated', { productId: id, updatedBy: req.user?.id, updates: Object.keys(updates) });
    res.json({
      ...(updatedProduct ? formatProductForApi(updatedProduct) : {}),
      serial_numbers_added: stockToAdd && stockToAdd > 0 ? stockToAdd : 0,
      serial_numbers: createdSerials.length > 0 ? createdSerials : undefined
    });
  } catch (error) {
    logError('Update product error', error, { productId: req.params.id, updatedBy: req.user?.id });
    const message = error instanceof Error ? error.message : 'Server error';
    if (message.includes('Missing or invalid prices') || message.includes('default_price') || message.includes('serial_number_prices')) {
      res.status(400).json({
        error: 'Validation error',
        details: [{
          path: 'pricing',
          message
        }]
      });
      return;
    }
    res.status(400).json({ error: message });
  }
};

// Delete product
export const deleteProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const product = await Product.findByPk(id);
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    // Check if product is in admin inventory
    const adminInventory = await AdminInventory.findOne({ where: { product_id: id } });

    if (adminInventory) {
      res.status(400).json({
        error: 'Cannot delete product. It exists in admin inventory.'
      });
      return;
    }

    // Delete associated image from S3 if it exists
    if (product.image) {
      await deleteFileFromS3IfExists(product.image);
    }
    
    await product.destroy();
    logInfo('Product deleted', { productId: id, name: product.name, deletedBy: req.user?.id });
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    logError('Delete product error', error, { productId: req.params.id, deletedBy: req.user?.id });
    res.status(500).json({ error: 'Server error' });
  }
};

// Get inventory levels (central + distributed)
export const getInventoryLevels = async (_req: Request, res: Response): Promise<void> => {
  try {
    const inventory = await Product.findAll({
      attributes: [
        'id',
        'name',
        'model',
        'category',
        'wattage',
        'unit',
        'unit_price',
        [sequelize.col('products.quantity'), 'central_stock'],
        [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('admin_inventory.quantity')), 0), 'distributed_stock'],
        [sequelize.literal('(products.quantity + COALESCE(SUM(admin_inventory.quantity), 0))'), 'total_stock']
      ],
      include: [{
        model: AdminInventory,
        as: 'adminInventory',
        attributes: [],
        required: false
      }],
      group: [
        'products.id',
        'products.name',
        'products.model',
        'products.category',
        'products.wattage',
        'products.unit',
        'products.unit_price',
        'products.quantity'
      ],
      order: [['name', 'ASC']],
      raw: true
    });

    const rows = inventory.map((row) => {
      const plain = row as unknown as Record<string, unknown>;
      const centralStock = Number(plain.central_stock ?? 0);
      return {
        ...plain,
        quantity: centralStock,
        central_stock: centralStock
      };
    });

    logInfo('Get inventory levels', { count: rows.length });
    res.json(rows);
  } catch (error) {
    logError('Get inventory levels error', error);
    res.status(500).json({ error: 'Server error' });
  }
};

