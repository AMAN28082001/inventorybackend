import { Request, Response } from 'express';
import { Product, ProductSerialNumber } from '../models';
import { Op } from 'sequelize';
import { logError } from '../utils/loggerHelper';

export const searchSerialNumber = async (req: Request, res: Response): Promise<void> => {
  try {
    const query = (req.query.q as string || '').trim();
    if (!query) {
      res.status(400).json({ error: 'Query parameter q is required' });
      return;
    }

    const serial = await ProductSerialNumber.findOne({
      where: { serial_number: query }
    });

    if (!serial) {
      res.status(404).json({ error: 'Serial number not found' });
      return;
    }

    const product = await Product.findByPk(serial.product_id, {
      attributes: ['id', 'name', 'model']
    });

    const resolvedCost = serial.cost_price !== undefined && serial.cost_price !== null
      ? Number(serial.cost_price)
      : serial.price !== undefined && serial.price !== null
        ? Number(serial.price)
        : null;

    res.json({
      serial_number: serial.serial_number,
      cost_price: resolvedCost,
      price: resolvedCost,
      product_name: serial.product_name,
      category: serial.category,
      status: serial.status,
      product: product
        ? { id: product.id, name: product.name, model: product.model }
        : null,
      created_at: serial.created_at
    });
  } catch (error) {
    logError('Search serial number error', error, { query: req.query.q });
    res.status(500).json({ error: 'Server error' });
  }
};

export const deleteSerialNumber = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const serial = await ProductSerialNumber.findByPk(id);

    if (!serial) {
      res.status(404).json({ error: 'Serial number not found' });
      return;
    }

    await serial.destroy();
    res.json({ message: 'Serial number deleted successfully' });
  } catch (error) {
    logError('Delete serial number error', error, { id: req.params.id });
    res.status(500).json({ error: 'Server error' });
  }
};

export const listSerialNumbers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { owner_id, owner_type, product_id, product_name, status } = req.query as Record<string, string | undefined>;
    const where: any = {};

    if (owner_id) where.owner_id = owner_id;
    if (owner_type) where.owner_type = owner_type;
    if (product_id) where.product_id = product_id;
    if (product_name) {
      where.product_name = { [Op.iLike]: product_name };
    }
    if (status) {
      if (status === 'available') {
        where.status = { [Op.notIn]: ['dispatched', 'acknowledged', 'sold'] };
      } else {
        where.status = status;
      }
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
    logError('List serial numbers error', error, { query: req.query });
    res.status(500).json({ error: 'Server error' });
  }
};
