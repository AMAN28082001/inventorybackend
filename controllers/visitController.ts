import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';
import { Visit, VisitAssignment, Quotation, Visitor, Customer } from '../models/index-quotation';
import { logError, logInfo } from '../utils/loggerHelper';

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

// Create visit
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

    const quotation = await Quotation.findOne({
      where: { id: quotationId, dealerId: req.dealer.id }
    });

    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    const visit = await Visit.create({
      id: uuidv4(),
      quotationId,
      dealerId: req.dealer.id,
      visitDate,
      visitTime,
      location,
      locationLink: locationLink || null, // Allow null if not provided
      notes: notes || null,
      status: 'pending'
    });

    // Create visit assignments
    if (visitors && Array.isArray(visitors)) {
      for (const visitorData of visitors) {
        const visitor = await Visitor.findByPk(visitorData.visitorId);
        if (visitor) {
          await VisitAssignment.create({
            id: uuidv4(),
            visitId: visit.id,
            visitorId: visitor.id,
            visitorName: `${visitor.firstName} ${visitor.lastName}`
          });
        }
      }
    }

    // Get visit with assignments and visitor details
    const visitWithAssignments = await Visit.findByPk(visit.id, {
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

    logInfo('Visit created', { visitId: visit.id, quotationId, dealerId: req.dealer.id });

    const visitAny = visitWithAssignments as any;
    const assignments = visitAny.assignments || [];
    
    // Get full visitor details
    const formattedVisitors = assignments.map((a: any) => {
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

    const visitData = visitAny.toJSON();
    delete visitData.assignments; // Remove raw assignments, use formatted visitors instead
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

// Get all visits for dealer (visit schedule)
export const getAllVisits = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
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

    const formattedVisits = filteredVisits.map(v => {
      const vAny = v as any;
      const quotation = vAny.quotation;
      const customer = quotation?.customer;
      const assignments = vAny.assignments || [];

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
        images: v.images,
        feedback: v.feedback,
        rejectionReason: v.rejectionReason,
        visitors: visitors,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt
      };
    });

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

// Get visits for quotation
export const getVisitsForQuotation = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer && !req.visitor) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { quotationId } = req.params;
    
    // Check permissions
    let quotation;
    if (req.visitor) {
      // Visitors can only see visits for quotations from their assigned visits
      const visitorAssignments = await VisitAssignment.findAll({
        where: { visitorId: req.visitor.id },
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
    } else if (req.dealer) {
      // Dealers can see their own quotations, admins can see all
      const where: any = { id: quotationId };
      if (req.dealer.role !== 'admin') {
        where.dealerId = req.dealer.id;
      }
      quotation = await Quotation.findOne({ where });
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
        }
      ],
      order: [['visitDate', 'DESC'], ['visitTime', 'DESC']]
    });

    res.json({
      success: true,
      data: {
        visits: visits.map(v => {
          const vAny = v as any;
          const assignments = vAny.assignments || [];
          
          // Get full visitor details from the included Visitor model
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
            visitDate: v.visitDate,
            ...getVisitTimeFields(v.visitTime),
            location: v.location,
            locationLink: v.locationLink,
            notes: v.notes,
            status: v.status,
            length: v.length,
            width: v.width,
            height: v.height,
            images: v.images,
            feedback: v.feedback,
            rejectionReason: v.rejectionReason,
            visitors: visitors,
            createdAt: v.createdAt,
            updatedAt: v.updatedAt
          };
        })
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
    const assignment = (visitAny.assignments || []).find((a: any) => a.visitorId === req.visitor!.id);
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
    const { length, width, height, images, notes } = req.body;

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
    const assignment = (visitAny.assignments || []).find((a: any) => a.visitorId === req.visitor!.id);
    if (!assignment) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'You are not assigned to this visit' }
      });
      return;
    }

    await visit.update({
      status: 'completed',
      length,
      width,
      height,
      images: images || [],
      feedback: notes
    });

    res.json({
      success: true,
      data: {
        id: visit.id,
        status: visit.status,
        length: visit.length,
        width: visit.width,
        height: visit.height,
        images: visit.images,
        notes: visit.feedback || notes,
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
    const assignment = (visitAny.assignments || []).find((a: any) => a.visitorId === req.visitor!.id);
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

// Reschedule visit
export const rescheduleVisit = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.visitor) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { visitId } = req.params;
    const { reason, visitDate, visitTime } = req.body;

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
    const assignment = (visitAny.assignments || []).find((a: any) => a.visitorId === req.visitor!.id);
    if (!assignment) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'You are not assigned to this visit' }
      });
      return;
    }

    const updatePayload: any = {
      status: 'rescheduled',
      rejectionReason: reason
    };
    if (visitDate !== undefined) updatePayload.visitDate = visitDate;
    if (visitTime !== undefined) updatePayload.visitTime = visitTime;

    await visit.update(updatePayload);

    res.json({
      success: true,
      data: {
        id: visit.id,
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
    const assignment = (visitAny.assignments || []).find((a: any) => a.visitorId === req.visitor!.id);
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


