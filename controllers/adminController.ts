import { Request, Response } from 'express';
import { Quotation, QuotationPaymentPhase, QuotationInstallationDoc, QuotationProduct, CustomPanel, Dealer, Customer, Visitor } from '../models/index-quotation';
import { Op } from 'sequelize';
import { logError, logInfo } from '../utils/loggerHelper';
import { normalizePaymentModeInput } from '../utils/paymentMode';
import {
  quotationAmountApiFields,
  quotationPaymentApiFields,
  quotationAdminMetadataFields,
  quotationProductEnrichmentFields,
  readStatusHistoryFromRow,
  serializeInstallationReleaseFields,
  quotationProposalDateApiFields
} from '../utils/quotationApiJson';
import { emitRealtime, realtimeEvents } from '../utils/realtime';
import {
  buildReleasedToInstallerWhere,
  INSTALLER_RELEASE_STATUSES,
  isReleasedToInstallerListQuery
} from '../constants/workflowQueues';
import {
  batchLoadInstallationDocsByQuotationId,
  mapInstallationDocumentsForApi
} from '../utils/installationDocumentsApi';
import {
  buildMeterDocumentApiFields,
  getLatestMeterDocMeta,
  resolveMeterStoredRef
} from '../utils/meteringMediaApi';
import { meteringWorkflowApiFields } from '../utils/meteringWorkflowApi';
import { persistQuotationSystemKw } from '../utils/persistQuotationSystemKw';

const sumPhasePaidAmounts = (phases: { paidAmount?: number }[]): number =>
  phases.reduce((sum, p) => sum + Number((p as any).paidAmount || 0), 0);

/** Quotation dealer admin or inventory admin — matches `authorizeAdmin` middleware (§L.1). */
const hasAdminQuotationAccess = (req: Request): boolean => {
  const isQuotationAdmin = Boolean(req.dealer && req.dealer.role === 'admin');
  const isInventoryAdmin = Boolean(
    req.user &&
    (req.user.role === 'admin' ||
      req.user.role === 'super-admin' ||
      req.user.role === 'super-admin-manager')
  );
  return isQuotationAdmin || isInventoryAdmin;
};

/** Admin Send to Metering — allow early handoff from install pipeline (§L.1). */
const SEND_TO_METERING_FROM_STATUSES = new Set([
  'pending_installer',
  'installer_in_progress',
  'installer_approved',
  'installer_rejected',
  'pending_baldev',
  'baldev_approved',
  'baldev_rejected',
  'pending_metering',
  'metering_in_progress'
]);

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

