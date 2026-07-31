/**
 * Quotation system history / revise+revert (§23).
 * See BACKEND_QUOTATION_SYSTEM_HISTORY.ts
 */

export const MAX_SYSTEM_HISTORY = 10;

export type QuotationSystemHistoryEntry = {
  products: Record<string, unknown>;
  pricing: {
    subtotal: number;
    stateSubsidy: number;
    centralSubsidy: number;
    discountAmount: number;
    totalAmount: number;
    finalAmount: number;
    pdfCommercialSet?: boolean;
  };
  label: string;
  savedAt: string;
  customPanels?: Array<Record<string, unknown>>;
};

export const readSystemHistory = (quotation: Record<string, unknown> | null | undefined): QuotationSystemHistoryEntry[] => {
  if (!quotation) return [];
  const raw = quotation.systemHistory ?? quotation.system_history ?? [];
  if (Array.isArray(raw)) return raw as QuotationSystemHistoryEntry[];
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as QuotationSystemHistoryEntry[]) : [];
    } catch {
      return [];
    }
  }
  return [];
};

/** Build one history entry from current quotation + products row + custom panels. */
export const buildSystemHistoryEntry = (args: {
  quotation: Record<string, unknown>;
  products?: Record<string, unknown> | null;
  customPanels?: Array<Record<string, unknown>> | null;
}): QuotationSystemHistoryEntry => {
  const { quotation } = args;
  const productsRaw = args.products || {};
  const products =
    typeof (productsRaw as any).toJSON === 'function'
      ? ((productsRaw as any).toJSON() as Record<string, unknown>)
      : { ...productsRaw };

  // Drop Sequelize internals / FK noise from snapshot
  delete products.id;
  delete products.quotationId;
  delete products.quotation_id;
  delete products.createdAt;
  delete products.updatedAt;
  delete products.created_at;
  delete products.updated_at;

  const customPanels = (args.customPanels || []).map((panel) => {
    const p =
      typeof (panel as any).toJSON === 'function'
        ? ((panel as any).toJSON() as Record<string, unknown>)
        : { ...panel };
    delete p.id;
    delete p.quotationId;
    delete p.quotation_id;
    delete p.createdAt;
    delete p.updatedAt;
    return p;
  });

  const brand = String(
    products.panelBrand ||
      products.panel_brand ||
      products.dcrPanelBrand ||
      products.dcr_panel_brand ||
      products.panelType ||
      ''
  ).trim();
  const systemType = String(
    products.systemType || products.system_type || quotation.systemType || ''
  )
    .trim()
    .toUpperCase();
  const label = [brand, systemType].filter(Boolean).join(' · ') || 'Previous system';

  const subtotal = Number(quotation.subtotal ?? products.systemPrice ?? 0);
  const stateSubsidy = Number(
    quotation.stateSubsidy ?? products.stateSubsidy ?? 0
  );
  const centralSubsidy = Number(
    quotation.centralSubsidy ?? products.centralSubsidy ?? 0
  );
  const discountAmount = Number(quotation.discountAmount ?? quotation.discount ?? 0);
  const totalAmount = Number(quotation.totalAmount ?? 0);
  const finalAmount = Number(quotation.finalAmount ?? totalAmount);
  const pdfCommercialSet = Boolean(
    products.pdfCommercialSet || products.pdf_commercial_set
  );

  return {
    products: {
      ...products,
      systemType: products.systemType || quotation.systemType || null,
      ...(customPanels.length > 0 ? { customPanels } : {})
    },
    pricing: {
      subtotal,
      stateSubsidy,
      centralSubsidy,
      discountAmount,
      totalAmount,
      finalAmount,
      pdfCommercialSet
    },
    label,
    savedAt: new Date().toISOString(),
    ...(customPanels.length > 0 ? { customPanels } : {})
  };
};

export const pushSystemHistory = (
  quotation: Record<string, unknown>,
  products?: Record<string, unknown> | null,
  customPanels?: Array<Record<string, unknown>> | null,
  entry: QuotationSystemHistoryEntry | null = null
): QuotationSystemHistoryEntry[] => {
  const stack = readSystemHistory(quotation);
  stack.push(entry || buildSystemHistoryEntry({ quotation, products, customPanels }));
  return stack.slice(-MAX_SYSTEM_HISTORY);
};

/**
 * Swap: restore previous, store current so user can revert again
 * (Adani → Waaree → revert Adani → revert Waaree).
 */
export const swapSystemHistory = (
  quotation: Record<string, unknown>,
  products?: Record<string, unknown> | null,
  customPanels?: Array<Record<string, unknown>> | null
): { previous: QuotationSystemHistoryEntry | null; nextHistory: QuotationSystemHistoryEntry[] } => {
  const stack = readSystemHistory(quotation);
  const previous = stack.pop() || null;
  if (!previous) return { previous: null, nextHistory: stack };
  stack.push(buildSystemHistoryEntry({ quotation, products, customPanels }));
  return {
    previous,
    nextHistory: stack.slice(-MAX_SYSTEM_HISTORY)
  };
};

/** Echo fields for GET /quotations/:id (and list if desired). */
export const quotationSystemHistoryApiFields = (
  quotation: Record<string, unknown> | null | undefined
) => {
  const systemHistory = readSystemHistory(quotation);
  return {
    systemHistory,
    system_history: systemHistory,
    canRevertSystem: systemHistory.length > 0,
    can_revert_system: systemHistory.length > 0,
    previousSystemLabel: systemHistory.length
      ? systemHistory[systemHistory.length - 1].label
      : null,
    previous_system_label: systemHistory.length
      ? systemHistory[systemHistory.length - 1].label
      : null
  };
};

/** Whether products PATCH should push history (revise flags or default true). */
export const shouldPushSystemHistoryOnProductsPatch = (
  body: Record<string, unknown> | null | undefined,
  query: Record<string, unknown> | null | undefined
): boolean => {
  if (body?.pushSystemHistory === false || body?.reviseSystem === false) return false;
  if (body?.skipSystemHistory === true) return false;
  if (
    body?.pushSystemHistory === true ||
    body?.reviseSystem === true ||
    query?.revise === '1' ||
    query?.revise === 'true'
  ) {
    return true;
  }
  // Default: always snapshot before products replace (safest for cross-device revert)
  return true;
};
