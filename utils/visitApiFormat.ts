import type { Response } from 'express';
import { resolveBrowsableMediaUrl, resolveBrowsableMediaUrls } from './s3Service';

export const toSafeVisitString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
};

export type CanonicalVisitStatus =
  | 'pending'
  | 'approved'
  | 'completed'
  | 'incomplete'
  | 'rescheduled'
  | 'rejected';

export const normalizeVisitStatus = (raw?: unknown): CanonicalVisitStatus => {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'approve' || value === 'approved') return 'approved';
  if (value === 'complete' || value === 'completed') return 'completed';
  if (value === 'incomplete') return 'incomplete';
  if (value === 'reschedule' || value === 'rescheduled') return 'rescheduled';
  if (value === 'reject' || value === 'rejected') return 'rejected';
  return 'pending';
};

export const normalizeVisitStatusQuery = (raw?: unknown): CanonicalVisitStatus | 'all' => {
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

export const getVisitStatusDbVariants = (status: CanonicalVisitStatus): string[] => {
  if (status === 'approved') return ['approved', 'approve'];
  if (status === 'completed') return ['completed', 'complete'];
  if (status === 'rescheduled') return ['rescheduled', 'reschedule'];
  if (status === 'rejected') return ['rejected', 'reject'];
  return [status];
};

export const parseVisitTimeFields = (
  value: unknown
): { visitTime: string; visitStartTime: string | null; visitEndTime: string | null } => {
  const visitTime = toSafeVisitString(value).trim();
  if (/^([01]\d|2[0-3]):([0-5]\d)\s-\s([01]\d|2[0-3]):([0-5]\d)$/.test(visitTime)) {
    const [visitStartTime, visitEndTime] = visitTime.split(' - ');
    return { visitTime, visitStartTime, visitEndTime };
  }
  if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(visitTime)) {
    return { visitTime, visitStartTime: visitTime, visitEndTime: null };
  }
  return { visitTime, visitStartTime: null, visitEndTime: null };
};

export const mapVisitAssignmentSummary = (assignments: any[]) =>
  (assignments || []).map((a: any) => {
    const visitor = a.visitor;
    if (visitor) {
      const name =
        `${toSafeVisitString(visitor.firstName)} ${toSafeVisitString(visitor.lastName)}`.trim() ||
        toSafeVisitString(a.visitorName);
      return { visitorId: visitor.id, visitorName: name };
    }
    return {
      visitorId: a.visitorId,
      visitorName: toSafeVisitString(a.visitorName)
    };
  });

export const applyVisitListNoCacheHeaders = (res: Response) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
};

const buildAdminVisitReportCore = (visit: any) => {
  const quotation = visit.quotation;
  const customer = quotation?.customer;
  const dealer = quotation?.dealer ?? visit.dealer;
  const assignments = visit.assignments || [];
  const timeFields = parseVisitTimeFields(visit.visitTime);

  return {
    id: visit.id,
    quotationId: visit.quotationId,
    dealerId: visit.dealerId,
    visitDate: visit.visitDate,
    visitTime: timeFields.visitTime,
    visitStartTime: timeFields.visitStartTime,
    visitEndTime: timeFields.visitEndTime,
    location: toSafeVisitString(visit.location),
    locationLink: toSafeVisitString(visit.locationLink) || null,
    status: normalizeVisitStatus(visit.status),
    visitors: mapVisitAssignmentSummary(assignments),
    customer: {
      firstName: toSafeVisitString(customer?.firstName),
      lastName: toSafeVisitString(customer?.lastName),
      mobile: toSafeVisitString(customer?.mobile),
      fullName:
        `${toSafeVisitString(customer?.firstName)} ${toSafeVisitString(customer?.lastName)}`.trim() ||
        null
    },
    dealer: dealer
      ? {
          id: dealer.id,
          firstName: dealer.firstName,
          lastName: dealer.lastName,
          fullName: `${toSafeVisitString(dealer.firstName)} ${toSafeVisitString(dealer.lastName)}`.trim()
        }
      : null,
    rejectionReason: visit.rejectionReason ?? null,
    notes: visit.notes ?? null,
    createdAt: visit.createdAt,
    updatedAt: visit.updatedAt
  };
};

/** List row for GET /admin/visits — names only; no completion media (Details modal uses per-quotation GET). */
export const formatAdminVisitReportListRow = (visit: any): Record<string, unknown> =>
  buildAdminVisitReportCore(visit);

/** Full row with presigned media URLs (optional ?includeMedia=true on admin list). */
export const formatAdminVisitReportRow = async (visit: any): Promise<Record<string, unknown>> => {
  const core = buildAdminVisitReportCore(visit);
  const resolvedImages = await resolveBrowsableMediaUrls(visit.images);
  const resolvedRowDiagramImage = await resolveBrowsableMediaUrl(visit.rowDiagramImage);
  const resolvedMeterImage = await resolveBrowsableMediaUrl(
    visit.meterImage || (Array.isArray(resolvedImages) ? resolvedImages[0] : null)
  );

  return {
    ...core,
    images: resolvedImages,
    site_images: resolvedImages,
    rowDiagramImage: resolvedRowDiagramImage,
    row_diagram_image: resolvedRowDiagramImage,
    meterImage: resolvedMeterImage,
    meter_image: resolvedMeterImage
  };
};

