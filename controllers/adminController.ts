import { Request, Response } from 'express';
import { Quotation, QuotationPaymentPhase, QuotationInstallationDoc, QuotationProduct, CustomPanel, Dealer, Customer, Visitor, Visit, QuotationDocument } from '../models/index-quotation';
import { Op, fn, col, literal, Sequelize } from 'sequelize';
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
import { quotationCallingLeadApiFields } from '../utils/quotationAdditionalCreate';
import { emitRealtime, realtimeEvents } from '../utils/realtime';
import { parseCityFilter, cityInFilterWhere } from '../utils/serviceCities';
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
  buildMeterInstallationPendingPhotoApiFields,
  getLatestMeterDocMeta,
  resolveMeterStoredRef
} from '../utils/meteringMediaApi';
import {
  hasAdminPanelAccess,
  parseAccessFromBody,
  resolveAccess
} from '../utils/userAccess';
import { filterByListAccess, paginateRows, parseAccessQueryFromReq } from '../utils/accessLists';
import {
  METER_INSTALLATION_PENDING_STATUS,
  meteringWorkflowApiFields,
  normalizeMeteringWorkflowStatus,
  parseMeteringWccAfterDiscomFlag,
  parseBankProcessDoneFlag
} from '../utils/meteringWorkflowApi';
import { paymentExcelJourneyApiFields } from '../utils/paymentExcelJourneyStatus';
import { isInstallationTeamJwtRole } from '../utils/installationTeamRole';
import {
  INSTALLATION_PARTIAL_STATUS,
  installationPartialApiFields,
  isInstallationPartialApprovedStatus,
  meteringDetailsEchoFields
} from '../utils/installationPartialApi';
import {
  buildAdminListCustomerFields,
  adminQuotationLocationApiFields,
  adminQuotationStatusUpdatedAtFields,
  adminQuotationPricingNestedFields,
  deriveLoanCashAmountFields,
  buildPrimaryVisitLocationByQuotationId
} from '../utils/adminQuotationListApi';
import {
  INSTALLATION_PENDING_STATUSES,
  buildBrandAggregates,
  isQuotationEligibleForProductNeededScope,
  parseProductNeededScope,
  resolveProductNeededDateColumn,
  serializeProductNeededRow
} from '../utils/adminProductNeeded';
import {
  resolveApproveLoanCashAmounts,
  pickQuotationSubtotalForPayments
} from '../utils/cashLoanAmounts';
import { persistQuotationSystemKw } from '../utils/persistQuotationSystemKw';
import { buildFinalConfirmationApiFields } from '../utils/finalConfirmationDocuments';
import { resolveQuotationDocumentUrls } from './quotationController';

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

/** §17 — Admin / metering / installer may update WCC flag + bank process. */
const hasMeteringDualTrackAccess = (req: Request): boolean => {
  if (hasAdminQuotationAccess(req)) return true;
  const role = req.user?.role;
  if (!role) return false;
  return (
    role === 'metering' ||
    role === 'meter' ||
    role === 'metering-team' ||
    role === 'mco' ||
    role === 'installer' ||
    isInstallationTeamJwtRole(role)
  );
};

/**
 * Admin Send to Metering — allowed from statuses.
 * Jul 2026: include pending_installer / installer_in_progress so Admin → Quotations → All
 * "Send to Metering" works while OPS is still Pending Installer (see BACKEND_SEND_TO_METERING.ts).
 * installer_partial_approved stays blocked (Complete & Mark as Approved first).
 */
const SEND_TO_METERING_FROM_STATUSES = new Set([
  'pending_installer',
  'installer_in_progress',
  'installer_rejected',
  'installer_approved',
  'pending_baldev',
  'baldev_approved',
  'baldev_rejected',
  'metering_in_progress'
]);

/** Frontend always sends these on Admin Metering handoff (lib/api.ts → sendQuotationToMetering). */
const isAdminSendToMeteringOverride = (body: Record<string, unknown> | null | undefined): boolean => {
  if (!body) return false;
  if (body.force === true || body.force === 'true' || body.force === 1) return true;
  if (body.adminOverride === true || body.adminOverride === 'true') return true;
  if (body.allowFromPendingInstaller === true || body.allowFromPendingInstaller === 'true') return true;
  if (String(body.source || '').toLowerCase() === 'admin') return true;
  return false;
};

/**
 * Remaining = amountAfterSubsidy − discountAmount − total paid.
 * Final Settlement writes off unpaid balance via discountAmount so remaining reaches 0.
 */
const remainingAgainstSubtotal = (
  amountAfterSubsidyOrSubtotal: number | null | undefined,
  totalPaid: number,
  discountAmount: number | null | undefined = 0
): number => {
  const base = Number(amountAfterSubsidyOrSubtotal) || 0;
  const discount = Math.max(0, Number(discountAmount) || 0);
  const paid = Number(totalPaid);
  const safePaid = isNaN(paid) ? 0 : paid;
  return Math.max(0, base - discount - safePaid);
};

