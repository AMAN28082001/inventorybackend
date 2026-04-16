import { Request, Response } from 'express';
import AWS from 'aws-sdk';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';
import { Quotation, QuotationInstallationDoc, Dealer, Customer, QuotationProduct } from '../models/index-quotation';
import { logError, logInfo } from '../utils/loggerHelper';

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
    additionalExpense: grouped.additional_expense || [],
    warrantyDocs: grouped.warranty_doc || [],
    meterDocs: grouped.meter_doc || []
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
    const where: any = requestedStatuses.length > 1
      ? { installationStatus: { [Op.in]: requestedStatuses } }
      : { installationStatus: requestedStatuses[0] || targetStatus };
    Object.assign(where, extraWhere);
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
        { model: Customer, as: 'customer', attributes: ['id', 'firstName', 'lastName', 'mobile'] },
        { model: QuotationProduct, as: 'products', required: false },
        { model: QuotationInstallationDoc, as: 'installationDocs', required: false }
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
        quotations: quotations.rows.map((q: any) => ({
          id: q.id,
          status: q.status,
          installationStatus: q.installationStatus,
          installationReadyForInstaller: Boolean(q.installationReadyForInstaller),
          installationReleasedAt: q.installationReleasedAt || null,
          dealer: q.dealer || null,
          customer: q.customer || null,
          products: q.products || null,
          pricing: {
            subtotal: Number(q.subtotal || 0),
            totalAmount: Number(q.totalAmount || 0),
            finalAmount: Number(q.finalAmount || 0)
          },
          approvedAt: q.approvedAt || null,
          installerApprovedAt: q.installerApprovedAt || null,
          documents: mapWorkflowDocumentsForFrontend((q.installationDocs || []).map((doc: any) => (typeof doc.toJSON === 'function' ? doc.toJSON() : doc))),
          createdAt: q.createdAt,
          validUntil: q.validUntil
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
  await getWorkflowQueue(req, res, 'pending_installer', {
    status: 'approved',
    installationReadyForInstaller: true
  });
};

export const getBaldevQueue = async (req: Request, res: Response): Promise<void> => {
  // Include handoff-ready records while keeping explicit status filter support.
  // `?status=pending_baldev` will still return only pending_baldev items.
  await getWorkflowQueue(req, res, 'pending_baldev,installer_approved');
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

      const shouldCompleteNow = markCompleted === true || quotation.installationStatus === 'baldev_approved';
      await quotation.update({
        installationStatus: shouldCompleteNow ? 'completed' : 'baldev_approved',
        baldevId: req.user?.id || null,
        baldevActionAt: new Date(),
        baldevRemarks: remarks || null,
        completionAt: shouldCompleteNow ? new Date() : quotation.completionAt
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

    const allFiles = (req as any).files as Express.Multer.File[] | undefined;
    const files = Array.isArray(allFiles)
      ? allFiles.filter((file) => ['files', 'installerCompletionImages'].includes(file.fieldname))
      : [];
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

export const installerUploadDocuments = async (req: Request, res: Response): Promise<void> => {
  await saveDocs(req, res, ['installer_po', 'additional_expense', 'site_completion_image']);
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
      quotation.completionAt
        ? {
            event: 'completed',
            at: quotation.completionAt,
            actorId: quotation.baldevId,
            actorRole: 'baldev',
            remarks: quotation.baldevRemarks || null
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
