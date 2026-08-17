import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';
import { Visit, VisitAssignment, Quotation, Visitor, Customer, Dealer } from '../models/index-quotation';
import {
  applyVisitListNoCacheHeaders,
  formatAdminVisitReportListRow,
  formatAdminVisitReportRow,
  formatVisitCompletionPayload,
  getVisitStatusDbVariants,
  normalizeVisitStatusQuery,
  visitMatchesAdminSearch
} from '../utils/visitApiFormat';
import { logError, logInfo } from '../utils/loggerHelper';
import {
  extractS3Key,
  persistableMediaReference,
  resolveBrowsableMediaUrl,
  resolveBrowsableMediaUrls,
  uploadFileToS3FromBuffer
} from '../utils/s3Service';
import { getInstallationTeamIdFromRequest, isInstallationTeamJwtRole } from '../utils/installationTeamRole';
import {
  assignmentVisitorIdsForRequest,
  ensureVisitorRowForAssignment,
  findAssignableVisitor
} from '../utils/assignableVisitors';
import { hasAdminPanelAccess } from '../utils/userAccess';

const timeRangeRegex = /^([01]\d|2[0-3]):([0-5]\d)\s-\s([01]\d|2[0-3]):([0-5]\d)$/;
const hhmmRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const getVisitTimeFields = (visitTimeValue: unknown) => {
  const visitTime = typeof visitTimeValue === 'string' ? visitTimeValue : '';
  if (timeRangeRegex.test(visitTime)) {
    const [visitStartTime, visitEndTime] = visitTime.split(' - ');
    return {
      visitTime,
      visitStartTime,
      visitEndTime,
      visitTimeRange: visitTime
    };
  }
  if (hhmmRegex.test(visitTime)) {
    return {
      visitTime,
      visitStartTime: visitTime,
      visitEndTime: null,
      visitTimeRange: null
    };
  }
  return {
    visitTime,
    visitStartTime: null,
    visitEndTime: null,
    visitTimeRange: null
  };
};

const parseExistingImages = (raw: unknown): string[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v).trim()).filter(Boolean);
      }
    } catch {
      return raw.split(',').map((v) => v.trim()).filter(Boolean);
    }
  }
  return [];
};

const normalizeVisitMediaUrl = (value: unknown): string | null => persistableMediaReference(value);

const normalizeVisitMediaUrls = (raw: unknown): string[] =>
  dedupeMediaUrls(parseExistingImages(raw).map((v) => normalizeVisitMediaUrl(v)).filter((v): v is string => !!v));

const mediaRefFromUploadedFile = (file?: Express.Multer.File): string | null => {
  if (!file) return null;
  const key = (file as Express.Multer.File & { s3Key?: string }).s3Key;
  if (typeof key === 'string' && key.trim()) return key.trim();
  return persistableMediaReference((file as Express.Multer.File & { s3Location?: string }).s3Location);
};

const resolveMediaUrl = resolveBrowsableMediaUrl;
const resolveMediaUrls = resolveBrowsableMediaUrls;

const toOptionalFiniteNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeMediaIdentity = (url: string): string => {
  const key = extractS3Key(url);
  if (!key) return url.trim();
  const filePart = key.split('/').pop() || key;
  // uploadFileToS3FromBuffer prefixes keys with "<timestamp>_<filename>".
  return filePart.replace(/^\d+_/, '').trim();
};

const dedupeMediaUrls = (urls: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const url = String(raw || '').trim();
    if (!url) continue;
    const identity = normalizeMediaIdentity(url);
    if (seen.has(identity)) continue;
    seen.add(identity);
    out.push(url);
  }
  return out;
};

const mapVisitDetailPayload = async (visit: Visit): Promise<Record<string, unknown>> => {
  const vAny = visit as any;
  const assignments = vAny.assignments || [];
  const resolvedImages = await resolveMediaUrls(visit.images);
  const resolvedRowDiagramImage = await resolveMediaUrl((visit as any).rowDiagramImage);
  const resolvedMeterImage = await resolveMediaUrl(
    (visit as any).meterImage || (Array.isArray(resolvedImages) ? resolvedImages[0] : null)
  );

  const visitors = assignments.map((a: any) => {
    const visitor = a.visitor;
    if (visitor) {
      return {
        visitorId: visitor.id,
        username: visitor.username,
        firstName: visitor.firstName,
        lastName: visitor.lastName,
        fullName: `${visitor.firstName} ${visitor.lastName}`,
        email: visitor.email,
        mobile: visitor.mobile,
        employeeId: visitor.employeeId,
        isActive: visitor.isActive
      };
    }
    return {
      visitorId: a.visitorId,
      visitorName: a.visitorName,
      fullName: a.visitorName
    };
  });

  const backLegFeet = (visit as any).backLegFeet != null ? Number((visit as any).backLegFeet) : null;
  const midLegFeet = (visit as any).midLegFeet != null ? Number((visit as any).midLegFeet) : null;
  const frontLegFeet = (visit as any).frontLegFeet != null ? Number((visit as any).frontLegFeet) : null;
  const len = visit.length != null ? Number(visit.length) : null;
  const wid = visit.width != null ? Number(visit.width) : null;
  const hgt = visit.height != null ? Number(visit.height) : null;

  return {
    id: visit.id,
    visitDate: visit.visitDate,
    ...getVisitTimeFields(visit.visitTime),
    location: visit.location,
    locationLink: visit.locationLink,
    notes: visit.notes,
    status: visit.status,
    length: len,
    width: wid,
    height: hgt,
    images: resolvedImages,
    site_images: resolvedImages,
    feedback: visit.feedback,
    unit: (visit as any).unit || null,
    backLegFeet,
    midLegFeet,
    frontLegFeet,
    back_leg_feet: backLegFeet,
    mid_leg_feet: midLegFeet,
    front_leg_feet: frontLegFeet,
    siteDimensions: {
      siteLength: len,
      siteWidth: wid,
      siteHeight: hgt,
      backLegFeet,
      midLegFeet,
      frontLegFeet
    },
    rowDiagramImage: resolvedRowDiagramImage,
    row_diagram_image: resolvedRowDiagramImage,
    meterImage: resolvedMeterImage,
    meter_image: resolvedMeterImage,
    rejectionReason: visit.rejectionReason,
    visitors,
    otherVisitors: visitors,
    assignedVisitors: visitors,
    createdAt: visit.createdAt,
    updatedAt: visit.updatedAt
  };
};