const resolveAmountAfterSubsidyForRemaining = (q: {
  subtotal?: number | null;
  amountAfterSubsidy?: number | null;
  centralSubsidy?: number | null;
  stateSubsidy?: number | null;
  products?: { centralSubsidy?: number | null; stateSubsidy?: number | null } | null;
}): number => {
  const subtotal = Number(q.subtotal || 0);
  const rawStored = q.amountAfterSubsidy;
  const stored = Number(rawStored);
  if (
    rawStored !== undefined &&
    rawStored !== null &&
    Number.isFinite(stored) &&
    !(stored === 0 && subtotal > 0)
  ) {
    return Math.max(0, stored);
  }
  const central = Number(q.products?.centralSubsidy ?? q.centralSubsidy ?? 0);
  const state = Number(q.products?.stateSubsidy ?? q.stateSubsidy ?? 0);
  return Math.max(0, subtotal - central - state);
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
    const scope = String(req.query.scope || '').toLowerCase();
    const status = req.query.status as string;
    const installationStatusQuery = req.query.installationStatus as string;
    const operationalView = String(req.query.operationalView || '').toLowerCase();
    // §7.4 — always bound list pages (never unbounded all-time serialization).
    // Meter/Installer/Baldev operational views need a high default so Meter Process
    // chip counts + tab rows survive hard refresh (FE often omits limit).
    const limit = limitParam
      ? Math.min(parseInt(limitParam, 10) || 20, 1000)
      : wantsReleasedInstallerList ||
          operationalView === 'metering' ||
          operationalView === 'installer' ||
          operationalView === 'baldev'
        ? 1000
        : 100;
    const offset = (page - 1) * limit;
    const dealerId = req.query.dealerId as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const search = String(req.query.search || req.query.q || '').trim();
    const includeMediaRaw = String(req.query.includeMedia || req.query.include_media || '').toLowerCase();
    const includeMedia =
      includeMediaRaw === 'true' ||
      includeMediaRaw === '1' ||
      operationalView === 'installer' ||
      operationalView === 'metering' ||
      operationalView === 'baldev' ||
      scope === 'installer_queue';

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
    const meteringStates = [
      'pending_metering',
      'metering_in_progress',
      'metering_approved',
      METER_INSTALLATION_PENDING_STATUS,
      'mco'
    ];
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

    if (search) {
      where[Op.and] = [
        ...(Array.isArray(where[Op.and]) ? where[Op.and] : []),
        {
          [Op.or]: [
            { id: { [Op.iLike]: `%${search}%` } },
            Sequelize.where(Sequelize.col('customer.firstName'), { [Op.iLike]: `%${search}%` }),
            Sequelize.where(Sequelize.col('customer.lastName'), { [Op.iLike]: `%${search}%` }),
            Sequelize.where(Sequelize.col('customer.mobile'), { [Op.iLike]: `%${search}%` }),
            Sequelize.where(Sequelize.col('customer.email'), { [Op.iLike]: `%${search}%` }),
            Sequelize.where(Sequelize.col('dealer.firstName'), { [Op.iLike]: `%${search}%` }),
            Sequelize.where(Sequelize.col('dealer.lastName'), { [Op.iLike]: `%${search}%` })
          ]
        }
      ];
    }

    const cities = parseCityFilter(req.query as Record<string, unknown>);

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
          required: cities.length > 0,
          attributes: [
            'id',
            'firstName',
            'lastName',
            'mobile',
            'email',
            'streetAddress',
            'city',
            'state',
            'pincode'
          ],
          ...(cities.length ? { where: cityInFilterWhere(cities, 'city') } : {})
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
      distinct: true,
      subQuery: false,
      limit,
      offset,
      order: wantsReleasedInstallerList
        ? [['installationReleasedAt', 'DESC'], ['approvedAt', 'DESC'], ['createdAt', 'DESC']]
        : [['createdAt', 'DESC']]
    });
    const quotationIds = quotations.rows.map((q: any) => String(q.id));
    const phaseRows = quotationIds.length
      ? await QuotationPaymentPhase.findAll({
          where: { quotationId: { [Op.in]: quotationIds } },
          order: [['quotationId', 'ASC'], ['phaseNumber', 'ASC']]
        })
      : [];
    // §7.4 / §7.5 — skip heavy media + visit fan-out on list critical path unless opted in.
    const installationDocMap = includeMedia
      ? await batchLoadInstallationDocsByQuotationId(quotationIds)
      : new Map<string, any[]>();
    // §M — Final confirmation preview URLs on admin list (lightweight: only 4 slots).
    const quotationDocRows = quotationIds.length
      ? await QuotationDocument.findAll({
          where: { quotationId: { [Op.in]: quotationIds } },
          attributes: [
            'quotationId',
            'customerFinalBillFile',
            'panelWarrantyFile',
            'inverterWarrantyFile',
            'workCompletionWarrantyFile'
          ]
        })
      : [];
    const finalConfirmationByQuotationId = new Map<string, Record<string, string | null>>();
    await Promise.all(
      (quotationDocRows as any[]).map(async (doc) => {
        const fields = await buildFinalConfirmationApiFields(doc);
        finalConfirmationByQuotationId.set(String(doc.quotationId), fields);
      })
    );
    const visitRows =
      includeMedia && quotationIds.length
        ? await Visit.findAll({
            where: { quotationId: { [Op.in]: quotationIds } },
            attributes: ['quotationId', 'location', 'visitDate', 'visitTime'],
            order: [
              ['visitDate', 'ASC'],
              ['visitTime', 'ASC']
            ]
          })
        : [];
    const visitLocationByQuotationId = buildPrimaryVisitLocationByQuotationId(
      visitRows.map((v) =>
        typeof (v as any).toJSON === 'function' ? (v as any).toJSON() : v
      )
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
          const amountAfterSubsidyNum = resolveAmountAfterSubsidyForRemaining({
            ...(q as any),
            products: qAny.products
          });
          const totalPaidForRemaining = sumPhasePaidAmounts(phases);
          const discountAmt = Number((q as any).discountAmount || 0);
          let remainingAmount = remainingAgainstSubtotal(
            amountAfterSubsidyNum,
            totalPaidForRemaining,
            discountAmt
          );
          let paymentStatusOut = q.paymentStatus;
          if (remainingAmount > 0.01) {
            paymentStatusOut = totalPaidForRemaining <= 0.01 ? 'pending' : 'partial';
          } else if (q.paymentStatus === 'completed') {
            remainingAmount = 0;
            paymentStatusOut = 'completed';
          } else {
            remainingAmount = 0;
          }
          const row =
            typeof qAny.get === 'function'
              ? (qAny.get({ plain: true }) as Record<string, unknown>)
              : (q as unknown as Record<string, unknown>);
          const rawInstallationDocs = includeMedia
            ? installationDocMap.get(String(q.id)) || []
            : [];
          const installationPayload = includeMedia
            ? await mapInstallationDocumentsForApi(rawInstallationDocs)
            : {
                documents: [],
                installationDocuments: [],
                installationPhotoUrls: [],
                installationFieldUrls: {}
              };
          const latestMeterDoc = includeMedia
            ? getLatestMeterDocMeta(rawInstallationDocs)
            : { name: null as string | null, storedRef: null as string | null };
          // §AF — always echo browsable meter document URLs on admin list (not gated on includeMedia).
          const meterDocumentFields = await buildMeterDocumentApiFields(
            resolveMeterStoredRef(
              (q as any).meterDocumentImageUrl,
              includeMedia ? rawInstallationDocs : []
            ) || ((q as any).meterDocumentImageUrl as string | null),
            latestMeterDoc.name
          );
          const productListFields = quotationProductEnrichmentFields(
            qAny.products,
            qAny.customPanels,
            q.systemType,
            (q as any).systemKw ?? row.system_kw
          );
          const amountFields = quotationAmountApiFields(row);
          const filePaymentType = String(
            (q as any).filePaymentType ?? (q as any).file_payment_type ?? ''
          ).trim();
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
            ...buildAdminListCustomerFields(qAny.customer),
            ...adminQuotationLocationApiFields(
              visitLocationByQuotationId.get(String(q.id)),
              qAny.customer
            ),
            ...productListFields,
            systemType: q.systemType,
            ...quotationPaymentApiFields(row),
            ...quotationAdminMetadataFields(row),
            ...amountFields,
            ...adminQuotationPricingNestedFields(amountFields),
            ...deriveLoanCashAmountFields(filePaymentType || (q as any).paymentType, amountFields.subtotal, phases, {
              loanAmount: (q as any).loanAmount,
              cashAmount: (q as any).cashAmount,
              loan_amount: (q as any).loan_amount,
              cash_amount: (q as any).cash_amount
            }),
            ...adminQuotationStatusUpdatedAtFields({
              updatedAt: (q as any).updatedAt,
              meteringActionAt: (q as any).meteringActionAt,
              meteringApprovedAt: (q as any).meteringApprovedAt,
              installerApprovedAt: (q as any).installerApprovedAt,
              approvedAt: (q as any).approvedAt,
              mcoAt: (q as any).mcoAt
            }),
            paymentStatus: paymentStatusOut || null,
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
            ...installationPartialApiFields({
              installationStatus: (q as any).installationStatus || 'pending_installer',
              installationPartialApproved: (q as any).installationPartialApproved,
              installationPartialApprovedAt: (q as any).installationPartialApprovedAt
            }),
            ...meteringWorkflowApiFields({
              installationStatus: (q as any).installationStatus || 'pending_installer',
              meteringApprovedAt: (q as any).meteringApprovedAt,
              mcoAt: (q as any).mcoAt,
              completionAt: (q as any).completionAt,
              meterInstallationPendingAt: (q as any).meterInstallationPendingAt,
              meteringWccAfterDiscom: (q as any).meteringWccAfterDiscom,
              meteringWccAfterDiscomAt: (q as any).meteringWccAfterDiscomAt
            }),
            ...paymentExcelJourneyApiFields({
              ...(typeof (q as any).get === 'function'
                ? ((q as any).get({ plain: true }) as Record<string, unknown>)
                : ((q as unknown) as Record<string, unknown>)),
              installationStatus: (q as any).installationStatus || 'pending_installer',
              meteringWccAfterDiscom: (q as any).meteringWccAfterDiscom,
              installationPartialApproved: (q as any).installationPartialApproved,
              installerApprovedAt: (q as any).installerApprovedAt
            }),
            dealerName: qAny.dealer
              ? `${qAny.dealer.firstName || ''} ${qAny.dealer.lastName || ''}`.trim() || null
              : null,
            dealer_name: qAny.dealer
              ? `${qAny.dealer.firstName || ''} ${qAny.dealer.lastName || ''}`.trim() || null
              : null,
            dealerMobile: qAny.dealer?.mobile ?? null,
            dealer_mobile: qAny.dealer?.mobile ?? null,
            ...meteringDetailsEchoFields({
              meteringRemarks: (q as any).meteringRemarks,
              meteringAuthorizedRepresentative: (q as any).meteringAuthorizedRepresentative,
              discomName: (q as any).discomName,
              discomLocation: (q as any).discomLocation
            }),
            ...(includeMedia
              ? await buildMeterInstallationPendingPhotoApiFields({
                  meterInstallationPhotoUrl: (q as any).meterInstallationPhotoUrl,
                  meterInstallationPhotoName: (q as any).meterInstallationPhotoName,
                  plantLivePhotoUrl: (q as any).plantLivePhotoUrl,
                  plantLivePhotoName: (q as any).plantLivePhotoName
                })
              : {}),
            meterType: (q as any).meterType || null,
            meterNo: (q as any).meterNo || null,
            solarMeterNo: (q as any).solarMeterNo || null,
            netMeterNo: (q as any).netMeterNo || null,
            ...meterDocumentFields,
            ...(finalConfirmationByQuotationId.get(String(q.id)) || {}),
            documents: {
              ...(finalConfirmationByQuotationId.get(String(q.id)) || {}),
              ...installationPayload.documents
            },
            installationDocuments: installationPayload.installationDocuments,
            installationPhotoUrls: installationPayload.installationPhotoUrls,
            installation_photo_urls: installationPayload.installationPhotoUrls,
            ...installationPayload.installationFieldUrls,
            ...quotationProposalDateApiFields(q),
            ...quotationCallingLeadApiFields(row)
          };
        })),
        pagination: {
          page,
          limit,
          total: quotations.count,
          totalPages: Math.max(1, Math.ceil(quotations.count / limit)),
          hasNext: page < Math.ceil(quotations.count / limit),
          hasPrev: page > 1
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
      loanAmount?: number | string;
      loan_amount?: number | string;
      cashAmount?: number | string;
      cash_amount?: number | string;
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
      updateData.filePaymentType = paymentTypeResolved;
      updateData.statusApprovedAt = manualApprovedAt || new Date();

      const amountResult = resolveApproveLoanCashAmounts({
        paymentType: paymentTypeResolved,
        loanAmountRaw: body.loanAmount ?? body.loan_amount,
        cashAmountRaw: body.cashAmount ?? body.cash_amount,
        quotationSubtotal: pickQuotationSubtotalForPayments(
          quotation.get({ plain: true }) as unknown as Record<string, unknown>
        )
      });
      if (!amountResult.ok) {
        res.status(400).json({
          success: false,
          error: { code: amountResult.code, message: amountResult.message }
        });
        return;
      }
      updateData.loanAmount = amountResult.loanAmount;
      updateData.cashAmount = amountResult.cashAmount;

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
      updateData.loanAmount = null;
      updateData.cashAmount = null;
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
    const wccAfterDiscomFlag = parseMeteringWccAfterDiscomFlag(body);
    const bankDoneFlag = parseBankProcessDoneFlag(body);

    // §17 SPA fallback: installation-status body with only bankProcessDone → bank-process handler
    if (
      !requested &&
      wccAfterDiscomFlag === undefined &&
      (bankDoneFlag !== undefined ||
        body.bankName !== undefined ||
        body.bank_name !== undefined ||
        body.bankIfsc !== undefined ||
        body.bank_ifsc !== undefined)
    ) {
      await updateQuotationBankProcess(req, res);
      return;
    }

    if (!requested && wccAfterDiscomFlag === undefined) {
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

    // §17 Parallel bank track — may accompany a metering stage change; never moves stage itself.
    if (bankDoneFlag !== undefined) {
      await quotation.update({
        bankProcessDone: bankDoneFlag,
        bankProcessDoneAt: bankDoneFlag
          ? (quotation as any).bankProcessDoneAt || new Date()
          : null
      } as any);
    }

    const currentStatus = String(quotation.installationStatus || 'pending_installer').trim();
    const now = new Date();

    const installationApprovedForPostDiscomWcc = (): boolean => {
      if (
        isInstallationPartialApprovedStatus(quotation.installationStatus) ||
        Boolean((quotation as any).installationPartialApproved)
      ) {
        return false;
      }
      return Boolean(quotation.installerApprovedAt);
    };

    const applyWccAfterDiscomPatch = (
      patch: Record<string, unknown>,
      flag: boolean,
      stageForGate: string = currentStatus
    ): { ok: true } | { ok: false; message: string } => {
      if (flag) {
        if (stageForGate !== 'metering_approved') {
          return {
            ok: false,
            message: 'meteringWccAfterDiscom can only be set when stage is metering_approved'
          };
        }
        if (!installationApprovedForPostDiscomWcc()) {
          return {
            ok: false,
            message:
              'Customer installation must be completed and approved before moving to WCC Pending (installer_partial_approved is not allowed)'
          };
        }
        patch.meteringWccAfterDiscom = true;
        patch.meteringWccAfterDiscomAt =
          (quotation as any).meteringWccAfterDiscomAt || now;
      } else {
        patch.meteringWccAfterDiscom = false;
        patch.meteringWccAfterDiscomAt = null;
      }
      return { ok: true };
    };

    const respondWithQuotation = async () => {
      await quotation.reload();
      const row = typeof quotation.toJSON === 'function' ? quotation.toJSON() : (quotation as any);
      res.json({
        success: true,
        data: {
          id: quotation.id,
          ...meteringWorkflowApiFields({
            installationStatus: quotation.installationStatus,
            meteringApprovedAt: quotation.meteringApprovedAt,
            mcoAt: quotation.mcoAt,
            completionAt: quotation.completionAt,
            meterInstallationPendingAt: (quotation as any).meterInstallationPendingAt,
            meteringWccAfterDiscom: (quotation as any).meteringWccAfterDiscom,
            meteringWccAfterDiscomAt: (quotation as any).meteringWccAfterDiscomAt
          }),
          ...quotationPaymentApiFields(row),
          ...installationPartialApiFields({
            installationStatus: quotation.installationStatus,
            installationPartialApproved: (quotation as any).installationPartialApproved,
            installationPartialApprovedAt: (quotation as any).installationPartialApprovedAt
          }),
          updatedAt: quotation.updatedAt
        }
      });
    };

    // Flag-only update (stay on metering_approved / clear flag)
    if (!requested && wccAfterDiscomFlag !== undefined) {
      const patch: Record<string, unknown> = {};
      const applied = applyWccAfterDiscomPatch(patch, wccAfterDiscomFlag);
      if (!applied.ok) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_001',
            message: applied.message,
            details: [{ field: 'meteringWccAfterDiscom', message: applied.message }]
          }
        });
        return;
      }
      if (bankDoneFlag === true) {
        patch.bankProcessDone = true;
        patch.bankProcessDoneAt = (quotation as any).bankProcessDoneAt || now;
      } else if (bankDoneFlag === false) {
        patch.bankProcessDone = false;
        patch.bankProcessDoneAt = null;
      }
      await quotation.update(patch as any);
      await respondWithQuotation();
      return;
    }

    const nextStatus =
      normalizeMeteringWorkflowStatus(requested) || requested!;

    if (nextStatus === METER_INSTALLATION_PENDING_STATUS) {
      if (
        currentStatus !== 'metering_approved' &&
        currentStatus !== METER_INSTALLATION_PENDING_STATUS
      ) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_001',
            message: `Cannot move to meter_installation_pending from "${currentStatus}"`,
            details: [
              {
                field: 'installationStatus',
                message: 'Allowed only from metering_approved'
              }
            ]
          }
        });
        return;
      }
    }

    if (nextStatus === 'mco') {
      const allowedToMco = new Set([
        METER_INSTALLATION_PENDING_STATUS,
        'metering_approved'
      ]);
      if (!allowedToMco.has(currentStatus) && currentStatus !== 'mco') {
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_001',
            message: `Cannot move to mco from "${currentStatus}"`,
            details: [
              {
                field: 'installationStatus',
                message: 'To MCO requires meter_installation_pending (or legacy metering_approved)'
              }
            ]
          }
        });
        return;
      }
    }

    if (nextStatus === 'pending_metering') {
      if (currentStatus === 'pending_metering') {
        await respondWithQuotation();
        return;
      }
      // Partial install must Complete & Approve before metering — never allow.
      if (isInstallationPartialApprovedStatus(currentStatus)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_001',
            message: `Cannot send to metering from installation status "${currentStatus}"`,
            details: [{
              field: 'installationStatus',
              message:
                'Complete & Mark as Approved first (installer_partial_approved cannot go to metering)'
            }]
          }
        });
        return;
      }
      // Terminal / past Meter Pending — reject even with admin force flags.
      const tooLateForSendToMetering = new Set([
        'metering_approved',
        METER_INSTALLATION_PENDING_STATUS,
        'mco',
        'completed'
      ]);
      if (tooLateForSendToMetering.has(currentStatus)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_001',
            message: `Cannot send to metering from installation status "${currentStatus}"`,
            details: [{
              field: 'installationStatus',
              message: 'Quotation is already past Meter Pending'
            }]
          }
        });
        return;
      }
      // Jul 2026: pending_installer / installer_in_progress are in SEND_TO_METERING_FROM_STATUSES
      // so Admin → Quotations → All → Send to Metering works without installer_approved.
      // force / adminOverride / source:"admin" are accepted but not required (handler is admin-only).
      if (!SEND_TO_METERING_FROM_STATUSES.has(currentStatus)) {
        const adminOverride = isAdminSendToMeteringOverride(body);
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_001',
            message: `Cannot send to metering from installation status "${currentStatus}"`,
            details: [{
              field: 'installationStatus',
              message: adminOverride
                ? 'Unsupported installation status for Send to Metering'
                : 'Send to Metering requires pending_installer / installer_approved (or later Baldev stages)'
            }]
          }
        });
        return;
      }
    }

    const patch: Record<string, unknown> = {
      installationStatus: nextStatus
    };

    if (nextStatus === 'pending_metering') {
      patch.meteringActionAt = now;
      patch.meteringWccAfterDiscom = false;
      patch.meteringWccAfterDiscomAt = null;
    }

    if (nextStatus === METER_INSTALLATION_PENDING_STATUS) {
      patch.meterInstallationPendingAt =
        (quotation as any).meterInstallationPendingAt || now;
      // Leave post-Discom WCC queue when entering Meter Installation Pending
      patch.meteringWccAfterDiscom = false;
      patch.meteringWccAfterDiscomAt = null;
    }

    if (nextStatus === 'mco') {
      patch.mcoAt = quotation.mcoAt || now;
      if (!quotation.meteringApprovedAt) {
        patch.meteringApprovedAt = now;
      }
      patch.meteringWccAfterDiscom = false;
      patch.meteringWccAfterDiscomAt = null;
    }

    const preMeteringApproved = new Set([
      'pending_installer',
      'installer_in_progress',
      INSTALLATION_PARTIAL_STATUS,
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
      patch.meterInstallationPendingAt = null;
      patch.meteringWccAfterDiscom = false;
      patch.meteringWccAfterDiscomAt = null;
    }

    if (nextStatus === INSTALLATION_PARTIAL_STATUS) {
      patch.installationPartialApproved = true;
      patch.installationPartialApprovedAt =
        (quotation as any).installationPartialApprovedAt || now;
      patch.installerApprovedAt = null;
    }

    if (nextStatus === 'installer_approved') {
      if (!quotation.installerApprovedAt) {
        patch.installerApprovedAt = now;
      }
      patch.installationPartialApproved = false;
      patch.installationPartialApprovedAt = null;
    }
    if (nextStatus === 'metering_approved') {
      patch.meteringApprovedAt = quotation.meteringApprovedAt || now;
      // Undo from MIP keeps metering_approved; clear MIP stamp only when leaving that path later if needed
      if (currentStatus === METER_INSTALLATION_PENDING_STATUS) {
        // keep meterInstallationPendingAt history; status alone drives the tab
      } else {
        patch.mcoAt = null;
        // To Discom from Meter Pending → Meter in Discom (not WCC Pending)
        if (
          currentStatus === 'pending_metering' ||
          currentStatus === 'metering_in_progress'
        ) {
          patch.meteringWccAfterDiscom = false;
          patch.meteringWccAfterDiscomAt = null;
        }
      }
    }
    if (nextStatus === 'completed' && !quotation.completionAt) {
      patch.completionAt = now;
    }
    if (nextStatus === 'pending_baldev') {
      patch.baldevActionAt = quotation.baldevActionAt || now;
    }

    // Explicit post-Discom WCC flag on the same PATCH (e.g. stay metering_approved + flag true)
    if (wccAfterDiscomFlag !== undefined) {
      if (nextStatus === METER_INSTALLATION_PENDING_STATUS || nextStatus === 'mco') {
        // already cleared above
      } else if (nextStatus === 'metering_approved' || currentStatus === 'metering_approved') {
        const stageForGate =
          nextStatus === 'metering_approved' ? 'metering_approved' : currentStatus;
        const applied = applyWccAfterDiscomPatch(patch, wccAfterDiscomFlag, stageForGate);
        if (!applied.ok) {
          res.status(400).json({
            success: false,
            error: {
              code: 'VAL_001',
              message: applied.message,
              details: [{ field: 'meteringWccAfterDiscom', message: applied.message }]
            }
          });
          return;
        }
      } else if (wccAfterDiscomFlag === true) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_001',
            message: 'meteringWccAfterDiscom can only be set when stage is metering_approved',
            details: [{ field: 'meteringWccAfterDiscom', message: 'Requires metering_approved' }]
          }
        });
        return;
      } else {
        patch.meteringWccAfterDiscom = false;
        patch.meteringWccAfterDiscomAt = null;
      }
    }

    await quotation.update(patch as any);
    await respondWithQuotation();
  } catch (error) {
    logError('Update quotation installation status error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal error' }
    });
  }
};

