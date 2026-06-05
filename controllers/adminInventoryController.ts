import { Request, Response } from 'express';
import { AdminInventory, User, Product, ProductSerialNumber } from '../models';
import { v4 as uuidv4 } from 'uuid';
import { logError, logInfo } from '../utils/loggerHelper';
import { Op } from 'sequelize';

// Get all admin inventory
export const getAllAdminInventory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { admin_id } = req.query;
    const where: any = {};

    if (admin_id) {
      where.admin_id = admin_id;
    }

    const inventory = await AdminInventory.findAll({
      where,
      include: [
        {
          model: User,
          as: 'admin',
          attributes: ['id', 'name']
        },
        {
          model: Product,
          as: 'product',
          attributes: ['id', 'name', 'model', 'category', 'wattage']
        }
      ],
      order: [
        [{ model: User, as: 'admin' }, 'name', 'ASC'],
        [{ model: Product, as: 'product' }, 'name', 'ASC']
      ]
    });

    // Format response
    const formattedInventory = inventory.map(item => {
      const itemAny = item as any;
      return {
        ...item.toJSON(),
        admin_name: itemAny.admin ? (itemAny.admin as User).name : null,
        product_name: itemAny.product ? (itemAny.product as Product).name : null,
        model: itemAny.product ? (itemAny.product as Product).model : null,
        wattage: itemAny.product ? (itemAny.product as Product).wattage : null,
        category_name: itemAny.product ? (itemAny.product as Product).category : null
      };
    });

    logInfo('Get all admin inventory', { count: formattedInventory.length, adminId: admin_id as string || 'all' });
    res.json(formattedInventory);
  } catch (error) {
    logError('Get all admin inventory error', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get admin inventory by ID
export const getAdminInventoryById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const inventory = await AdminInventory.findByPk(id, {
      include: [
        {
          model: User,
          as: 'admin',
          attributes: ['id', 'name']
        },
        {
          model: Product,
          as: 'product',
          attributes: ['id', 'name', 'model', 'category', 'wattage']
        }
      ]
    });

    if (!inventory) {
      res.status(404).json({ error: 'Admin inventory not found' });
      return;
    }

    const inventoryAny = inventory as any;
    const formatted = {
      ...inventory.toJSON(),
      admin_name: inventoryAny.admin ? (inventoryAny.admin as User).name : null,
      product_name: inventoryAny.product ? (inventoryAny.product as Product).name : null,
      model: inventoryAny.product ? (inventoryAny.product as Product).model : null,
      wattage: inventoryAny.product ? (inventoryAny.product as Product).wattage : null,
      category_name: inventoryAny.product ? (inventoryAny.product as Product).category : null
    };

    logInfo('Get admin inventory by ID', { inventoryId: id });
    res.json(formatted);
  } catch (error) {
    logError('Get admin inventory by ID error', error, { inventoryId: req.params.id });
    res.status(500).json({ error: 'Server error' });
  }
};

// Get inventory for specific admin
export const getAdminInventoryByAdminId = async (req: Request, res: Response): Promise<void> => {
  try {
    const { adminId } = req.params;

    // Verify admin exists
    const admin = await User.findOne({
      where: { id: adminId, role: 'admin' },
      attributes: ['id', 'name', 'role']
    });

    if (!admin) {
      res.status(404).json({ error: 'Admin not found' });
      return;
    }

    const inventory = await AdminInventory.findAll({
      where: { admin_id: adminId },
      include: [{
        model: Product,
        as: 'product',
        attributes: ['id', 'name', 'model', 'category', 'wattage']
      }],
      order: [[{ model: Product, as: 'product' }, 'name', 'ASC']]
    });

    const formatted = inventory.map(item => {
      const itemAny = item as any;
      return {
        ...item.toJSON(),
        product_name: itemAny.product ? (itemAny.product as Product).name : null,
        model: itemAny.product ? (itemAny.product as Product).model : null,
        wattage: itemAny.product ? (itemAny.product as Product).wattage : null,
        category_name: itemAny.product ? (itemAny.product as Product).category : null
      };
    });

    logInfo('Get admin inventory by admin ID', { adminId, count: formatted.length });
    res.json(formatted);
  } catch (error) {
    logError('Get admin inventory by admin ID error', error, { adminId: req.params.adminId });
    res.status(500).json({ error: 'Server error' });
  }
};

