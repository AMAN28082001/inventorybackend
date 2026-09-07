import { Request, Response } from 'express';
import AWS from 'aws-sdk';
import crypto from 'crypto';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';
import { Quotation, QuotationInstallationDoc, Dealer, Customer, QuotationProduct, Visit, VisitAssignment, Visitor, CustomPanel, QuotationDocument } from '../models/index-quotation';
import { enforceWorkflowFieldWriteOrRespond } from '../utils/moduleFieldPermissions';
import { logError, logInfo } from '../utils/loggerHelper';
import {
  buildReleasedToInstallerWhere,
  INSTALLER_RELEASE_STATUSES,
  resolveInstallerQueueStatuses
} from '../constants/workflowQueues';
import { toDateOnlyStringOrNull, quotationPaymentApiFields } from '../utils/quotationApiJson';
import { getInstallationTeamIdFromRequest } from '../utils/installationTeamRole';
import {
  buildPublicWorkflowFileUrl,
  mapInstallationDocumentsForApi
} from '../utils/installationDocumentsApi';
import {
  buildMcoDocApiFields,
  buildMeterDocumentApiFields,
  buildMeterInstallationPendingPhotoApiFields,
  getLatestMcoDocMeta,
  getLatestMeterDocMeta,
  MCO_DOC_FIELDS,
  resolveMeterStoredRef
} from '../utils/meteringMediaApi';
import {
  METER_INSTALLATION_PENDING_STATUS,
  meteringWorkflowApiFields,
  normalizeMeteringWorkflowStatus
} from '../utils/meteringWorkflowApi';
import { paymentExcelJourneyApiFields } from '../utils/paymentExcelJourneyStatus';
import { resolveImageContentTypeForUpload } from '../utils/uploadMimeTypes';
import {
  INSTALLATION_PARTIAL_STATUS,
  installationPartialApiFields,
  isInstallationPartialApprovedStatus,
  meteringDetailsEchoFields,
  parseTruthyFlag
} from '../utils/installationPartialApi';
import { buildFinalConfirmationApiFields } from '../utils/finalConfirmationDocuments';
import { assertInstallationUploadAllowed } from '../utils/installationUploadState';

const assertInstallationTeamQuotationScope = (req: Request, quotation: Quotation, res: Response): boolean => {
  const tid = getInstallationTeamIdFromRequest(req);
  if (!tid) return true;
  const qtid = quotation.installationTeamId ?? null;
  if (qtid !== tid) {
    res.status(403).json({
      success: false,
      error: { code: 'AUTH_004', message: 'Insufficient permissions' }
    });
    return false;
  }
  return true;
};