/**
 * Preferred Admin "Send to Metering" endpoint (Jul 2026).
 * PATCH|POST /admin/quotations/:quotationId/send-to-metering
 *
 * Always targets pending_metering and allows pending_installer → pending_metering
 * so Admin → Quotations → All → Metering works while OPS is still Pending Installer.
 * See BACKEND_SEND_TO_METERING.ts.
 */
export const sendQuotationToMetering = async (req: Request, res: Response): Promise<void> => {
  // Normalize body so updateQuotationInstallationStatus takes the pending_metering path
  // with admin override flags the frontend also sends on status patches.
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  req.body = {
    ...body,
    installationStatus: 'pending_metering',
    meteringStatus: 'pending_metering',
    force: body.force ?? true,
    adminOverride: body.adminOverride ?? true,
    allowFromPendingInstaller: body.allowFromPendingInstaller ?? true,
    source: body.source ?? 'admin'
  };
  await updateQuotationInstallationStatus(req, res);
};

/**
 * PATCH /admin/quotations/:quotationId/metering-wcc-after-discom
 * Mark Meter in Discom → WCC Pending (server flag; survives refresh).
 */
export const updateMeteringWccAfterDiscom = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!hasMeteringDualTrackAccess(req)) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions. Admin access required.' }
      });
      return;
    }

    const { quotationId } = req.params;
    const flag = parseMeteringWccAfterDiscomFlag(req.body as Record<string, unknown>);
    if (flag === undefined) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'meteringWccAfterDiscom is required',
          details: [{ field: 'meteringWccAfterDiscom', message: 'boolean required' }]
        }
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

    const currentStatus = String(quotation.installationStatus || '').trim();
    const now = new Date();
    const patch: Record<string, unknown> = {};

    if (flag) {
      if (currentStatus !== 'metering_approved') {
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_001',
            message: 'meteringWccAfterDiscom can only be set when stage is metering_approved',
            details: [{ field: 'meteringWccAfterDiscom', message: 'Requires metering_approved' }]
          }
        });
        return;
      }
      if (
        isInstallationPartialApprovedStatus(quotation.installationStatus) ||
        Boolean((quotation as any).installationPartialApproved) ||
        !quotation.installerApprovedAt
      ) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_001',
            message:
              'Customer installation must be completed and approved before moving to WCC Pending (installer_partial_approved is not allowed)',
            details: [{ field: 'meteringWccAfterDiscom', message: 'Installation not fully approved' }]
          }
        });
        return;
      }
      patch.meteringWccAfterDiscom = true;
      patch.meteringWccAfterDiscomAt =
        (quotation as any).meteringWccAfterDiscomAt || now;
    } else {
      patch.meteringWccAfterDiscom = false;
      patch.meteringWccAfterDiscomAt = null;
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
          completionAt: quotation.completionAt,
          meterInstallationPendingAt: (quotation as any).meterInstallationPendingAt,
          meteringWccAfterDiscom: (quotation as any).meteringWccAfterDiscom,
          meteringWccAfterDiscomAt: (quotation as any).meteringWccAfterDiscomAt
        }),
        updatedAt: quotation.updatedAt
      }
    });
  } catch (error) {
    logError('Update metering WCC after discom error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal error' }
    });
  }
};

