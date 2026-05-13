import { Request, Response } from 'express';
import { Visit, VisitAssignment, Quotation, Customer, Dealer, Visitor } from '../models/index-quotation';
import { Op } from 'sequelize';
import { logError } from '../utils/loggerHelper';
import { extractS3Key, generatePublicUrl } from '../utils/s3Service';

const VISIT_MEDIA_PRESIGN_TTL_SECONDS = Number(process.env.AWS_S3_SIGNED_URL_TTL_SECONDS || 604800);

const toSafeString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
};

const normalizeVisitTime = (value: unknown): string => {
  const raw = toSafeString(value).trim();
  if (!raw) return '';
  return raw;
};

const parseVisitTimeFields = (value: unknown): { visitTime: string; visitStartTime: string | null; visitEndTime: string | null } => {
  const visitTime = normalizeVisitTime(value);
  if (/^([01]\d|2[0-3]):([0-5]\d)\s-\s([01]\d|2[0-3]):([0-5]\d)$/.test(visitTime)) {
    const [visitStartTime, visitEndTime] = visitTime.split(' - ');
    return { visitTime, visitStartTime, visitEndTime };
  }
  if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(visitTime)) {
    return { visitTime, visitStartTime: visitTime, visitEndTime: null };
  }
  return { visitTime, visitStartTime: null, visitEndTime: null };
};

const parseSummaryFlag = (value: unknown, fallback = true): boolean => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  return fallback;
};

type CanonicalVisitStatus = 'pending' | 'approved' | 'completed' | 'incomplete' | 'rescheduled' | 'rejected';

const normalizeVisitStatus = (raw?: unknown): CanonicalVisitStatus => {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'approve' || value === 'approved') return 'approved';
  if (value === 'complete' || value === 'completed') return 'completed';
  if (value === 'incomplete') return 'incomplete';
  if (value === 'reschedule' || value === 'rescheduled') return 'rescheduled';
  if (value === 'reject' || value === 'rejected') return 'rejected';
  return 'pending';
};

const normalizeStatusQueryValue = (raw?: unknown): CanonicalVisitStatus | 'all' => {
  const value = String(raw || '').trim().toLowerCase();
  if (!value || value === 'all') return 'all';
  if (value === 'approve' || value === 'approved') return 'approved';
  if (value === 'complete' || value === 'completed') return 'completed';
  if (value === 'incomplete') return 'incomplete';
  if (value === 'reschedule' || value === 'rescheduled') return 'rescheduled';
  if (value === 'reject' || value === 'rejected') return 'rejected';
  if (value === 'pending') return 'pending';
  return 'all';
};

const getStatusDbVariants = (status: CanonicalVisitStatus): string[] => {
  if (status === 'approved') return ['approved', 'approve'];
  if (status === 'completed') return ['completed', 'complete'];
  if (status === 'rescheduled') return ['rescheduled', 'reschedule'];
  if (status === 'rejected') return ['rejected', 'reject'];
  return [status];
};

const applyNoCacheHeaders = (res: Response) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
};

const resolveMediaUrl = async (url: unknown): Promise<string | null> => {
  if (typeof url !== 'string' || !url.trim()) return null;
  const key = extractS3Key(url);
  if (!key) return url;
  try {
    return await generatePublicUrl(key, VISIT_MEDIA_PRESIGN_TTL_SECONDS);
  } catch {
    return url;
  }
};

const resolveMediaUrls = async (urls: unknown): Promise<string[]> => {
  if (!Array.isArray(urls)) return [];
  const resolved = await Promise.all(urls.map((u) => resolveMediaUrl(u)));
  return resolved.filter((u): u is string => !!u);
};

const mapAssignmentSummary = (assignments: any[]) =>
  (assignments || []).map((a: any) => {
    const visitor = a.visitor;
    if (visitor) {
      return {
        visitorId: visitor.id,
        visitorName: `${toSafeString(visitor.firstName)} ${toSafeString(visitor.lastName)}`.trim() || toSafeString(a.visitorName)
      };
    }
    return {
      visitorId: a.visitorId,
      visitorName: toSafeString(a.visitorName)
    };
  });