const normalizeWorkflowRole = (role: string | undefined): string =>
  String(role || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');

/**
 * Admin Installation tab completion uploader (§6.4.C): quotation `dealer` admins and inventory admins.
 * Relaxed file / leg requirements vs installer in `installerUploadDocuments`.
 */
const isInstallerCompletionAdmin = (req: Request): boolean => {
  if (req.dealer?.role === 'admin') return true;
  const r = normalizeWorkflowRole(req.user?.role);
  return r === 'admin' || r === 'superadmin' || r === 'super_admin' || r === 'super_admin_manager';
};

const workflowActorId = (req: Request): string => String(req.user?.id || req.dealer?.id || 'unknown');

const workflowActorRole = (req: Request): string =>
  String(req.user?.role || req.dealer?.role || 'unknown');

const normalizeAwsEnvValue = (value: string | undefined, fallback = ''): string => {
  const normalized = String(value || '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '');

  if (!normalized) return fallback;

  const lower = normalized.toLowerCase();
  if (lower === 'undefined' || lower === 'null') {
    return fallback;
  }

  return normalized;
};

const getS3Client = () => {
  const region = normalizeAwsEnvValue(process.env.AWS_REGION, 'ap-south-1');
  const accessKeyId = normalizeAwsEnvValue(process.env.AWS_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID);
  const secretAccessKey = normalizeAwsEnvValue(process.env.AWS_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY);
  if (accessKeyId && secretAccessKey) {
    return new AWS.S3({ region, accessKeyId, secretAccessKey });
  }
  return new AWS.S3({ region });
};

const uploadFileToS3 = async (file: Express.Multer.File, quotationId: string, docType: string) => {
  const bucket = normalizeAwsEnvValue(process.env.AWS_BUCKET_NAME, 'cbpl-bajaj-node');
  if (!bucket) throw new Error('AWS_BUCKET_NAME is not configured');
  const ext = path.extname(file.originalname || '');
  const key = `quotation-workflow/${quotationId}/${docType}-${Date.now()}-${Math.round(Math.random() * 1e8)}${ext}`;
  await getS3Client().putObject({
    Bucket: bucket,
    Key: key,
    Body: file.buffer,
    ContentType: resolveImageContentTypeForUpload(file)
  }).promise();
  return key;
};

const normalizeWorkflowFileUrl = (value: unknown): string | null => buildPublicWorkflowFileUrl(value);

const mapWorkflowDocumentsForFrontend = async (docs: any[]) =>
  (await mapInstallationDocumentsForApi(docs)).documents;

const mapAssignedVisitors = (assignments: any[]) =>
  (assignments || []).map((a: any) => {
    const visitor = a.visitor;
    if (visitor) {
      return {
        visitorId: visitor.id,
        username: visitor.username,
        firstName: visitor.firstName,
        lastName: visitor.lastName,
        fullName: `${visitor.firstName || ''} ${visitor.lastName || ''}`.trim(),
        mobile: visitor.mobile || null,
        email: visitor.email || null
      };
    }
    return {
      visitorId: a.visitorId || null,
      fullName: a.visitorName || null
    };
  });

const mapInstallerProducts = (products: any, customPanels: any[]) => {
  if (!products) return null;
  return {
    systemType: products.systemType || null,
    phase: products.phase || null,
    panelBrand: products.panelBrand || null,
    panelSize: products.panelSize || null,
    panelQuantity: products.panelQuantity ?? null,
    dcrPanelBrand: products.dcrPanelBrand || null,
    dcrPanelSize: products.dcrPanelSize || null,
    dcrPanelQuantity: products.dcrPanelQuantity ?? null,
    nonDcrPanelBrand: products.nonDcrPanelBrand || null,
    nonDcrPanelSize: products.nonDcrPanelSize || null,
    nonDcrPanelQuantity: products.nonDcrPanelQuantity ?? null,
    customPanels: (customPanels || []).map((p: any) => ({
      brand: p.brand || null,
      size: p.size || null,
      quantity: p.quantity ?? null,
      type: p.type || null,
      price: p.price !== undefined && p.price !== null ? Number(p.price) : null
    })),
    inverterType: products.inverterType || null,
    inverterBrand: products.inverterBrand || null,
    inverterSize: products.inverterSize || null,
    hybridInverter: products.hybridInverter || null,
    batteryCapacity: products.batteryCapacity || null,
    batteryPrice: products.batteryPrice !== undefined && products.batteryPrice !== null ? Number(products.batteryPrice) : null,
    structureType: products.structureType || null,
    structureSize: products.structureSize || null,
    meterBrand: products.meterBrand || null,
    acCableBrand: products.acCableBrand || null,
    acCableSize: products.acCableSize || null,
    dcCableBrand: products.dcCableBrand || null,
    dcCableSize: products.dcCableSize || null,
    acdb: products.acdb || null,
    dcdb: products.dcdb || null,
    earthingWireSize: products.earthingWireSize || products.earthing_wire_size || null,
    earthingWireBrand: products.earthingWireBrand || products.earthing_wire_brand || null
  };
};

const getWorkflowQueue = async (
  req: Request,
  res: Response,
  targetStatus: string,
  extraWhere: Record<string, unknown> = {}
) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    // Metering queue needs a higher default so Meter Process tabs/counts survive refresh.
    const defaultLimit = extraWhere.meteringQueue === true ? 1000 : 20;
    const limit = Math.min(parseInt(req.query.limit as string) || defaultLimit, 1000);
    const offset = (page - 1) * limit;
    const status = (req.query.status as string) || targetStatus;
    const sortBy = (req.query.sortBy as string) || 'createdAt';
    const sortOrder = ((req.query.sortOrder as string) || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const search = (req.query.search as string | undefined)?.trim();

    const requestedStatuses = status
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const releaseRequired = extraWhere.installationReadyForInstaller === true;
    const meteringQueue = extraWhere.meteringQueue === true;
    const where: any = {};
    const installationStatusFilter =
      requestedStatuses.length > 1
        ? { [Op.in]: requestedStatuses }
        : requestedStatuses[0] || targetStatus;

    if (meteringQueue) {
      // §L.1 — metering pipeline rows appear without Payment Management release (admin early send).
      where.installationStatus = installationStatusFilter;
    } else if (releaseRequired) {
      // Source-of-truth: only rows sent from Payment Management (flag or release timestamp).
      where[Op.and] = [
        ...(where[Op.and] || []),
        buildReleasedToInstallerWhere(),
        { installationStatus: installationStatusFilter }
      ];
    } else {
      where.installationStatus = installationStatusFilter;
    }

    const sanitizedExtraWhere = { ...extraWhere };
    delete (sanitizedExtraWhere as any).installationReadyForInstaller;
    delete (sanitizedExtraWhere as any).meteringQueue;
    Object.assign(where, sanitizedExtraWhere);
    const scopedTeamId = getInstallationTeamIdFromRequest(req);
    if (scopedTeamId) {
      where.installationTeamId = scopedTeamId;
    }
    if (search) {
      const searchOr = [
        { id: { [Op.iLike]: `%${search}%` } },
        { '$customer.firstName$': { [Op.iLike]: `%${search}%` } },
        { '$customer.lastName$': { [Op.iLike]: `%${search}%` } },
        { '$customer.mobile$': { [Op.iLike]: `%${search}%` } }
      ];
      where[Op.and] = [...(where[Op.and] || []), { [Op.or]: searchOr }];
    }

    const allowedSortFields = new Set(['createdAt', 'approvedAt', 'installerApprovedAt', 'updatedAt']);
    const orderByField = allowedSortFields.has(sortBy) ? sortBy : 'createdAt';
    const includeMediaRaw = String(req.query.includeMedia || req.query.include_media || '').toLowerCase();
    const includeVisitsRaw = String(req.query.includeVisits || req.query.include_visits || '').toLowerCase();
    // §7.5 — installer queue skips heavy media/visits unless opted in; metering/baldev keep media by default.
    const includeMedia =
      includeMediaRaw === 'true' || includeMediaRaw === '1'
        ? true
        : includeMediaRaw === 'false' || includeMediaRaw === '0'
          ? false
          : !releaseRequired;
    const includeVisits =
      includeVisitsRaw === 'true' || includeVisitsRaw === '1'
        ? true
        : includeVisitsRaw === 'false' || includeVisitsRaw === '0'
          ? false
          : includeMedia;

    const includes: any[] = [
      { model: Dealer, as: 'dealer', attributes: ['id', 'firstName', 'lastName', 'username', 'email', 'mobile'] },
      {
        model: Customer,
        as: 'customer',
        attributes: ['id', 'firstName', 'lastName', 'mobile', 'email', 'streetAddress', 'city', 'state', 'pincode']
      },
      { model: QuotationProduct, as: 'products', required: false },
      { model: CustomPanel, as: 'customPanels', required: false },
      // §M — Final confirmation preview fields for Baldev / Final process tabs.
      {
        model: QuotationDocument,
        as: 'documents',
        required: false,
        attributes: [
          'customerFinalBillFile',
          'panelWarrantyFile',
          'inverterWarrantyFile',
          'workCompletionWarrantyFile'
        ]
      }
    ];
    // §7.5 — skip heavy media/visits on queue list critical path unless opted in.
    if (includeMedia) {
      includes.push({ model: QuotationInstallationDoc, as: 'installationDocs', required: false });
    }
    if (includeVisits) {
      includes.push({
        model: Visit,
        as: 'visits',
        required: false,
        attributes: [
          'id',
          'visitDate',
          'visitTime',
          'location',
          'locationLink',
          'status',
          'createdAt',
          'length',
          'width',
          'height',
          'unit',
          'backLegFeet',
          'midLegFeet',
          'frontLegFeet',
          'notes'
        ],
        include: [
          {
            model: VisitAssignment,
            as: 'assignments',
            required: false,
            attributes: ['visitorId', 'visitorName'],
            include: [
              {
                model: Visitor,
                as: 'visitor',
                required: false,
                attributes: ['id', 'username', 'firstName', 'lastName', 'mobile', 'email']
              }
            ]
          }
        ]
      });
    }

    const quotations = await Quotation.findAndCountAll({
      where,
      include: includes,
      subQuery: false,
      distinct: true,
      order: [[orderByField, sortOrder]],
      limit,
      offset
    });

    res.json({
      success: true,
      data: {
        quotations: await Promise.all(quotations.rows.map(async (q: any) => {
          const rawVisits = includeVisits && Array.isArray(q.visits) ? q.visits : [];
          const sortedVisits = [...rawVisits].sort((a: any, b: any) => {
            const da = new Date(`${a.visitDate || ''} ${a.visitTime || '00:00'}`).getTime();
            const db = new Date(`${b.visitDate || ''} ${b.visitTime || '00:00'}`).getTime();
            return da - db;
          });
          const visits = sortedVisits.map((v: any) => {
            const assignedVisitors = mapAssignedVisitors(v.assignments || []);
            const backLegFeet = v.backLegFeet != null ? Number(v.backLegFeet) : null;
            const midLegFeet = v.midLegFeet != null ? Number(v.midLegFeet) : null;
            const frontLegFeet = v.frontLegFeet != null ? Number(v.frontLegFeet) : null;
            return {
              id: v.id,
              visitDate: v.visitDate || null,
              visitTime: v.visitTime || null,
              status: v.status || null,
              location: v.location || null,
              visitLocation: v.location || null,
              locationLink: v.locationLink || null,
              length: v.length != null ? Number(v.length) : null,
              width: v.width != null ? Number(v.width) : null,
              height: v.height != null ? Number(v.height) : null,
              unit: v.unit || null,
              backLegFeet,
              midLegFeet,
              frontLegFeet,
              back_leg_feet: backLegFeet,
              mid_leg_feet: midLegFeet,
              front_leg_feet: frontLegFeet,
              siteDimensions: {
                siteLength: v.length != null ? Number(v.length) : null,
                siteWidth: v.width != null ? Number(v.width) : null,
                siteHeight: v.height != null ? Number(v.height) : null,
                backLegFeet,
                midLegFeet,
                frontLegFeet
              },
              visitors: assignedVisitors,
              assignedVisitors
            };
          });
          const primaryVisit = visits[0] || null;
          const rawInstallationDocs = includeMedia
            ? (q.installationDocs || []).map((doc: any) =>
                typeof doc.toJSON === 'function' ? doc.toJSON() : doc
              )
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
          const mcoDocFields = includeMedia
            ? await buildMcoDocApiFields(rawInstallationDocs)
            : {};
          // §AF — always echo meter document public URLs (re-presign from stored key), even when includeMedia=false.
          const meterStoredRef =
            resolveMeterStoredRef(q.meterDocumentImageUrl, includeMedia ? rawInstallationDocs : []) ||
            (typeof q.meterDocumentImageUrl === 'string' ? q.meterDocumentImageUrl : null);
          const meterDocumentFields = await buildMeterDocumentApiFields(
            meterStoredRef,
            latestMeterDoc.name
          );
          const finalConfirmationFields = await buildFinalConfirmationApiFields(q.documents);
          return {
            id: q.id,
            status: q.status,
            installationReadyForInstaller: Boolean(q.installationReadyForInstaller),
            installation_ready_for_installer: Boolean(q.installationReadyForInstaller),
            installationReleasedAt: q.installationReleasedAt || null,
            installation_released_at: q.installationReleasedAt || null,
            installationScheduledAt: toDateOnlyStringOrNull(q.installationScheduledAt ?? (q as any).installation_scheduled_at),
            installation_scheduled_at: toDateOnlyStringOrNull(q.installationScheduledAt ?? (q as any).installation_scheduled_at),
            installationTeamId: q.installationTeamId ?? null,
            installation_team_id: q.installationTeamId ?? null,
            meteringId: q.meteringId || null,
            meteringActionAt: q.meteringActionAt || null,
            ...meteringDetailsEchoFields({
              meteringRemarks: q.meteringRemarks,
              meteringAuthorizedRepresentative: (q as any).meteringAuthorizedRepresentative,
              discomName: q.discomName,
              discomLocation: (q as any).discomLocation
            }),
            ...installationPartialApiFields({
              installationStatus: q.installationStatus,
              installationPartialApproved: (q as any).installationPartialApproved,
              installationPartialApprovedAt: (q as any).installationPartialApprovedAt
            }),
            ...meteringWorkflowApiFields({
              installationStatus: q.installationStatus,
              meteringApprovedAt: q.meteringApprovedAt,
              mcoAt: q.mcoAt,
              completionAt: q.completionAt,
              meterInstallationPendingAt: (q as any).meterInstallationPendingAt,
              meteringWccAfterDiscom: (q as any).meteringWccAfterDiscom,
              meteringWccAfterDiscomAt: (q as any).meteringWccAfterDiscomAt
            }),
            ...paymentExcelJourneyApiFields({
              ...(typeof q.toJSON === 'function' ? q.toJSON() : (q as any)),
              installationStatus: q.installationStatus,
              meteringWccAfterDiscom: (q as any).meteringWccAfterDiscom,
              installationPartialApproved: (q as any).installationPartialApproved,
              installerApprovedAt: q.installerApprovedAt
            }),
            ...quotationPaymentApiFields(
              typeof q.toJSON === 'function' ? q.toJSON() : (q as any)
            ),
            ...(includeMedia
              ? await buildMeterInstallationPendingPhotoApiFields({
                  meterInstallationPhotoUrl: (q as any).meterInstallationPhotoUrl,
                  meterInstallationPhotoName: (q as any).meterInstallationPhotoName,
                  plantLivePhotoUrl: (q as any).plantLivePhotoUrl,
                  plantLivePhotoName: (q as any).plantLivePhotoName
                })
              : {}),
            discomName: q.discomName || null,
            meterType: q.meterType || null,
            meterNo: q.meterNo || null,
            solarMeterNo: q.solarMeterNo || null,
            netMeterNo: q.netMeterNo || null,
            ...meterDocumentFields,
            ...mcoDocFields,
            ...finalConfirmationFields,
            dealer: q.dealer
              ? {
                id: q.dealer.id,
                firstName: q.dealer.firstName || null,
                lastName: q.dealer.lastName || null,
                name: `${q.dealer.firstName || ''} ${q.dealer.lastName || ''}`.trim() || null,
                username: (q.dealer as any).username || null,
                mobile: q.dealer.mobile || null,
                email: q.dealer.email || null
              }
              : null,
            dealerName: q.dealer
              ? `${q.dealer.firstName || ''} ${q.dealer.lastName || ''}`.trim() || null
              : null,
            dealer_name: q.dealer
              ? `${q.dealer.firstName || ''} ${q.dealer.lastName || ''}`.trim() || null
              : null,
            dealerMobile: q.dealer?.mobile || null,
            dealer_mobile: q.dealer?.mobile || null,
            customer: q.customer
              ? {
                id: q.customer.id,
                firstName: q.customer.firstName || null,
                lastName: q.customer.lastName || null,
                mobile: q.customer.mobile || null,
                email: q.customer.email || null,
                address: {
                  street: q.customer.streetAddress || null,
                  city: q.customer.city || null,
                  state: q.customer.state || null,
                  pincode: q.customer.pincode || null
                },
                location: [q.customer.city, q.customer.state].filter(Boolean).join(', ') || null
              }
              : null,
            visits,
            location: primaryVisit?.location || null,
            visitLocation: primaryVisit?.visitLocation || null,
            locationLink: primaryVisit?.locationLink || null,
            visitors: primaryVisit?.visitors || [],
            otherVisitors: primaryVisit?.assignedVisitors || [],
            assignedVisitors: primaryVisit?.assignedVisitors || [],
            products: mapInstallerProducts(q.products, q.customPanels || []),
            pricing: {
              subtotal: Number(q.subtotal || 0),
              totalAmount: Number(q.totalAmount || 0),
              finalAmount: Number(q.finalAmount || 0)
            },
            approvedAt: q.approvedAt || null,
            installerApprovedAt: q.installerApprovedAt || null,
            documents: {
              ...finalConfirmationFields,
              ...installationPayload.documents
            },
            installationDocuments: installationPayload.installationDocuments,
            installationPhotoUrls: installationPayload.installationPhotoUrls,
            installation_photo_urls: installationPayload.installationPhotoUrls,
            ...installationPayload.installationFieldUrls,
            createdAt: q.createdAt,
            validUntil: q.validUntil,
            // Nested alias for clients that read `row.quotation.*` (must echo team id for field-team portals).
            quotation: {
              id: q.id,
              status: q.status,
              ...meteringWorkflowApiFields({
                installationStatus: q.installationStatus,
                meteringApprovedAt: q.meteringApprovedAt,
                mcoAt: q.mcoAt,
                completionAt: q.completionAt,
                meterInstallationPendingAt: (q as any).meterInstallationPendingAt,
                meteringWccAfterDiscom: (q as any).meteringWccAfterDiscom,
                meteringWccAfterDiscomAt: (q as any).meteringWccAfterDiscomAt
              }),
              installationTeamId: q.installationTeamId ?? null,
              installation_team_id: q.installationTeamId ?? null,
              installationReadyForInstaller: Boolean(q.installationReadyForInstaller),
              installation_ready_for_installer: Boolean(q.installationReadyForInstaller),
              installationReleasedAt: q.installationReleasedAt || null,
              installation_released_at: q.installationReleasedAt || null,
              installationScheduledAt: toDateOnlyStringOrNull(q.installationScheduledAt ?? (q as any).installation_scheduled_at),
              installation_scheduled_at: toDateOnlyStringOrNull(q.installationScheduledAt ?? (q as any).installation_scheduled_at)
            }
          };
        })),
        pagination: {
          page,
          limit,
          total: quotations.count,
          totalPages: Math.ceil(quotations.count / limit),
          hasNext: page < Math.ceil(quotations.count / limit),
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    logError('Get workflow queue error', error, { targetStatus });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const getInstallerQueue = async (req: Request, res: Response): Promise<void> => {
  req.query.status = resolveInstallerQueueStatuses(req.query.status as string | undefined) as any;
  await getWorkflowQueue(req, res, INSTALLER_RELEASE_STATUSES.join(','), {
    installationReadyForInstaller: true
  });
};

export const getBaldevQueue = async (req: Request, res: Response): Promise<void> => {
  // Include handoff-ready records while keeping explicit status filter support.
  // `?status=pending_baldev` will still return only pending_baldev items.
  await getWorkflowQueue(req, res, 'pending_baldev,installer_approved');
};

export const getMeteringQueue = async (req: Request, res: Response): Promise<void> => {
  const status = String(req.query.status || '').toLowerCase();
  const aliasMap: Record<string, string> = {
    // Processing must only include stages metering can actively work on.
    processing: 'pending_metering,metering_in_progress',
    pending: 'pending_metering,metering_in_progress',
    approved: 'metering_approved',
    meter_installation_pending: METER_INSTALLATION_PENDING_STATUS,
    meter_install_pending: METER_INSTALLATION_PENDING_STATUS,
    mco: 'mco'
  };
  if (aliasMap[status]) {
    req.query.status = aliasMap[status] as any;
  }
  await getWorkflowQueue(req, res, 'pending_metering,metering_in_progress,metering_approved,meter_installation_pending,mco', {
    meteringQueue: true
  });
};

const collectMeteringApproveErrors = async (
  quotation: Quotation,
  quotationId: string
): Promise<Array<{ field: string; message: string }>> => {
  const discomName = parseTrimmedString((quotation as any).discomName);
  const meterType = parseTrimmedString((quotation as any).meterType);
  const meterNo = parseTrimmedString((quotation as any).meterNo);
  const solarMeterNo = parseTrimmedString((quotation as any).solarMeterNo);
  const netMeterNo = parseTrimmedString((quotation as any).netMeterNo);

  const meterDocCount = await QuotationInstallationDoc.count({
    where: { quotationId, docType: 'meter_doc' }
  });
  const hasMeterDocument =
    Boolean(parseTrimmedString((quotation as any).meterDocumentImageUrl)) || meterDocCount > 0;

  const detailsErrors: Array<{ field: string; message: string }> = [];
  if (!discomName) detailsErrors.push({ field: 'discomName', message: 'discomName is required' });
  if (!meterType || !['solar', 'net', 'both'].includes(meterType)) {
    detailsErrors.push({ field: 'meterType', message: 'meterType must be solar, net, or both' });
  }
  if (meterType === 'both') {
    if (!solarMeterNo) detailsErrors.push({ field: 'solarMeterNo', message: 'solarMeterNo is required for meterType=both' });
    if (!netMeterNo) detailsErrors.push({ field: 'netMeterNo', message: 'netMeterNo is required for meterType=both' });
  } else if (!meterNo) {
    detailsErrors.push({ field: 'meterNo', message: 'meterNo is required for meterType solar/net' });
  }
  if (!hasMeterDocument) {
    detailsErrors.push({ field: 'meterDocumentImage', message: 'Meter document is required before approve action' });
  }
  return detailsErrors;
};

export const meteringStatusUpdate = async (req: Request, res: Response): Promise<void> => {
  try {
    const { quotationId } = req.params;
    const body = req.body as Record<string, unknown>;
    const action = body.action as string | undefined;
    const remarks = body.remarks as string | undefined;
    const quotation = await Quotation.findByPk(quotationId);
    if (!quotation) {
      res.status(404).json({ success: false, error: { code: 'RES_001', message: 'Quotation not found' } });
      return;
    }

    if (!(await enforceWorkflowFieldWriteOrRespond(req, res, 'metering', quotation))) {
      return;
    }

    const current = quotation.installationStatus || '';
    const valid: Record<string, string[]> = {
      // Fallback compatibility: when queue includes pre-metering records,
      // allow metering to move via start -> approve (or direct approve).
      start: ['pending_metering', 'pending_installer', 'installer_in_progress', 'installer_approved'],
      approve: [
        'metering_in_progress',
        'pending_metering',
        'pending_installer',
        'installer_in_progress',
        'installer_approved'
      ],
      // Primary path: Meter Installation Pending → MCO; legacy: metering_approved → mco
      send_to_mco: [METER_INSTALLATION_PENDING_STATUS, 'metering_approved'],
      mark_completed: ['mco', 'metering_approved', METER_INSTALLATION_PENDING_STATUS],
      move_back: [
        'metering_in_progress',
        'metering_approved',
        METER_INSTALLATION_PENDING_STATUS,
        'mco'
      ]
    };

    const patch: Record<string, unknown> = {
      meteringId: req.user?.id || req.dealer?.id || quotation.meteringId || null,
      meteringActionAt: new Date()
    };
    if (remarks !== undefined) {
      patch.meteringRemarks = (remarks as string | undefined) || null;
    }

    const wf003Message = (act: string, stage: string): string => {
      if (act === 'send_to_mco' && !valid.send_to_mco.includes(stage)) {
        return 'To MCO requires meter_installation_pending (or legacy metering_approved).';
      }
      if (act === 'approve' && !valid.approve.includes(stage)) {
        return 'Metering approve is not allowed for the current installation stage.';
      }
      return 'Metering action not allowed for current stage';
    };

    if (action) {
      if (!valid[action] || !valid[action].includes(current)) {
        res.status(409).json({
          success: false,
          error: { code: 'WF_003', message: wf003Message(action, current) }
        });
        return;
      }

      if (action === 'start') patch.installationStatus = 'metering_in_progress';
      if (action === 'approve') {
        const detailsErrors = await collectMeteringApproveErrors(quotation, quotationId);
        if (detailsErrors.length > 0) {
          res.status(400).json({
            success: false,
            error: {
              code: 'WF_002',
              message: 'Metering details are incomplete for approve action.',
              details: detailsErrors
            }
          });
          return;
        }
        patch.installationStatus = 'metering_approved';
        patch.meteringApprovedAt = new Date();
        // Land in Meter in Discom (not WCC Pending)
        patch.meteringWccAfterDiscom = false;
        patch.meteringWccAfterDiscomAt = null;
      }
      if (action === 'send_to_mco') {
        patch.installationStatus = 'mco';
        patch.mcoAt = new Date();
        patch.meteringWccAfterDiscom = false;
        patch.meteringWccAfterDiscomAt = null;
      }
      if (action === 'mark_completed') {
        const docs = await QuotationInstallationDoc.findAll({
          where: { quotationId, docType: 'other' },
          order: [['uploadedAt', 'DESC'], ['createdAt', 'DESC']]
        });
        const latestMcoDocs = getLatestMcoDocMeta(docs.map((d) => (typeof (d as any).toJSON === 'function' ? (d as any).toJSON() : d)));
        const missingMcoDocs: Array<{ field: string; message: string }> = [];
        if (!latestMcoDocs.workCompleteReportImageUrl) {
          missingMcoDocs.push({ field: 'workCompleteReportImage', message: 'workCompleteReportImage is required' });
        }
        if (!latestMcoDocs.meterInstalledPhotoUrl) {
          missingMcoDocs.push({ field: 'meterInstalledPhoto', message: 'meterInstalledPhoto is required' });
        }
        if (!latestMcoDocs.completeDcrReportImageUrl) {
          missingMcoDocs.push({ field: 'completeDcrReportImage', message: 'completeDcrReportImage is required' });
        }
        if (missingMcoDocs.length > 0) {
          res.status(400).json({
            success: false,
            error: {
              code: 'WF_002',
              message: 'Required MCO documents are missing before completion.',
              details: missingMcoDocs
            }
          });
          return;
        }
        patch.installationStatus = 'pending_baldev';
      }
      if (action === 'move_back') {
        if (current === METER_INSTALLATION_PENDING_STATUS) {
          patch.installationStatus = 'metering_approved';
        } else {
          patch.installationStatus = current === 'mco' ? 'metering_approved' : 'pending_metering';
        }
      }
    } else {
      // Direct body fallback: metering_approved | meter_installation_pending | mco
      const rawTarget =
        parseTrimmedString(body.installationStatus) ||
        parseTrimmedString(body.installation_status) ||
        parseTrimmedString(body.meteringStatus) ||
        parseTrimmedString(body.metering_status) ||
        parseTrimmedString(body.status);
      const target = normalizeMeteringWorkflowStatus(rawTarget) || '';

      if (!['metering_approved', METER_INSTALLATION_PENDING_STATUS, 'mco'].includes(target)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message:
              'Direct status must be metering_approved, meter_installation_pending, or mco when action is omitted',
            details: [
              {
                field: 'installationStatus',
                message:
                  'Use action enum, or installationStatus/meteringStatus = metering_approved | meter_installation_pending | mco'
              }
            ]
          }
        });
        return;
      }

      if (target === 'metering_approved') {
        // Undo from Meter Installation Pending → Meter in Discom, or approve path
        if (current === METER_INSTALLATION_PENDING_STATUS) {
          patch.installationStatus = 'metering_approved';
        } else {
          if (!valid.approve.includes(current)) {
            res.status(409).json({
              success: false,
              error: { code: 'WF_003', message: wf003Message('approve', current) }
            });
            return;
          }
          const detailsErrors = await collectMeteringApproveErrors(quotation, quotationId);
          if (detailsErrors.length > 0) {
            res.status(400).json({
              success: false,
              error: {
                code: 'WF_002',
                message: 'Metering details are incomplete for approve action.',
                details: detailsErrors
              }
            });
            return;
          }
          patch.installationStatus = 'metering_approved';
          patch.meteringApprovedAt = new Date();
          patch.meteringWccAfterDiscom = false;
          patch.meteringWccAfterDiscomAt = null;
        }
      } else if (target === METER_INSTALLATION_PENDING_STATUS) {
        if (current !== 'metering_approved' && current !== METER_INSTALLATION_PENDING_STATUS) {
          res.status(409).json({
            success: false,
            error: {
              code: 'WF_003',
              message: 'meter_installation_pending is only allowed from metering_approved'
            }
          });
          return;
        }
        patch.installationStatus = METER_INSTALLATION_PENDING_STATUS;
        if (!(quotation as any).meterInstallationPendingAt) {
          patch.meterInstallationPendingAt = new Date();
        }
        patch.meteringWccAfterDiscom = false;
        patch.meteringWccAfterDiscomAt = null;
      } else if (target === 'mco') {
        if (!valid.send_to_mco.includes(current)) {
          res.status(409).json({
            success: false,
            error: { code: 'WF_003', message: wf003Message('send_to_mco', current) }
          });
          return;
        }
        patch.installationStatus = 'mco';
        patch.mcoAt = new Date();
        patch.meteringWccAfterDiscom = false;
        patch.meteringWccAfterDiscomAt = null;
      }
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
        meteringId: quotation.meteringId || null,
        meteringActionAt: quotation.meteringActionAt || null,
        ...meteringDetailsEchoFields({
          meteringRemarks: quotation.meteringRemarks,
          meteringAuthorizedRepresentative: (quotation as any).meteringAuthorizedRepresentative,
          discomName: quotation.discomName,
          discomLocation: (quotation as any).discomLocation
        }),
        updatedAt: quotation.updatedAt
      }
    });
  } catch (error) {
    logError('Metering status update error', error, { quotationId: req.params.quotationId });
    res.status(500).json({ success: false, error: { code: 'SYS_001', message: 'Internal server error' } });
  }
};

export const installerDecision = async (req: Request, res: Response): Promise<void> => {
  try {
    const { quotationId } = req.params;
    const { action, remarks } = req.body;
    const quotation = await Quotation.findByPk(quotationId);
    if (!quotation) {
      res.status(404).json({ success: false, error: { code: 'RES_001', message: 'Quotation not found' } });
      return;
    }

    if (!assertInstallationTeamQuotationScope(req, quotation, res)) {
      return;
    }

    if (!['pending_installer', 'installer_in_progress'].includes(quotation.installationStatus || '')) {
      res.status(409).json({ success: false, error: { code: 'WF_001', message: 'Invalid workflow transition' } });
      return;
    }

    if (action === 'start') {
      if (quotation.installationStatus !== 'pending_installer') {
        res.status(409).json({ success: false, error: { code: 'WF_001', message: 'Invalid workflow transition' } });
        return;
      }
      await quotation.update({
        installationStatus: 'installer_in_progress',
        installerId: req.user?.id || null,
        installerActionAt: new Date(),
        installerInProgressAt: new Date(),
        installerRemarks: remarks || quotation.installerRemarks || null
      });
    } else if (action === 'approve') {
      if (!['pending_installer', 'installer_in_progress'].includes(quotation.installationStatus || '')) {
        res.status(409).json({ success: false, error: { code: 'WF_001', message: 'Invalid workflow transition' } });
        return;
      }
      const siteImages = await QuotationInstallationDoc.count({
        where: { quotationId, docType: 'site_completion_image' }
      });
      if (siteImages < 1) {
        res.status(400).json({ success: false, error: { code: 'WF_002', message: 'Required documents missing for transition' } });
        return;
      }
      await quotation.update({
        installationStatus: 'pending_baldev',
        installerId: req.user?.id || null,
        installerActionAt: new Date(),
        installerApprovedAt: new Date(),
        installerRemarks: remarks || null
      });
    } else {
      if (!['pending_installer', 'installer_in_progress'].includes(quotation.installationStatus || '')) {
        res.status(409).json({ success: false, error: { code: 'WF_001', message: 'Invalid workflow transition' } });
        return;
      }
      await quotation.update({
        installationStatus: 'installer_rejected',
        installerId: req.user?.id || null,
        installerActionAt: new Date(),
        installerRemarks: remarks || null
      });
    }

    res.json({
      success: true,
      data: {
        id: quotation.id,
        installationStatus: quotation.installationStatus,
        installerId: quotation.installerId,
        installerActionAt: quotation.installerActionAt,
        installerInProgressAt: quotation.installerInProgressAt || null,
        installerApprovedAt: quotation.installerApprovedAt || null,
        installerRemarks: quotation.installerRemarks,
        updatedAt: quotation.updatedAt
      }
    });
  } catch (error) {
    logError('Installer decision error', error, { quotationId: req.params.quotationId });
    res.status(500).json({ success: false, error: { code: 'SYS_001', message: 'Internal server error' } });
  }
};

export const baldevDecision = async (req: Request, res: Response): Promise<void> => {
  try {
    const { quotationId } = req.params;
    const { action, remarks, markCompleted } = req.body;
    const quotation = await Quotation.findByPk(quotationId);
    if (!quotation) {
      res.status(404).json({ success: false, error: { code: 'RES_001', message: 'Quotation not found' } });
      return;
    }

    if (!['installer_approved', 'pending_baldev', 'baldev_approved'].includes(quotation.installationStatus || '')) {
      res.status(409).json({ success: false, error: { code: 'WF_001', message: 'Invalid workflow transition' } });
      return;
    }

    if (action === 'reject') {
      await quotation.update({
        installationStatus: 'baldev_rejected',
        baldevId: req.user?.id || null,
        baldevActionAt: new Date(),
        baldevRemarks: remarks || null
      });
    } else {
      // If installer step left it at installer_approved, move it into Baldev pending state first.
      if (quotation.installationStatus === 'installer_approved') {
        await quotation.update({
          installationStatus: 'pending_baldev'
        });
      }

      const warrantyCount = await QuotationInstallationDoc.count({ where: { quotationId, docType: 'warranty_doc' } });
      const meterCount = await QuotationInstallationDoc.count({ where: { quotationId, docType: 'meter_doc' } });
      if (warrantyCount < 1 || meterCount < 1) {
        res.status(400).json({ success: false, error: { code: 'WF_002', message: 'Required documents missing for transition' } });
        return;
      }

      await quotation.update({
        installationStatus: markCompleted === true ? 'completed' : 'pending_metering',
        baldevId: req.user?.id || null,
        baldevActionAt: new Date(),
        baldevRemarks: remarks || null,
        completionAt: markCompleted === true ? new Date() : quotation.completionAt
      });
    }

    res.json({
      success: true,
      data: {
        id: quotation.id,
        installationStatus: quotation.installationStatus,
        baldevId: quotation.baldevId,
        baldevActionAt: quotation.baldevActionAt,
        baldevRemarks: quotation.baldevRemarks,
        completionAt: quotation.completionAt,
        updatedAt: quotation.updatedAt
      }
    });
  } catch (error) {
    logError('Baldev decision error', error, { quotationId: req.params.quotationId });
    res.status(500).json({ success: false, error: { code: 'SYS_001', message: 'Internal server error' } });
  }
};

const INSTALLER_FIELD_DOC_MAP: Record<
  string,
  { docType: 'installer_po' | 'installer_pi' | 'additional_expense' | 'site_completion_image'; slot?: string }
> = {
  installerCompletionImages: { docType: 'site_completion_image' },
  files: { docType: 'site_completion_image' },
  homeFrontPhoto: { docType: 'site_completion_image', slot: 'homeFrontPhoto' },
  homeWithPersonPhoto: { docType: 'site_completion_image', slot: 'homeWithPersonPhoto' },
  inverterWithCustomerPhoto: { docType: 'site_completion_image', slot: 'inverterWithCustomerPhoto' },
  plantWithCustomerPhoto: { docType: 'site_completion_image', slot: 'plantWithCustomerPhoto' },
  inverterSerialNumberPhoto: { docType: 'site_completion_image', slot: 'inverterSerialNumberPhoto' },
  panelSerialNumberPhoto: { docType: 'site_completion_image', slot: 'panelSerialNumberPhoto' },
  geoTagPlantPhoto: { docType: 'site_completion_image', slot: 'geoTagPlantPhoto' },
  otherImages: { docType: 'site_completion_image', slot: 'otherImages' },
  piUpload: { docType: 'installer_pi' },
  installerPo: { docType: 'installer_po' }
};

/** Role string for §29 upload gate (admin JWT / dealer admin / installer). */
const installationUploadGateRole = (req: Request): string => {
  if (isInstallerCompletionAdmin(req)) return 'admin';
  return String(req.user?.role || req.dealer?.role || '').toLowerCase();
};

/** §29 — reject completion upload only when state is blocked (not for pending_installer). */
const rejectIfInstallationUploadNotAllowed = (
  req: Request,
  quotation: Quotation,
  res: Response
): boolean => {
  const gate = assertInstallationUploadAllowed({
    quotation,
    role: installationUploadGateRole(req),
    body: (req.body || {}) as Record<string, unknown>
  });
  if (gate.ok) return false;
  res.status(gate.status).json({
    success: false,
    error: { code: gate.code, message: gate.message }
  });
  return true;
};

const parseTrimmedString = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
};

const parseStringList = (raw: unknown): string[] => {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v).trim()).filter(Boolean);
      }
    } catch {
      return [trimmed];
    }
    return [trimmed];
  }
  return [String(raw).trim()].filter(Boolean);
};