// Get serial numbers for a product mapped to an admin
export const getAdminProductSerialNumbers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { adminId, productId } = req.params;
    const statusFilter = (req.query.status as string | undefined) || 'acknowledged,dispatched';

    const admin = await User.findOne({
      where: { id: adminId, role: 'admin' },
      attributes: ['id']
    });

    if (!admin) {
      res.status(404).json({ error: 'Admin not found' });
      return;
    }

    const statusList = statusFilter.split(',').map((val) => val.trim()).filter(Boolean);
    const where: any = {
      product_id: productId,
      [Op.or]: [
        { owner_id: adminId, owner_type: 'admin' },
        { dispatched_to_admin_id: adminId }
      ]
    };
    if (statusList.length > 0) {
      where.status = { [Op.in]: statusList };
    }

    const serials = await ProductSerialNumber.findAll({
      where,
      order: [['created_at', 'DESC']]
    });

    res.json(serials.map((serial) => {
      const resolvedCost = serial.cost_price !== undefined && serial.cost_price !== null
        ? Number(serial.cost_price)
        : serial.price !== undefined && serial.price !== null
          ? Number(serial.price)
          : null;
      return {
        id: serial.id,
        serial_number: serial.serial_number,
        product_id: serial.product_id,
        cost_price: resolvedCost,
        price: resolvedCost,
        product_name: serial.product_name,
        category: serial.category,
        status: serial.status,
        created_at: serial.created_at,
        owner_id: serial.owner_id,
        owner_type: serial.owner_type
      };
    }));
  } catch (error) {
    logError('Get admin product serial numbers error', error, { adminId: req.params.adminId, productId: req.params.productId });
    res.status(500).json({ error: 'Server error' });
  }
};

// Create or update admin inventory
export const upsertAdminInventory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { admin_id, product_id, quantity } = req.body;

    if (!admin_id || !product_id || quantity === undefined) {
      res.status(400).json({
        error: 'admin_id, product_id, and quantity are required'
      });
      return;
    }

    if (quantity < 0) {
      res.status(400).json({ error: 'Quantity cannot be negative' });
      return;
    }

    // Verify admin exists
    const admin = await User.findOne({
      where: { id: admin_id, role: 'admin' }
    });

    if (!admin) {
      res.status(400).json({ error: 'Admin not found' });
      return;
    }

    // Verify product exists
    const product = await Product.findByPk(product_id);
    if (!product) {
      res.status(400).json({ error: 'Product not found' });
      return;
    }

    // Check if inventory entry exists
    const existing = await AdminInventory.findOne({
      where: { admin_id, product_id }
    });

    if (existing) {
      // Update existing
      await existing.update({ quantity });

      const updated = await AdminInventory.findByPk(existing.id, {
        include: [
          {
            model: User,
            as: 'admin',
            attributes: ['id', 'name']
          },
          {
            model: Product,
            as: 'product',
            attributes: ['id', 'name', 'model', 'category']
          }
        ]
      });

      if (!updated) {
        res.status(500).json({ error: 'Failed to retrieve updated inventory' });
        return;
      }

      const updatedAny = updated as any;
      const formatted = {
        ...updated.toJSON(),
        admin_name: updatedAny.admin ? (updatedAny.admin as User).name : null,
        product_name: updatedAny.product ? (updatedAny.product as Product).name : null,
        model: updatedAny.product ? (updatedAny.product as Product).model : null,
        category_name: updatedAny.product ? (updatedAny.product as Product).category : null
      };

      logInfo('Admin inventory updated', { inventoryId: existing.id, adminId: admin_id, productId: product_id, quantity, updatedBy: req.user?.id });
      res.json(formatted);
    } else {
      // Create new
      const id = uuidv4();
      const newInventory = await AdminInventory.create({
        id,
        admin_id,
        product_id,
        quantity
      });

      const created = await AdminInventory.findByPk(newInventory.id, {
        include: [
          {
            model: User,
            as: 'admin',
            attributes: ['id', 'name']
          },
          {
            model: Product,
            as: 'product',
            attributes: ['id', 'name', 'model', 'category']
          }
        ]
      });

      if (!created) {
        res.status(500).json({ error: 'Failed to retrieve created inventory' });
        return;
      }

      const createdAny = created as any;
      const formatted = {
        ...created.toJSON(),
        admin_name: createdAny.admin ? (createdAny.admin as User).name : null,
        product_name: createdAny.product ? (createdAny.product as Product).name : null,
        model: createdAny.product ? (createdAny.product as Product).model : null,
        category_name: createdAny.product ? (createdAny.product as Product).category : null
      };

      logInfo('Admin inventory created', { inventoryId: created.id, adminId: admin_id, productId: product_id, quantity, createdBy: req.user?.id });
      res.status(201).json(formatted);
    }
  } catch (error) {
    logError('Upsert admin inventory error', error, { adminId: req.body.admin_id, productId: req.body.product_id, createdBy: req.user?.id });
    res.status(500).json({ error: 'Server error' });
  }
};

