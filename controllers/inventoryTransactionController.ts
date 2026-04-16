import { Request, Response } from 'express';
import { InventoryTransaction, Product, User, StockRequest, Sale } from '../models';
import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';
import { logError, logInfo } from '../utils/loggerHelper';

// Get all inventory transactions
export const getAllInventoryTransactions = async (req: Request, res: Response): Promise<void> => {
  try {
    const { product_id, transaction_type, start_date, end_date, page, limit } = req.query;
    const where: any = {};

    if (product_id) {
      where.product_id = product_id;
    }

    if (transaction_type) {
      where.transaction_type = transaction_type;
    }

    if (start_date || end_date) {
      where.timestamp = {};
      if (start_date) {
        where.timestamp[Op.gte] = new Date(start_date as string);
      }
      if (end_date) {
        where.timestamp[Op.lte] = new Date(end_date as string);
      }
    }

    const parsedPage = Math.max(1, Number(page) || 1);
    const parsedLimitRaw = Number(limit);
    const usePagination = Number.isFinite(parsedLimitRaw) && parsedLimitRaw > 0;
    const parsedLimit = usePagination ? Math.min(200, parsedLimitRaw) : null;
    const offset = usePagination ? (parsedPage - 1) * (parsedLimit as number) : undefined;

    const transactionsResult = await InventoryTransaction.findAndCountAll({
      where,
      include: [
        {
          model: Product,
          as: 'product',
          attributes: ['id', 'name', 'model']
        },
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'name']
        },
        {
          model: StockRequest,
          as: 'relatedStockRequest',
          attributes: ['id', 'requested_by_name', 'requested_by_role', 'status'],
          required: false
        },
        {
          model: Sale,
          as: 'relatedSale',
          attributes: ['id', 'customer_name', 'type', 'payment_status'],
          required: false
        }
      ],
      order: [['timestamp', 'DESC']],
      ...(usePagination ? { limit: parsedLimit as number, offset } : {})
    });

    const formatted = transactionsResult.rows.map(txn => {
      const txnAny = txn as any;
      return {
        id: txn.id,
        product_id: txn.product_id,
        transaction_type: txn.transaction_type,
        quantity: txn.quantity,
        reference: txn.reference || null,
        notes: txn.notes || null,
        created_at: txn.timestamp || null,
        timestamp: txn.timestamp || null,
        related_stock_request_id: txn.related_stock_request_id || null,
        related_sale_id: txn.related_sale_id || null,
        created_by: txn.created_by || null,
        product_name: txnAny.product ? (txnAny.product as Product).name : null,
        model: txnAny.product ? (txnAny.product as Product).model : null,
        created_by_name: txnAny.creator ? (txnAny.creator as User).name : null,
        related_stock_request: txnAny.relatedStockRequest || null,
        related_sale: txnAny.relatedSale || null
      };
    });

    logInfo('Get all inventory transactions', {
      count: formatted.length,
      total: transactionsResult.count,
      productId: product_id as string || 'all',
      transactionType: transaction_type as string || 'all'
    });

    if (usePagination) {
      res.json({
        transactions: formatted,
        pagination: {
          page: parsedPage,
          limit: parsedLimit,
          total: transactionsResult.count,
          totalPages: Math.max(1, Math.ceil(transactionsResult.count / (parsedLimit as number)))
        }
      });
      return;
    }

    res.json(formatted);
  } catch (error) {
    logError('Get all inventory transactions error', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get inventory transaction by ID
export const getInventoryTransactionById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const transaction = await InventoryTransaction.findByPk(id, {
      include: [
        {
          model: Product,
          as: 'product',
          attributes: ['id', 'name', 'model']
        },
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'name']
        },
        {
          model: StockRequest,
          as: 'relatedStockRequest',
          attributes: ['id', 'requested_by_name', 'requested_by_role', 'status'],
          required: false
        },
        {
          model: Sale,
          as: 'relatedSale',
          attributes: ['id', 'customer_name', 'type', 'payment_status'],
          required: false
        }
      ]
    });

    if (!transaction) {
      res.status(404).json({ error: 'Inventory transaction not found' });
      return;
    }

    const transactionAny = transaction as any;
    const formatted = {
      ...transaction.toJSON(),
      product_name: transactionAny.product ? (transactionAny.product as Product).name : null,
      model: transactionAny.product ? (transactionAny.product as Product).model : null,
      created_by_name: transactionAny.creator ? (transactionAny.creator as User).name : null,
      related_stock_request: transactionAny.relatedStockRequest || null,
      related_sale: transactionAny.relatedSale || null
    };

    logInfo('Get inventory transaction by ID', { transactionId: id });
    res.json(formatted);
  } catch (error) {
    logError('Get inventory transaction by ID error', error, { transactionId: req.params.id });
    res.status(500).json({ error: 'Server error' });
  }
};

// Create inventory transaction (usually created automatically, but can be manual)
export const createInventoryTransaction = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      product_id,
      transaction_type,
      quantity,
      reference,
      notes,
      related_stock_request_id,
      related_sale_id
    } = req.body;

    if (!product_id || !transaction_type || quantity === undefined) {
      res.status(400).json({
        error: 'product_id, transaction_type, and quantity are required'
      });
      return;
    }

    if (!req.user) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const validTypes = ['purchase', 'sale', 'return', 'adjustment', 'transfer'];
    if (!validTypes.includes(transaction_type)) {
      res.status(400).json({ error: 'Invalid transaction type' });
      return;
    }

    // Verify product exists
    const product = await Product.findByPk(product_id);
    if (!product) {
      res.status(400).json({ error: 'Product not found' });
      return;
    }

    const id = uuidv4();

    const newTransaction = await InventoryTransaction.create({
      id,
      product_id,
      transaction_type,
      quantity,
      reference: reference || null,
      related_stock_request_id: related_stock_request_id || null,
      related_sale_id: related_sale_id || null,
      notes: notes || null,
      created_by: req.user.id
    });

    const created = await InventoryTransaction.findByPk(newTransaction.id, {
      include: [
        {
          model: Product,
          as: 'product',
          attributes: ['id', 'name', 'model']
        },
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'name']
        },
        {
          model: StockRequest,
          as: 'relatedStockRequest',
          attributes: ['id', 'requested_by_name', 'requested_by_role', 'status'],
          required: false
        },
        {
          model: Sale,
          as: 'relatedSale',
          attributes: ['id', 'customer_name', 'type', 'payment_status'],
          required: false
        }
      ]
    });

    if (!created) {
      res.status(500).json({ error: 'Failed to retrieve created transaction' });
      return;
    }

    const createdAny = created as any;
    const formatted = {
      ...created.toJSON(),
      product_name: createdAny.product ? (createdAny.product as Product).name : null,
      model: createdAny.product ? (createdAny.product as Product).model : null,
      created_by_name: createdAny.creator ? (createdAny.creator as User).name : null,
      related_stock_request: createdAny.relatedStockRequest || null,
      related_sale: createdAny.relatedSale || null
    };

    logInfo('Inventory transaction created', { transactionId: newTransaction.id, productId: product_id, transactionType: transaction_type, quantity, createdBy: req.user.id });
    res.status(201).json(formatted);
  } catch (error) {
    logError('Create inventory transaction error', error, { productId: req.body.product_id, transactionType: req.body.transaction_type, createdBy: req.user?.id });
    res.status(500).json({ error: 'Server error' });
  }
};

