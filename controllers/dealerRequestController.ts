import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';
import { Dealer, DealerRequest, SystemConfig } from '../models/index-quotation';
import { logError, logInfo } from '../utils/loggerHelper';

const DEFAULT_ASSIGNMENT_CONFIG_KEY = 'dealer_request_default_assignment';

const parseDefaultAssignment = (configValue: string | null | undefined): { dealerId?: string } => {
  if (!configValue) return {};
  try {
    const parsed = JSON.parse(configValue);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const getDefaultAssignedDealerId = async (): Promise<string | null> => {
  const config = await SystemConfig.findByPk(DEFAULT_ASSIGNMENT_CONFIG_KEY);
  const dealerId = parseDefaultAssignment(config?.configValue).dealerId;
  if (!dealerId) return null;
  const dealer = await Dealer.findByPk(dealerId);
  if (!dealer || !dealer.isActive) return null;
  return dealer.id;
};

const resolveRequestedDealerForInventoryUser = async (userId: string, username?: string): Promise<string | null> => {
  const candidate = (username || '').trim();
  const orClauses: any[] = [];
  if (candidate) {
    orClauses.push({ username: candidate });
    if (candidate.includes('@')) orClauses.push({ email: candidate });
    if (/^\d+$/.test(candidate)) orClauses.push({ mobile: candidate });
  }
  orClauses.push({ id: userId });
  const dealer = await Dealer.findOne({
    where: { [Op.or]: orClauses },
    attributes: ['id']
  });
  return dealer ? dealer.id : null;
};

// Public endpoint: creates a request and auto-assigns dealer from admin-selected config.
export const createDealerRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const defaultDealerId = await getDefaultAssignedDealerId();

    const created = await DealerRequest.create({
      id: uuidv4(),
      customerName: req.body.customerName,
      phoneNumber: req.body.phoneNumber,
      email: req.body.email || null,
      city: req.body.city || null,
      state: req.body.state || null,
      address: req.body.address || null,
      message: req.body.message || null,
      source: req.body.source || 'api',
      status: 'new',
      assignedDealerId: defaultDealerId,
      requestPayload: req.body
    });

    logInfo('Dealer request created', {
      requestId: created.id,
      assignedDealerId: created.assignedDealerId || null
    });

    res.status(201).json({
      success: true,
      data: created
    });
  } catch (error) {
    logError('Create dealer request error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const getDealerRequests = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;
    const status = req.query.status as string | undefined;

    const where: any = {};
    if (status) where.status = status;

    const isQuotationAdmin = req.dealer?.role === 'admin';
    const isQuotationDealer = !!req.dealer && req.dealer.role !== 'admin';
    const isInventoryAdmin = !!req.user && ['admin', 'super-admin', 'super-admin-manager'].includes(req.user.role);
    const isInventoryDealerScoped = !!req.user && ['agent', 'account'].includes(req.user.role);

    if (isQuotationDealer && req.dealer) {
      where.assignedDealerId = req.dealer.id;
    } else if (isInventoryDealerScoped && req.user) {
      const mappedDealerId = await resolveRequestedDealerForInventoryUser(req.user.id, req.user.username);
      if (!mappedDealerId) {
        res.json({
          success: true,
          data: { requests: [], pagination: { page, limit, total: 0, totalPages: 0 } }
        });
        return;
      }
      where.assignedDealerId = mappedDealerId;
    } else if (!isQuotationAdmin && !isInventoryAdmin) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const requests = await DealerRequest.findAndCountAll({
      where,
      include: [
        {
          model: Dealer,
          as: 'assignedDealer',
          attributes: ['id', 'firstName', 'lastName', 'email', 'mobile']
        }
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    res.json({
      success: true,
      data: {
        requests: requests.rows,
        pagination: {
          page,
          limit,
          total: requests.count,
          totalPages: Math.ceil(requests.count / limit)
        }
      }
    });
  } catch (error) {
    logError('Get dealer requests error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const getDealerRequestById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { requestId } = req.params;
    const record = await DealerRequest.findByPk(requestId, {
      include: [
        {
          model: Dealer,
          as: 'assignedDealer',
          attributes: ['id', 'firstName', 'lastName', 'email', 'mobile']
        }
      ]
    });

    if (!record) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Request not found' }
      });
      return;
    }

    const isAdmin = req.dealer?.role === 'admin' || (req.user && ['admin', 'super-admin', 'super-admin-manager'].includes(req.user.role));
    let scopedDealerId: string | null = null;
    if (req.dealer && req.dealer.role !== 'admin') {
      scopedDealerId = req.dealer.id;
    } else if (req.user && ['agent', 'account'].includes(req.user.role)) {
      scopedDealerId = await resolveRequestedDealerForInventoryUser(req.user.id, req.user.username);
    }

    if (!isAdmin && (!scopedDealerId || record.assignedDealerId !== scopedDealerId)) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    res.json({ success: true, data: record });
  } catch (error) {
    logError('Get dealer request by ID error', error, { requestId: req.params.requestId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const updateDealerRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const { requestId } = req.params;
    const record = await DealerRequest.findByPk(requestId);
    if (!record) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Request not found' }
      });
      return;
    }

    const isAdmin = req.dealer?.role === 'admin' || (req.user && ['admin', 'super-admin', 'super-admin-manager'].includes(req.user.role));
    let scopedDealerId: string | null = null;
    if (req.dealer && req.dealer.role !== 'admin') {
      scopedDealerId = req.dealer.id;
    } else if (req.user && ['agent', 'account'].includes(req.user.role)) {
      scopedDealerId = await resolveRequestedDealerForInventoryUser(req.user.id, req.user.username);
    }

    if (!isAdmin && (!scopedDealerId || record.assignedDealerId !== scopedDealerId)) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    if (req.body.assignedDealerId !== undefined && req.body.assignedDealerId !== null) {
      const dealer = await Dealer.findByPk(req.body.assignedDealerId);
      if (!dealer) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_001',
            message: 'Validation error',
            details: [{ field: 'assignedDealerId', message: 'Dealer not found' }]
          }
        });
        return;
      }
    }

    const updateData: any = { ...req.body };
    if (isAdmin && req.body.assignedDealerId !== undefined) {
      updateData.assignedByAdminId = req.dealer?.id || req.user?.id || null;
    } else {
      delete updateData.assignedDealerId;
    }

    await record.update(updateData);

    const updated = await DealerRequest.findByPk(requestId, {
      include: [{ model: Dealer, as: 'assignedDealer', attributes: ['id', 'firstName', 'lastName', 'email', 'mobile'] }]
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    logError('Update dealer request error', error, { requestId: req.params.requestId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const deleteDealerRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const { requestId } = req.params;
    const record = await DealerRequest.findByPk(requestId);
    if (!record) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Request not found' }
      });
      return;
    }
    await record.destroy();
    res.json({ success: true, message: 'Request deleted successfully' });
  } catch (error) {
    logError('Delete dealer request error', error, { requestId: req.params.requestId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const setDefaultDealerAssignment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { dealerId } = req.body;
    const dealer = await Dealer.findByPk(dealerId);
    if (!dealer) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Validation error',
          details: [{ field: 'dealerId', message: 'Dealer not found' }]
        }
      });
      return;
    }

    const payload = JSON.stringify({ dealerId });
    const existing = await SystemConfig.findByPk(DEFAULT_ASSIGNMENT_CONFIG_KEY);
    if (existing) {
      await existing.update({
        configValue: payload,
        dataType: 'json',
        updatedAt: new Date()
      });
    } else {
      await SystemConfig.create({
        configKey: DEFAULT_ASSIGNMENT_CONFIG_KEY,
        configValue: payload,
        dataType: 'json',
        description: 'Default dealer assignment for incoming dealer requests',
        category: 'routing',
        updatedAt: new Date()
      });
    }

    res.json({
      success: true,
      message: 'Default dealer assignment updated',
      data: { dealerId }
    });
  } catch (error) {
    logError('Set default dealer assignment error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const getDefaultDealerAssignment = async (_req: Request, res: Response): Promise<void> => {
  try {
    const config = await SystemConfig.findByPk(DEFAULT_ASSIGNMENT_CONFIG_KEY);
    const dealerId = parseDefaultAssignment(config?.configValue).dealerId || null;

    let dealer = null;
    if (dealerId) {
      const found = await Dealer.findByPk(dealerId, {
        attributes: ['id', 'firstName', 'lastName', 'email', 'mobile', 'isActive']
      });
      dealer = found || null;
    }

    res.json({
      success: true,
      data: {
        dealerId,
        dealer
      }
    });
  } catch (error) {
    logError('Get default dealer assignment error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};
