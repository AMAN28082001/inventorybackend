import { Request, Response } from 'express';
import { Quotation, QuotationPaymentPhase, Dealer, Customer, Visitor } from '../models/index-quotation';
import { Op } from 'sequelize';
import { logError, logInfo } from '../utils/loggerHelper';
import { normalizePaymentModeInput } from '../utils/paymentMode';
import { quotationPaymentApiFields, quotationAdminMetadataFields, readStatusHistoryFromRow } from '../utils/quotationApiJson';
import { emitRealtime, realtimeEvents } from '../utils/realtime';

const sumPhasePaidAmounts = (phases: { paidAmount?: number }[]): number =>
  phases.reduce((sum, p) => sum + Number((p as any).paidAmount || 0), 0);

const remainingAgainstSubtotal = (subtotal: number | null | undefined, totalPaid: number): number => {
  const base = Number(subtotal) || 0;
  const paid = Number(totalPaid);
  const safePaid = isNaN(paid) ? 0 : paid;
  return Math.max(0, base - safePaid);
};

const resolveDealerIdForInventoryUser = async (userId: string, username?: string): Promise<string | null> => {
  const candidate = (username || '').trim();
  const orClauses: any[] = [];
  if (candidate) {
    orClauses.push({ username: candidate });
    if (candidate.includes('@')) {
      orClauses.push({ email: candidate });
    }
    if (/^\d+$/.test(candidate)) {
      orClauses.push({ mobile: candidate });
    }
  }
  orClauses.push({ id: userId });

  const dealer = await Dealer.findOne({
    where: { [Op.or]: orClauses },
    attributes: ['id']
  });
  return dealer ? dealer.id : null;
};

const APPROVAL_PAYMENT_TYPES = ['loan', 'cash', 'mix'] as const;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

function normalizeApprovalPaymentType(raw: unknown): 'loan' | 'cash' | 'mix' | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  return (APPROVAL_PAYMENT_TYPES as readonly string[]).includes(v) ? (v as 'loan' | 'cash' | 'mix') : null;
}

function normalizeIfscValue(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toUpperCase().replace(/\s/g, '');
  return IFSC_REGEX.test(v) ? v : null;
}

function normalizeFileLoginStatus(raw: unknown): 'already_login' | 'login_now' | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (v === 'already_login' || v === 'already_logged_in' || v === 'alreadylogin') return 'already_login';
  if (v === 'login_now' || v === 'loginnow') return 'login_now';
  return null;
}