/** Completion payload for GET /quotations/{id}/visits and Details modal (§Z.11). */
export const formatVisitCompletionPayload = async (visit: any): Promise<Record<string, unknown>> => {
  const quotation = visit.quotation;
  const customer = quotation?.customer;
  const dealer = quotation?.dealer ?? visit.dealer;
  const assignments = visit.assignments || [];
  const timeFields = parseVisitTimeFields(visit.visitTime);
  const resolvedImages = await resolveBrowsableMediaUrls(visit.images);
  const resolvedRowDiagramImage = await resolveBrowsableMediaUrl(visit.rowDiagramImage);
  const resolvedMeterImage = await resolveBrowsableMediaUrl(
    visit.meterImage || (Array.isArray(resolvedImages) ? resolvedImages[0] : null)
  );

  const backLegFeet = visit.backLegFeet != null ? Number(visit.backLegFeet) : null;
  const midLegFeet = visit.midLegFeet != null ? Number(visit.midLegFeet) : null;
  const frontLegFeet = visit.frontLegFeet != null ? Number(visit.frontLegFeet) : null;
  const len = visit.length != null ? Number(visit.length) : null;
  const wid = visit.width != null ? Number(visit.width) : null;
  const hgt = visit.height != null ? Number(visit.height) : null;

  const visitors = (assignments || []).map((a: any) => {
    const visitor = a.visitor;
    if (visitor) {
      const visitorName =
        `${toSafeVisitString(visitor.firstName)} ${toSafeVisitString(visitor.lastName)}`.trim() ||
        toSafeVisitString(a.visitorName);
      return {
        visitorId: visitor.id,
        visitorName,
        username: visitor.username,
        firstName: visitor.firstName,
        lastName: visitor.lastName,
        fullName: visitorName,
        email: visitor.email,
        mobile: visitor.mobile,
        employeeId: visitor.employeeId,
        isActive: visitor.isActive
      };
    }
    return {
      visitorId: a.visitorId,
      visitorName: toSafeVisitString(a.visitorName),
      fullName: toSafeVisitString(a.visitorName)
    };
  });

  return {
    id: visit.id,
    quotationId: visit.quotationId,
    dealerId: visit.dealerId,
    visitDate: visit.visitDate,
    visitTime: timeFields.visitTime,
    visitStartTime: timeFields.visitStartTime,
    visitEndTime: timeFields.visitEndTime,
    location: toSafeVisitString(visit.location),
    locationLink: toSafeVisitString(visit.locationLink) || null,
    notes: visit.notes ?? null,
    status: normalizeVisitStatus(visit.status),
    length: len,
    width: wid,
    height: hgt,
    unit: visit.unit ?? null,
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
    images: resolvedImages,
    site_images: resolvedImages,
    rowDiagramImage: resolvedRowDiagramImage,
    row_diagram_image: resolvedRowDiagramImage,
    meterImage: resolvedMeterImage,
    meter_image: resolvedMeterImage,
    feedback: visit.feedback ?? null,
    rejectionReason: visit.rejectionReason ?? null,
    visitors,
    otherVisitors: visitors,
    assignedVisitors: visitors,
    customer: {
      firstName: toSafeVisitString(customer?.firstName),
      lastName: toSafeVisitString(customer?.lastName),
      mobile: toSafeVisitString(customer?.mobile),
      fullName:
        `${toSafeVisitString(customer?.firstName)} ${toSafeVisitString(customer?.lastName)}`.trim() ||
        null
    },
    dealer: dealer
      ? {
          id: dealer.id,
          firstName: dealer.firstName,
          lastName: dealer.lastName
        }
      : null,
    createdAt: visit.createdAt,
    updatedAt: visit.updatedAt
  };
};

export const visitMatchesAdminSearch = (visit: any, searchRaw: string): boolean => {
  const search = searchRaw.trim().toLowerCase();
  if (!search) return true;

  const quotation = visit.quotation;
  const customer = quotation?.customer;
  const dealer = quotation?.dealer;
  const assignments = visit.assignments || [];

  const haystack = [
    visit.id,
    visit.quotationId,
    visit.location,
    quotation?.id,
    customer?.firstName,
    customer?.lastName,
    customer?.mobile,
    dealer?.firstName,
    dealer?.lastName,
    ...assignments.map((a: any) => a.visitorName),
    ...assignments.map((a: any) => {
      const v = a.visitor;
      return v ? `${v.firstName} ${v.lastName}` : '';
    })
  ]
    .map((v) => toSafeVisitString(v).toLowerCase())
    .filter(Boolean);

  return haystack.some((part) => part.includes(search));
};