const parsePositiveDecimal = (v: unknown): number | null => {
  const s = parseTrimmedString(v);
  if (s === undefined) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return n;
};

const parseOptionalPositiveDecimal = (v: unknown): number | null | undefined => {
  const s = parseTrimmedString(v);
  if (s === undefined) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  if (n <= 0) return NaN;
  return n;
};

const parseOptionalNonNegativeDecimal = (v: unknown): number | null | undefined => {
  const s = parseTrimmedString(v);
  if (s === undefined) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return n;
};

const parseExtraExpensesJson = (
  raw: unknown
): { lines: Array<{ description: string; amount: number }>; total: number } | 'invalid' | 'empty' => {
  const str = parseTrimmedString(raw);
  if (str === undefined) return 'empty';
  try {
    const arr = JSON.parse(str);
    if (!Array.isArray(arr)) return 'invalid';
    const lines = arr.map((row: any) => ({
      description: typeof row?.description === 'string' ? row.description : '',
      amount: Math.max(0, Number(row?.amount) || 0)
    }));
    const total = lines.reduce((sum, l) => sum + l.amount, 0);
    return { lines, total };
  } catch {
    return 'invalid';
  }
};

const flattenMulterFiles = (req: Request): Express.Multer.File[] => {
  const raw = (req as any).files as Express.Multer.File[] | Record<string, Express.Multer.File[]> | undefined;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return Object.values(raw).flat();
};