// Get all quotations (admin)
export const getAllQuotations = async (req: Request, res: Response): Promise<void> => {
  try {
    const isQuotationAdmin = req.dealer && req.dealer.role === 'admin';
    const isQuotationDealer = req.dealer && req.dealer.role !== 'admin';
    const isInventoryAdmin = req.user && (req.user.role === 'admin' || req.user.role === 'super-admin' || req.user.role === 'super-admin-manager');
    const isInventoryAgent = req.user && (req.user.role === 'agent' || req.user.role === 'account');

    if (!isQuotationAdmin && !isQuotationDealer && !isInventoryAdmin && !isInventoryAgent) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const limitParam = req.query.limit as string | undefined;
    const limit = limitParam ? Math.min(parseInt(limitParam) || 20, 1000) : undefined;
    const offset = limit ? (page - 1) * limit : undefined;
    const status = req.query.status as string;
    const dealerId = req.query.dealerId as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const where: any = {};

    if (status) where.status = status;
    if (dealerId) where.dealerId = dealerId;

    if (isQuotationDealer && req.dealer) {
      where.dealerId = req.dealer.id;
    } else if (isInventoryAgent && req.user) {
      const mappedDealerId = await resolveDealerIdForInventoryUser(req.user.id, req.user.username);
      if (!mappedDealerId) {
        res.json({
          success: true,
          data: {
            quotations: [],
            pagination: {
              page,
              limit,
              total: 0,
              totalPages: 0
            }
          }
        });
        return;
      }
      where.dealerId = mappedDealerId;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate);
    }

    const quotations = await Quotation.findAndCountAll({
      where,
      include: [
        {
          model: Dealer,
          as: 'dealer',
          attributes: ['id', 'firstName', 'lastName']
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['firstName', 'lastName', 'mobile']
        }
      ],
      limit,
      offset,
      order: [['createdAt', 'DESC']]
    });
    const phaseRows = await QuotationPaymentPhase.findAll({
      where: { quotationId: { [Op.in]: quotations.rows.map((q: any) => q.id) } },
      order: [['quotationId', 'ASC'], ['phaseNumber', 'ASC']]
    });
    const phaseMap = new Map<string, any[]>();
    for (const phase of phaseRows as any[]) {
      const qid = String(phase.quotationId);
      if (!phaseMap.has(qid)) phaseMap.set(qid, []);
      phaseMap.get(qid)!.push({
        phaseNumber: Number(phase.phaseNumber),
        phaseName: phase.phaseName,
        amount: Number(phase.amount || 0),
        paidAmount: Number(phase.paidAmount || 0),
        status: phase.status,
        dueDate: phase.dueDate ? new Date(phase.dueDate).toISOString() : null,
        paymentDate: phase.paymentDate ? new Date(phase.paymentDate).toISOString() : null,
        paymentMode: normalizePaymentModeInput(phase.paymentMode) ?? null,
        transactionId: phase.transactionId || null
      });
    }

    res.json({
      success: true,
      data: {
        quotations: quotations.rows.map(q => {
          const qAny = q as any;
          const phases = phaseMap.get(String(q.id)) || qAny.paymentPhases || [];
          const subtotalNum = Number(q.subtotal || 0);
          const totalPaidForRemaining =
            phases.length > 0 ? sumPhasePaidAmounts(phases) : Number(q.paidAmount || 0);
          const remainingAmount = remainingAgainstSubtotal(subtotalNum, totalPaidForRemaining);
          const row =
            typeof qAny.get === 'function'
              ? (qAny.get({ plain: true }) as Record<string, unknown>)
              : (q as unknown as Record<string, unknown>);
          return {
            id: q.id,
            dealer: qAny.dealer ? {
              id: qAny.dealer.id,
              firstName: qAny.dealer.firstName,
              lastName: qAny.dealer.lastName
            } : null,
            customer: qAny.customer ? {
              firstName: qAny.customer.firstName,
              lastName: qAny.customer.lastName,
              mobile: qAny.customer.mobile
            } : null,
            systemType: q.systemType,
            ...quotationPaymentApiFields(row),
            ...quotationAdminMetadataFields(row),
            paymentStatus: (q as any).paymentStatus || null,
            subtotal: subtotalNum,
            paidAmount: q.paidAmount !== undefined && q.paidAmount !== null ? Number(q.paidAmount) : null,
            remaining: remainingAmount,
            remainingAmount,
            installments: phases,
            paymentPhases: phases,
            payment_phases: phases,
            finalAmount: subtotalNum,
            status: q.status,
            installationStatus: (q as any).installationStatus || 'pending_installer',
            approvedAt: (q as any).approvedAt || null,
            installerApprovedAt: (q as any).installerApprovedAt || null,
            createdAt: q.createdAt
          };
        }),
        pagination: {
          page,
          limit: limit || quotations.count,
          total: quotations.count,
          totalPages: limit ? Math.ceil(quotations.count / limit) : 1
        }
      }
    });
  } catch (error) {
    logError('Get all quotations error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Update quotation status (admin) — see BACKEND_ADMIN_QUOTATION_STATUS.ts
export const updateQuotationStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer || req.dealer.role !== 'admin') {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'Admin required' }
      });
      return;
    }

    const { quotationId } = req.params;
    if (!quotationId) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: 'Quotation ID required' }
      });
      return;
    }

    const body = req.body as {
      status: 'pending' | 'approved' | 'rejected' | 'completed';
      paymentType?: 'loan' | 'cash' | 'mix';
      paymentMode?: 'loan' | 'cash' | 'mix';
      bankName?: string;
      bankIfsc?: string;
      bank_ifsc?: string;
      subsidyChequeDetails?: string;
      subsidy_cheque_details?: string;
    };
    const statusRaw = body.status;
    const allowed = ['pending', 'approved', 'rejected', 'completed'] as const;
    if (!allowed.includes(statusRaw as (typeof allowed)[number])) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_002', message: `status must be one of: ${allowed.join(', ')}` }
      });
      return;
    }

    const quotation = await Quotation.findByPk(quotationId);
    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    const plainBefore = quotation.get({ plain: true }) as unknown as Record<string, unknown>;
    const prevHistory = readStatusHistoryFromRow(plainBefore);
    const at = new Date().toISOString();
    const updateData: Record<string, unknown> = {
      status: statusRaw,
      statusHistory: [...prevHistory, { status: statusRaw, at }]
    };

    if (statusRaw === 'approved') {
      const paymentTypeResolved =
        normalizeApprovalPaymentType(body.paymentType) ?? normalizeApprovalPaymentType(body.paymentMode);
      if (!paymentTypeResolved) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_003',
            message: 'paymentType or paymentMode required (loan, cash, mix)'
          }
        });
        return;
      }

      updateData.paymentMode = paymentTypeResolved;
      updateData.paymentType = paymentTypeResolved;
      updateData.statusApprovedAt = new Date();

      if (paymentTypeResolved === 'loan' || paymentTypeResolved === 'mix') {
        const bankName = typeof body.bankName === 'string' ? body.bankName.trim() : '';
        const ifsc = normalizeIfscValue(body.bankIfsc ?? body.bank_ifsc);
        if (!bankName) {
          res.status(400).json({
            success: false,
            error: { code: 'VAL_004', message: 'bankName required for loan/mix' }
          });
          return;
        }
        if (!ifsc) {
          res.status(400).json({
            success: false,
            error: { code: 'VAL_005', message: 'Valid 11-char bankIfsc required for loan/mix' }
          });
          return;
        }
        updateData.bankName = bankName;
        updateData.bankIfsc = ifsc;
      } else {
        updateData.bankName = null;
        updateData.bankIfsc = null;
      }

      const subsidyRaw =
        typeof body.subsidyChequeDetails === 'string'
          ? body.subsidyChequeDetails.trim()
          : typeof body.subsidy_cheque_details === 'string'
            ? body.subsidy_cheque_details.trim()
            : '';
      if (paymentTypeResolved === 'loan') {
        updateData.subsidyChequeDetails = null;
      } else if (paymentTypeResolved === 'cash' || paymentTypeResolved === 'mix') {
        updateData.subsidyChequeDetails = subsidyRaw || null;
      }

      updateData.installationStatus = 'pending_installer';
      updateData.approvedAt = new Date();
    } else if (statusRaw === 'rejected') {
      updateData.bankName = null;
      updateData.bankIfsc = null;
      updateData.paymentMode = null;
      updateData.paymentType = null;
      updateData.subsidyChequeDetails = null;
      updateData.subsidyCheques = [];
      updateData.remainingAmount = null;
    }

    await quotation.update(updateData);
    await quotation.reload();

    const rowAfter = quotation.get({ plain: true }) as unknown as Record<string, unknown>;
    res.json({
      success: true,
      data: {
        id: quotationId,
        status: quotation.status,
        ...quotationPaymentApiFields(rowAfter),
        ...quotationAdminMetadataFields(rowAfter)
      }
    });

    logInfo('Quotation status updated by admin', {
      quotationId: quotation.id,
      adminId: req.dealer.id,
      status: quotation.status,
      paymentMode: quotation.paymentMode,
      bankName: quotation.bankName ?? null,
      bankIfsc: quotation.bankIfsc ?? null,
      statusApprovedAt: quotation.statusApprovedAt,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logError('Update quotation status error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal error' }
    });
  }
};

