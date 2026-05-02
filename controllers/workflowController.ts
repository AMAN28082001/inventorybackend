import { Request, Response } from 'express';
import AWS from 'aws-sdk';
import crypto from 'crypto';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';
import { Quotation, QuotationInstallationDoc, Dealer, Customer, QuotationProduct, Visit, VisitAssignment, Visitor, CustomPanel } from '../models/index-quotation';
import { logError, logInfo } from '../utils/loggerHelper';
import { INSTALLER_RELEASE_STATUSES, resolveInstallerQueueStatuses } from '../constants/workflowQueues';
import { toDateOnlyStringOrNull } from '../utils/quotationApiJson';

const getS3Client = () => {
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY;
  const secretAccessKey = process.env.AWS_SECRET_KEY;
  if (region && accessKeyId && secretAccessKey) {
    return new AWS.S3({ region, accessKeyId, secretAccessKey });
  }
  return new AWS.S3();
};

const buildS3Url = (key: string) => {
  const publicBase = process.env.AWS_S3_PUBLIC_URL;
  if (publicBase) return `${publicBase.replace(/\/$/, '')}/${key}`;
  const bucket = process.env.AWS_BUCKET_NAME;
  const region = process.env.AWS_REGION || 'us-east-1';
  const host = region === 'us-east-1' ? 's3.amazonaws.com' : `s3.${region}.amazonaws.com`;
  return `https://${bucket}.${host}/${key}`;
};

const uploadFileToS3 = async (file: Express.Multer.File, quotationId: string, docType: string) => {
  const bucket = process.env.AWS_BUCKET_NAME;
  if (!bucket) throw new Error('AWS_BUCKET_NAME is not configured');
  const ext = path.extname(file.originalname || '');
  const key = `quotation-workflow/${quotationId}/${docType}-${Date.now()}-${Math.round(Math.random() * 1e8)}${ext}`;
  await getS3Client().putObject({
    Bucket: bucket,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype
  }).promise();
  return buildS3Url(key);
};

const groupDocsByType = (docs: any[]) => {
  const grouped: Record<string, any[]> = {};
  for (const doc of docs || []) {
    const key = doc.docType || 'other';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(doc);
  }
  return grouped;
};

const mapWorkflowDocumentsForFrontend = (docs: any[]) => {
  const grouped = groupDocsByType(docs);
  return {
    ...grouped,
    siteCompletionImages: grouped.site_completion_image || [],
    installerPo: grouped.installer_po || [],
    installerPi: grouped.installer_pi || [],
    additionalExpense: grouped.additional_expense || [],
    warrantyDocs: grouped.warranty_doc || [],
    meterDocs: grouped.meter_doc || []
  };
};

const getLatestMeterDocMeta = (docs: any[]): { url: string | null; name: string | null } => {
  const meterDocs = (docs || []).filter((doc: any) => doc?.docType === 'meter_doc');
  if (meterDocs.length === 0) return { url: null, name: null };

  const sorted = [...meterDocs].sort((a: any, b: any) => {
    const ta = new Date(a.uploadedAt || a.createdAt || 0).getTime();
    const tb = new Date(b.uploadedAt || b.createdAt || 0).getTime();
    return tb - ta;
  });

  const latest = sorted[0];
  const metadata = latest?.metadata || {};
  const originalName =
    (typeof metadata.originalName === 'string' && metadata.originalName.trim()) ||
    (typeof metadata.original_name === 'string' && metadata.original_name.trim()) ||
    null;

  return {
    url: typeof latest?.fileUrl === 'string' && latest.fileUrl.trim() ? latest.fileUrl : null,
    name: originalName
  };
};

const MCO_DOC_FIELDS = [
  'workCompleteReportImage',
  'meterInstalledPhoto',
  'completeDcrReportImage'
] as const;