/** Field names allowed in `installerCompletionImageFieldOrderJson` (aligned with admin aggregate upload). */
const INSTALLER_AGGREGATE_ORDER_KEYS = new Set([
  'homeFrontPhoto',
  'homeWithPersonPhoto',
  'inverterWithCustomerPhoto',
  'plantWithCustomerPhoto',
  'inverterSerialNumberPhoto',
  'panelSerialNumberPhoto',
  'geoTagPlantPhoto',
  'otherImages',
  'piUpload'
]);

const parseInstallerCompletionImageFieldOrderJson = (body: Record<string, unknown>): string[] | null => {
  const raw =
    body.installerCompletionImageFieldOrderJson ?? body.installer_completion_image_field_order_json;
  const s = parseTrimmedString(raw);
  if (s === undefined) return null;
  try {
    const parsed = JSON.parse(s) as unknown;
    if (!Array.isArray(parsed)) return null;
    const keys = parsed.map((x) => String(x).trim()).filter(Boolean);
    return keys.length ? keys : null;
  } catch {
    return null;
  }
};

/**
 * Deterministic file order: known per-field parts first (stable UI order), then repeated
 * `installerCompletionImages` in multipart order (matches `installerCompletionImageFieldOrderJson`).
 * Supports Multer `.fields()` (Record) and `.any()` (File[]).
 */