// Update admin inventory
export const updateAdminInventory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { quantity } = req.body;

    if (quantity === undefined) {
      res.status(400).json({ error: 'Quantity is required' });
      return;
    }

    if (quantity < 0) {
      res.status(400).json({ error: 'Quantity cannot be negative' });
      return;
    }

    const inventory = await AdminInventory.findByPk(id);
    if (!inventory) {
      res.status(404).json({ error: 'Admin inventory not found' });
      return;
    }

    await inventory.update({ quantity });

    const updated = await AdminInventory.findByPk(id, {
      include: [
        {
          model: User,
          as: 'admin',
          attributes: ['id', 'name']
        },
        {
          model: Product,
          as: 'product',
          attributes: ['id', 'name', 'model', 'category']
        }
      ]
    });

    if (!updated) {
      res.status(500).json({ error: 'Failed to retrieve updated inventory' });
      return;
    }

    const updatedAny = updated as any;
    const formatted = {
      ...updated.toJSON(),
      admin_name: updatedAny.admin ? (updatedAny.admin as User).name : null,
      product_name: updatedAny.product ? (updatedAny.product as Product).name : null,
      model: updatedAny.product ? (updatedAny.product as Product).model : null,
      category_name: updatedAny.product ? (updatedAny.product as Product).category : null
    };

    logInfo('Admin inventory updated', { inventoryId: id, quantity, updatedBy: req.user?.id });
    res.json(formatted);
  } catch (error) {
    logError('Update admin inventory error', error, { inventoryId: req.params.id, updatedBy: req.user?.id });
    res.status(500).json({ error: 'Server error' });
  }
};

// Delete admin inventory
export const deleteAdminInventory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const inventory = await AdminInventory.findByPk(id);
    if (!inventory) {
      res.status(404).json({ error: 'Admin inventory not found' });
      return;
    }

    await inventory.destroy();
    logInfo('Admin inventory deleted', { inventoryId: id, adminId: inventory.admin_id, productId: inventory.product_id, deletedBy: req.user?.id });
    res.json({ message: 'Admin inventory deleted successfully' });
  } catch (error) {
    logError('Delete admin inventory error', error, { inventoryId: req.params.id, deletedBy: req.user?.id });
    res.status(500).json({ error: 'Server error' });
  }
};