// PATCH /admin/quotations/:quotationId/file-login — see BACKEND_ADMIN_QUOTATION_STATUS.ts
export const updateQuotationFileLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer || req.dealer.role !== 'admin') {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'Admin required' }
      });
      return;
    }

    const { quotationId } = req.params;
    if (!quotationId) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: 'Quotation ID required' }
      });
      return;
    }

    const quotation = await Quotation.findByPk(quotationId);
    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    const body = req.body as Record<string, unknown>;

    if (body.resetFileLogin === true) {
      await quotation.update({
        fileLoginStatus: null,
        filePaymentType: null,
        fileBankName: null,
        fileBankIfsc: null,
        fileSubsidyChequeDetails: null,
        fileLoginAt: null
      });
      await quotation.reload();
      res.json({
        success: true,
        data: {
          id: quotationId,
          reset: true,
          fileLoginStatus: null,
          fileLoginAt: null
        }
      });
      return;
    }

    const fls = normalizeFileLoginStatus(body.fileLoginStatus ?? body.file_login_status);
    if (!fls) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_006', message: 'fileLoginStatus must be already_login or login_now' }
      });
      return;
    }

    const paymentType =
      normalizeApprovalPaymentType(body.filePaymentType) ??
      normalizeApprovalPaymentType(body.paymentMode) ??
      normalizeApprovalPaymentType(body.file_payment_type);
    if (!paymentType) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_007',
          message: 'filePaymentType or paymentMode required (loan, cash, mix)'
        }
      });
      return;
    }

    const updatePayload: Record<string, unknown> = {
      fileLoginStatus: fls,
      filePaymentType: paymentType,
      fileLoginAt: new Date()
    };

    if (paymentType === 'loan' || paymentType === 'mix') {
      const bankNameRaw = body.fileBankName ?? body.file_bank_name ?? body.bankName;
      const bankName = typeof bankNameRaw === 'string' ? bankNameRaw.trim() : '';
      const ifsc = normalizeIfscValue(
        body.fileBankIfsc ?? body.file_bank_ifsc ?? body.bankIfsc ?? body.bank_ifsc
      );
      if (!bankName) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_008',
            message: 'Bank name required for loan / cash + loan file login'
          }
        });
        return;
      }
      if (!ifsc) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_009',
            message: 'Valid 11-char IFSC required for loan / cash + loan file login'
          }
        });
        return;
      }
      updatePayload.fileBankName = bankName;
      updatePayload.fileBankIfsc = ifsc;
    } else {
      updatePayload.fileBankName = null;
      updatePayload.fileBankIfsc = null;
    }

    const chequeRaw =
      typeof body.fileSubsidyChequeDetails === 'string'
        ? body.fileSubsidyChequeDetails.trim()
        : typeof body.file_subsidy_cheque_details === 'string'
          ? String(body.file_subsidy_cheque_details).trim()
          : '';
    updatePayload.fileSubsidyChequeDetails =
      chequeRaw && (paymentType === 'cash' || paymentType === 'mix') ? chequeRaw : null;

    await quotation.update(updatePayload);
    await quotation.reload();
    const plain = quotation.get({ plain: true }) as unknown as Record<string, unknown>;

    res.json({
      success: true,
      data: {
        id: quotationId,
        fileLoginStatus: plain.fileLoginStatus ?? null,
        filePaymentType: plain.filePaymentType ?? null,
        fileBankName: plain.fileBankName ?? null,
        fileBankIfsc: plain.fileBankIfsc ?? null,
        fileSubsidyChequeDetails: plain.fileSubsidyChequeDetails ?? null,
        fileLoginAt: plain.fileLoginAt
          ? new Date(plain.fileLoginAt as Date).toISOString()
          : null
      }
    });

    logInfo('Quotation file-login updated by admin', {
      quotationId: quotation.id,
      adminId: req.dealer.id,
      fileLoginStatus: plain.fileLoginStatus
    });
  } catch (error) {
    logError('Update quotation file-login error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal error' }
    });
  }
};