const buildOrderedInstallerMultipartFiles = (req: Request): Express.Multer.File[] => {
  const raw = (req as any).files as Express.Multer.File[] | Record<string, Express.Multer.File[]> | undefined;
  if (!raw) return [];

  const asRecord = (files: Express.Multer.File[]): Record<string, Express.Multer.File[]> => {
    const out: Record<string, Express.Multer.File[]> = {};
    for (const f of files) {
      if (!out[f.fieldname]) out[f.fieldname] = [];
      out[f.fieldname].push(f);
    }
    return out;
  };

  const byField: Record<string, Express.Multer.File[]> = Array.isArray(raw) ? asRecord(raw) : raw;
  const pick = (name: string): Express.Multer.File[] =>
    Array.isArray(byField[name]) ? byField[name] : [];
  const nonAggregateOrder = [
    'homeFrontPhoto',
    'homeWithPersonPhoto',
    'inverterWithCustomerPhoto',
    'plantWithCustomerPhoto',
    'inverterSerialNumberPhoto',
    'panelSerialNumberPhoto',
    'geoTagPlantPhoto',
    'otherImages',
    'piUpload',
    'installerPo',
    'files'
  ];
  const ordered: Express.Multer.File[] = [];
  for (const name of nonAggregateOrder) {
    ordered.push(...pick(name));
  }
  ordered.push(...pick('installerCompletionImages'));
  return ordered;
};

type InstallerUrlDocCandidate = {
  fieldName: string;
  url: string;
  docType: 'installer_po' | 'installer_pi' | 'additional_expense' | 'site_completion_image';
  slot?: string;
  /** Provenance for retained URL rows (admin partial re-upload). */
  urlSource?:
    | 'existing_installation_image_urls_json'
    | 'existing_pi_upload_url'
    | 'existing_pi_upload_urls_json'
    | 'url_submit';
};

/** Logical keys allowed inside `existingInstallationImageUrlsJson` (per-field URL retention). */
const INSTALLER_EXISTING_URL_BLOB_KEYS = new Set([
  'homeFrontPhoto',
  'homeWithPersonPhoto',
  'inverterWithCustomerPhoto',
  'plantWithCustomerPhoto',
  'inverterSerialNumberPhoto',
  'panelSerialNumberPhoto',
  'geoTagPlantPhoto',
  'otherImages',
  'piUpload',
  'installerPo'
]);

const parseExistingInstallationImageUrlsJson = (
  body: Record<string, unknown>
): { candidates: InstallerUrlDocCandidate[]; parseError: string | null } => {
  const raw =
    body.existingInstallationImageUrlsJson ?? body.existing_installation_image_urls_json;
  const s = parseTrimmedString(raw);
  if (s === undefined) {
    return { candidates: [], parseError: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return { candidates: [], parseError: 'existingInstallationImageUrlsJson is not valid JSON' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { candidates: [], parseError: 'existingInstallationImageUrlsJson must be a JSON object' };
  }
  const picked = new Map<string, InstallerUrlDocCandidate>();
  for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
    if (!INSTALLER_EXISTING_URL_BLOB_KEYS.has(key)) {
      continue;
    }
    const map = INSTALLER_FIELD_DOC_MAP[key];
    if (!map) continue;
    const list = Array.isArray(val) ? val : val !== undefined && val !== null ? [val] : [];
    for (const item of list) {
      const url = normalizeWorkflowFileUrl(item);
      if (!url) continue;
      const dedupeKey = `${map.docType}:${url}`;
      const candidate: InstallerUrlDocCandidate = {
        fieldName: key,
        url,
        docType: map.docType,
        urlSource: 'existing_installation_image_urls_json',
        ...(map.slot ? { slot: map.slot } : {})
      };
      const existing = picked.get(dedupeKey);
      if (!existing || (!existing.slot && candidate.slot)) {
        picked.set(dedupeKey, candidate);
      }
    }
  }
  return { candidates: [...picked.values()], parseError: null };
};

const buildExistingPiUploadUrlCandidate = (body: Record<string, unknown>): InstallerUrlDocCandidate | null => {
  const url = normalizeWorkflowFileUrl(body.existingPiUploadUrl ?? body.existing_pi_upload_url);
  if (!url) return null;
  return {
    fieldName: 'piUpload',
    url,
    docType: 'installer_pi',
    urlSource: 'existing_pi_upload_url'
  };
};

const parseExistingPiUploadUrlsJson = (
  body: Record<string, unknown>
): { candidates: InstallerUrlDocCandidate[]; parseError: string | null } => {
  const raw = body.existingPiUploadUrlsJson ?? body.existing_pi_upload_urls_json;
  const s = parseTrimmedString(raw);
  if (s === undefined) {
    return { candidates: [], parseError: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return { candidates: [], parseError: 'existingPiUploadUrlsJson is not valid JSON' };
  }
  if (!Array.isArray(parsed)) {
    return { candidates: [], parseError: 'existingPiUploadUrlsJson must be a JSON array' };
  }
  const candidates: InstallerUrlDocCandidate[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    const url = normalizeWorkflowFileUrl(item);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    candidates.push({
      fieldName: 'piUpload',
      url,
      docType: 'installer_pi',
      urlSource: 'existing_pi_upload_urls_json'
    });
  }
  return { candidates, parseError: null };
};

const mergeInstallerUrlDocCandidates = (lists: InstallerUrlDocCandidate[][]): InstallerUrlDocCandidate[] => {
  const byKey = new Map<string, InstallerUrlDocCandidate>();
  for (const list of lists) {
    for (const c of list) {
      const dedupeKey = `${c.docType}:${c.url}`;
      const existing = byKey.get(dedupeKey);
      if (!existing || (!existing.slot && c.slot)) {
        byKey.set(dedupeKey, c);
      }
    }
  }
  return [...byKey.values()];
};

const buildInstallerUrlDocCandidates = (
  body: Record<string, unknown>,
  bodyDocType:
    | 'installer_po'
    | 'installer_pi'
    | 'additional_expense'
    | 'site_completion_image'
    | undefined
): InstallerUrlDocCandidate[] => {
  const orderedFields = [
    'homeFrontPhoto',
    'homeWithPersonPhoto',
    'inverterWithCustomerPhoto',
    'plantWithCustomerPhoto',
    'inverterSerialNumberPhoto',
    'panelSerialNumberPhoto',
    'geoTagPlantPhoto',
    'otherImages',
    'piUpload',
    'installerPo',
    'installerCompletionImages',
    'files'
  ];

  const picked = new Map<string, InstallerUrlDocCandidate>();
  for (const fieldName of orderedFields) {
    const map = INSTALLER_FIELD_DOC_MAP[fieldName];
    if (!map) continue;
    const values = parseStringList(body[fieldName]);
    for (const value of values) {
      const url = normalizeWorkflowFileUrl(value);
      if (!url) continue;
      let docType = map.docType;
      if (fieldName === 'files' && bodyDocType && ['installer_po', 'installer_pi', 'additional_expense', 'site_completion_image'].includes(bodyDocType)) {
        docType = bodyDocType;
      }
      const dedupeKey = `${docType}:${url}`;
      const candidate: InstallerUrlDocCandidate = {
        fieldName,
        url,
        docType,
        urlSource: 'url_submit',
        ...(map.slot ? { slot: map.slot } : {})
      };
      const existing = picked.get(dedupeKey);
      if (!existing || (!existing.slot && candidate.slot)) {
        picked.set(dedupeKey, candidate);
      }
    }
  }
  return [...picked.values()];
};

export const uploadInstallerDocument = async (req: Request, res: Response): Promise<void> => {
  try {
    const { quotationId } = req.params;
    const quotation = await Quotation.findByPk(quotationId);
    if (!quotation) {
      res.status(404).json({ success: false, error: { code: 'RES_001', message: 'Quotation not found' } });
      return;
    }

    if (!assertInstallationTeamQuotationScope(req, quotation, res)) {
      return;
    }

    if (rejectIfInstallationUploadNotAllowed(req, quotation, res)) {
      return;
    }

    if (!(await enforceWorkflowFieldWriteOrRespond(req, res, 'installation', quotation))) {
      return;
    }

    const fieldName = parseTrimmedString(req.body?.field);
    const file = req.file as Express.Multer.File | undefined;
    const allowedFields = new Set([
      'homeFrontPhoto',
      'homeWithPersonPhoto',
      'inverterWithCustomerPhoto',
      'plantWithCustomerPhoto',
      'inverterSerialNumberPhoto',
      'panelSerialNumberPhoto',
      'geoTagPlantPhoto',
      'otherImages',
      'piUpload'
    ]);

    if (!fieldName || !allowedFields.has(fieldName)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'field must be a supported installer upload slot',
          details: [{ field: 'field', message: 'Invalid installer upload field' }]
        }
      });
      return;
    }

    if (!file?.buffer) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'file is required',
          details: [{ field: 'file', message: 'file is required' }]
        }
      });
      return;
    }

    const docType = INSTALLER_FIELD_DOC_MAP[fieldName].docType;
    const url = await uploadFileToS3(file, quotationId, docType);
    const urlKey = `${fieldName}Url`;

    res.status(200).json({
      success: true,
      data: {
        field: fieldName,
        url,
        fileUrl: url,
        [urlKey]: url,
        documents: {
          [fieldName]: url
        }
      }
    });
  } catch (error) {
    logError('Upload installer document error', error, { quotationId: req.params.quotationId, field: req.body?.field });
    res.status(500).json({ success: false, error: { code: 'SYS_001', message: 'Internal server error' } });
  }
};