/**
 * §17 Bank process (parallel track) — save bank details + optional move to Pending Payment.
 * Does NOT change metering/installation stage.
 * PATCH /admin/quotations/:id/bank-process (also payment-details fallbacks).
 */
export const updateQuotationBankProcess = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!hasMeteringDualTrackAccess(req)) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const { quotationId } = req.params;
    const body = (req.body || {}) as Record<string, unknown>;
    const quotation = await Quotation.findByPk(quotationId);
    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    const patch: Record<string, unknown> = {};
    const bankNameRaw = body.bankName ?? body.bank_name;
    if (typeof bankNameRaw === 'string') {
      const trimmed = bankNameRaw.trim();
      if (trimmed) patch.bankName = trimmed;
    }
    const bankIfscRaw = body.bankIfsc ?? body.bank_ifsc;
    if (typeof bankIfscRaw === 'string') {
      const trimmed = bankIfscRaw.trim();
      if (trimmed) patch.bankIfsc = trimmed;
    }

    const paymentTypeRaw = body.paymentType ?? body.payment_type ?? body.paymentMode ?? body.payment_mode;
    if (typeof paymentTypeRaw === 'string' && paymentTypeRaw.trim()) {
      const norm = paymentTypeRaw
        .trim()
        .toLowerCase()
        .replace(/-/g, '_')
        .replace(/\+/g, '_');
      const paymentType =
        norm === 'cash_loan' || norm === 'cashloan' ? 'mix' : norm === 'loan' || norm === 'cash' || norm === 'mix' ? norm : null;
      if (paymentType) {
        patch.paymentType = paymentType;
        patch.paymentMode = paymentType;
      }
    }

    const doneFlag = parseBankProcessDoneFlag(body);
    if (doneFlag === true) {
      patch.bankProcessDone = true;
      patch.bankProcessDoneAt = (quotation as any).bankProcessDoneAt || new Date();
    } else if (doneFlag === false) {
      patch.bankProcessDone = false;
      patch.bankProcessDoneAt = null;
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Provide bankName, bankIfsc, paymentType, and/or bankProcessDone'
        }
      });
      return;
    }

    await quotation.update(patch as any);
    await quotation.reload();

    const row = typeof quotation.toJSON === 'function' ? quotation.toJSON() : (quotation as any);
    res.json({
      success: true,
      data: {
        id: quotation.id,
        ...quotationPaymentApiFields(row),
        ...meteringWorkflowApiFields({
          installationStatus: quotation.installationStatus,
          meteringApprovedAt: quotation.meteringApprovedAt,
          mcoAt: quotation.mcoAt,
          completionAt: quotation.completionAt,
          meterInstallationPendingAt: (quotation as any).meterInstallationPendingAt,
          meteringWccAfterDiscom: (quotation as any).meteringWccAfterDiscom,
          meteringWccAfterDiscomAt: (quotation as any).meteringWccAfterDiscomAt
        }),
        updatedAt: quotation.updatedAt
      }
    });
  } catch (error) {
    logError('Update quotation bank process error', error);
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
          attributes: ['id', 'firstName', 'lastName', 'mobile', 'email', 'streetAddress', 'city', 'state', 'pincode']
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
        },
        {
          model: QuotationDocument,
          as: 'documents',
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
    const resolvedDocuments = await resolveQuotationDocumentUrls(quotationAny.documents);
    const finalConfirmationFields = await buildFinalConfirmationApiFields(resolvedDocuments);
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
    const amountAfterSubsidyNum = resolveAmountAfterSubsidyForRemaining({
      ...(quotation as any),
      products: quotationAny.products
    });
    const totalPaidForRemaining = sumPhasePaidAmounts(phases);
    const discountAmt = Number((quotation as any).discountAmount || 0);
    let remainingAmount = remainingAgainstSubtotal(
      amountAfterSubsidyNum,
      totalPaidForRemaining,
      discountAmt
    );
    let paymentStatusOut = quotationAny.paymentStatus;
    if (remainingAmount > 0.01) {
      paymentStatusOut = totalPaidForRemaining <= 0.01 ? 'pending' : 'partial';
    } else if (quotationAny.paymentStatus === 'completed') {
      remainingAmount = 0;
      paymentStatusOut = 'completed';
    } else {
      remainingAmount = 0;
    }
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
        paymentStatus: paymentStatusOut || null,
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
        ...installationPartialApiFields({
          installationStatus: quotationAny.installationStatus || 'pending_installer',
          installationPartialApproved: quotationAny.installationPartialApproved,
          installationPartialApprovedAt: quotationAny.installationPartialApprovedAt
        }),
        ...meteringWorkflowApiFields({
          installationStatus: quotationAny.installationStatus || 'pending_installer',
          meteringApprovedAt: quotationAny.meteringApprovedAt,
          mcoAt: quotationAny.mcoAt,
          completionAt: quotationAny.completionAt,
          meterInstallationPendingAt: quotationAny.meterInstallationPendingAt,
          meteringWccAfterDiscom: quotationAny.meteringWccAfterDiscom,
          meteringWccAfterDiscomAt: quotationAny.meteringWccAfterDiscomAt
        }),
        installationReadyForInstaller: Boolean(quotationAny.installationReadyForInstaller),
        installation_ready_for_installer: Boolean(quotationAny.installationReadyForInstaller),
        ...meteringDetailsEchoFields({
          meteringRemarks: quotationAny.meteringRemarks,
          meteringAuthorizedRepresentative: quotationAny.meteringAuthorizedRepresentative,
          discomName: quotationAny.discomName,
          discomLocation: quotationAny.discomLocation
        }),
        ...(await buildMeterInstallationPendingPhotoApiFields({
          meterInstallationPhotoUrl: quotationAny.meterInstallationPhotoUrl,
          meterInstallationPhotoName: quotationAny.meterInstallationPhotoName,
          plantLivePhotoUrl: quotationAny.plantLivePhotoUrl,
          plantLivePhotoName: quotationAny.plantLivePhotoName
        })),
        meterType: quotationAny.meterType || null,
        meterNo: quotationAny.meterNo || null,
        solarMeterNo: quotationAny.solarMeterNo || null,
        netMeterNo: quotationAny.netMeterNo || null,
        ...meterDocumentFields,
        ...finalConfirmationFields,
        documents: {
          ...(resolvedDocuments || {}),
          ...finalConfirmationFields,
          ...installationPayload.documents
        },
        aadharFront: (resolvedDocuments as any)?.aadharFront || null,
        aadharBack: (resolvedDocuments as any)?.aadharBack || null,
        panImage: (resolvedDocuments as any)?.panImage || null,
        electricityBillImage: (resolvedDocuments as any)?.electricityBillImage || null,
        bankPassbookImage: (resolvedDocuments as any)?.bankPassbookImage || null,
        geotagRoofPhoto: (resolvedDocuments as any)?.geotagRoofPhoto || null,
        customerWithHousePhoto: (resolvedDocuments as any)?.customerWithHousePhoto || null,
        propertyDocumentPdf: (resolvedDocuments as any)?.propertyDocumentPdf || null,
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
    if (!hasAdminPanelAccess(req) && (!req.dealer || req.dealer.role !== 'admin')) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 1000, 1000);
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

    const accessKey = parseAccessQueryFromReq(req);
    const dealers = await Dealer.findAll({
      where,
      attributes: { exclude: ['password'] },
      order: [['createdAt', 'DESC']]
    });

    const mappedDealers = dealers.map((dealer) => {
      const dealerData = dealer.toJSON() as any;
      const access = resolveAccess({
        role: dealerData.role || 'dealer',
        access: dealerData.access,
        username: dealerData.username
      });
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
        role: dealerData.role || 'dealer',
        access,
        permissions: access,
        isActive: dealerData.isActive,
        emailVerified: dealerData.emailVerified,
        createdAt: dealerData.createdAt,
        updatedAt: dealerData.updatedAt
      };
    });

    const eligible = filterByListAccess(mappedDealers, accessKey);
    const paged = paginateRows(eligible, page, limit);

    const dealersWithStats = await Promise.all(
      paged.rows.map(async (dealerData) => {
        const quotationCount = await Quotation.count({ where: { dealerId: dealerData.id } });
        const totalRevenue = await Quotation.sum('finalAmount', { where: { dealerId: dealerData.id } }) || 0;

        return {
          ...dealerData,
          quotationCount,
          totalRevenue: Number(totalRevenue)
        };
      })
    );

    res.json({
      success: true,
      data: {
        dealers: dealersWithStats,
        pagination: {
          page: paged.page,
          limit: paged.limit,
          total: paged.total,
          totalPages: paged.totalPages
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
    if (!hasAdminPanelAccess(req) && (!req.dealer || req.dealer.role !== 'admin')) {
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

    const accessParse = parseAccessFromBody(req.body || {});
    if (accessParse.error) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: accessParse.error }
      });
      return;
    }
    if (accessParse.access) {
      updateData.access = accessParse.access;
    }

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
    const access = resolveAccess({
      role: dealerData.role || 'dealer',
      access: dealerData.access,
      username: dealerData.username
    });
    const responseData: any = {
      ...dealerData,
      role: dealerData.role || 'dealer',
      access,
      permissions: access,
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
      data: responseData,
      message: 'Dealer updated successfully'
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
    if (!hasAdminPanelAccess(req) && (!req.dealer || req.dealer.role !== 'admin')) {
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

/**
 * GET /api/admin/product-needed?scope=installation_pending|file_login
 * Procurement dashboard for Pending Installation jobs, or file-login (not approved).
 * Rejected quotations are never included.
 */
export const getAdminProductNeeded = async (req: Request, res: Response): Promise<void> => {
  try {
    const scope = parseProductNeededScope(req.query);

    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(
      2000,
      Math.max(1, parseInt(String(req.query.limit || '500'), 10) || 500)
    );
    const dealerId = req.query.dealerId ? String(req.query.dealerId) : null;
    const search = req.query.search ? String(req.query.search).trim().toLowerCase() : '';
    const dateField = resolveProductNeededDateColumn(req.query.dateField, scope);
    const startDate = req.query.startDate ? new Date(String(req.query.startDate)) : null;
    const endDate = req.query.endDate ? new Date(String(req.query.endDate)) : null;

    const where: any =
      scope === 'file_login'
        ? {
            status: { [Op.notIn]: ['rejected', 'reject', 'approved', 'completed'] },
            [Op.or]: [
              { fileLoginStatus: { [Op.in]: ['already_login', 'login_now'] } },
              { fileLoginAt: { [Op.ne]: null } }
            ]
          }
        : {
            status: 'approved',
            installerApprovedAt: null,
            [Op.or]: [
              { installationReadyForInstaller: true },
              { installationReleasedAt: { [Op.ne]: null } },
              { installationStatus: { [Op.in]: [...INSTALLATION_PENDING_STATUSES] } }
            ]
          };
    if (dealerId) where.dealerId = dealerId;
    if (startDate || endDate) {
      where[dateField] = {};
      if (startDate && !Number.isNaN(startDate.getTime())) where[dateField][Op.gte] = startDate;
      if (endDate && !Number.isNaN(endDate.getTime())) where[dateField][Op.lte] = endDate;
    }

    const rows = await Quotation.findAll({
      where,
      include: [
        { model: QuotationProduct, as: 'products', required: false },
        {
          model: CustomPanel,
          as: 'customPanels',
          required: false
        },
        {
          model: Dealer,
          as: 'dealer',
          attributes: ['id', 'firstName', 'lastName', 'email', 'mobile', 'username', 'role']
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'firstName', 'lastName', 'mobile', 'streetAddress', 'city', 'state', 'pincode']
        }
      ],
      order:
        scope === 'file_login'
          ? [['fileLoginAt', 'DESC'], ['createdAt', 'DESC']]
          : [['installationReleasedAt', 'DESC'], ['createdAt', 'DESC']]
    });

    let all = rows
      .map((q: any) => (typeof q.toJSON === 'function' ? q.toJSON() : q))
      .map((q: any) => {
        // Merge customPanels into products blob for customize system types
        if (Array.isArray(q.customPanels) && q.customPanels.length) {
          const products =
            q.products && typeof q.products === 'object'
              ? { ...q.products, customPanels: q.customPanels }
              : { customPanels: q.customPanels };
          return { ...q, products };
        }
        return q;
      })
      .filter((q: Record<string, unknown>) => isQuotationEligibleForProductNeededScope(q, scope))
      .map(serializeProductNeededRow);

    if (search) {
      all = all.filter((r) => {
        const blob = [r.customerName, r.customerMobile, r.dealerName, r.quotationId, r.panels, r.inverter]
          .join(' ')
          .toLowerCase();
        return blob.includes(search);
      });
    }

    const aggregates = buildBrandAggregates(all);
    const total = all.length;
    const offset = (page - 1) * limit;
    const pageRows = all.slice(offset, offset + limit);

    res.json({
      success: true,
      data: {
        scope,
        rows: pageRows,
        quotations: pageRows,
        aggregates,
        brandCards: aggregates.panels,
        totals: {
          jobs: aggregates.jobCount,
          panelQuantity: aggregates.totalPanels,
          inverterQuantity: aggregates.totalInverters
        },
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit))
        }
      }
    });
  } catch (error) {
    logError('Get admin product-needed error', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SYS_001',
        message: error instanceof Error ? error.message : 'Internal server error'
      }
    });
  }
};

