/**
 * Sale line persist + serialize helpers (HANDOFF §22 / BACKEND_SALES_LINE_ITEMS.ts).
 * Ensures quantity / unit_price / gst_rate / line amount are stored and returned as numbers.
 */

import { normalizeSaleQuantity } from './saleQuantity';
import { roundProductPrice } from './productUnit';

const toFiniteNumber = (value: unknown, fallback = NaN): number => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return toFiniteNumber(
      o.amount ?? o.value ?? o.quantity ?? o.qty ?? o.rate ?? o.price ?? o.number,
      fallback
    );
  }
  const n = Number(typeof value === 'string' ? value.replace(/,/g, '').trim() : value);
  return Number.isFinite(n) ? n : fallback;
};

export type NormalizedSaleLine = {
  product_id: string | null;
  quantity: number;
  unit_price: number;
  gst_rate: number;
  line_total: number;
  subtotal: number;
  serial_numbers?: string[] | null;
};

/** Normalize one request line (accept common aliases). */
export const normalizeIncomingSaleItem = (raw: Record<string, unknown> = {}): NormalizedSaleLine => {
  const product_id = String(raw.product_id || raw.productId || '').trim() || null;
  const quantity = normalizeSaleQuantity(
    raw.quantity ?? raw.qty ?? raw.Qty ?? raw.billedqty ?? raw.billed_qty ?? raw.billedQty
  );
  const unit_price = roundProductPrice(
    toFiniteNumber(
      raw.unit_price ?? raw.unitPrice ?? raw.rate ?? raw.Rate ?? raw.price ?? raw.selling_price,
      NaN
    )
  );
  const gst_rate = toFiniteNumber(raw.gst_rate ?? raw.gstRate ?? raw.tax_rate ?? raw.taxRate, 0);
  let line_total = toFiniteNumber(
    raw.subtotal ??
      raw.line_total ??
      raw.lineTotal ??
      raw.amount ??
      raw.Amount ??
      raw.line_amount ??
      raw.lineAmount,
    NaN
  );
  if (!(line_total >= 0) && Number.isFinite(quantity) && Number.isFinite(unit_price ?? NaN)) {
    line_total = roundProductPrice((quantity as number) * (unit_price as number)) ??
      (quantity as number) * (unit_price as number);
  } else if (Number.isFinite(line_total)) {
    line_total = roundProductPrice(line_total) ?? line_total;
  }

  const serialRaw = raw.serial_numbers ?? raw.serialNumbers;
  let serial_numbers: string[] | null = null;
  if (Array.isArray(serialRaw)) {
    serial_numbers = serialRaw.map(String).map((s) => s.trim()).filter(Boolean);
  } else if (typeof serialRaw === 'string' && serialRaw.trim()) {
    serial_numbers = serialRaw
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return {
    product_id,
    quantity: Number.isFinite(quantity) ? (quantity as number) : NaN,
    unit_price: unit_price ?? NaN,
    gst_rate: Number.isFinite(gst_rate) ? gst_rate : 0,
    line_total: Number.isFinite(line_total) ? (line_total as number) : NaN,
    subtotal: Number.isFinite(line_total) ? (line_total as number) : NaN,
    serial_numbers
  };
};

/** Sale header money fields — prefer body, else sum lines. */
export const resolveSaleMoneyFields = (
  body: Record<string, unknown> = {},
  itemRows: Array<{ quantity?: number; unit_price?: number; gst_rate?: number; line_total?: number; subtotal?: number }> = []
) => {
  const itemsSubtotal = itemRows.reduce(
    (a, r) => a + Number(r.subtotal ?? r.line_total ?? 0),
    0
  );
  const itemsTax = itemRows.reduce((a, r) => {
    const base = Number(r.quantity || 0) * Number(r.unit_price || 0);
    return a + (base * Number(r.gst_rate || 0)) / 100;
  }, 0);

  const subtotal = toFiniteNumber(body.subtotal ?? body.sub_total, itemsSubtotal);
  const tax_amount = toFiniteNumber(body.tax_amount ?? body.taxAmount, itemsTax);
  const discount_amount = toFiniteNumber(body.discount_amount ?? body.discountAmount, 0);
  let total_amount = toFiniteNumber(
    body.total_amount ?? body.totalAmount ?? body.final_amount ?? body.finalAmount,
    NaN
  );
  if (!(total_amount > 0)) {
    total_amount = Math.max(0, subtotal + tax_amount - discount_amount);
  }
  return {
    subtotal: Number.isFinite(subtotal) ? subtotal : 0,
    tax_amount: Number.isFinite(tax_amount) ? tax_amount : 0,
    discount_amount: Number.isFinite(discount_amount) ? discount_amount : 0,
    total_amount: Number.isFinite(total_amount) ? total_amount : 0
  };
};

/** JSON shape frontend expects for each line on GET /sales and GET /sales/:id. */
export const serializeSaleItemApi = (
  row: Record<string, unknown>,
  product: { id?: string; name?: string | null; model?: string | null; unit_price?: unknown } | null = null
) => {
  const quantity = toFiniteNumber(row.quantity ?? row.qty, 0);
  const unit_price = toFiniteNumber(row.unit_price ?? row.unitPrice ?? row.rate, 0);
  const gst_rate = toFiniteNumber(row.gst_rate ?? row.gstRate, 0);
  const subtotal = toFiniteNumber(
    row.subtotal ??
      row.line_total ??
      row.lineTotal ??
      (quantity > 0 && unit_price >= 0 ? quantity * unit_price : 0),
    0
  );
  const productId = (row.product_id || row.productId || product?.id || null) as string | null;
  const productName =
    (product?.name as string | undefined) ||
    (row.product_name as string | undefined) ||
    undefined;

  return {
    id: row.id,
    product_id: productId,
    product: product
      ? {
          id: product.id,
          name: product.name ?? null,
          model: product.model ?? null,
          unit_price: toFiniteNumber(product.unit_price, 0)
        }
      : row.product && typeof row.product === 'object'
        ? {
            id: (row.product as any).id,
            name: (row.product as any).name ?? null,
            model: (row.product as any).model ?? null,
            unit_price: toFiniteNumber((row.product as any).unit_price, 0)
          }
        : productId
          ? { id: productId, name: productName ?? null, model: (row.model as string) || null }
          : undefined,
    product_name: productName,
    model: (product?.model as string | undefined) || (row.model as string | undefined) || undefined,
    quantity,
    qty: quantity,
    unit_price,
    rate: unit_price,
    gst_rate,
    subtotal,
    line_total: subtotal,
    amount: subtotal,
    serial_numbers: Array.isArray(row.serial_numbers)
      ? row.serial_numbers
      : Array.isArray(row.serialNumbers)
        ? row.serialNumbers
        : []
  };
};

export const serializeSaleMoneyApi = (sale: Record<string, unknown>) => {
  const money = {
    subtotal: toFiniteNumber(sale.subtotal, 0),
    tax_amount: toFiniteNumber(sale.tax_amount ?? sale.taxAmount, 0),
    discount_amount: toFiniteNumber(sale.discount_amount ?? sale.discountAmount, 0),
    total_amount: toFiniteNumber(
      sale.total_amount ?? sale.totalAmount ?? sale.final_amount ?? sale.finalAmount,
      0
    ),
    total_quantity: toFiniteNumber(sale.total_quantity ?? sale.totalQuantity, 0)
  };
  if (!(money.total_amount > 0)) {
    money.total_amount = Math.max(0, money.subtotal + money.tax_amount - money.discount_amount);
  }
  return {
    ...money,
    taxAmount: money.tax_amount,
    discountAmount: money.discount_amount,
    totalAmount: money.total_amount,
    totalQuantity: money.total_quantity
  };
};