export const saveMeteringDetails = async (req: Request, res: Response): Promise<void> => {
  try {
    const { quotationId } = req.params;
    const quotation = await Quotation.findByPk(quotationId);
    if (!quotation) {
      res.status(404).json({ success: false, error: { code: 'RES_001', message: 'Quotation not found' } });
      return;
    }

    const allowedStatuses = new Set([
      'pending_installer',
      'installer_in_progress',
      'installer_partial_approved',
      'installer_approved',
      'pending_baldev',
      'baldev_approved',
      'pending_metering',
      'metering_in_progress',
      'metering_approved',
      METER_INSTALLATION_PENDING_STATUS,
      'mco'
    ]);
    if (!allowedStatuses.has(quotation.installationStatus || '')) {
      res.status(409).json({
        success: false,
        error: { code: 'WF_003', message: 'Metering details are not allowed for current stage' }
      });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const meterType = parseTrimmedString(body.meterType);
    const meterNo = parseTrimmedString(body.meterNo);
    const solarMeterNo = parseTrimmedString(body.solarMeterNo);
    const netMeterNo = parseTrimmedString(body.netMeterNo);
    const meteringRemarks =
      parseTrimmedString(body.remarks) ?? parseTrimmedString(body.meteringRemarks);
    const authorizedRepresentative =
      parseTrimmedString(body.authorizedRepresentative) ??
      parseTrimmedString(body.authorized_representative);
    const discomLocation =
      parseTrimmedString(body.discomLocation) ?? parseTrimmedString(body.discom_location);

    if (meterType && !['solar', 'net', 'both'].includes(meterType)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'meterType must be one of: solar, net, both',
          details: [{ field: 'meterType', message: 'Invalid meter type' }]
        }
      });
      return;
    }

    if (meterType === 'both' && (!solarMeterNo || !netMeterNo)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'solarMeterNo and netMeterNo are required when meterType is both',
          details: [
            { field: 'solarMeterNo', message: 'Required for meterType=both' },
            { field: 'netMeterNo', message: 'Required for meterType=both' }
          ]
        }
      });
      return;
    }

    const allFiles = flattenMulterFiles(req);
    const pickFirst = (...names: string[]) =>
      allFiles.find((f) => names.includes(f.fieldname)) || null;

    const meterDocFile = pickFirst(
      'meterDocumentImage',
      'meter_document_image',
      'meterDocument',
      'meter_document',
      'meterDocumentFile',
      'file'
    );
    const meterInstallPhotoFile = pickFirst(
      'meterInstallationPhoto',
      'meter_installation_photo'
    );
    const plantLivePhotoFile = pickFirst('plantLivePhoto', 'plant_live_photo');

    let meterDocumentImageUrl = quotation.meterDocumentImageUrl || null;
    let meterDocumentName: string | null = null;
    let meterInstallationPhotoUrl = (quotation as any).meterInstallationPhotoUrl || null;
    let meterInstallationPhotoName = (quotation as any).meterInstallationPhotoName || null;
    let plantLivePhotoUrl = (quotation as any).plantLivePhotoUrl || null;
    let plantLivePhotoName = (quotation as any).plantLivePhotoName || null;

    const actorId = req.user?.id || req.dealer?.id || 'unknown';
    const actorRole = req.user?.role || req.dealer?.role || 'unknown';

    if (meterDocFile) {
      meterDocumentImageUrl = await uploadFileToS3(meterDocFile, quotationId, 'meter_doc');
      meterDocumentName = meterDocFile.originalname || null;
      await QuotationInstallationDoc.create({
        id: uuidv4(),
        quotationId,
        docType: 'meter_doc',
        fileUrl: meterDocumentImageUrl,
        uploadedByUserId: actorId,
        uploadedByRole: actorRole,
        remarks: parseTrimmedString(body.remarks) || 'metering_detail_upload',
        metadata: {
          originalName: meterDocFile.originalname,
          mimeType: meterDocFile.mimetype,
          size: meterDocFile.size,
          field: meterDocFile.fieldname
        },
        uploadedAt: new Date()
      });
    }

    if (meterInstallPhotoFile) {
      meterInstallationPhotoUrl = await uploadFileToS3(
        meterInstallPhotoFile,
        quotationId,
        'meter_installation_photo'
      );
      meterInstallationPhotoName = meterInstallPhotoFile.originalname || null;
      await QuotationInstallationDoc.create({
        id: uuidv4(),
        quotationId,
        docType: 'other',
        fileUrl: meterInstallationPhotoUrl,
        uploadedByUserId: actorId,
        uploadedByRole: actorRole,
        remarks: parseTrimmedString(body.remarks) || 'meter_installation_photo',
        metadata: {
          originalName: meterInstallPhotoFile.originalname,
          mimeType: meterInstallPhotoFile.mimetype,
          size: meterInstallPhotoFile.size,
          field: 'meterInstallationPhoto',
          meteringField: 'meterInstallationPhoto'
        },
        uploadedAt: new Date()
      });
    }

    if (plantLivePhotoFile) {
      plantLivePhotoUrl = await uploadFileToS3(
        plantLivePhotoFile,
        quotationId,
        'plant_live_photo'
      );
      plantLivePhotoName = plantLivePhotoFile.originalname || null;
      await QuotationInstallationDoc.create({
        id: uuidv4(),
        quotationId,
        docType: 'other',
        fileUrl: plantLivePhotoUrl,
        uploadedByUserId: actorId,
        uploadedByRole: actorRole,
        remarks: parseTrimmedString(body.remarks) || 'plant_live_photo',
        metadata: {
          originalName: plantLivePhotoFile.originalname,
          mimeType: plantLivePhotoFile.mimetype,
          size: plantLivePhotoFile.size,
          field: 'plantLivePhoto',
          meteringField: 'plantLivePhoto'
        },
        uploadedAt: new Date()
      });
    }

    const currentStatus = String(quotation.installationStatus || '').trim();
    const statusPatch: Record<string, unknown> = {};
    if (currentStatus !== 'mco') {
      // WCC save in metering path should land in Meter Installation Pending.
      statusPatch.installationStatus = METER_INSTALLATION_PENDING_STATUS;
      statusPatch.meterInstallationPendingAt =
        (quotation as any).meterInstallationPendingAt || new Date();
      statusPatch.meteringWccAfterDiscom = false;
      statusPatch.meteringWccAfterDiscomAt = null;
    }

    await quotation.update({
      discomName: parseTrimmedString(body.discomName) ?? quotation.discomName,
      meterType: meterType ?? quotation.meterType,
      meterNo: meterNo ?? quotation.meterNo,
      solarMeterNo: solarMeterNo ?? quotation.solarMeterNo,
      netMeterNo: netMeterNo ?? quotation.netMeterNo,
      meterDocumentImageUrl,
      meterInstallationPhotoUrl,
      meterInstallationPhotoName,
      plantLivePhotoUrl,
      plantLivePhotoName,
      ...(discomLocation !== undefined ? { discomLocation } : {}),
      ...(meteringRemarks !== undefined ? { meteringRemarks } : {}),
      ...(authorizedRepresentative !== undefined
        ? { meteringAuthorizedRepresentative: authorizedRepresentative }
        : {}),
      ...statusPatch
    } as any);

    await quotation.reload();
    if (!meterDocumentName) {
      const latestMeterDoc = await QuotationInstallationDoc.findOne({
        where: { quotationId, docType: 'meter_doc' },
        order: [['uploadedAt', 'DESC'], ['createdAt', 'DESC']]
      });
      const metadata: any = latestMeterDoc?.metadata || {};
      meterDocumentName =
        (typeof metadata.originalName === 'string' && metadata.originalName.trim()) ||
        (typeof metadata.original_name === 'string' && metadata.original_name.trim()) ||
        null;
    }

    const meterDocumentFields = await buildMeterDocumentApiFields(
      quotation.meterDocumentImageUrl,
      meterDocumentName
    );
    const mipPhotoFields = await buildMeterInstallationPendingPhotoApiFields({
      meterInstallationPhotoUrl: (quotation as any).meterInstallationPhotoUrl,
      meterInstallationPhotoName: (quotation as any).meterInstallationPhotoName,
      plantLivePhotoUrl: (quotation as any).plantLivePhotoUrl,
      plantLivePhotoName: (quotation as any).plantLivePhotoName
    });

    res.json({
      success: true,
      data: {
        id: quotation.id,
        quotationId: quotation.id,
        ...meteringWorkflowApiFields({
          installationStatus: quotation.installationStatus,
          meteringApprovedAt: quotation.meteringApprovedAt,
          mcoAt: quotation.mcoAt,
          completionAt: quotation.completionAt,
          meterInstallationPendingAt: (quotation as any).meterInstallationPendingAt,
          meteringWccAfterDiscom: (quotation as any).meteringWccAfterDiscom,
          meteringWccAfterDiscomAt: (quotation as any).meteringWccAfterDiscomAt
        }),
        ...meteringDetailsEchoFields({
          meteringRemarks: quotation.meteringRemarks,
          meteringAuthorizedRepresentative: (quotation as any).meteringAuthorizedRepresentative,
          discomName: quotation.discomName,
          discomLocation: (quotation as any).discomLocation
        }),
        meterType: quotation.meterType || null,
        meterNo: quotation.meterNo || null,
        solarMeterNo: quotation.solarMeterNo || null,
        netMeterNo: quotation.netMeterNo || null,
        ...meterDocumentFields,
        ...mipPhotoFields,
        meteringApprovedAt: quotation.meteringApprovedAt || null,
        updatedAt: quotation.updatedAt
      }
    });
  } catch (error) {
    logError('Save metering details error', error, { quotationId: req.params.quotationId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const saveMeteringMcoDocuments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { quotationId } = req.params;
    const quotation = await Quotation.findByPk(quotationId);
    if (!quotation) {
      res.status(404).json({ success: false, error: { code: 'RES_001', message: 'Quotation not found' } });
      return;
    }

    const files = flattenMulterFiles(req);
    const acceptedFields = new Set<string>(MCO_DOC_FIELDS);
    const relevantFiles = files.filter((f) => acceptedFields.has(f.fieldname as any));
    if (relevantFiles.length === 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'At least one MCO document file is required',
          details: MCO_DOC_FIELDS.map((field) => ({ field, message: 'Upload one or more MCO document images' }))
        }
      });
      return;
    }

    for (const file of relevantFiles) {
      const fileUrl = await uploadFileToS3(file, quotationId, 'mco_doc');
      await QuotationInstallationDoc.create({
        id: uuidv4(),
        quotationId,
        docType: 'other',
        fileUrl,
        uploadedByUserId: req.user?.id || 'unknown',
        uploadedByRole: req.user?.role || 'unknown',
        remarks: parseTrimmedString((req.body as any)?.remarks) || 'metering_mco_document',
        metadata: {
          mcoField: file.fieldname,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size
        },
        uploadedAt: new Date()
      });
    }

    const docs = await QuotationInstallationDoc.findAll({
      where: { quotationId, docType: 'other' },
      order: [['uploadedAt', 'DESC'], ['createdAt', 'DESC']]
    });
    const docRows = docs.map((d) => (typeof (d as any).toJSON === 'function' ? (d as any).toJSON() : d));
    const mcoDocFields = await buildMcoDocApiFields(docRows);

    res.json({
      success: true,
      data: {
        id: quotation.id,
        quotationId: quotation.id,
        ...mcoDocFields,
        updatedAt: quotation.updatedAt
      }
    });
  } catch (error) {
    logError('Save metering MCO documents error', error, { quotationId: req.params.quotationId });
    res.status(500).json({ success: false, error: { code: 'SYS_001', message: 'Internal server error' } });
  }
};