export const getAdminQuotationById = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer || req.dealer.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const { quotationId } = req.params;
    const quotation = await Quotation.findByPk(quotationId, {
      include: [
        {
          model: Dealer,
          as: 'dealer',
          attributes: ['id', 'firstName', 'lastName', 'email', 'mobile']
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'firstName', 'lastName', 'mobile', 'email']
        }
      ]
    });

    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    const quotationAny = quotation as any;
    const phaseRows = await QuotationPaymentPhase.findAll({
      where: { quotationId: quotation.id },
      order: [['phaseNumber', 'ASC']]
    });
    const phases = (phaseRows as any[]).map((phase) => ({
      phaseNumber: Number(phase.phaseNumber),
      phaseName: phase.phaseName,
      amount: Number(phase.amount || 0),
      paidAmount: Number(phase.paidAmount || 0),
      status: phase.status,
      dueDate: phase.dueDate ? new Date(phase.dueDate).toISOString() : null,
      paymentDate: phase.paymentDate ? new Date(phase.paymentDate).toISOString() : null,
      paymentMode: normalizePaymentModeInput(phase.paymentMode) ?? null,
      transactionId: phase.transactionId || null
    }));
    const subtotalNum = Number(quotation.subtotal || 0);
    const totalPaidForRemaining =
      phases.length > 0 ? sumPhasePaidAmounts(phases) : Number(quotation.paidAmount || 0);
    const remainingAmount = remainingAgainstSubtotal(subtotalNum, totalPaidForRemaining);
    const row = quotation.get({ plain: true }) as unknown as Record<string, unknown>;
    res.json({
      success: true,
      data: {
        id: quotation.id,
        status: quotation.status,
        ...quotationPaymentApiFields(row),
        ...quotationAdminMetadataFields(row),
        paymentStatus: quotationAny.paymentStatus || null,
        subtotal: subtotalNum,
        paidAmount: quotation.paidAmount !== undefined && quotation.paidAmount !== null ? Number(quotation.paidAmount) : null,
        remaining: remainingAmount,
        remainingAmount,
        installments: phases,
        paymentPhases: phases,
        payment_phases: phases,
        dealer: quotationAny.dealer || null,
        customer: quotationAny.customer || null,
        finalAmount: subtotalNum,
        createdAt: quotation.createdAt,
        approvedAt: quotationAny.approvedAt || null,
        updatedAt: quotation.updatedAt
      }
    });
  } catch (error) {
    logError('Get admin quotation by id error', error, { quotationId: req.params.quotationId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Get all dealers (admin)
export const getAllDealers = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer || req.dealer.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;
    const search = req.query.search as string;
    const isActive = req.query.isActive as string;

    const where: any = { role: 'dealer' };
    
    // Filter by isActive if provided
    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    // Search by name, email, mobile, username
    if (search) {
      where[Op.or] = [
        { firstName: { [Op.iLike]: `%${search}%` } },
        { lastName: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { mobile: { [Op.iLike]: `%${search}%` } },
        { username: { [Op.iLike]: `%${search}%` } },
        { company: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const dealers = await Dealer.findAndCountAll({
      where,
      attributes: { exclude: ['password'] },
      limit,
      offset,
      order: [['createdAt', 'DESC']]
    });

    // Get statistics for each dealer and format response
    const dealersWithStats = await Promise.all(
      dealers.rows.map(async (dealer) => {
        const quotationCount = await Quotation.count({ where: { dealerId: dealer.id } });
        const totalRevenue = await Quotation.sum('finalAmount', { where: { dealerId: dealer.id } }) || 0;

        const dealerData = dealer.toJSON() as any;
        
        // Format response with address object
        return {
          id: dealerData.id,
          username: dealerData.username,
          firstName: dealerData.firstName,
          lastName: dealerData.lastName,
          email: dealerData.email,
          mobile: dealerData.mobile,
          gender: dealerData.gender,
          dateOfBirth: dealerData.dateOfBirth,
          fatherName: dealerData.fatherName,
          fatherContact: dealerData.fatherContact,
          governmentIdType: dealerData.governmentIdType,
          governmentIdNumber: dealerData.governmentIdNumber,
          governmentIdImage: dealerData.governmentIdImage,
          address: {
            street: dealerData.addressStreet,
            city: dealerData.addressCity,
            state: dealerData.addressState,
            pincode: dealerData.addressPincode
          },
          company: dealerData.company,
          isActive: dealerData.isActive,
          emailVerified: dealerData.emailVerified,
          quotationCount,
          totalRevenue: Number(totalRevenue),
          createdAt: dealerData.createdAt,
          updatedAt: dealerData.updatedAt
        };
      })
    );

    res.json({
      success: true,
      data: {
        dealers: dealersWithStats,
        pagination: {
          page,
          limit,
          total: dealers.count,
          totalPages: Math.ceil(dealers.count / limit)
        }
      }
    });
  } catch (error) {
    logError('Get all dealers error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Update dealer (admin)
export const updateDealer = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer || req.dealer.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const { dealerId } = req.params;
    const updateData: any = {};

    const dealer = await Dealer.findByPk(dealerId);
    if (!dealer) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Dealer not found' }
      });
      return;
    }

    // Update basic fields
    if (req.body.firstName !== undefined) updateData.firstName = req.body.firstName;
    if (req.body.lastName !== undefined) updateData.lastName = req.body.lastName;
    if (req.body.email !== undefined) {
      // Check if email is already taken by another dealer
      const existingDealer = await Dealer.findOne({ 
        where: { email: req.body.email, id: { [Op.ne]: dealerId } } 
      });
      if (existingDealer) {
        res.status(400).json({
          success: false,
          error: {
            code: 'RES_002',
            message: 'Email already exists',
            details: [{ field: 'email', message: 'Email already exists' }]
          }
        });
        return;
      }
      updateData.email = req.body.email;
    }
    if (req.body.mobile !== undefined) {
      // Check if mobile is already taken by another dealer
      const existingDealer = await Dealer.findOne({ 
        where: { mobile: req.body.mobile, id: { [Op.ne]: dealerId } } 
      });
      if (existingDealer) {
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
      updateData.mobile = req.body.mobile;
    }
    if (req.body.gender !== undefined) updateData.gender = req.body.gender;
    if (req.body.dateOfBirth !== undefined) updateData.dateOfBirth = new Date(req.body.dateOfBirth);
    if (req.body.fatherName !== undefined) updateData.fatherName = req.body.fatherName;
    if (req.body.fatherContact !== undefined) updateData.fatherContact = req.body.fatherContact;
    if (req.body.governmentIdType !== undefined) updateData.governmentIdType = req.body.governmentIdType;
    if (req.body.governmentIdNumber !== undefined) updateData.governmentIdNumber = req.body.governmentIdNumber;
    if (req.body.governmentIdImage !== undefined) updateData.governmentIdImage = req.body.governmentIdImage;
    if (req.body.company !== undefined) updateData.company = req.body.company;
    if (req.body.isActive !== undefined) updateData.isActive = req.body.isActive;
    if (req.body.emailVerified !== undefined) updateData.emailVerified = req.body.emailVerified;

    // Update address fields if provided
    if (req.body.address) {
      if (req.body.address.street) updateData.addressStreet = req.body.address.street;
      if (req.body.address.city) updateData.addressCity = req.body.address.city;
      if (req.body.address.state) updateData.addressState = req.body.address.state;
      if (req.body.address.pincode) updateData.addressPincode = req.body.address.pincode;
    }

    await dealer.update(updateData);

    const updatedDealer = await Dealer.findByPk(dealerId, {
      attributes: { exclude: ['password'] }
    });

    const dealerData = updatedDealer?.toJSON() as any;
    const responseData = {
      ...dealerData,
      address: {
        street: dealerData.addressStreet,
        city: dealerData.addressCity,
        state: dealerData.addressState,
        pincode: dealerData.addressPincode
      }
    };

    // Remove individual address fields from response
    delete responseData.addressStreet;
    delete responseData.addressCity;
    delete responseData.addressState;
    delete responseData.addressPincode;

    res.json({
      success: true,
      data: responseData
    });

    if (updateData.isActive !== undefined || updateData.emailVerified !== undefined) {
      emitRealtime(realtimeEvents.dealerDirectoryUpdated, {
        dealerId,
        isActive: responseData.isActive,
        emailVerified: responseData.emailVerified,
        updatedAt: responseData.updatedAt || new Date().toISOString()
      });
    }
  } catch (error) {
    logError('Update dealer error', error, { dealerId: req.params.dealerId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Activate dealer (admin)
export const activateDealer = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer || req.dealer.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const { dealerId } = req.params;

    const dealer = await Dealer.findByPk(dealerId);
    if (!dealer) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Dealer not found' }
      });
      return;
    }

    await dealer.update({ isActive: true });

    res.json({
      success: true,
      message: 'Dealer activated successfully',
      data: {
        id: dealer.id,
        isActive: true,
        updatedAt: dealer.updatedAt
      }
    });

    emitRealtime(realtimeEvents.dealerDirectoryUpdated, {
      dealerId: dealer.id,
      isActive: true,
      updatedAt: dealer.updatedAt || new Date().toISOString()
    });
  } catch (error) {
    logError('Activate dealer error', error, { dealerId: req.params.dealerId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Get system statistics (admin)
export const getSystemStatistics = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer || req.dealer.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const where: any = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate);
    }

    const quotations = await Quotation.findAll({ where });
    const totalQuotations = quotations.length;
    const totalRevenue = quotations.reduce((sum, q) => sum + Number(q.finalAmount), 0);
    const uniqueCustomers = [...new Set(quotations.map(q => q.customerId))].length;
    const activeDealers = [...new Set(quotations.map(q => q.dealerId))].length;

    // This month's data
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthQuotations = quotations.filter(q => new Date(q.createdAt) >= startOfMonth);
    const thisMonth = {
      quotations: thisMonthQuotations.length,
      revenue: thisMonthQuotations.reduce((sum, q) => sum + Number(q.finalAmount), 0),
      newCustomers: [...new Set(thisMonthQuotations.map(q => q.customerId))].length,
      newVisitors: await Visitor.count({
        where: {
          createdAt: { [Op.gte]: startOfMonth }
        }
      })
    };

    // Status breakdown
    const statusBreakdown = {
      pending: quotations.filter(q => q.status === 'pending').length,
      approved: quotations.filter(q => q.status === 'approved').length,
      rejected: quotations.filter(q => q.status === 'rejected').length,
      completed: quotations.filter(q => q.status === 'completed').length
    };

    // Top dealers
    const dealerStats = new Map<string, { count: number; revenue: number }>();
    quotations.forEach(q => {
      const existing = dealerStats.get(q.dealerId) || { count: 0, revenue: 0 };
      dealerStats.set(q.dealerId, {
        count: existing.count + 1,
        revenue: existing.revenue + Number(q.finalAmount)
      });
    });

    const topDealers = Array.from(dealerStats.entries())
      .map(([dealerId, stats]) => ({ dealerId, ...stats }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // Get dealer names
    const dealerIds = topDealers.map(d => d.dealerId);
    const dealers = await Dealer.findAll({
      where: { id: { [Op.in]: dealerIds } },
      attributes: ['id', 'firstName', 'lastName']
    });

    const topDealersWithNames = topDealers.map(td => {
      const dealer = dealers.find(d => d.id === td.dealerId);
      return {
        dealerId: td.dealerId,
        dealerName: dealer ? `${dealer.firstName} ${dealer.lastName}` : 'Unknown',
        quotationCount: td.count,
        revenue: td.revenue
      };
    });

    res.json({
      success: true,
      data: {
        overview: {
          totalQuotations,
          totalRevenue,
          totalCustomers: uniqueCustomers,
          activeDealers,
          totalVisitors: await Visitor.count(),
          activeVisitors: await Visitor.count({ where: { isActive: true } })
        },
        thisMonth,
        statusBreakdown,
        topDealers: topDealersWithNames
      }
    });
  } catch (error) {
    logError('Get system statistics error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};