function parseOptionalTimestamp(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
    const wantsReleasedInstallerList = isReleasedToInstallerListQuery(req.query as Record<string, unknown>);
    const limit = limitParam
      ? Math.min(parseInt(limitParam) || 20, 1000)
      : wantsReleasedInstallerList
        ? 1000
        : undefined;
    const offset = limit ? (page - 1) * limit : undefined;
    const scope = String(req.query.scope || '').toLowerCase();
    const status = req.query.status as string;
    const installationStatusQuery = req.query.installationStatus as string;
    const operationalView = String(req.query.operationalView || '').toLowerCase();
    const dealerId = req.query.dealerId as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const where: any = {};

    if (status && scope !== 'installer_queue') where.status = status;
    if (dealerId) where.dealerId = dealerId;
    if (installationStatusQuery) {
      const statuses = installationStatusQuery
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (statuses.length > 1) {
        where.installationStatus = { [Op.in]: statuses };
      } else if (statuses.length === 1) {
        where.installationStatus = statuses[0];
      }
    }

    const installerForwardStates = [...INSTALLER_RELEASE_STATUSES];
    const meteringStates = ['pending_metering', 'metering_in_progress', 'metering_approved', 'mco'];
    const baldevStates = ['installer_approved', 'pending_baldev', 'baldev_approved', 'completed'];
    if (operationalView === 'installer' || (wantsReleasedInstallerList && scope !== 'installer_queue')) {
      where.status = 'approved';
      where[Op.and] = [
        ...(where[Op.and] || []),
        buildReleasedToInstallerWhere()
      ];
    } else if (operationalView === 'metering') {
      where.status = 'approved';
      where[Op.and] = [
        ...(where[Op.and] || []),
        {
          [Op.or]: [
            { installationReadyForInstaller: true },
            { installationStatus: { [Op.in]: meteringStates } }
          ]
        }
      ];
    } else if (operationalView === 'baldev') {
      where[Op.and] = [
        ...(where[Op.and] || []),
        { installationStatus: { [Op.in]: baldevStates } }
      ];
    }

    if (scope === 'installer_queue') {
      const installerStatusRaw = String(status || '').trim().toLowerCase();
      let installerStatuses: string[] = installerForwardStates;
      if (installerStatusRaw === 'pending_installer') {
        installerStatuses = ['pending_installer'];
      } else if (installerStatusRaw === 'approved') {
        installerStatuses = ['installer_approved'];
      } else if (installerStatusRaw) {
        installerStatuses = installerStatusRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }

      where.status = 'approved';
      const installerStatusClause =
        installerStatuses.length > 1
          ? { installationStatus: { [Op.in]: installerStatuses } }
          : { installationStatus: installerStatuses[0] };
      where[Op.and] = [
        ...(where[Op.and] || []),
        buildReleasedToInstallerWhere(),
        installerStatusClause
      ];
    }

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
          attributes: ['id', 'firstName', 'lastName', 'email', 'mobile', 'username', 'role']
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['firstName', 'lastName', 'mobile']
        },
        {
          model: QuotationProduct,
          as: 'products',
          required: false
        },
        {
          model: CustomPanel,
          as: 'customPanels',
          required: false
        }
      ],
      limit,
      offset,
      order: wantsReleasedInstallerList
        ? [['installationReleasedAt', 'DESC'], ['approvedAt', 'DESC'], ['createdAt', 'DESC']]
        : [['createdAt', 'DESC']]
    });
    const phaseRows = await QuotationPaymentPhase.findAll({
      where: { quotationId: { [Op.in]: quotations.rows.map((q: any) => q.id) } },
      order: [['quotationId', 'ASC'], ['phaseNumber', 'ASC']]
    });
    const installationDocMap = await batchLoadInstallationDocsByQuotationId(
      quotations.rows.map((q: any) => String(q.id))
    );

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
        transactionId: phase.transactionId || null,
        note: phase.note || null
      });
    }

    res.json({
      success: true,
      data: {
        quotations: await Promise.all(quotations.rows.map(async (q) => {
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
          const rawInstallationDocs = installationDocMap.get(String(q.id)) || [];
          const installationPayload = await mapInstallationDocumentsForApi(rawInstallationDocs);
          const latestMeterDoc = getLatestMeterDocMeta(rawInstallationDocs);
          const meterDocumentFields = await buildMeterDocumentApiFields(
            resolveMeterStoredRef((q as any).meterDocumentImageUrl, rawInstallationDocs),
            latestMeterDoc.name
          );
          const productListFields = quotationProductEnrichmentFields(
            qAny.products,
            qAny.customPanels,
            q.systemType,
            (q as any).systemKw ?? row.system_kw
          );
          return {
            id: q.id,
            dealerId: q.dealerId,
            dealer_id: q.dealerId,
            dealer: qAny.dealer ? {
              id: qAny.dealer.id,
              firstName: qAny.dealer.firstName,
              lastName: qAny.dealer.lastName,
              email: qAny.dealer.email ?? null,
              mobile: qAny.dealer.mobile ?? null,
              username: qAny.dealer.username ?? null,
              role: qAny.dealer.role ?? null
            } : null,
            customer: qAny.customer ? {
              firstName: qAny.customer.firstName,
              lastName: qAny.customer.lastName,
              mobile: qAny.customer.mobile
            } : null,
            ...productListFields,
            systemType: q.systemType,
            ...quotationPaymentApiFields(row),
            ...quotationAdminMetadataFields(row),
            ...quotationAmountApiFields(row),
            paymentStatus: (q as any).paymentStatus || null,
            paidAmount: q.paidAmount !== undefined && q.paidAmount !== null ? Number(q.paidAmount) : null,
            remaining: remainingAmount,
            remainingAmount,
            installments: phases,
            paymentPhases: phases,
            payment_phases: phases,
            status: q.status,
            ...serializeInstallationReleaseFields(row),
            approvedAt: (q as any).approvedAt || null,
            installerApprovedAt: (q as any).installerApprovedAt || null,
            installer_approved_at: (q as any).installerApprovedAt || null,
            ...meteringWorkflowApiFields({
              installationStatus: (q as any).installationStatus || 'pending_installer',
              meteringApprovedAt: (q as any).meteringApprovedAt,
              mcoAt: (q as any).mcoAt,
              completionAt: (q as any).completionAt
            }),
            dealerName: qAny.dealer
              ? `${qAny.dealer.firstName || ''} ${qAny.dealer.lastName || ''}`.trim() || null
              : null,
            dealer_name: qAny.dealer
              ? `${qAny.dealer.firstName || ''} ${qAny.dealer.lastName || ''}`.trim() || null
              : null,
            dealerMobile: qAny.dealer?.mobile ?? null,
            dealer_mobile: qAny.dealer?.mobile ?? null,
            discomName: (q as any).discomName || null,
            meterType: (q as any).meterType || null,
            meterNo: (q as any).meterNo || null,
            solarMeterNo: (q as any).solarMeterNo || null,
            netMeterNo: (q as any).netMeterNo || null,
            ...meterDocumentFields,
            documents: installationPayload.documents,
            installationDocuments: installationPayload.installationDocuments,
            installationPhotoUrls: installationPayload.installationPhotoUrls,
            installation_photo_urls: installationPayload.installationPhotoUrls,
            ...installationPayload.installationFieldUrls,
            ...quotationProposalDateApiFields(q)
          };
        })),
        pagination: {
          page,
          limit: limit || quotations.count,
          total: quotations.count,
          totalPages: limit ? Math.ceil(quotations.count / limit) : 1
        }
      }
    });
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    logError('Get all quotations error', error, { message: errMessage });
    res.status(500).json({
      success: false,
      error: {
        code: 'SYS_001',
        message: 'Internal server error',
        ...(process.env.NODE_ENV === 'development' ? { detail: errMessage } : {})
      }
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
      statusApprovedAt?: string;
      status_approved_at?: string;
      approvedAt?: string;
      approved_at?: string;
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
    const manualApprovedAt =
      parseOptionalTimestamp(
        body.statusApprovedAt ??
        body.status_approved_at ??
        body.approvedAt ??
        body.approved_at
      );
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
      updateData.statusApprovedAt = manualApprovedAt || new Date();

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
      updateData.approvedAt = manualApprovedAt || new Date();
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
    if (statusRaw === 'approved') {
      try {
        await persistQuotationSystemKw(quotationId, quotation.systemType);
      } catch (persistErr) {
        logError('Persist system_kw on approve failed (non-fatal)', persistErr, { quotationId });
      }
    }
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

export const updateQuotationInstallationStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!hasAdminQuotationAccess(req)) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions. Admin access required.' }
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

    const body = req.body as Record<string, unknown>;
    const pickStatus = (...keys: string[]): string | null => {
      for (const key of keys) {
        const v = body[key];
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
      return null;
    };
    const requested =
      pickStatus('installationStatus', 'installation_status') ||
      pickStatus('meteringStatus', 'metering_status', 'status') ||
      null;

    if (!requested) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: 'installationStatus is required' }
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

    const nextStatus = requested;
    const currentStatus = String(quotation.installationStatus || 'pending_installer').trim();

    if (nextStatus === 'pending_metering') {
      if (currentStatus === 'pending_metering') {
        res.json({
          success: true,
          data: {
            id: quotation.id,
            ...meteringWorkflowApiFields({
              installationStatus: quotation.installationStatus,
              meteringApprovedAt: quotation.meteringApprovedAt,
              mcoAt: quotation.mcoAt,
              completionAt: quotation.completionAt
            }),
            updatedAt: quotation.updatedAt
          }
        });
        return;
      }
      if (!SEND_TO_METERING_FROM_STATUSES.has(currentStatus)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_001',
            message: `Cannot send to metering from installation status "${currentStatus}"`,
            details: [{
              field: 'installationStatus',
              message:
                'Allowed from pending_installer, installer_*, pending_baldev, baldev_*, or metering_in_progress'
            }]
          }
        });
        return;
      }
    }

    const now = new Date();
    const patch: Record<string, unknown> = {
      installationStatus: nextStatus
    };

    if (nextStatus === 'pending_metering') {
      patch.meteringActionAt = now;
    }

    const preMeteringApproved = new Set([
      'pending_installer',
      'installer_in_progress',
      'installer_approved',
      'installer_rejected',
      'pending_baldev',
      'baldev_rejected',
      'baldev_approved',
      'pending_metering',
      'metering_in_progress'
    ]);

    if (preMeteringApproved.has(nextStatus)) {
      patch.meteringApprovedAt = null;
      patch.mcoAt = null;
    }

    if (nextStatus === 'installer_approved' && !quotation.installerApprovedAt) {
      patch.installerApprovedAt = now;
    }
    if (nextStatus === 'metering_approved') {
      patch.meteringApprovedAt = quotation.meteringApprovedAt || now;
      patch.mcoAt = null;
    }
    if (nextStatus === 'mco') {
      patch.mcoAt = quotation.mcoAt || now;
      if (!quotation.meteringApprovedAt) {
        patch.meteringApprovedAt = now;
      }
    }
    if (nextStatus === 'completed' && !quotation.completionAt) {
      patch.completionAt = now;
    }
    if (nextStatus === 'pending_baldev') {
      patch.baldevActionAt = quotation.baldevActionAt || now;
    }

    await quotation.update(patch as any);
    await quotation.reload();

    res.json({
      success: true,
      data: {
        id: quotation.id,
        ...meteringWorkflowApiFields({
          installationStatus: quotation.installationStatus,
          meteringApprovedAt: quotation.meteringApprovedAt,
          mcoAt: quotation.mcoAt,
          completionAt: quotation.completionAt
        }),
        updatedAt: quotation.updatedAt
      }
    });
  } catch (error) {
    logError('Update quotation installation status error', error);
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
    const manualFileLoginAt = parseOptionalTimestamp(
      body.fileLoginAt ?? body.file_login_at
    );

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
      fileLoginAt: manualFileLoginAt || new Date()
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
          attributes: ['id', 'firstName', 'lastName', 'email', 'mobile', 'username', 'role']
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'firstName', 'lastName', 'mobile', 'email']
        },
        {
          model: QuotationProduct,
          as: 'products',
          required: false
        },
        {
          model: CustomPanel,
          as: 'customPanels',
          required: false
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
      transactionId: phase.transactionId || null,
      note: phase.note || null
    }));
    const subtotalNum = Number(quotation.subtotal || 0);
    const totalPaidForRemaining =
      phases.length > 0 ? sumPhasePaidAmounts(phases) : Number(quotation.paidAmount || 0);
    const remainingAmount = remainingAgainstSubtotal(subtotalNum, totalPaidForRemaining);
    const row = quotation.get({ plain: true }) as unknown as Record<string, unknown>;
    const installationDocs = await QuotationInstallationDoc.findAll({
      where: { quotationId: quotation.id },
      order: [
        ['uploadedAt', 'ASC'],
        ['createdAt', 'ASC']
      ]
    });
    const rawInstallationDocs = installationDocs.map((doc) =>
      typeof (doc as { toJSON?: () => Record<string, unknown> }).toJSON === 'function'
        ? (doc as { toJSON: () => Record<string, unknown> }).toJSON()
        : (doc as unknown as Record<string, unknown>)
    );
    const installationPayload = await mapInstallationDocumentsForApi(rawInstallationDocs);
    const latestMeterDoc = getLatestMeterDocMeta(rawInstallationDocs);
    const meterDocumentFields = await buildMeterDocumentApiFields(
      resolveMeterStoredRef(quotationAny.meterDocumentImageUrl, rawInstallationDocs),
      latestMeterDoc.name
    );
    const productFields = quotationProductEnrichmentFields(
      quotationAny.products,
      quotationAny.customPanels,
      quotation.systemType,
      quotationAny.systemKw ?? row.system_kw
    );

    res.json({
      success: true,
      data: {
        id: quotation.id,
        dealerId: quotation.dealerId,
        dealer_id: quotation.dealerId,
        status: quotation.status,
        systemType: quotation.systemType,
        ...productFields,
        ...quotationPaymentApiFields(row),
        ...quotationAdminMetadataFields(row),
        ...quotationAmountApiFields(row),
        paymentStatus: quotationAny.paymentStatus || null,
        paidAmount: quotation.paidAmount !== undefined && quotation.paidAmount !== null ? Number(quotation.paidAmount) : null,
        remaining: remainingAmount,
        remainingAmount,
        installments: phases,
        paymentPhases: phases,
        payment_phases: phases,
        dealer: quotationAny.dealer || null,
        customer: quotationAny.customer || null,
        createdAt: quotation.createdAt,
        approvedAt: quotationAny.approvedAt || null,
        installerApprovedAt: quotationAny.installerApprovedAt || null,
        installer_approved_at: quotationAny.installerApprovedAt || null,
        ...meteringWorkflowApiFields({
          installationStatus: quotationAny.installationStatus || 'pending_installer',
          meteringApprovedAt: quotationAny.meteringApprovedAt,
          mcoAt: quotationAny.mcoAt,
          completionAt: quotationAny.completionAt
        }),
        installationReadyForInstaller: Boolean(quotationAny.installationReadyForInstaller),
        installation_ready_for_installer: Boolean(quotationAny.installationReadyForInstaller),
        discomName: quotationAny.discomName || null,
        meterType: quotationAny.meterType || null,
        meterNo: quotationAny.meterNo || null,
        solarMeterNo: quotationAny.solarMeterNo || null,
        netMeterNo: quotationAny.netMeterNo || null,
        ...meterDocumentFields,
        documents: installationPayload.documents,
        installationDocuments: installationPayload.installationDocuments,
        installationPhotoUrls: installationPayload.installationPhotoUrls,
        installation_photo_urls: installationPayload.installationPhotoUrls,
        ...installationPayload.installationFieldUrls,
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
    const includeInactiveRaw = String(req.query.includeInactive ?? '').trim().toLowerCase();
    const includeInactive = includeInactiveRaw === 'true' || includeInactiveRaw === '1';

    const where: any = { role: 'dealer' };
    
    // HR dealer-pool selector can request all dealers regardless of active status.
    if (!includeInactive && isActive !== undefined) {
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
          totalPages: Math.max(1, Math.ceil(dealers.count / limit))
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