export const installerUploadDocuments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { quotationId } = req.params;
    const quotation = await Quotation.findByPk(quotationId);
    if (!quotation) {
      res.status(404).json({ success: false, error: { code: 'RES_001', message: 'Quotation not found' } });
      return;
    }

    if (!assertInstallationTeamQuotationScope(req, quotation, res)) {
      return;
    }

    if (rejectIfInstallationUploadNotAllowed(req, quotation, res)) {
      return;
    }

    if (!(await enforceWorkflowFieldWriteOrRespond(req, res, 'installation', quotation))) {
      return;
    }

    const isAdmin = isInstallerCompletionAdmin(req);

    const body = req.body as Record<string, unknown>;
    const bodyDocType = parseTrimmedString(body.docType) as
      | 'installer_po'
      | 'installer_pi'
      | 'additional_expense'
      | 'site_completion_image'
      | undefined;

    const cmSignal = [
      body.siteLength,
      body.siteWidth,
      body.siteHeight,
      body.backLegCm,
      body.midLegCm,
      body.frontLegCm
    ].some((v) => parseTrimmedString(v) !== undefined);

    const feetSignal = [body.backLegFeet, body.midLegFeet, body.frontLegFeet].some(
      (v) => parseTrimmedString(v) !== undefined
    );

    const siteSignal = cmSignal || feetSignal;

    const backCmRaw = body.siteLength ?? body.backLegCm;
    const frontCmRaw = body.siteHeight ?? body.frontLegCm;
    const midCmRaw = body.siteWidth ?? body.midLegCm;

    if (cmSignal) {
      if (!isAdmin) {
        const backCm = parsePositiveDecimal(backCmRaw);
        const frontCm = parsePositiveDecimal(frontCmRaw);
        if (backCm === null || frontCm === null || Number.isNaN(backCm) || Number.isNaN(frontCm)) {
          res.status(400).json({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Back and front site legs (cm) are required and must be positive numbers',
              details: [
                { field: 'siteLength', message: 'Required positive number (back leg cm)' },
                { field: 'siteHeight', message: 'Required positive number (front leg cm)' }
              ]
            }
          });
          return;
        }
        const midCm = parseOptionalPositiveDecimal(midCmRaw);
        if (midCm !== undefined && Number.isNaN(midCm)) {
          res.status(400).json({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Mid leg (cm) must be a positive number when provided',
              details: [{ field: 'siteWidth', message: 'Invalid mid leg value' }]
            }
          });
          return;
        }
      } else {
        const hasBackInput = parseTrimmedString(backCmRaw) !== undefined;
        const hasFrontInput = parseTrimmedString(frontCmRaw) !== undefined;
        const hasMidInput = parseTrimmedString(midCmRaw) !== undefined;
        if (hasBackInput) {
          const backCm = parsePositiveDecimal(backCmRaw);
          if (backCm === null || Number.isNaN(backCm)) {
            res.status(400).json({
              success: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Back leg (cm) must be a positive number when provided',
                details: [{ field: 'siteLength', message: 'Invalid back leg value' }]
              }
            });
            return;
          }
        }
        if (hasFrontInput) {
          const frontCm = parsePositiveDecimal(frontCmRaw);
          if (frontCm === null || Number.isNaN(frontCm)) {
            res.status(400).json({
              success: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Front leg (cm) must be a positive number when provided',
                details: [{ field: 'siteHeight', message: 'Invalid front leg value' }]
              }
            });
            return;
          }
        }
        if (hasMidInput) {
          const midCm = parseOptionalPositiveDecimal(midCmRaw);
          if (midCm === undefined || Number.isNaN(midCm)) {
            res.status(400).json({
              success: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Mid leg (cm) must be a positive number when provided',
                details: [{ field: 'siteWidth', message: 'Invalid mid leg value' }]
              }
            });
            return;
          }
        }
      }
    }

    let extraParsed: { lines: Array<{ description: string; amount: number }>; total: number } | null = null;
    const extraRaw = body.extraExpensesJson;
    if (extraRaw !== undefined && parseTrimmedString(extraRaw) !== undefined) {
      const parsed = parseExtraExpensesJson(extraRaw);
      if (parsed === 'invalid') {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'extraExpensesJson must be a JSON array of { description, amount }',
            details: [{ field: 'extraExpensesJson', message: 'Invalid JSON' }]
          }
        });
        return;
      }
      if (parsed !== 'empty') {
        extraParsed = parsed;
        const stated = parseOptionalNonNegativeDecimal(body.extraExpensesTotal);
        if (
          typeof stated === 'number' &&
          Number.isFinite(stated) &&
          Math.abs(stated - parsed.total) > 0.01
        ) {
          res.status(400).json({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'extraExpensesTotal does not match sum of extraExpensesJson lines',
              details: [
                { field: 'extraExpensesTotal', message: `Expected ${parsed.total}` }
              ]
            }
          });
          return;
        }
      }
    }

    const { candidates: urlCandidatesFromExistingBlob, parseError: existingUrlsParseError } =
      parseExistingInstallationImageUrlsJson(body);
    if (existingUrlsParseError) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: existingUrlsParseError,
          details: [{ field: 'existingInstallationImageUrlsJson', message: existingUrlsParseError }]
        }
      });
      return;
    }

    const { candidates: existingPiUrlsFromJson, parseError: existingPiUrlsParseError } =
      parseExistingPiUploadUrlsJson(body);
    if (existingPiUrlsParseError) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: existingPiUrlsParseError,
          details: [{ field: 'existingPiUploadUrlsJson', message: existingPiUrlsParseError }]
        }
      });
      return;
    }

    const fieldOrder = parseInstallerCompletionImageFieldOrderJson(body);
    let aggregateImageIndex = 0;
    const files = buildOrderedInstallerMultipartFiles(req);
    const existingPiUrlCandidate = buildExistingPiUploadUrlCandidate(body);
    const urlDocs = mergeInstallerUrlDocCandidates([
      buildInstallerUrlDocCandidates(body, bodyDocType),
      urlCandidatesFromExistingBlob,
      existingPiUrlsFromJson,
      existingPiUrlCandidate ? [existingPiUrlCandidate] : []
    ]);
    const adminMetaPayload =
      isAdmin &&
      (parseTrimmedString(body.installationStatus) !== undefined ||
        parseTrimmedString(body.installerRemarks) !== undefined ||
        parseTrimmedString(body.remarks) !== undefined ||
        parseTruthyFlag(body.installationPartialApproved) !== undefined ||
        parseTruthyFlag(body.installation_partial_approved) !== undefined);
    if (files.length === 0 && urlDocs.length === 0 && !siteSignal && !extraParsed && !adminMetaPayload) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_002', message: 'Provide at least one file, site dimensions, or extra expenses' }
      });
      return;
    }

    const seenHashes = new Set<string>();
    const seenUrls = new Set<string>();
    const createdDocs: any[] = [];

    // Prefer reusing already-persisted URL docs on partial re-upload (avoid duplicates).
    const priorDocs = await QuotationInstallationDoc.findAll({
      where: {
        quotationId,
        docType: { [Op.in]: ['site_completion_image', 'installer_pi', 'installer_po', 'additional_expense'] }
      },
      attributes: ['fileUrl', 'docType']
    });
    for (const d of priorDocs) {
      const url = normalizeWorkflowFileUrl(d.fileUrl);
      if (url) seenUrls.add(`${d.docType}:${url}`);
    }

    for (const file of files) {
      const baseMap = INSTALLER_FIELD_DOC_MAP[file.fieldname];
      if (!baseMap) {
        continue;
      }
      let docType = baseMap.docType;
      let slot = baseMap.slot;
      let logicalField = file.fieldname;

      if (file.fieldname === 'installerCompletionImages' && fieldOrder && fieldOrder.length > 0) {
        const keyRaw = fieldOrder[aggregateImageIndex] ?? '';
        aggregateImageIndex += 1;
        if (keyRaw && INSTALLER_AGGREGATE_ORDER_KEYS.has(keyRaw)) {
          const sub = INSTALLER_FIELD_DOC_MAP[keyRaw];
          docType = sub.docType;
          slot = sub.slot;
          logicalField = keyRaw;
        } else {
          const fallback = INSTALLER_FIELD_DOC_MAP.otherImages;
          docType = fallback.docType;
          slot = fallback.slot;
          logicalField = 'otherImages';
        }
      }

      if (file.fieldname === 'files' && bodyDocType && ['installer_po', 'installer_pi', 'additional_expense', 'site_completion_image'].includes(bodyDocType)) {
        docType = bodyDocType;
      }
      const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');
      if (seenHashes.has(hash)) {
        continue;
      }
      seenHashes.add(hash);

      const fileUrl = await uploadFileToS3(file, quotationId, docType);
      const metadata: Record<string, unknown> = {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        field: logicalField,
        uploadField: file.fieldname
      };
      if (slot) {
        metadata.slot = slot;
      }
      const doc = await QuotationInstallationDoc.create({
        id: uuidv4(),
        quotationId,
        docType: docType as any,
        fileUrl,
        uploadedByUserId: workflowActorId(req),
        uploadedByRole: workflowActorRole(req),
        remarks: (parseTrimmedString(body.installerRemarks) || parseTrimmedString(body.remarks)) || null,
        metadata,
        uploadedAt: new Date()
      });
      createdDocs.push(doc);
    }

    for (const ref of urlDocs) {
      const dedupeKey = `${ref.docType}:${ref.url}`;
      if (seenUrls.has(dedupeKey)) {
        continue;
      }
      seenUrls.add(dedupeKey);
      const metadata: Record<string, unknown> = {
        field: ref.fieldName,
        source: ref.urlSource || 'url_submit'
      };
      if (ref.slot) {
        metadata.slot = ref.slot;
      }
      const doc = await QuotationInstallationDoc.create({
        id: uuidv4(),
        quotationId,
        docType: ref.docType as any,
        fileUrl: ref.url,
        uploadedByUserId: workflowActorId(req),
        uploadedByRole: workflowActorRole(req),
        remarks: (parseTrimmedString(body.installerRemarks) || parseTrimmedString(body.remarks)) || null,
        metadata,
        uploadedAt: new Date()
      });
      createdDocs.push(doc);
    }

    const quotationPatch: Record<string, unknown> = {};

    if (cmSignal) {
      const backCm = parsePositiveDecimal(body.siteLength ?? body.backLegCm);
      const frontCm = parsePositiveDecimal(body.siteHeight ?? body.frontLegCm);
      if (backCm !== null && !Number.isNaN(backCm)) quotationPatch.siteLengthCm = backCm;
      if (frontCm !== null && !Number.isNaN(frontCm)) quotationPatch.siteHeightCm = frontCm;
      const midCm = parseOptionalPositiveDecimal(body.siteWidth ?? body.midLegCm);
      if (midCm !== undefined && !Number.isNaN(midCm)) {
        quotationPatch.siteWidthCm = midCm;
      } else if (parseTrimmedString(body.siteWidth) === '' && parseTrimmedString(body.midLegCm) === '') {
        quotationPatch.siteWidthCm = null;
      }
    }

    if (feetSignal) {
      const bf = parseOptionalNonNegativeDecimal(body.backLegFeet);
      const mf = parseOptionalNonNegativeDecimal(body.midLegFeet);
      const ff = parseOptionalNonNegativeDecimal(body.frontLegFeet);
      if (bf !== undefined && !Number.isNaN(bf)) quotationPatch.backLegFt = bf;
      if (mf !== undefined && !Number.isNaN(mf)) quotationPatch.midLegFt = mf;
      if (ff !== undefined && !Number.isNaN(ff)) quotationPatch.frontLegFt = ff;
    }

    if (extraParsed) {
      quotationPatch.extraExpensesJson = extraParsed.lines;
      quotationPatch.extraExpensesTotal = extraParsed.total;
    }

    const rem = parseTrimmedString(body.installerRemarks) || parseTrimmedString(body.remarks);
    if (rem !== undefined) {
      quotationPatch.installerRemarks = rem;
    }

    if (Object.keys(quotationPatch).length > 0) {
      await quotation.update(quotationPatch as any);
    }

    const requestedInstallStatus = parseTrimmedString(body.installationStatus);
    const partialFlag =
      parseTruthyFlag(body.installationPartialApproved) === true ||
      parseTruthyFlag(body.installation_partial_approved) === true ||
      isInstallationPartialApprovedStatus(requestedInstallStatus);
    const markInstallerApproved = requestedInstallStatus === 'installer_approved';
    const markInstallerPartial =
      !markInstallerApproved &&
      (requestedInstallStatus === INSTALLATION_PARTIAL_STATUS || partialFlag);

    if (markInstallerApproved) {
      if (!isAdmin) {
        const siteImages = await QuotationInstallationDoc.count({
          where: { quotationId, docType: 'site_completion_image' }
        });
        if (siteImages < 1) {
          res.status(400).json({
            success: false,
            error: { code: 'WF_002', message: 'At least one site completion image is required before approval' }
          });
          return;
        }
      }
      await quotation.update({
        installationStatus: 'installer_approved',
        installerId: isAdmin ? quotation.installerId : req.user?.id || quotation.installerId,
        installerActionAt: new Date(),
        installerApprovedAt: new Date(),
        installerRemarks: rem || quotation.installerRemarks || null,
        installationPartialApproved: false,
        installationPartialApprovedAt: null
      } as any);
    } else if (markInstallerPartial) {
      await quotation.update({
        installationStatus: INSTALLATION_PARTIAL_STATUS,
        installerId: isAdmin ? quotation.installerId : req.user?.id || quotation.installerId,
        installerActionAt: new Date(),
        // Do not set installerApprovedAt for partial — keeps row out of Approved Installation
        installerApprovedAt: null,
        installerRemarks: rem || quotation.installerRemarks || null,
        installationPartialApproved: true,
        installationPartialApprovedAt: new Date()
      } as any);
    } else {
      // §29: upload from pending without target status → at least move to in_progress
      const currentAfter =
        String(quotation.installationStatus || '')
          .trim()
          .toLowerCase() || 'pending_installer';
      if (currentAfter === 'pending_installer' || currentAfter === '') {
        await quotation.update({
          installationStatus: 'installer_in_progress',
          installerId: isAdmin ? quotation.installerId : req.user?.id || quotation.installerId,
          installerActionAt: new Date(),
          installerInProgressAt: (quotation as any).installerInProgressAt || new Date(),
          installerRemarks: rem || quotation.installerRemarks || null
        } as any);
      }
    }

    await quotation.reload();
    const allDocs = await QuotationInstallationDoc.findAll({
      where: { quotationId },
      order: [['uploadedAt', 'ASC'], ['createdAt', 'ASC']]
    });

    logInfo('Installer workflow documents uploaded', {
      quotationId,
      newFiles: createdDocs.length,
      installationStatus: quotation.installationStatus
    });

    const installDocsPayload = await mapWorkflowDocumentsForFrontend(
      allDocs.map((doc: any) => (typeof doc.toJSON === 'function' ? doc.toJSON() : doc))
    );

    res.status(createdDocs.length > 0 ? 201 : 200).json({
      success: true,
      data: {
        quotationId,
        id: quotation.id,
        installationStatus: quotation.installationStatus,
        installation_status: quotation.installationStatus,
        ...installationPartialApiFields({
          installationStatus: quotation.installationStatus,
          installationPartialApproved: (quotation as any).installationPartialApproved,
          installationPartialApprovedAt: (quotation as any).installationPartialApprovedAt
        }),
        installerInProgressAt: quotation.installerInProgressAt || null,
        installerApprovedAt: quotation.installerApprovedAt || null,
        installerRemarks: quotation.installerRemarks || null,
        siteLengthCm: quotation.siteLengthCm != null ? Number(quotation.siteLengthCm) : null,
        siteWidthCm: quotation.siteWidthCm != null ? Number(quotation.siteWidthCm) : null,
        siteHeightCm: quotation.siteHeightCm != null ? Number(quotation.siteHeightCm) : null,
        site_length_cm: quotation.siteLengthCm != null ? Number(quotation.siteLengthCm) : null,
        site_width_cm: quotation.siteWidthCm != null ? Number(quotation.siteWidthCm) : null,
        site_height_cm: quotation.siteHeightCm != null ? Number(quotation.siteHeightCm) : null,
        backLegFt: quotation.backLegFt != null ? Number(quotation.backLegFt) : null,
        midLegFt: quotation.midLegFt != null ? Number(quotation.midLegFt) : null,
        frontLegFt: quotation.frontLegFt != null ? Number(quotation.frontLegFt) : null,
        back_leg_ft: quotation.backLegFt != null ? Number(quotation.backLegFt) : null,
        mid_leg_ft: quotation.midLegFt != null ? Number(quotation.midLegFt) : null,
        front_leg_ft: quotation.frontLegFt != null ? Number(quotation.frontLegFt) : null,
        extraExpensesTotal: quotation.extraExpensesTotal != null ? Number(quotation.extraExpensesTotal) : null,
        extraExpensesJson: quotation.extraExpensesJson || null,
        documents: installDocsPayload,
        piUploadUrl: (installDocsPayload as any)?.piUploadUrl ?? null,
        piUploadUrls: (installDocsPayload as any)?.piUploadUrls ?? []
      }
    });
  } catch (error) {
    logError('Installer upload documents error', error, { quotationId: req.params.quotationId });
    res.status(500).json({ success: false, error: { code: 'SYS_001', message: 'Internal server error' } });
  }
};

