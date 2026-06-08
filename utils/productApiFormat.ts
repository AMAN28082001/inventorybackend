import type Product from '../models/Product';

/** Ensure DECIMAL columns serialize as numbers (not truncated strings) in JSON. */
export const formatProductForApi = (product: Product | Record<string, unknown>) => {
  const json: Record<string, unknown> =
    typeof (product as Product).toJSON === 'function'
      ? ((product as Product).toJSON() as unknown as Record<string, unknown>)
      : (product as Record<string, unknown>);

  return {
    ...json,
    quantity: json.quantity != null ? Number(json.quantity) : 0,
    unit_price: json.unit_price != null && json.unit_price !== '' ? Number(json.unit_price) : null,
    selling_price:
      json.selling_price != null && json.selling_price !== '' ? Number(json.selling_price) : null,
    unit: (json.unit as string | null | undefined) ?? null
  };
};