const findActorAssignment = (assignments: any[] | undefined, req: Request) => {
  const ids = new Set(assignmentVisitorIdsForRequest(req));
  return (assignments || []).find((a: any) => ids.has(String(a.visitorId || '')));
};

const getAssignedVisitForVisitor = async (
  visitId: string,
  req: Request,
  res: Response
): Promise<Visit | null> => {
  const visit = await Visit.findByPk(visitId, {
    include: [{ model: VisitAssignment, as: 'assignments' }]
  });

  if (!visit) {
    res.status(404).json({
      success: false,
      error: { code: 'RES_001', message: 'Visit not found' }
    });
    return null;
  }

  const visitAny = visit as any;
  const assignment = findActorAssignment(visitAny.assignments, req);
  if (!assignment) {
    res.status(403).json({
      success: false,
      error: { code: 'AUTH_004', message: 'You are not assigned to this visit' }
    });
    return null;
  }

  return visit;
};

export const uploadVisitMedia = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.visitor) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { visitId } = req.params;
    const visit = await getAssignedVisitForVisitor(visitId, req, res);
    if (!visit) return;

    const fieldName = typeof req.body?.field === 'string' ? req.body.field.trim() : '';
    const file = req.file as Express.Multer.File | undefined;
    const allowedFields = new Set(['images', 'rowDiagramImage', 'meterImage']);

    if (!fieldName || !allowedFields.has(fieldName)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'field must be one of images, rowDiagramImage, meterImage',
          details: [{ field: 'field', message: 'Invalid visit media field' }]
        }
      });
      return;
    }

    if (!file?.buffer) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'file is required',
          details: [{ field: 'file', message: 'file is required' }]
        }
      });
      return;
    }

    const key = await uploadFileToS3FromBuffer(file.buffer, file.originalname, 'visits');
    const storedValue = key;
    const usableUrl = (await resolveBrowsableMediaUrl(key)) || key;
    const urlKey = `${fieldName}Url`;

    logInfo('Visit media uploaded', { visitId: visit.id, field: fieldName, visitorId: req.visitor.id });
    res.status(200).json({
      success: true,
      data: {
        field: fieldName,
        url: usableUrl,
        fileUrl: usableUrl,
        storedValue,
        [urlKey]: usableUrl
      }
    });
  } catch (error) {
    logError('Upload visit media error', error, { visitId: req.params.visitId, field: req.body?.field });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Create visit
const parseVisitorIdFromBody = (body: Record<string, unknown>): string => {
  const direct = String(body.visitorId || body.visitor_id || '').trim();
  if (direct) return direct;
  const visitors = body.visitors;
  if (Array.isArray(visitors) && visitors[0] && typeof visitors[0] === 'object') {
    const first = visitors[0] as Record<string, unknown>;
    return String(first.visitorId || first.visitor_id || first.id || '').trim();
  }
  return '';
};

const canManageVisitQuotation = (req: Request, quotation: { dealerId?: string } | null): boolean => {
  if (!quotation) return false;
  if (hasAdminPanelAccess(req) || req.dealer?.role === 'admin') return true;
  if (req.dealer?.id && String(req.dealer.id) === String(quotation.dealerId)) return true;
  return false;
};

const formatVisitVisitors = (assignments: any[]) =>
  (assignments || []).map((a: any) => {
    const visitor = a.visitor;
    if (visitor) {
      return {
        visitorId: visitor.id,
        id: visitor.id,
        username: visitor.username,
        firstName: visitor.firstName,
        lastName: visitor.lastName,
        fullName: `${visitor.firstName} ${visitor.lastName}`.trim(),
        visitorName: `${visitor.firstName} ${visitor.lastName}`.trim(),
        email: visitor.email,
        mobile: visitor.mobile,
        employeeId: visitor.employeeId,
        isActive: visitor.isActive
      };
    }
    return {
      visitorId: a.visitorId,
      id: a.visitorId,
      visitorName: a.visitorName,
      fullName: a.visitorName
    };
  });

const loadVisitWithAssignments = (visitId: string) =>
  Visit.findByPk(visitId, {
    include: [
      {
        model: VisitAssignment,
        as: 'assignments',
        include: [
          {
            model: Visitor,
            as: 'visitor',
            required: false,
            attributes: ['id', 'username', 'firstName', 'lastName', 'email', 'mobile', 'employeeId', 'isActive']
          }
        ]
      }
    ]
  });

export const createVisit = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { quotationId, visitDate, visitTime, location, locationLink, notes, visitors } = req.body;
    const visitorId = parseVisitorIdFromBody(req.body || {});
    if (!visitorId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Exactly one visitor is required',
          details: [{ field: 'visitors', message: 'Provide visitors: [{ visitorId }]' }]
        }
      });
      return;
    }

    const assignable = await findAssignableVisitor(visitorId);
    if (!assignable) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Visitor is not assignable (inactive or missing Visitor access)',
          details: [{ field: 'visitorId', message: 'Visitor is not assignable' }]
        }
      });
      return;
    }

    const quotationWhere: Record<string, unknown> = { id: quotationId };
    if (req.dealer.role !== 'admin' && !hasAdminPanelAccess(req)) {
      quotationWhere.dealerId = req.dealer.id;
    }
    const quotation = await Quotation.findOne({ where: quotationWhere });

    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    const ensured = await ensureVisitorRowForAssignment(assignable);

    const visit = await Visit.create({
      id: uuidv4(),
      quotationId,
      dealerId: quotation.dealerId,
      visitDate,
      visitTime,
      location,
      locationLink: locationLink || null, // Allow null if not provided
      notes: notes || null,
      status: 'pending'
    });

    await VisitAssignment.create({
      id: uuidv4(),
      visitId: visit.id,
      visitorId: ensured.id,
      visitorName: assignable.fullName || ensured.fullName
    });

    const visitWithAssignments = await loadVisitWithAssignments(visit.id);

    logInfo('Visit created', { visitId: visit.id, quotationId, dealerId: quotation.dealerId });

    const visitAny = visitWithAssignments as any;
    const formattedVisitors = formatVisitVisitors(visitAny?.assignments || []);

    const visitData = visitAny?.toJSON ? visitAny.toJSON() : { id: visit.id };
    delete visitData.assignments;
    const visitTimeFields = getVisitTimeFields(visitData.visitTime);

    res.status(201).json({
      success: true,
      data: {
        ...visitData,
        ...visitTimeFields,
        visitors: formattedVisitors
      }
    });
  } catch (error) {
    logError('Create visit error', error, { dealerId: req.dealer?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const transferVisit = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer && !hasAdminPanelAccess(req)) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { visitId } = req.params;
    const visitorId = parseVisitorIdFromBody(req.body || {});
    const reason = String((req.body || {}).reason || '').trim();

    if (!visitorId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'visitorId is required',
          details: [{ field: 'visitorId', message: 'visitorId is required' }]
        }
      });
      return;
    }

    const visit = await Visit.findByPk(visitId);
    if (!visit) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Visit not found' }
      });
      return;
    }

    const quotation = await Quotation.findByPk(visit.quotationId);
    if (!canManageVisitQuotation(req, quotation)) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const assignable = await findAssignableVisitor(visitorId);
    if (!assignable) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Visitor is not assignable (inactive or missing Visitor access)',
          details: [{ field: 'visitorId', message: 'Visitor is not assignable' }]
        }
      });
      return;
    }

    const ensured = await ensureVisitorRowForAssignment(assignable);
    const current = await VisitAssignment.findAll({ where: { visitId: visit.id } });
    if (
      current.length === 1 &&
      (current[0].visitorId === visitorId || current[0].visitorId === ensured.id)
    ) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Visitor is already assigned to this visit',
          details: [{ field: 'visitorId', message: 'Same as current assignee' }]
        }
      });
      return;
    }

    await VisitAssignment.destroy({ where: { visitId: visit.id } });
    await VisitAssignment.create({
      id: uuidv4(),
      visitId: visit.id,
      visitorId: ensured.id,
      visitorName: assignable.fullName || ensured.fullName
    });

    if (reason) {
      const noteLine = `Transferred: ${reason}`;
      const nextNotes = visit.notes ? `${visit.notes}\n${noteLine}` : noteLine;
      await visit.update({ notes: nextNotes });
    }

    const visitWithAssignments = await loadVisitWithAssignments(visit.id);
    const visitAny = visitWithAssignments as any;
    const formattedVisitors = formatVisitVisitors(visitAny?.assignments || []);
    const visitData = visitAny?.toJSON ? visitAny.toJSON() : { id: visit.id };
    delete visitData.assignments;

    logInfo('Visit transferred', {
      visitId: visit.id,
      visitorId: ensured.id,
      dealerId: req.dealer?.id
    });

    res.json({
      success: true,
      data: {
        ...visitData,
        ...getVisitTimeFields(visitData.visitTime),
        visitors: formattedVisitors
      }
    });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === 'VAL_001') {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: (error as Error).message }
      });
      return;
    }
    logError('Transfer visit error', error, { visitId: req.params.visitId, dealerId: req.dealer?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

const isAdminVisitorReportsActor = (req: Request): boolean => {
  const isQuotationAdmin = Boolean(req.dealer && req.dealer.role === 'admin');
  const role = req.user?.role;
  const isInventoryAdmin =
    role === 'admin' || role === 'super-admin' || role === 'super-admin-manager';
  return isQuotationAdmin || isInventoryAdmin;
};

/** GET /api/admin/visits — all visits for Admin Visitor Reports (admin only). */
export const getAdminVisits = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isAdminVisitorReportsActor(req)) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions. Admin access required.' }
      });
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 2000);
    const offset = (page - 1) * limit;
    const statusQuery = normalizeVisitStatusQuery(req.query.status as string);
    const visitorId = String(req.query.visitorId || '').trim() || undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const search = String(req.query.search || '').trim();

    const where: any = {};
    if (statusQuery !== 'all') {
      where.status = { [Op.in]: getVisitStatusDbVariants(statusQuery) };
    }
    if (startDate || endDate) {
      where.visitDate = {};
      if (startDate) where.visitDate[Op.gte] = startDate;
      if (endDate) where.visitDate[Op.lte] = endDate;
    }
    if (visitorId) {
      const assigned = await VisitAssignment.findAll({
        where: { visitorId },
        attributes: ['visitId']
      });
      const visitIds = [...new Set(assigned.map((a) => a.visitId))];
      where.id = { [Op.in]: visitIds.length > 0 ? visitIds : ['__no_visits__'] };
    }

    const visits = await Visit.findAndCountAll({
      where,
      include: [
        {
          model: VisitAssignment,
          as: 'assignments',
          required: false,
          include: [
            {
              model: Visitor,
              as: 'visitor',
              required: false,
              attributes: ['id', 'firstName', 'lastName']
            }
          ]
        },
        {
          model: Quotation,
          as: 'quotation',
          required: false,
          attributes: ['id', 'systemType', 'finalAmount', 'dealerId'],
          include: [
            {
              model: Customer,
              as: 'customer',
              required: false,
              attributes: ['id', 'firstName', 'lastName', 'mobile']
            },
            {
              model: Dealer,
              as: 'dealer',
              required: false,
              attributes: ['id', 'firstName', 'lastName']
            }
          ]
        }
      ],
      limit: search ? undefined : limit,
      offset: search ? undefined : offset,
      order: [['visitDate', 'DESC'], ['visitTime', 'ASC']],
      distinct: true,
      subQuery: false
    });

    let rows = visits.rows;
    if (search) {
      rows = rows.filter((v) => visitMatchesAdminSearch(v, search));
    }
    const total = search ? rows.length : visits.count;
    const pagedRows = search ? rows.slice(offset, offset + limit) : rows;

    const includeMedia =
      String(req.query.includeMedia || req.query.include_media || '')
        .trim()
        .toLowerCase() === 'true';

    const formattedVisits = includeMedia
      ? await Promise.all(pagedRows.map((v) => formatAdminVisitReportRow(v as any)))
      : pagedRows.map((v) => formatAdminVisitReportListRow(v as any));

    applyVisitListNoCacheHeaders(res);
    res.json({
      success: true,
      data: {
        visits: formattedVisits,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    logError('Get admin visits error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Get all visits for dealer (visit schedule); quotation admin may load all visits (fallback for reports).
export const getAllVisits = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    if (isAdminVisitorReportsActor(req)) {
      await getAdminVisits(req, res);
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;
    const status = req.query.status as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const search = req.query.search as string;

    const where: any = { dealerId: req.dealer.id };

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.visitDate = {};
      if (startDate) where.visitDate[Op.gte] = new Date(startDate);
      if (endDate) where.visitDate[Op.lte] = new Date(endDate);
    }

    const visits = await Visit.findAndCountAll({
      where,
      include: [
        {
          model: VisitAssignment,
          as: 'assignments',
          required: false,
          include: [
            {
              model: Visitor,
              as: 'visitor',
              required: false,
              attributes: ['id', 'username', 'firstName', 'lastName', 'email', 'mobile', 'employeeId', 'isActive']
            }
          ]
        },
        {
          model: Quotation,
          as: 'quotation',
          include: [
            {
              model: Customer,
              as: 'customer',
              attributes: ['id', 'firstName', 'lastName', 'mobile', 'email']
            }
          ],
          attributes: ['id', 'systemType', 'finalAmount']
        }
      ],
      limit,
      offset,
      order: [['visitDate', 'ASC'], ['visitTime', 'ASC']]
    });

    // Filter by search if provided (search in customer name, location, quotation ID)
    let filteredVisits = visits.rows;
    if (search) {
      const searchLower = search.toLowerCase();
      filteredVisits = visits.rows.filter(v => {
        const vAny = v as any;
        const quotation = vAny.quotation;
        const customer = quotation?.customer;
        return (
          v.location.toLowerCase().includes(searchLower) ||
          quotation?.id?.toLowerCase().includes(searchLower) ||
          customer?.firstName?.toLowerCase().includes(searchLower) ||
          customer?.lastName?.toLowerCase().includes(searchLower) ||
          `${customer?.firstName} ${customer?.lastName}`.toLowerCase().includes(searchLower)
        );
      });
    }

    const formattedVisits = await Promise.all(filteredVisits.map(async (v) => {
      const vAny = v as any;
      const quotation = vAny.quotation;
      const customer = quotation?.customer;
      const assignments = vAny.assignments || [];
      const resolvedImages = await resolveMediaUrls(v.images);
      const resolvedRowDiagramImage = await resolveMediaUrl((v as any).rowDiagramImage);
      const resolvedMeterImage = await resolveMediaUrl(
        (v as any).meterImage || (Array.isArray(resolvedImages) ? resolvedImages[0] : null)
      );

      // Get full visitor details
      const visitors = assignments.map((a: any) => {
        const visitor = a.visitor;
        if (visitor) {
          return {
            visitorId: visitor.id,
            username: visitor.username,
            firstName: visitor.firstName,
            lastName: visitor.lastName,
            fullName: `${visitor.firstName} ${visitor.lastName}`,
            email: visitor.email,
            mobile: visitor.mobile,
            employeeId: visitor.employeeId,
            isActive: visitor.isActive
          };
        }
        // Fallback to assignment data if visitor not loaded
        return {
          visitorId: a.visitorId,
          visitorName: a.visitorName,
          fullName: a.visitorName
        };
      });

      return {
        id: v.id,
        quotation: quotation ? {
          id: quotation.id,
          systemType: quotation.systemType,
          finalAmount: Number(quotation.finalAmount)
        } : null,
        customer: customer ? {
          id: customer.id,
          firstName: customer.firstName,
          lastName: customer.lastName,
          fullName: `${customer.firstName} ${customer.lastName}`,
          mobile: customer.mobile,
          email: customer.email
        } : null,
        visitDate: v.visitDate,
        ...getVisitTimeFields(v.visitTime),
        location: v.location,
        locationLink: v.locationLink,
        notes: v.notes,
        status: v.status,
        length: v.length,
        width: v.width,
        height: v.height,
        images: resolvedImages,
        site_images: resolvedImages,
        feedback: v.feedback,
        unit: (v as any).unit || null,
        backLegFeet: (v as any).backLegFeet || null,
        midLegFeet: (v as any).midLegFeet || null,
        frontLegFeet: (v as any).frontLegFeet || null,
        rowDiagramImage: resolvedRowDiagramImage,
        row_diagram_image: resolvedRowDiagramImage,
        meterImage: resolvedMeterImage,
        meter_image: resolvedMeterImage,
        rejectionReason: v.rejectionReason,
        visitors: visitors,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt
      };
    }));

    res.json({
      success: true,
      data: {
        visits: formattedVisits,
        pagination: {
          page,
          limit,
          total: search ? filteredVisits.length : visits.count,
          totalPages: Math.ceil((search ? filteredVisits.length : visits.count) / limit),
          hasNext: page < Math.ceil((search ? filteredVisits.length : visits.count) / limit),
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    logError('Get all visits error', error, { dealerId: req.dealer?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const getVisitById = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer && !req.visitor && !req.user) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { visitId } = req.params;
    const visit = await Visit.findByPk(visitId, {
      include: [
        {
          model: VisitAssignment,
          as: 'assignments',
          required: false,
          include: [
            {
              model: Visitor,
              as: 'visitor',
              required: false,
              attributes: ['id', 'username', 'firstName', 'lastName', 'email', 'mobile', 'employeeId', 'isActive']
            }
          ]
        }
      ]
    });

    if (!visit) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Visit not found' }
      });
      return;
    }

    const ownsAsDealer =
      !!req.dealer && (req.dealer.role === 'admin' || visit.dealerId === req.dealer.id);
    const assignedAsVisitor = !!findActorAssignment((visit as any).assignments, req);
    const allowedOpsRoles = new Set([
      'installer',
      'baldev',
      'confirmation',
      'agent',
      'account',
      'admin',
      'super-admin',
      'super-admin-manager',
      'hr'
    ]);
    if (
      !ownsAsDealer &&
      !assignedAsVisitor &&
      !(req.user && allowedOpsRoles.has(req.user.role))
    ) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const mapped = await mapVisitDetailPayload(visit);
    res.json({
      success: true,
      data: mapped
    });
  } catch (error) {
    logError('Get visit by id error', error, { visitId: req.params.visitId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Get visits for quotation
export const getVisitsForQuotation = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer && !req.visitor && !req.user) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { quotationId } = req.params;
    
    // Check permissions — prefer dealer ownership when both dealer + visitor are attached
    let quotation;
    if (req.dealer) {
      const where: any = { id: quotationId };
      if (req.dealer.role !== 'admin') {
        where.dealerId = req.dealer.id;
      }
      quotation = await Quotation.findOne({ where });
      if (!quotation && req.visitor) {
        const actorIds = assignmentVisitorIdsForRequest(req);
        const visitorAssignments = await VisitAssignment.findAll({
          where: { visitorId: actorIds.length === 1 ? actorIds[0] : { [Op.in]: actorIds } },
          attributes: ['visitId']
        });
        const visitIds = visitorAssignments.map(a => a.visitId);
        if (visitIds.length > 0) {
          const assigned = await Visit.findOne({
            where: { id: visitIds, quotationId },
            attributes: ['quotationId']
          });
          if (assigned) {
            quotation = await Quotation.findOne({ where: { id: quotationId } });
          }
        }
      }
    } else if (req.visitor) {
      const actorIds = assignmentVisitorIdsForRequest(req);
      const visitorAssignments = await VisitAssignment.findAll({
        where: { visitorId: actorIds.length === 1 ? actorIds[0] : { [Op.in]: actorIds } },
        attributes: ['visitId']
      });
      const visitIds = visitorAssignments.map(a => a.visitId);
      if (visitIds.length > 0) {
        const visits = await Visit.findAll({
          where: { id: visitIds, quotationId },
          attributes: ['quotationId']
        });
        if (visits.length === 0) {
          res.status(403).json({
            success: false,
            error: { code: 'AUTH_004', message: 'Insufficient permissions' }
          });
          return;
        }
      } else {
        res.status(403).json({
          success: false,
          error: { code: 'AUTH_004', message: 'Insufficient permissions' }
        });
        return;
      }
      quotation = await Quotation.findOne({ where: { id: quotationId } });
    } else if (req.user) {
      const allowedRoles = new Set([
        'installer',
        'baldev',
        'confirmation',
        'agent',
        'account',
        'admin',
        'super-admin',
        'super-admin-manager',
        'hr'
      ]);
      if (!allowedRoles.has(req.user.role)) {
        res.status(403).json({
          success: false,
          error: { code: 'AUTH_004', message: 'Insufficient permissions' }
        });
        return;
      }
      quotation = await Quotation.findOne({ where: { id: quotationId } });
    }

    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    const visits = await Visit.findAll({
      where: { quotationId },
      include: [
        {
          model: VisitAssignment,
          as: 'assignments',
          required: false,
          include: [
            {
              model: Visitor,
              as: 'visitor',
              required: false,
              attributes: ['id', 'username', 'firstName', 'lastName', 'email', 'mobile', 'employeeId', 'isActive']
            }
          ]
        },
        {
          model: Quotation,
          as: 'quotation',
          required: false,
          attributes: ['id', 'dealerId'],
          include: [
            {
              model: Customer,
              as: 'customer',
              required: false,
              attributes: ['id', 'firstName', 'lastName', 'mobile', 'email']
            },
            {
              model: Dealer,
              as: 'dealer',
              required: false,
              attributes: ['id', 'firstName', 'lastName']
            }
          ]
        },
        {
          model: Dealer,
          as: 'dealer',
          required: false,
          attributes: ['id', 'firstName', 'lastName']
        }
      ],
      order: [['visitDate', 'DESC'], ['visitTime', 'DESC']]
    });

    const mappedVisits = await Promise.all(visits.map((v) => formatVisitCompletionPayload(v as any)));

    applyVisitListNoCacheHeaders(res);
    res.json({
      success: true,
      data: {
        quotationId,
        visits: mappedVisits
      }
    });
  } catch (error) {
    logError('Get visits for quotation error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Approve visit (visitor)
export const approveVisit = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.visitor) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { visitId } = req.params;
    const visit = await Visit.findByPk(visitId, {
      include: [{ model: VisitAssignment, as: 'assignments' }]
    });

    if (!visit) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Visit not found' }
      });
      return;
    }

    // Check if visitor is assigned to this visit
    const visitAny = visit as any;
    const assignment = findActorAssignment(visitAny.assignments, req);
    if (!assignment) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'You are not assigned to this visit' }
      });
      return;
    }

    if (visit.status !== 'pending') {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: 'Visit is not in pending status' }
      });
      return;
    }

    await visit.update({ status: 'approved' });

    res.json({
      success: true,
      data: {
        id: visit.id,
        status: visit.status,
        updatedAt: visit.updatedAt
      }
    });
  } catch (error) {
    logError('Approve visit error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Complete visit (visitor)
export const completeVisit = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.visitor) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { visitId } = req.params;
    const {
      length,
      width,
      height,
      unit,
      backLegFeet,
      midLegFeet,
      frontLegFeet,
      images,
      rowDiagramImage,
      meterImage,
      existingImages,
      existingRowDiagramImage,
      existingMeterImage,
      notes
    } = req.body;

    const visit = await getAssignedVisitForVisitor(visitId, req, res);
    if (!visit) return;

    const files = (req.files || {}) as Record<string, Express.Multer.File[]>;
    const imageFiles = files.images || [];
    const rowDiagramFile = (files.rowDiagramImage || [])[0];
    const meterImageFile = (files.meterImage || [])[0];

    const storedVisitImages = normalizeVisitMediaUrls(Array.isArray(visit.images) ? visit.images : []);
    const existingImageUrls = existingImages !== undefined
      ? normalizeVisitMediaUrls(existingImages)
      : images !== undefined
        ? normalizeVisitMediaUrls(images)
      : storedVisitImages;
    const uploadedImageUrls = imageFiles
      .map((file) => mediaRefFromUploadedFile(file))
      .filter((url): url is string => !!url);
    const uploadedMeterImageUrl = mediaRefFromUploadedFile(meterImageFile);
    const mergedImages = dedupeMediaUrls([...existingImageUrls, ...uploadedImageUrls]);

    const rowDiagramImageUrl =
      mediaRefFromUploadedFile(rowDiagramFile) ||
      normalizeVisitMediaUrl(rowDiagramImage) ||
      normalizeVisitMediaUrl(existingRowDiagramImage) ||
      normalizeVisitMediaUrl((visit as any).rowDiagramImage) ||
      null;
    const meterImageUrl =
      uploadedMeterImageUrl ||
      normalizeVisitMediaUrl(meterImage) ||
      normalizeVisitMediaUrl(existingMeterImage) ||
      normalizeVisitMediaUrl((visit as any).meterImage) ||
      null;

    const parsedLength = toOptionalFiniteNumber(length);
    const parsedWidth = toOptionalFiniteNumber(width);
    const parsedHeight = toOptionalFiniteNumber(height);
    const parsedBackLegFeet = toOptionalFiniteNumber(backLegFeet) ?? (visit as any).backLegFeet;
    const parsedMidLegFeet = toOptionalFiniteNumber(midLegFeet) ?? (visit as any).midLegFeet;
    const parsedFrontLegFeet = toOptionalFiniteNumber(frontLegFeet) ?? (visit as any).frontLegFeet;

    const invalidNumericFields: Array<{ field: string; message: string }> = [];
    if (length !== undefined && parsedLength === undefined) {
      invalidNumericFields.push({ field: 'length', message: 'length must be a valid number' });
    }
    if (width !== undefined && parsedWidth === undefined) {
      invalidNumericFields.push({ field: 'width', message: 'width must be a valid number' });
    }
    if (height !== undefined && parsedHeight === undefined) {
      invalidNumericFields.push({ field: 'height', message: 'height must be a valid number' });
    }
    if (backLegFeet !== undefined && toOptionalFiniteNumber(backLegFeet) === undefined) {
      invalidNumericFields.push({ field: 'backLegFeet', message: 'backLegFeet must be a valid number' });
    }
    if (midLegFeet !== undefined && toOptionalFiniteNumber(midLegFeet) === undefined) {
      invalidNumericFields.push({ field: 'midLegFeet', message: 'midLegFeet must be a valid number' });
    }
    if (frontLegFeet !== undefined && toOptionalFiniteNumber(frontLegFeet) === undefined) {
      invalidNumericFields.push({ field: 'frontLegFeet', message: 'frontLegFeet must be a valid number' });
    }
    if (invalidNumericFields.length > 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid numeric fields in complete visit payload',
          details: invalidNumericFields
        }
      });
      return;
    }

    const compatibilityHeightFromLegs = [parsedBackLegFeet, parsedMidLegFeet, parsedFrontLegFeet]
      .filter((v) => typeof v === 'number' && Number.isFinite(v))
      .reduce((max, current) => Math.max(max, current as number), Number.NEGATIVE_INFINITY);

    const computedHeight =
      parsedHeight !== undefined
        ? parsedHeight
        : Number.isFinite(compatibilityHeightFromLegs)
          ? compatibilityHeightFromLegs
          : visit.height;

    const normalizedUnit = typeof unit === 'string' && unit.trim() ? unit.trim() : ((visit as any).unit || null);
    const nextLength = parsedLength ?? visit.length;
    const nextWidth = parsedWidth ?? visit.width;
    const nextNotes = notes !== undefined ? notes : visit.notes;
    const nextFeedback = notes !== undefined ? notes : visit.feedback;

    const noScalarChange =
      visit.status === 'completed' &&
      Number(visit.length ?? 0) === Number(nextLength ?? 0) &&
      Number(visit.width ?? 0) === Number(nextWidth ?? 0) &&
      Number(visit.height ?? 0) === Number(computedHeight ?? 0) &&
      String((visit as any).unit || '') === String(normalizedUnit || '') &&
      Number(((visit as any).backLegFeet ?? 0)) === Number(parsedBackLegFeet ?? 0) &&
      Number(((visit as any).midLegFeet ?? 0)) === Number(parsedMidLegFeet ?? 0) &&
      Number(((visit as any).frontLegFeet ?? 0)) === Number(parsedFrontLegFeet ?? 0) &&
      String((visit as any).rowDiagramImage || '') === String(rowDiagramImageUrl || '') &&
      String((visit as any).meterImage || '') === String(meterImageUrl || '') &&
      JSON.stringify(storedVisitImages) === JSON.stringify(mergedImages) &&
      String(visit.notes || '') === String(nextNotes || '') &&
      String(visit.feedback || '') === String(nextFeedback || '');

    if (noScalarChange && imageFiles.length === 0 && !rowDiagramFile && !meterImageFile) {
      const responseImages = await resolveMediaUrls(visit.images);
      const responseRowDiagramImage = await resolveMediaUrl((visit as any).rowDiagramImage);
      const responseMeterImage = await resolveMediaUrl(
        meterImageUrl || (Array.isArray(responseImages) ? responseImages[0] : null)
      );
      res.json({
        success: true,
        data: {
          id: visit.id,
          status: visit.status,
          length: visit.length,
          width: visit.width,
          height: visit.height,
          unit: (visit as any).unit || null,
          backLegFeet: (visit as any).backLegFeet || null,
          midLegFeet: (visit as any).midLegFeet || null,
          frontLegFeet: (visit as any).frontLegFeet || null,
          images: responseImages,
          site_images: responseImages,
          rowDiagramImage: responseRowDiagramImage,
          row_diagram_image: responseRowDiagramImage,
          meterImage: responseMeterImage,
          meter_image: responseMeterImage,
          notes: visit.notes || visit.feedback || null,
          feedback: visit.feedback || visit.notes || null,
          updatedAt: visit.updatedAt
        }
      });
      return;
    }

    await (visit as any).update({
      status: 'completed',
      length: nextLength,
      width: nextWidth,
      height: computedHeight,
      unit: normalizedUnit,
      backLegFeet: parsedBackLegFeet,
      midLegFeet: parsedMidLegFeet,
      frontLegFeet: parsedFrontLegFeet,
      rowDiagramImage: rowDiagramImageUrl,
      meterImage: meterImageUrl,
      images: mergedImages,
      feedback: nextFeedback,
      notes: nextNotes
    });
    await visit.reload();

    const responseImages = await resolveMediaUrls(visit.images);
    const responseRowDiagramImage = await resolveMediaUrl((visit as any).rowDiagramImage);
    const responseMeterImage = await resolveMediaUrl(
      meterImageUrl || (Array.isArray(responseImages) ? responseImages[0] : null)
    );

    res.json({
      success: true,
      data: {
        id: visit.id,
        status: visit.status,
        length: visit.length,
        width: visit.width,
        height: visit.height,
        unit: (visit as any).unit || null,
        backLegFeet: (visit as any).backLegFeet || null,
        midLegFeet: (visit as any).midLegFeet || null,
        frontLegFeet: (visit as any).frontLegFeet || null,
        images: responseImages,
        site_images: responseImages,
        rowDiagramImage: responseRowDiagramImage,
        row_diagram_image: responseRowDiagramImage,
        meterImage: responseMeterImage,
        meter_image: responseMeterImage,
        notes: visit.notes || visit.feedback || notes || null,
        feedback: visit.feedback || visit.notes || notes || null,
        updatedAt: visit.updatedAt
      }
    });
  } catch (error) {
    logError('Complete visit error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Mark visit as incomplete
export const markVisitIncomplete = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.visitor) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { visitId } = req.params;
    const { reason } = req.body;

    const visit = await Visit.findByPk(visitId, {
      include: [{ model: VisitAssignment, as: 'assignments' }]
    });

    if (!visit) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Visit not found' }
      });
      return;
    }

    const visitAny = visit as any;
    const assignment = findActorAssignment(visitAny.assignments, req);
    if (!assignment) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'You are not assigned to this visit' }
      });
      return;
    }

    await visit.update({
      status: 'incomplete',
      rejectionReason: reason
    });

    res.json({
      success: true,
      data: {
        id: visit.id,
        status: visit.status,
        rejectionReason: visit.rejectionReason,
        updatedAt: visit.updatedAt
      }
    });
  } catch (error) {
    logError('Mark visit incomplete error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

const isInventorySystemAdminUser = (req: Request): boolean =>
  !!req.user &&
  (req.user.role === 'admin' ||
    req.user.role === 'super-admin' ||
    req.user.role === 'super-admin-manager');

// Reschedule visit (visitor: must be assigned; dealer/admin: visit must belong to their quotation)
export const rescheduleVisit = async (req: Request, res: Response): Promise<void> => {
  try {
    const isVisitor = !!req.visitor;
    const isDealer =
      !!req.dealer && (req.dealer.role === 'dealer' || req.dealer.role === 'admin');
    const isInventoryAdmin = isInventorySystemAdminUser(req);

    if (!isVisitor && !isDealer && !isInventoryAdmin) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const { visitId } = req.params;
    const quotationIdFromPath = (req.params as { quotationId?: string }).quotationId;
    const { reason, visitDate, visitTime } = req.body;

    const visit = await Visit.findByPk(visitId, {
      include: [
        { model: VisitAssignment, as: 'assignments', required: false },
        { model: Quotation, as: 'quotation', required: false }
      ]
    });

    if (!visit) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Visit not found' }
      });
      return;
    }

    if (quotationIdFromPath && visit.quotationId !== quotationIdFromPath) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Visit not found for this quotation' }
      });
      return;
    }

    const visitAny = visit as any;
    const assignedAsVisitor = !!findActorAssignment(visitAny.assignments, req);
    if (isDealer) {
      const q = visitAny.quotation as Quotation | undefined;
      const owns =
        req.dealer!.role === 'admin' ||
        visit.dealerId === req.dealer!.id ||
        (q && q.dealerId === req.dealer!.id);
      if (!owns && !assignedAsVisitor) {
        res.status(403).json({
          success: false,
          error: { code: 'AUTH_004', message: 'You can only reschedule visits for your own quotations' }
        });
        return;
      }
    } else if (isVisitor) {
      if (!assignedAsVisitor) {
        res.status(403).json({
          success: false,
          error: { code: 'AUTH_004', message: 'You are not assigned to this visit' }
        });
        return;
      }
    } else if (isInventoryAdmin) {
      // Ops: no per-dealer scope check
    }

    const updatePayload: any = {
      status: 'rescheduled',
      rejectionReason: reason
    };
    if (visitDate !== undefined) updatePayload.visitDate = visitDate;
    if (visitTime !== undefined) updatePayload.visitTime = visitTime;

    await visit.update(updatePayload);
    await visit.reload();

    res.json({
      success: true,
      data: {
        id: visit.id,
        quotationId: visit.quotationId,
        status: visit.status,
        visitDate: visit.visitDate,
        ...getVisitTimeFields(visit.visitTime),
        rejectionReason: visit.rejectionReason,
        updatedAt: visit.updatedAt
      }
    });
  } catch (error) {
    logError('Reschedule visit error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Reject visit
export const rejectVisit = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.visitor) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { visitId } = req.params;
    const { rejectionReason } = req.body;

    const visit = await Visit.findByPk(visitId, {
      include: [{ model: VisitAssignment, as: 'assignments' }]
    });

    if (!visit) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Visit not found' }
      });
      return;
    }

    const visitAny = visit as any;
    const assignment = findActorAssignment(visitAny.assignments, req);
    if (!assignment) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'You are not assigned to this visit' }
      });
      return;
    }

    await visit.update({
      status: 'rejected',
      rejectionReason
    });

    res.json({
      success: true,
      data: {
        id: visit.id,
        status: visit.status,
        rejectionReason: visit.rejectionReason,
        updatedAt: visit.updatedAt
      }
    });
  } catch (error) {
    logError('Reject visit error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

const INSTALLER_PATCH_VISIT_STATUSES = new Set([
  'pending_installer',
  'installer_in_progress',
  'installer_partial_approved',
  'installer_approved'
]);

export const patchVisitSiteDimensions = async (req: Request, res: Response): Promise<void> => {
  try {
    const { visitId } = req.params;
    const visit = await Visit.findByPk(visitId, {
      include: [{ model: Quotation, as: 'quotation' }]
    });

    if (!visit) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Visit not found' }
      });
      return;
    }

    const quotation = (visit as any).quotation as InstanceType<typeof Quotation> | null;
    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    let allowed = false;
    if (req.dealer) {
      allowed = req.dealer.role === 'admin' || visit.dealerId === req.dealer.id;
    } else if (req.user?.role === 'installer') {
      allowed =
        quotation.status === 'approved' &&
        INSTALLER_PATCH_VISIT_STATUSES.has((quotation as any).installationStatus || '');
    } else if (req.user && isInstallationTeamJwtRole(req.user.role)) {
      const teamId = getInstallationTeamIdFromRequest(req);
      const qTeam = String((quotation as any).installationTeamId || '').trim();
      allowed =
        Boolean(teamId && qTeam && teamId === qTeam) &&
        quotation.status === 'approved' &&
        INSTALLER_PATCH_VISIT_STATUSES.has((quotation as any).installationStatus || '');
    } else if (
      req.user &&
      ['admin', 'super-admin', 'super-admin-manager'].includes(req.user.role)
    ) {
      allowed = true;
    }

    if (!allowed) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    if (body.unit !== undefined) updates.unit = body.unit;
    const siteL = body.siteLength ?? body.length;
    const siteW = body.siteWidth ?? body.width;
    const siteH = body.siteHeight ?? body.height;
    if (siteL !== undefined) updates.length = siteL;
    if (siteW !== undefined) updates.width = siteW;
    if (siteH !== undefined) updates.height = siteH;
    if (body.backLegFeet !== undefined) updates.backLegFeet = body.backLegFeet;
    if (body.midLegFeet !== undefined) updates.midLegFeet = body.midLegFeet;
    if (body.frontLegFeet !== undefined) updates.frontLegFeet = body.frontLegFeet;

    await visit.update(updates);
    await visit.reload();

    const resolvedImages = await resolveMediaUrls(visit.images);
    const resolvedRowDiagramImage = await resolveMediaUrl((visit as any).rowDiagramImage);
    const backLegFeet = (visit as any).backLegFeet != null ? Number((visit as any).backLegFeet) : null;
    const midLegFeet = (visit as any).midLegFeet != null ? Number((visit as any).midLegFeet) : null;
    const frontLegFeet = (visit as any).frontLegFeet != null ? Number((visit as any).frontLegFeet) : null;
    const len = visit.length != null ? Number(visit.length) : null;
    const wid = visit.width != null ? Number(visit.width) : null;
    const hgt = visit.height != null ? Number(visit.height) : null;

    res.json({
      success: true,
      data: {
        id: visit.id,
        quotationId: visit.quotationId,
        unit: (visit as any).unit || null,
        length: len,
        width: wid,
        height: hgt,
        siteLength: len,
        siteWidth: wid,
        siteHeight: hgt,
        backLegFeet,
        midLegFeet,
        frontLegFeet,
        siteDimensions: {
          siteLength: len,
          siteWidth: wid,
          siteHeight: hgt,
          backLegFeet,
          midLegFeet,
          frontLegFeet
        },
        images: resolvedImages,
        rowDiagramImage: resolvedRowDiagramImage,
        updatedAt: visit.updatedAt
      }
    });
  } catch (error) {
    logError('Patch visit site dimensions error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Delete visit
export const deleteVisit = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { visitId } = req.params;
    const visit = await Visit.findByPk(visitId, {
      include: [{ model: Quotation, as: 'quotation' }]
    });

    if (!visit) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Visit not found' }
      });
      return;
    }

    if (visit.dealerId !== req.dealer.id) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    await visit.destroy();

    res.json({
      success: true,
      message: 'Visit deleted successfully'
    });
  } catch (error) {
    logError('Delete visit error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};