const saveDocs = async (req: Request, res: Response, allowedTypes: string[]) => {
  try {
    const { quotationId } = req.params;
    const quotation = await Quotation.findByPk(quotationId);
    if (!quotation) {
      res.status(404).json({ success: false, error: { code: 'RES_001', message: 'Quotation not found' } });
      return;
    }

    const docType = req.body.docType as string;
    const remarks = req.body.remarks as string | undefined;
    if (!docType || !allowedTypes.includes(docType)) {
      res.status(400).json({ success: false, error: { code: 'VAL_001', message: 'Validation error', details: [{ field: 'docType', message: 'Invalid document type' }] } });
      return;
    }

    const files = flattenMulterFiles(req).filter((f) => f.fieldname === 'files' || f.fieldname === 'installerCompletionImages');
    if (files.length === 0) {
      res.status(400).json({ success: false, error: { code: 'VAL_002', message: 'At least one file is required' } });
      return;
    }

    const createdDocs = [];
    for (const file of files) {
      const fileUrl = await uploadFileToS3(file, quotationId, docType);
      const doc = await QuotationInstallationDoc.create({
        id: uuidv4(),
        quotationId,
        docType: docType as any,
        fileUrl,
        uploadedByUserId: req.user?.id || 'unknown',
        uploadedByRole: req.user?.role || 'unknown',
        remarks: remarks || null,
        metadata: { originalName: file.originalname, mimeType: file.mimetype, size: file.size },
        uploadedAt: new Date()
      });
      createdDocs.push(doc);
    }

    const allDocs = await QuotationInstallationDoc.findAll({
      where: { quotationId },
      order: [['uploadedAt', 'ASC'], ['createdAt', 'ASC']]
    });

    logInfo('Workflow documents uploaded', { quotationId, docType, count: createdDocs.length });
    res.status(201).json({
      success: true,
      data: {
        quotationId,
        docType,
        installationStatus: quotation.installationStatus,
        installerInProgressAt: quotation.installerInProgressAt || null,
        installerApprovedAt: quotation.installerApprovedAt || null,
        documents: await mapWorkflowDocumentsForFrontend(
          allDocs.map((doc: any) => (typeof doc.toJSON === 'function' ? doc.toJSON() : doc))
        )
      }
    });
  } catch (error) {
    logError('Save workflow docs error', error, { quotationId: req.params.quotationId });
    res.status(500).json({ success: false, error: { code: 'SYS_001', message: 'Internal server error' } });
  }
};

export const baldevUploadDocuments = async (req: Request, res: Response): Promise<void> => {
  await saveDocs(req, res, ['warranty_doc', 'meter_doc', 'other']);
};

export const getWorkflowHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { quotationId } = req.params;
    const quotation = await Quotation.findByPk(quotationId);
    if (!quotation) {
      res.status(404).json({ success: false, error: { code: 'RES_001', message: 'Quotation not found' } });
      return;
    }

    const docs = await QuotationInstallationDoc.findAll({
      where: { quotationId },
      order: [['uploadedAt', 'ASC'], ['createdAt', 'ASC']]
    });

    const timeline = [
      { event: 'quotation_created', at: quotation.createdAt, actorId: null, actorRole: null, remarks: null },
      quotation.status === 'approved' ? { event: 'quotation_approved', at: quotation.approvedAt || quotation.updatedAt, actorId: null, actorRole: 'admin', remarks: null } : null,
      quotation.installerInProgressAt
        ? {
            event: 'installer_in_progress',
            at: quotation.installerInProgressAt,
            actorId: quotation.installerId,
            actorRole: 'installer',
            remarks: quotation.installerRemarks || null
          }
        : null,
      quotation.installerApprovedAt
        ? {
            event: 'installer_approved',
            at: quotation.installerApprovedAt,
            actorId: quotation.installerId,
            actorRole: 'installer',
            remarks: quotation.installerRemarks || null
          }
        : null,
      quotation.installerActionAt && quotation.installationStatus === 'installer_rejected'
        ? {
            event: 'installer_rejected',
            at: quotation.installerActionAt,
            actorId: quotation.installerId,
            actorRole: 'installer',
            remarks: quotation.installerRemarks || null
          }
        : null,
      quotation.baldevActionAt
        ? {
            event: quotation.installationStatus === 'baldev_rejected' ? 'baldev_rejected' : 'baldev_approved',
            at: quotation.baldevActionAt,
            actorId: quotation.baldevId,
            actorRole: 'baldev',
            remarks: quotation.baldevRemarks || null
          }
        : null,
      quotation.meteringActionAt
        ? {
            event:
              quotation.installationStatus === 'metering_in_progress'
                ? 'metering_in_progress'
                : quotation.installationStatus === 'metering_approved'
                  ? 'metering_approved'
                  : quotation.installationStatus === 'mco'
                    ? 'mco'
                    : 'metering_action',
            at: quotation.meteringActionAt,
            actorId: quotation.meteringId,
            actorRole: 'metering',
            remarks: quotation.meteringRemarks || null
          }
        : null,
      quotation.mcoAt
        ? {
            event: 'mco',
            at: quotation.mcoAt,
            actorId: quotation.meteringId,
            actorRole: 'metering',
            remarks: quotation.meteringRemarks || null
          }
        : null,
      quotation.completionAt
        ? {
            event: 'completed',
            at: quotation.completionAt,
            actorId: quotation.meteringId || quotation.baldevId,
            actorRole: quotation.meteringId ? 'metering' : 'baldev',
            remarks: quotation.meteringRemarks || quotation.baldevRemarks || null
          }
        : null
    ].filter(Boolean);

    res.json({
      success: true,
      data: {
        quotationId,
        status: quotation.status,
        installationStatus: quotation.installationStatus,
        approvedAt: quotation.approvedAt || null,
        installerApprovedAt: quotation.installerApprovedAt || null,
        timeline,
        documents: await mapWorkflowDocumentsForFrontend(docs.map((d: any) => d.toJSON()))
      }
    });
  } catch (error) {
    logError('Get workflow history error', error, { quotationId: req.params.quotationId });
    res.status(500).json({ success: false, error: { code: 'SYS_001', message: 'Internal server error' } });
  }
};
