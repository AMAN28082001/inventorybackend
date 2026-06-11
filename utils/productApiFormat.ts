import type Product from '../models/Product';
import { roundProductPrice } from './productUnit';

/** Ensure DECIMAL columns serialize as numbers with 2dp precision (not truncated integers). */
export const formatProductForApi = (product: Product | Record<string, unknown>) => {
  const json: Record<string, unknown> =
    typeof (product as Product).toJSON === 'function'
      ? ((product as Product).toJSON() as unknown as Record<string, unknown>)
      : (product as Record<string, unknown>);

  const unitPrice =
    json.unit_price != null && json.unit_price !== '' ? roundProductPrice(json.unit_price) : null;
  const sellingPrice =
    json.selling_price != null && json.selling_price !== ''
      ? roundProductPrice(json.selling_price)
      : null;

  const centralStock = json.quantity != null ? Number(json.quantity) : 0;

  return {
    ...json,
    quantity: centralStock,
    /** Same value as `quantity` — central warehouse stock used by dispatch validation. */
    central_stock: centralStock,
    unit_price: unitPrice,
    selling_price: sellingPrice,
    unit: (json.unit as string | null | undefined) ?? null
  };
};
