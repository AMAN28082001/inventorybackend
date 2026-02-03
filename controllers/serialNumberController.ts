import { Request, Response } from 'express';
import { Product, ProductSerialNumber } from '../models';
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

    res.json({
      serial_number: serial.serial_number,
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