const ADMIN_STATS_CACHE_TTL_MS = 30 * 1000;
const adminStatsCache = new Map<string, { expiresAt: number; payload: any }>();

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
    const cacheKey = `stats:${startDate || ''}:${endDate || ''}`;
    const cached = adminStatsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.json(cached.payload);
      return;
    }

    const where: any = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate);
    }

    // This month's data
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const thisMonthWhere = {
      ...where,
      [Op.and]: [
        ...(Array.isArray(where[Op.and]) ? where[Op.and] : []),
        { createdAt: { [Op.gte]: startOfMonth } }
      ]
    };

    const thisMonthApprovedWhere = {
      status: 'approved',
      [Op.or]: [
        { statusApprovedAt: { [Op.gte]: startOfMonth } },
        {
          statusApprovedAt: null,
          approvedAt: { [Op.gte]: startOfMonth }
        },
        {
          statusApprovedAt: null,
          approvedAt: null,
          createdAt: { [Op.gte]: startOfMonth }
        }
      ]
    };

    const [
      totalQuotations,
      overviewAggregate,
      approvedRevenueAggregate,
      thisMonthAggregate,
      thisMonthApprovedAggregate,
      statusRows,
      topDealersRaw,
      totalVisitors,
      activeVisitors,
      newVisitors
    ] = await Promise.all([
      Quotation.count({ where }),
      Quotation.findOne({
        where,
        raw: true,
        attributes: [
          [fn('COALESCE', fn('SUM', col('finalAmount')), 0), 'totalRevenue'],
          [fn('COUNT', fn('DISTINCT', col('customerId'))), 'totalCustomers'],
          [fn('COUNT', fn('DISTINCT', col('dealerId'))), 'activeDealers']
        ]
      }),
      Quotation.findOne({
        where: { ...where, status: 'approved' },
        raw: true,
        attributes: [[fn('COALESCE', fn('SUM', col('finalAmount')), 0), 'totalRevenue']]
      }),
      Quotation.findOne({
        where: thisMonthWhere,
        raw: true,
        attributes: [
          [fn('COUNT', col('id')), 'quotations'],
          [fn('COALESCE', fn('SUM', col('finalAmount')), 0), 'revenue'],
          [fn('COUNT', fn('DISTINCT', col('customerId'))), 'newCustomers']
        ]
      }),
      Quotation.findOne({
        where: thisMonthApprovedWhere,
        raw: true,
        attributes: [
          [fn('COUNT', col('id')), 'approvedQuotations'],
          [fn('COALESCE', fn('SUM', col('finalAmount')), 0), 'approvedRevenue'],
          [fn('COUNT', fn('DISTINCT', col('customerId'))), 'approvedCustomers']
        ]
      }),
      Quotation.findAll({
        where,
        raw: true,
        attributes: ['status', [fn('COUNT', col('id')), 'count']],
        group: ['status']
      }),
      Quotation.findAll({
        where,
        raw: true,
        attributes: [
          'dealerId',
          [fn('COUNT', col('id')), 'quotationCount'],
          [fn('COALESCE', fn('SUM', col('finalAmount')), 0), 'revenue']
        ],
        group: ['dealerId'],
        order: [[literal('"revenue"'), 'DESC']],
        limit: 10
      }),
      Visitor.count(),
      Visitor.count({ where: { isActive: true } }),
      Visitor.count({ where: { createdAt: { [Op.gte]: startOfMonth } } })
    ]);

    const statusMap = new Map<string, number>();
    for (const row of statusRows as any[]) {
      statusMap.set(String(row.status || '').toLowerCase(), Number(row.count || 0));
    }
    const statusBreakdown = {
      pending: statusMap.get('pending') || 0,
      approved: statusMap.get('approved') || 0,
      rejected: statusMap.get('rejected') || 0,
      completed: statusMap.get('completed') || 0
    };

    const dealerIds = (topDealersRaw as any[])
      .map((row) => String(row.dealerId || ''))
      .filter(Boolean);
    const dealers = dealerIds.length
      ? await Dealer.findAll({
          where: { id: { [Op.in]: dealerIds } },
          attributes: ['id', 'firstName', 'lastName'],
          raw: true
        })
      : [];
    const dealerNameById = new Map<string, string>();
    for (const dealer of dealers as any[]) {
      dealerNameById.set(
        String(dealer.id),
        `${String(dealer.firstName || '').trim()} ${String(dealer.lastName || '').trim()}`.trim() || 'Unknown'
      );
    }
    const topDealersWithNames = (topDealersRaw as any[]).map((row) => {
      const dealerId = String(row.dealerId || '');
      return {
        dealerId,
        dealerName: dealerNameById.get(dealerId) || 'Unknown',
        quotationCount: Number(row.quotationCount || 0),
        revenue: Number(row.revenue || 0)
      };
    });

    const approvedCustomers = Number((thisMonthApprovedAggregate as any)?.approvedCustomers || 0);
    const thisMonth = {
      quotations: Number((thisMonthAggregate as any)?.quotations || 0),
      revenue: Number(
        (thisMonthApprovedAggregate as any)?.approvedRevenue ??
          (thisMonthAggregate as any)?.revenue ??
          0
      ),
      newCustomers: Number((thisMonthAggregate as any)?.newCustomers || 0),
      approvedCustomers,
      approved_customers: approvedCustomers,
      approvedQuotations: Number((thisMonthApprovedAggregate as any)?.approvedQuotations || 0),
      newVisitors
    };

    const payload = {
      success: true,
      data: {
        overview: {
          totalQuotations,
          totalRevenue: Number(
            (approvedRevenueAggregate as any)?.totalRevenue ??
              (overviewAggregate as any)?.totalRevenue ??
              0
          ),
          totalCustomers: Number((overviewAggregate as any)?.totalCustomers || 0),
          activeDealers: Number((overviewAggregate as any)?.activeDealers || 0),
          totalVisitors,
          activeVisitors
        },
        thisMonth,
        statusBreakdown,
        topDealers: topDealersWithNames
      }
    };

    adminStatsCache.set(cacheKey, {
      expiresAt: Date.now() + ADMIN_STATS_CACHE_TTL_MS,
      payload
    });
    res.json(payload);
  } catch (error) {
    logError('Get system statistics error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};


