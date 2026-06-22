import { Op, Transaction, WhereOptions } from 'sequelize';
import { ProductSerialNumber } from '../models';

/**
 * Serial numbers required only for Panels and Inverters.
 * Meters never require serials; cables and other categories are optional unless
 * the product name implies panel/inverter stock (kwp, panel, inverter).
 */
export const requiresSerialNumbers = (
  category: string | null | undefined,
  productName?: string | null
): boolean => {
  const c = (category || '').toLowerCase().trim();
  if (c === 'meter' || c === 'meters') return false;
  if (['panels', 'panel', 'inverter', 'inverters'].includes(c)) return true;
  if (c.includes('panel') || c.includes('inverter')) return true;
  const name = (productName || '').toLowerCase();
  if (
    name.includes('meter') &&
    !name.includes('inverter') &&
    !name.includes('kwp') &&
    !name.includes('panel')
  ) {
    return false;
  }
  return name.includes('inverter') || name.includes('kwp') || name.includes('panel');
};

/** Dispatch and GET serial-numbers — same rule as product create/edit stock. */
export const productRequiresSerialOnDispatch = (
  category: string | null | undefined,
  productName?: string | null
): boolean => requiresSerialNumbers(category, productName);

const isSuperAdminRole = (role?: string): boolean =>
  role === 'super-admin' || role === 'super-admin-manager';

/** Same "available" rule for GET serial-numbers and dispatch — if GET lists it, dispatch must accept it. */
export const availableSerialStatusWhere = (): WhereOptions => ({
  status: { [Op.notIn]: ['dispatched', 'acknowledged', 'sold'] }
});

/**
 * Match serial rows by product_id OR product_name (case-insensitive).
 * Used by GET /products/:id/serial-numbers and POST .../dispatch.
 */
export const buildProductSerialIdentityMatch = (
  productId: string,
  productName?: string | null
): WhereOptions => {
  const orConditions: WhereOptions[] = [{ product_id: productId }];
  const trimmedName = (productName || '').trim();
  if (trimmedName) {
    orConditions.push({ product_name: { [Op.iLike]: trimmedName } });
  }
  return orConditions.length === 1 ? orConditions[0] : { [Op.or]: orConditions };
};

export const buildCentralOwnerScope = (userId?: string, userRole?: string): WhereOptions => ({
  [Op.or]: [
    { owner_id: null, owner_type: null },
    { owner_type: 'super-admin' },
    ...(isSuperAdminRole(userRole) && userId
      ? [{ owner_id: userId, owner_type: 'super-admin' as const }]
      : [])
  ]
});

export interface ProductSerialQueryOptions {
  productId: string;
  productName?: string | null;
  status?: 'available' | string;
  scope?: 'central' | 'admin' | 'all';
  ownerId?: string | null;
  userId?: string;
  userRole?: string;
  serialNumbers?: string[];
  serialRange?: { from: string; to: string };
  transaction?: Transaction;
  lock?: boolean;
}

export const buildProductSerialWhere = (options: ProductSerialQueryOptions): WhereOptions => {
  const conditions: WhereOptions[] = [
    buildProductSerialIdentityMatch(options.productId, options.productName)
  ];

  if (options.status === 'available') {
    conditions.push(availableSerialStatusWhere());
  } else if (options.status) {
    conditions.push({ status: options.status });
  }

  if (options.scope === 'central') {
    conditions.push(buildCentralOwnerScope(options.userId, options.userRole));
  } else if (options.scope === 'admin' && options.ownerId) {
    conditions.push({ owner_id: options.ownerId, owner_type: 'admin' });
  }

  if (options.serialNumbers?.length) {
    conditions.push({ serial_number: { [Op.in]: options.serialNumbers } });
  }

  if (options.serialRange) {
    conditions.push({
      serial_number: { [Op.between]: [options.serialRange.from, options.serialRange.to] }
    });
  }

  return conditions.length === 1 ? conditions[0] : { [Op.and]: conditions };
};

export const findProductSerialNumbers = async (
  options: ProductSerialQueryOptions
): Promise<ProductSerialNumber[]> => {
  const rows = await ProductSerialNumber.findAll({
    where: buildProductSerialWhere(options),
    order: options.serialRange ? [['serial_number', 'ASC']] : [['created_at', 'DESC']],
    ...(options.transaction ? { transaction: options.transaction } : {}),
    ...(options.lock && options.transaction
      ? { lock: options.transaction.LOCK.UPDATE }
      : {})
  });
  const deduped = new Map<string, ProductSerialNumber>();
  for (const row of rows) {
    deduped.set(row.id, row);
  }
  return Array.from(deduped.values());
};

/** Central super-admin dispatch: same lookup as GET ?status=available&scope=central */
export const findDispatchableCentralSerials = async (
  productId: string,
  productName: string,
  serialNumbers: string[],
  userId: string,
  userRole: string,
  transaction: Transaction
): Promise<ProductSerialNumber[]> =>
  findProductSerialNumbers({
    productId,
    productName,
    status: 'available',
    scope: 'central',
    serialNumbers,
    userId,
    userRole,
    transaction,
    lock: true
  });

export const findDispatchableCentralSerialsInRange = async (
  productId: string,
  productName: string,
  range: { from: string; to: string },
  userId: string,
  userRole: string,
  transaction: Transaction
): Promise<ProductSerialNumber[]> =>
  findProductSerialNumbers({
    productId,
    productName,
    status: 'available',
    scope: 'central',
    serialRange: range,
    userId,
    userRole,
    transaction,
    lock: true
  });