const mapAssignmentDetails = (assignments: any[]) =>
  (assignments || []).map((a: any) => {
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

// Get assigned visits (visitor)
export const getAssignedVisits = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.visitor) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const status = req.query.status as string;
    const statusTab = req.query.statusTab ?? req.query.tab ?? req.query.activeTab ?? req.query.visitTab;
    const statusFilter = req.query.statusFilter ?? req.query.filterStatus ?? req.query.visitStatus;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const search = req.query.search as string;
    const summary = parseSummaryFlag(req.query.summary, true);

    const where: any = {};

    const normalizedStatus = normalizeStatusQueryValue(status);
    const normalizedStatusFilter = normalizeStatusQueryValue(statusFilter);
    const normalizedStatusTab = normalizeStatusQueryValue(statusTab);
    const selectedStatus = normalizedStatus !== 'all'
      ? normalizedStatus
      : (normalizedStatusFilter !== 'all'
        ? normalizedStatusFilter
        : normalizedStatusTab);

    if (selectedStatus !== 'all') {
      where.status = { [Op.in]: getStatusDbVariants(selectedStatus) };
    }

    if (startDate || endDate) {
      where.visitDate = {};
      if (startDate) where.visitDate[Op.gte] = new Date(startDate);
      if (endDate) where.visitDate[Op.lte] = new Date(endDate);
    }

    // Note: Search will be handled after fetching visits with associations
    // since we need to search in customer name and quotation ID

    const visits = await Visit.findAll({
      where,
      include: [
        {
          model: VisitAssignment,
          as: 'assignments',
          where: { visitorId: req.visitor.id },
          required: true,
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
              as: 'customer'
            },
            {
              model: Dealer,
              as: 'dealer',
              attributes: ['id', 'firstName', 'lastName']
            }
          ]
        }
      ],
      order: [['visitDate', 'ASC'], ['visitTime', 'ASC']]
    });

    // Filter by search if provided
    let filteredVisits = visits;
    if (search) {
      filteredVisits = visits.filter(v => {
        const vAny = v as any;
        const quotation = vAny.quotation;
        const customer = quotation?.customer;
        const searchLower = search.toLowerCase();
        const location = toSafeString(v.location).toLowerCase();
        const quotationId = toSafeString(quotation?.id).toLowerCase();
        const firstName = toSafeString(customer?.firstName).toLowerCase();
        const lastName = toSafeString(customer?.lastName).toLowerCase();
        const fullName = `${firstName} ${lastName}`.trim();
        return (
          location.includes(searchLower) ||
          quotationId.includes(searchLower) ||
          firstName.includes(searchLower) ||
          lastName.includes(searchLower) ||
          fullName.includes(searchLower)
        );
      });
    }

    const formattedVisits = await Promise.all(filteredVisits.map(async (v) => {
      const vAny = v as any;
      const quotation = vAny.quotation;
      const customer = quotation?.customer;
      const assignments = vAny.assignments || [];
      const timeFields = parseVisitTimeFields(v.visitTime);
      const safeQuotation = {
        id: toSafeString(quotation?.id)
      };
      const safeCustomer = {
        firstName: toSafeString(customer?.firstName),
        lastName: toSafeString(customer?.lastName),
        mobile: toSafeString(customer?.mobile),
        email: toSafeString(customer?.email)
      };

      const baseVisit = {
        id: v.id,
        quotation: safeQuotation,
        customer: safeCustomer,
        dealer: quotation?.dealer ? {
          id: quotation.dealer.id,
          firstName: quotation.dealer.firstName,
          lastName: quotation.dealer.lastName
        } : null,
        visitDate: v.visitDate || '',
        visitTime: timeFields.visitTime,
        visitStartTime: timeFields.visitStartTime,
        visitEndTime: timeFields.visitEndTime,
        location: toSafeString(v.location),
        locationLink: toSafeString(v.locationLink),
        status: normalizeVisitStatus(v.status),
        createdAt: v.createdAt
      };

      if (summary) {
        return {
          ...baseVisit,
          visitors: mapAssignmentSummary(assignments)
        };
      }

      const resolvedImages = await resolveMediaUrls(v.images);
      const resolvedRowDiagramImage = await resolveMediaUrl(vAny.rowDiagramImage);
      const resolvedMeterImage = await resolveMediaUrl(
        vAny.meterImage || (Array.isArray(resolvedImages) ? resolvedImages[0] : null)
      );
      return {
        ...baseVisit,
        quotation: {
          ...safeQuotation,
          systemType: toSafeString(quotation?.systemType),
          finalAmount: Number(quotation?.finalAmount || 0),
          createdAt: quotation?.createdAt || null,
          customer: safeCustomer
        },
        customer: {
          ...safeCustomer,
          address: {
            street: toSafeString(customer?.streetAddress),
            city: toSafeString(customer?.city),
            state: toSafeString(customer?.state),
            pincode: toSafeString(customer?.pincode)
          }
        },
        notes: toSafeString(v.notes),
        length: v.length ?? null,
        width: v.width ?? null,
        height: v.height ?? null,
        unit: (vAny.unit as 'feet' | 'cm' | null) ?? null,
        backLegFeet: vAny.backLegFeet ?? null,
        midLegFeet: vAny.midLegFeet ?? null,
        frontLegFeet: vAny.frontLegFeet ?? null,
        images: resolvedImages,
        site_images: resolvedImages,
        rowDiagramImage: resolvedRowDiagramImage,
        row_diagram_image: resolvedRowDiagramImage,
        meterImage: resolvedMeterImage,
        meter_image: resolvedMeterImage,
        otherVisitors: mapAssignmentDetails(assignments.filter((a: any) => a.visitorId !== req.visitor!.id)),
        assignedVisitors: mapAssignmentDetails(assignments),
        visitors: mapAssignmentSummary(assignments)
      };
    }));

    applyNoCacheHeaders(res);
    res.json({
      success: true,
      visits: formattedVisits,
      data: {
        items: formattedVisits,
        visits: formattedVisits,
        count: formattedVisits.length
      }
    });
  } catch (error) {
    logError('Get assigned visits error', error, { visitorId: req.visitor?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Get visitor statistics
export const getVisitorStatistics = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.visitor) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const visits = await Visit.findAll({
      include: [
        {
          model: VisitAssignment,
          as: 'assignments',
          where: { visitorId: req.visitor.id },
          required: true
        },
        {
          model: Quotation,
          as: 'quotation',
          include: [
            {
              model: Customer,
              as: 'customer'
            }
          ]
        }
      ]
    });

    const totalVisits = visits.length;
    let pendingVisits = 0;
    let approvedVisits = 0;
    let completedVisits = 0;
    let incompleteVisits = 0;
    let rejectedVisits = 0;
    let rescheduledVisits = 0;
    for (const v of visits) {
      const s = normalizeVisitStatus(v.status);
      if (s === 'pending') pendingVisits++;
      else if (s === 'approved') approvedVisits++;
      else if (s === 'completed') completedVisits++;
      else if (s === 'incomplete') incompleteVisits++;
      else if (s === 'rejected') rejectedVisits++;
      else if (s === 'rescheduled') rescheduledVisits++;
    }

    // Get upcoming visits with customer names
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcomingVisitsData = visits
      .filter(v => {
        const visitDate = new Date(v.visitDate);
        visitDate.setHours(0, 0, 0, 0);
        const s = normalizeVisitStatus(v.status);
        return visitDate >= today && (s === 'pending' || s === 'approved');
      })
      .slice(0, 5);

    const upcomingVisits = await Promise.all(
      upcomingVisitsData.map(async (v) => {
        const vAny = v as any;
        const quotation = vAny.quotation;
        const customer = quotation?.customer;
        const customerName = customer 
          ? `${customer.firstName} ${customer.lastName}`
          : 'Unknown Customer';

        return {
          id: v.id,
          visitDate: v.visitDate,
          visitTime: v.visitTime,
          customerName
        };
      })
    );

    res.json({
      success: true,
      data: {
        totalVisits,
        pendingVisits,
        approvedVisits,
        completedVisits,
        incompleteVisits,
        rejectedVisits,
        rescheduledVisits,
        upcomingVisits
      }
    });
  } catch (error) {
    logError('Get visitor statistics error', error, { visitorId: req.visitor?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// live
