import { Request, Response } from 'express';
import { Product, AdminInventory, ProductSerialNumber } from '../models';
import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';
import sequelize from '../config/database';
import { logError, logInfo } from '../utils/loggerHelper';
import { deleteFileFromS3IfExists } from '../middleware/upload';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

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
    res.json(products);
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

    logInfo('Get product by ID', { productId: id });
    res.json(product);
  } catch (error) {
    logError('Get product by ID error', error, { productId: req.params.id });
    res.status(500).json({ error: 'Server error' });
  }
};

// Get serial numbers for a product
export const getProductSerialNumbers = async (req: Request, res: Response): Promise<void> => {
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

    res.json({
      product_id: id,
      total_serial_numbers: serials.length,
      serial_numbers: serials.map((s) => ({
        id: s.id,
        serial_number: s.serial_number,
        created_at: s.created_at
      }))
    });
  } catch (error) {
    logError('Get product serial numbers error', error, { productId: req.params.id });
    res.status(500).json({ error: 'Server error' });
  }
};

// Create product
export const createProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, model, wattage, category, quantity, unit_price, image } = req.body;

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

    // Check if product with same name and model already exists
    const existingProduct = await Product.findOne({ where: { name, model } });

    if (existingProduct) {
      res.status(400).json({
        error: 'Product with this name and model already exists'
      });
      return;
    }

    const id = uuidv4();
    // Use S3 URL if available, otherwise fall back to local path or provided image
    const imagePath = req.file 
      ? ((req.file as any).s3Location || `/uploads/${req.file.filename}`)
      : image;

    const newProduct = await Product.create({
      id,
      name,
      model,
      wattage: wattage || null,
      category,
      quantity: quantity || 0,
      unit_price: unit_price !== undefined ? unit_price : null,
      image: imagePath || null,
      created_by: req.user.id
    });

    logInfo('Product created', { productId: newProduct.id, name: newProduct.name, model: newProduct.model, createdBy: req.user?.id });
    res.status(201).json(newProduct);
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
    const { name, model, wattage, category, quantity, unit_price, image, stock_to_add, serial_numbers } = req.body;

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

    const stockToAdd = stock_to_add !== undefined ? Number(stock_to_add) : undefined;
    if (stockToAdd !== undefined && (isNaN(stockToAdd) || stockToAdd < 0)) {
      res.status(400).json({ error: 'stock_to_add must be a non-negative number' });
      return;
    }

    if (quantity !== undefined) {
      if (quantity < 0) {
        res.status(400).json({ error: 'Quantity cannot be negative' });
        return;
      }
      if (stockToAdd === undefined) {
        updates.quantity = quantity;
      }
    }

    if (unit_price !== undefined) {
      if (unit_price < 0) {
        res.status(400).json({ error: 'Unit price cannot be negative' });
        return;
      }
      updates.unit_price = unit_price;
    }

    const imageFile = (req.file as Express.Multer.File) || ((req as any).files?.image?.[0] as Express.Multer.File | undefined);
    if (imageFile) {
      // Use S3 URL if available, otherwise fall back to local path
      updates.image = (imageFile as any).s3Location || `/uploads/${imageFile.filename}`;
      
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

    await sequelize.transaction(async (transaction) => {
      if (Object.keys(updates).length > 0) {
        await product.update(updates, { transaction });
      }

      if (stockToAdd && stockToAdd > 0) {
        const excelFile = (req as any).files?.serial_number_excel?.[0] as Express.Multer.File | undefined;
        const serialNumbers = parseSerialNumbers(serial_numbers);
        const excelSerials = excelFile ? parseSerialNumbersFromFile(excelFile) : [];
        const finalSerials = serialNumbers.length > 0 ? serialNumbers : excelSerials;

        if (finalSerials.length === 0) {
          throw new Error('Serial numbers are required when adding stock');
        }

        if (finalSerials.length !== stockToAdd) {
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
          const duplicates = existingSerials.map((s) => (s as any).serial_number);
          throw new Error(`Duplicate serial numbers found: ${duplicates.join(', ')}`);
        }

        const currentQuantity = Number(product.quantity);
        if (stockToAdd > currentQuantity) {
          throw new Error('stock_to_add cannot exceed current product quantity for initial stock');
        }

        for (const serial of uniqueSerials) {
          await ProductSerialNumber.create({
            id: uuidv4(),
            product_id: product.id,
            serial_number: serial
          }, { transaction });
        }

        if (stockToAdd < currentQuantity) {
          await product.increment('quantity', { by: stockToAdd, transaction });
        }

        if (excelFile) {
          try {
            fs.unlinkSync(excelFile.path);
          } catch (error) {
            logError('Failed to delete serial_number_excel file', error, { path: excelFile.path });
          }
        }
      }
    });

    const updatedProduct = await Product.findByPk(id);

    logInfo('Product updated', { productId: id, updatedBy: req.user?.id, updates: Object.keys(updates) });
    res.json({
      ...updatedProduct?.toJSON(),
      serial_numbers_added: stockToAdd && stockToAdd > 0 ? stockToAdd : 0
    });
  } catch (error) {
    logError('Update product error', error, { productId: req.params.id, updatedBy: req.user?.id });
    const message = error instanceof Error ? error.message : 'Server error';
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
        'products.unit_price',
        'products.quantity'
      ],
      order: [['name', 'ASC']],
      raw: true
    });

    logInfo('Get inventory levels', { count: inventory.length });
    res.json(inventory);
  } catch (error) {
    logError('Get inventory levels error', error);
    res.status(500).json({ error: 'Server error' });
  }
};

