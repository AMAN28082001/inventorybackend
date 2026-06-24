import { Request } from 'express';
import { Op } from 'sequelize';
import {
  Customer,
  Dealer,
  Quotation,
  Visit,
  VisitAssignment
} from '../models/index-quotation';

export const normalizePhoneDigits = (value: unknown): string | null => {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length > 10) return digits.slice(-10);
  return null;
};

export const resolveDealerIdForInventoryUser = async (
  userId: string,
  username?: string
): Promise<string | null> => {
  const candidate = (username || '').trim();
  const orClauses: Record<string, string>[] = [];
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

/** Access scope for phone prefill — slightly broader than quotation list for stock-out agents. */
export const resolvePhoneLookupAccessWhere = async (
  req: Request
): Promise<Record<string, unknown> | null> => {
  const isAccountManager =
    req.user && (req.user.role === 'account-management' || req.user.role === 'hr');
  let where: Record<string, unknown> = {};

  if (isAccountManager) {
    where.status = 'approved';
  } else if (req.visitor) {
    const visitorAssignments = await VisitAssignment.findAll({
      where: { visitorId: req.visitor.id },
      attributes: ['visitId']
    });
    const visitIds = visitorAssignments.map((a) => a.visitId);
    if (!visitIds.length) return null;
    const visits = await Visit.findAll({
      where: { id: visitIds },
      attributes: ['quotationId']
    });
    const quotationIds = visits.map((v) => (v as { quotationId?: string }).quotationId).filter(Boolean);
    if (!quotationIds.length) return null;
    where.id = quotationIds;
  } else if (req.dealer) {
    where = req.dealer.role === 'admin' ? {} : { dealerId: req.dealer.id };
  } else if (req.user) {
    const role = req.user.role;
    const isInventoryAdmin =
      role === 'admin' || role === 'super-admin' || role === 'super-admin-manager';
    const isInventoryAccount = role === 'account';
    const isInventoryAgent = role === 'agent';

    if (isInventoryAdmin || isInventoryAccount) {
      where = {};
    } else if (isInventoryAgent) {
      const mappedDealerId = await resolveDealerIdForInventoryUser(req.user.id, req.user.username);
      // Stock-out prefill: still search by phone when mapping is missing (scoped by phone match).
      where = mappedDealerId ? { dealerId: mappedDealerId } : {};
    }
  }

  return where;
};

const mapQuotationCustomerToInventoryAddress = (customer: Customer) => ({
  line1: customer.streetAddress || '',
  line2: '',
  city: customer.city || '',
  state: customer.state || '',
  postal_code: customer.pincode || '',
  country: 'India'
});

const buildCustomerPayload = (customer: Customer) => {
  const customerName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim();
  const billingAddress = mapQuotationCustomerToInventoryAddress(customer);
  return {
    customer_name: customerName,
    customer_phone: customer.mobile,
    customer_email: customer.email || '',
    company_name: null as null,
    gst_number: null as null,
    contact_person: customerName,
    billing_address: billingAddress,
    delivery_address: { ...billingAddress },
    delivery_matches_billing: true as const
  };
};

const canBroadenPhoneLookup = (req: Request): boolean => {
  if (req.dealer || req.visitor) return false;
  const role = req.user?.role;
  return (
    role === 'admin' ||
    role === 'super-admin' ||
    role === 'super-admin-manager' ||
    role === 'agent' ||
    role === 'account'
  );
};

export type QuotationCustomerPhoneLookupResult = {
  success: true;
  source: 'quotation' | 'customer';
  customer: {
    customer_name: string;
    customer_phone: string;
    customer_email: string;
    company_name: null;
    gst_number: null;
    contact_person: string;
    billing_address: ReturnType<typeof mapQuotationCustomerToInventoryAddress>;
    delivery_address: ReturnType<typeof mapQuotationCustomerToInventoryAddress>;
    delivery_matches_billing: true;
  };
  quotation: {
    id: string;
    status: string;
    created_at: Date | string | null;
  } | null;
};

export const lookupQuotationCustomerByPhone = async (
  req: Request,
  phone: unknown
): Promise<QuotationCustomerPhoneLookupResult | null> => {
  const normalizedPhone = normalizePhoneDigits(phone);
  if (!normalizedPhone) return null;

  const accessWhere = await resolvePhoneLookupAccessWhere(req);
  if (accessWhere === null) return null;

  const customerCandidates = await Customer.findAll({
    where: {
      mobile: { [Op.iLike]: `%${normalizedPhone.slice(-6)}%` }
    } as Record<string, unknown>,
    limit: 25
  });
  const matchingCustomers = customerCandidates.filter(
    (row) => normalizePhoneDigits(row.mobile) === normalizedPhone
  );
  if (!matchingCustomers.length) return null;

  const customerIds = matchingCustomers.map((row) => row.id);
  let quotation = await Quotation.findOne({
    where: {
      ...accessWhere,
      customerId: { [Op.in]: customerIds }
    },
    include: [{ model: Customer, as: 'customer', required: true }],
    order: [['createdAt', 'DESC']]
  });

  if (!quotation && canBroadenPhoneLookup(req)) {
    quotation = await Quotation.findOne({
      where: {
        customerId: { [Op.in]: customerIds }
      },
      include: [{ model: Customer, as: 'customer', required: true }],
      order: [['createdAt', 'DESC']]
    });
  }

  if (quotation) {
    const quotationAny = quotation as Quotation & { createdAt?: Date; customer?: Customer };
    const customer = quotationAny.customer as Customer;
    return {
      success: true,
      source: 'quotation',
      customer: buildCustomerPayload(customer),
      quotation: {
        id: quotation.id,
        status: quotation.status,
        created_at: quotationAny.createdAt || null
      }
    };
  }

  if (!canBroadenPhoneLookup(req)) return null;

  const customer = matchingCustomers.sort(
    (a, b) =>
      new Date(b.updatedAt || b.createdAt).getTime() -
      new Date(a.updatedAt || a.createdAt).getTime()
  )[0];

  return {
    success: true,
    source: 'customer',
    customer: buildCustomerPayload(customer),
    quotation: null
  };
};