const getLatestMcoDocMeta = (docs: any[]) => {
  const latestByField: Record<string, any> = {};
  for (const field of MCO_DOC_FIELDS) {
    const matching = (docs || [])
      .filter((doc: any) => doc?.metadata?.mcoField === field && typeof doc?.fileUrl === 'string')
      .sort((a: any, b: any) => {
        const ta = new Date(a.uploadedAt || a.createdAt || 0).getTime();
        const tb = new Date(b.uploadedAt || b.createdAt || 0).getTime();
        return tb - ta;
      });
    latestByField[field] = matching[0] || null;
  }

  const readName = (doc: any): string | null => {
    const metadata = doc?.metadata || {};
    return (
      (typeof metadata.originalName === 'string' && metadata.originalName.trim()) ||
      (typeof metadata.original_name === 'string' && metadata.original_name.trim()) ||
      null
    );
  };

  return {
    workCompleteReportImageUrl: latestByField.workCompleteReportImage?.fileUrl || null,
    meterInstalledPhotoUrl: latestByField.meterInstalledPhoto?.fileUrl || null,
    completeDcrReportImageUrl: latestByField.completeDcrReportImage?.fileUrl || null,
    workCompleteReportImageName: readName(latestByField.workCompleteReportImage),
    meterInstalledPhotoName: readName(latestByField.meterInstalledPhoto),
    completeDcrReportImageName: readName(latestByField.completeDcrReportImage)
  };
};

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
    dcdb: products.dcdb || null
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
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;
    const status = (req.query.status as string) || targetStatus;
    const sortBy = (req.query.sortBy as string) || 'createdAt';
    const sortOrder = ((req.query.sortOrder as string) || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const search = (req.query.search as string | undefined)?.trim();

    const requestedStatuses = status
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const releaseOrStatuses = extraWhere.installationReadyForInstaller === true;
    const where: any = {};
    const installationStatusFilter =
      requestedStatuses.length > 1
        ? { [Op.in]: requestedStatuses }
        : requestedStatuses[0] || targetStatus;

    if (releaseOrStatuses) {
      // Operational visibility contract: released records OR records already in operational stages.
      where[Op.or] = [
        { installationReadyForInstaller: true },
        { installationStatus: installationStatusFilter }
      ];
    } else {
      where.installationStatus = installationStatusFilter;
    }

    const sanitizedExtraWhere = { ...extraWhere };
    delete (sanitizedExtraWhere as any).installationReadyForInstaller;
    Object.assign(where, sanitizedExtraWhere);
    if (search) {
      where[Op.or] = [
        { id: { [Op.iLike]: `%${search}%` } },
        { '$customer.firstName$': { [Op.iLike]: `%${search}%` } },
        { '$customer.lastName$': { [Op.iLike]: `%${search}%` } },
        { '$customer.mobile$': { [Op.iLike]: `%${search}%` } }
      ];
    }

    const allowedSortFields = new Set(['createdAt', 'approvedAt', 'installerApprovedAt', 'updatedAt']);
    const orderByField = allowedSortFields.has(sortBy) ? sortBy : 'createdAt';
    const quotations = await Quotation.findAndCountAll({
      where,
      include: [
        { model: Dealer, as: 'dealer', attributes: ['id', 'firstName', 'lastName', 'email', 'mobile'] },
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'firstName', 'lastName', 'mobile', 'email', 'streetAddress', 'city', 'state', 'pincode']
        },
        { model: QuotationProduct, as: 'products', required: false },
        { model: CustomPanel, as: 'customPanels', required: false },
        { model: QuotationInstallationDoc, as: 'installationDocs', required: false },
        {
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
        }
      ],
      subQuery: false,
      distinct: true,
      order: [[orderByField, sortOrder]],
      limit,
      offset
    });

    res.json({
      success: true,
      data: {
        quotations: quotations.rows.map((q: any) => {
          const rawVisits = Array.isArray(q.visits) ? q.visits : [];
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
          const rawInstallationDocs = (q.installationDocs || []).map((doc: any) =>
            (typeof doc.toJSON === 'function' ? doc.toJSON() : doc)
          );
          const latestMeterDoc = getLatestMeterDocMeta(rawInstallationDocs);
          const latestMcoDocs = getLatestMcoDocMeta(rawInstallationDocs);
          const meterDocumentImageUrl = q.meterDocumentImageUrl || latestMeterDoc.url || null;
          return {
            id: q.id,
            status: q.status,
            installationStatus: q.installationStatus,
            installation_status: q.installationStatus,
            installationReadyForInstaller: Boolean(q.installationReadyForInstaller),
            installation_ready_for_installer: Boolean(q.installationReadyForInstaller),
            installationReleasedAt: q.installationReleasedAt || null,
            installationScheduledAt: toDateOnlyStringOrNull(q.installationScheduledAt ?? (q as any).installation_scheduled_at),
            installation_scheduled_at: toDateOnlyStringOrNull(q.installationScheduledAt ?? (q as any).installation_scheduled_at),
            meteringId: q.meteringId || null,
            meteringActionAt: q.meteringActionAt || null,
            meteringApprovedAt: q.meteringApprovedAt || null,
            meteringRemarks: q.meteringRemarks || null,
            meteringStatus: q.installationStatus || null,
            metering_status: q.installationStatus || null,
            meteringStage: q.installationStatus || null,
            mcoStatus: q.installationStatus === 'mco' ? 'mco' : null,
            mco_status: q.installationStatus === 'mco' ? 'mco' : null,
            mcoAt: q.mcoAt || null,
            completionAt: q.completionAt || null,
            discomName: q.discomName || null,
            meterType: q.meterType || null,
            meterNo: q.meterNo || null,
            solarMeterNo: q.solarMeterNo || null,
            netMeterNo: q.netMeterNo || null,
            meterDocumentImageUrl,
            meterDocumentUrl: meterDocumentImageUrl,
            meter_document_url: meterDocumentImageUrl,
            meterDocumentName: latestMeterDoc.name,
            meter_document_name: latestMeterDoc.name,
            workCompleteReportImageUrl: latestMcoDocs.workCompleteReportImageUrl,
            work_complete_report_image_url: latestMcoDocs.workCompleteReportImageUrl,
            meterInstalledPhotoUrl: latestMcoDocs.meterInstalledPhotoUrl,
            meter_installed_photo_url: latestMcoDocs.meterInstalledPhotoUrl,
            completeDcrReportImageUrl: latestMcoDocs.completeDcrReportImageUrl,
            complete_dcr_report_image_url: latestMcoDocs.completeDcrReportImageUrl,
            workCompleteReportImageName: latestMcoDocs.workCompleteReportImageName,
            work_complete_report_image_name: latestMcoDocs.workCompleteReportImageName,
            meterInstalledPhotoName: latestMcoDocs.meterInstalledPhotoName,
            meter_installed_photo_name: latestMcoDocs.meterInstalledPhotoName,
            completeDcrReportImageName: latestMcoDocs.completeDcrReportImageName,
            complete_dcr_report_image_name: latestMcoDocs.completeDcrReportImageName,
            dealer: q.dealer
              ? {
                id: q.dealer.id,
                firstName: q.dealer.firstName || null,
                lastName: q.dealer.lastName || null,
                mobile: q.dealer.mobile || null,
                email: q.dealer.email || null
              }
              : null,
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
            documents: mapWorkflowDocumentsForFrontend(rawInstallationDocs),
            createdAt: q.createdAt,
            validUntil: q.validUntil
          };
        }),
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
    status: 'approved',
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
    approved: 'metering_approved',
    mco: 'mco'
  };
  if (aliasMap[status]) {
    req.query.status = aliasMap[status] as any;
  }
  await getWorkflowQueue(req, res, 'pending_metering,metering_in_progress,metering_approved,mco', {
    status: 'approved',
    installationReadyForInstaller: true
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

    const current = quotation.installationStatus || '';
    const valid: Record<string, string[]> = {
      // Fallback compatibility: when queue includes pre-metering records,
      // allow metering to move via start -> approve (or direct approve).
      start: ['pending_metering', 'pending_installer', 'installer_in_progress'],
      approve: ['metering_in_progress', 'pending_metering', 'pending_installer', 'installer_in_progress'],
      send_to_mco: ['metering_approved'],
      mark_completed: ['mco', 'metering_approved'],
      move_back: ['metering_in_progress', 'metering_approved', 'mco']
    };

    const patch: Record<string, unknown> = {
      meteringId: req.user?.id || quotation.meteringId || null,
      meteringActionAt: new Date(),
      meteringRemarks: (remarks as string | undefined) || null
    };

    if (action) {
      if (!valid[action] || !valid[action].includes(current)) {
        res.status(409).json({ success: false, error: { code: 'WF_003', message: 'Metering action not allowed for current stage' } });
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
      }
      if (action === 'send_to_mco') {
        patch.installationStatus = 'mco';
        patch.mcoAt = new Date();
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
        patch.installationStatus = current === 'mco' ? 'metering_approved' : 'pending_metering';
      }
    } else {
      // Direct body fallback: { installationStatus, meteringStatus, status } — same rules as approve / send_to_mco.
      const rawTarget =
        parseTrimmedString(body.installationStatus) ||
        parseTrimmedString(body.installation_status) ||
        parseTrimmedString(body.meteringStatus) ||
        parseTrimmedString(body.status);
      const target = (rawTarget || '').toLowerCase();

      if (!['metering_approved', 'mco'].includes(target)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Direct status must be metering_approved or mco when action is omitted',
            details: [{ field: 'installationStatus', message: 'Use action enum, or installationStatus/meteringStatus = metering_approved | mco' }]
          }
        });
        return;
      }

      if (target === 'metering_approved') {
        if (!valid.approve.includes(current)) {
          res.status(409).json({ success: false, error: { code: 'WF_003', message: 'Metering action not allowed for current stage' } });
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
      } else if (target === 'mco') {
        if (!valid.send_to_mco.includes(current)) {
          res.status(409).json({ success: false, error: { code: 'WF_003', message: 'Metering action not allowed for current stage' } });
          return;
        }
        patch.installationStatus = 'mco';
        patch.mcoAt = new Date();
      }
    }

    await quotation.update(patch as any);
    await quotation.reload();

    const inst = quotation.installationStatus || null;
    res.json({
      success: true,
      data: {
        id: quotation.id,
        installationStatus: inst,
        installation_status: inst,
        meteringStatus: inst,
        meteringStage: inst,
        meteringId: quotation.meteringId || null,
        meteringActionAt: quotation.meteringActionAt || null,
        meteringApprovedAt: quotation.meteringApprovedAt || null,
        meteringRemarks: quotation.meteringRemarks || null,
        mcoAt: quotation.mcoAt || null,
        completionAt: quotation.completionAt || null,
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

const INSTALLER_UPLOAD_ALLOWED_STATUSES = new Set([
  'pending_installer',
  'installer_in_progress',
  'installer_approved'
]);

const parseTrimmedString = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
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
      'installer_approved',
      'pending_baldev',
      'baldev_approved',
      'pending_metering',
      'metering_in_progress',
      'metering_approved',
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

    const files = flattenMulterFiles(req).filter((f) => f.fieldname === 'meterDocumentImage');
    let meterDocumentImageUrl = quotation.meterDocumentImageUrl || null;
    let meterDocumentName: string | null = null;

    if (files.length > 0) {
      const file = files[0];
      meterDocumentImageUrl = await uploadFileToS3(file, quotationId, 'meter_doc');
      meterDocumentName = file.originalname || null;
      await QuotationInstallationDoc.create({
        id: uuidv4(),
        quotationId,
        docType: 'meter_doc',
        fileUrl: meterDocumentImageUrl,
        uploadedByUserId: req.user?.id || 'unknown',
        uploadedByRole: req.user?.role || 'unknown',
        remarks: parseTrimmedString(body.remarks) || 'metering_detail_upload',
        metadata: {
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          field: file.fieldname
        },
        uploadedAt: new Date()
      });
    }

    await quotation.update({
      discomName: parseTrimmedString(body.discomName) ?? quotation.discomName,
      meterType: meterType ?? quotation.meterType,
      meterNo: meterNo ?? quotation.meterNo,
      solarMeterNo: solarMeterNo ?? quotation.solarMeterNo,
      netMeterNo: netMeterNo ?? quotation.netMeterNo,
      meterDocumentImageUrl
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

    res.json({
      success: true,
      data: {
        id: quotation.id,
        quotationId: quotation.id,
        installationStatus: quotation.installationStatus,
        discomName: quotation.discomName || null,
        meterType: quotation.meterType || null,
        meterNo: quotation.meterNo || null,
        solarMeterNo: quotation.solarMeterNo || null,
        netMeterNo: quotation.netMeterNo || null,
        meterDocumentImageUrl: quotation.meterDocumentImageUrl || null,
        meterDocumentUrl: quotation.meterDocumentImageUrl || null,
        meter_document_url: quotation.meterDocumentImageUrl || null,
        meterDocumentName,
        meter_document_name: meterDocumentName,
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
    const latestMcoDocs = getLatestMcoDocMeta(docs.map((d) => (typeof (d as any).toJSON === 'function' ? (d as any).toJSON() : d)));

    res.json({
      success: true,
      data: {
        id: quotation.id,
        quotationId: quotation.id,
        workCompleteReportImageUrl: latestMcoDocs.workCompleteReportImageUrl,
        work_complete_report_image_url: latestMcoDocs.workCompleteReportImageUrl,
        meterInstalledPhotoUrl: latestMcoDocs.meterInstalledPhotoUrl,
        meter_installed_photo_url: latestMcoDocs.meterInstalledPhotoUrl,
        completeDcrReportImageUrl: latestMcoDocs.completeDcrReportImageUrl,
        complete_dcr_report_image_url: latestMcoDocs.completeDcrReportImageUrl,
        workCompleteReportImageName: latestMcoDocs.workCompleteReportImageName,
        work_complete_report_image_name: latestMcoDocs.workCompleteReportImageName,
        meterInstalledPhotoName: latestMcoDocs.meterInstalledPhotoName,
        meter_installed_photo_name: latestMcoDocs.meterInstalledPhotoName,
        completeDcrReportImageName: latestMcoDocs.completeDcrReportImageName,
        complete_dcr_report_image_name: latestMcoDocs.completeDcrReportImageName,
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

    if (!INSTALLER_UPLOAD_ALLOWED_STATUSES.has(quotation.installationStatus || '')) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Installation upload not allowed for this quotation state' }
      });
      return;
    }

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

    const files = flattenMulterFiles(req);
    if (files.length === 0 && !siteSignal && !extraParsed) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_002', message: 'Provide at least one file, site dimensions, or extra expenses' }
      });
      return;
    }

    const seenHashes = new Set<string>();
    const createdDocs: any[] = [];

    for (const file of files) {
      const map = INSTALLER_FIELD_DOC_MAP[file.fieldname];
      if (!map) {
        continue;
      }
      let docType = map.docType;
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
        field: file.fieldname
      };
      if (map.slot) {
        metadata.slot = map.slot;
      }
      const doc = await QuotationInstallationDoc.create({
        id: uuidv4(),
        quotationId,
        docType: docType as any,
        fileUrl,
        uploadedByUserId: req.user?.id || 'unknown',
        uploadedByRole: req.user?.role || 'unknown',
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

    const markInstallerApproved = parseTrimmedString(body.installationStatus) === 'installer_approved';
    if (markInstallerApproved) {
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
      await quotation.update({
        installationStatus: 'pending_baldev',
        installerId: req.user?.id || quotation.installerId,
        installerActionAt: new Date(),
        installerApprovedAt: new Date(),
        installerRemarks: rem || quotation.installerRemarks || null
      });
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

    res.status(createdDocs.length > 0 ? 201 : 200).json({
      success: true,
      data: {
        quotationId,
        id: quotation.id,
        installationStatus: quotation.installationStatus,
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
        documents: mapWorkflowDocumentsForFrontend(allDocs.map((doc: any) => (typeof doc.toJSON === 'function' ? doc.toJSON() : doc)))
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
        documents: mapWorkflowDocumentsForFrontend(allDocs.map((doc: any) => (typeof doc.toJSON === 'function' ? doc.toJSON() : doc)))
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
        documents: mapWorkflowDocumentsForFrontend(docs.map((d: any) => d.toJSON()))
      }
    });
  } catch (error) {
    logError('Get workflow history error', error, { quotationId: req.params.quotationId });
    res.status(500).json({ success: false, error: { code: 'SYS_001', message: 'Internal server error' } });
  }
};
