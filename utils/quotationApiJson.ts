import { readSubsidyChequesFromRow } from './subsidyChequesNormalize';
import { quotationProductPdfDisplayApiFields } from './quotationProductPdfDisplay';
import { computeSystemKwFromProducts, formatSystemSizeKw } from './quotationSystemKw';

export type QuotationStatusHistoryEntry = { status: string; at: string };

/**
 * Read statusHistory from DB row (JSON array, JSON string, or snake_case key).
 */
export function readStatusHistoryFromRow(q: Record<string, unknown>): QuotationStatusHistoryEntry[] {
  const raw = q.statusHistory ?? q.status_history;
  if (Array.isArray(raw)) {
    return raw.filter((e): e is QuotationStatusHistoryEntry => !!e && typeof e === 'object' && typeof (e as any).status === 'string' && typeof (e as any).at === 'string');
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const p = JSON.parse(raw) as unknown;
      return Array.isArray(p)
        ? p.filter((e): e is QuotationStatusHistoryEntry => !!e && typeof e === 'object' && typeof (e as any).status === 'string' && typeof (e as any).at === 'string')
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toIsoStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return null;
}

/** DATEONLY / YYYY-MM-DD for API responses (camelCase + snake_case consumers). */
export function toDateOnlyStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const s = v.trim();
    return s.length >= 10 ? s.slice(0, 10) : s;
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return null;
}

/**
 * Mirrors BACKEND_ADMIN_QUOTATION_STATUS.ts → quotationToApiJson (payment/bank slice).
 * Use on Sequelize instances or plain row objects.
 */
export type QuotationPricingSlice = {
  subtotal?: number;
  totalAmount?: number;
  finalAmount?: number;
};

/**
 * Root-level amounts for list/detail (dealer dashboard Total Value: subtotal → totalAmount → finalAmount).
 */
export function quotationAmountApiFields(
  row: Record<string, unknown>,
  pricing?: QuotationPricingSlice | null
) {
  const subtotalRaw = row.subtotal ?? row.sub_total;
  const subtotal =
    subtotalRaw !== undefined && subtotalRaw !== null
      ? Number(subtotalRaw)
      : pricing?.subtotal !== undefined
        ? Number(pricing.subtotal)
        : 0;

  const totalAmountRaw = row.totalAmount ?? row.total_amount;
  const totalAmount =
    totalAmountRaw !== undefined && totalAmountRaw !== null
      ? Number(totalAmountRaw)
      : pricing?.totalAmount !== undefined
        ? Number(pricing.totalAmount)
        : subtotal;

  const finalAmountRaw = row.finalAmount ?? row.final_amount;
  const finalAmount =
    finalAmountRaw !== undefined && finalAmountRaw !== null
      ? Number(finalAmountRaw)
      : pricing?.finalAmount !== undefined
        ? Number(pricing.finalAmount)
        : totalAmount;

  return {
    subtotal,
    totalAmount,
    finalAmount,
    total_amount: totalAmount,
    final_amount: finalAmount
  };
}

/** Approved-row amount for dealer dashboard (matches AMOUNT column: subtotal → totalAmount → finalAmount). */
export function approvedQuotationValueFromRow(row: {
  subtotal?: unknown;
  sub_total?: unknown;
  totalAmount?: unknown;
  total_amount?: unknown;
  finalAmount?: unknown;
  final_amount?: unknown;
}): number {
  const pick = (value: unknown): number | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  };
  const amount =
    pick(row.subtotal ?? row.sub_total) ??
    pick(row.totalAmount ?? row.total_amount) ??
    pick(row.finalAmount ?? row.final_amount) ??
    0;
  return Math.abs(amount);
}

function toPlainProductRow(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof (value as { toJSON?: () => unknown }).toJSON === 'function') {
    return (value as { toJSON: () => unknown }).toJSON() as Record<string, unknown>;
  }
  if (typeof (value as { get?: (opts: { plain: true }) => unknown }).get === 'function') {
    return (value as { get: (opts: { plain: true }) => unknown }).get({ plain: true }) as Record<
      string,
      unknown
    >;
  }
  if (typeof value === 'object') return value as Record<string, unknown>;
  return null;
}

/** Full products blob for list/detail (admin kW, payment UI, PDF). */
export function quotationProductsApiFields(
  products: Record<string, unknown> | null | undefined,
  customPanels?: unknown[] | null
) {
  const plainProducts = toPlainProductRow(products);
  if (!plainProducts) return null;
  const panels = (customPanels || []).map((cp: unknown) => {
    const row =
      cp && typeof (cp as { toJSON?: () => unknown }).toJSON === 'function'
        ? ((cp as { toJSON: () => unknown }).toJSON() as Record<string, unknown>)
        : (cp as Record<string, unknown>);
    return {
      brand: row.brand,
      size: row.size,
      quantity: row.quantity,
      type: row.type,
      price: row.price !== undefined && row.price !== null ? Number(row.price) : undefined
    };
  });
  return {
    systemType: plainProducts.systemType ?? plainProducts.system_type,
    phase: plainProducts.phase,
    panelBrand: plainProducts.panelBrand ?? plainProducts.panel_brand,
    panelSize: plainProducts.panelSize ?? plainProducts.panel_size,
    panelQuantity: plainProducts.panelQuantity ?? plainProducts.panel_quantity,
    dcrPanelBrand: plainProducts.dcrPanelBrand ?? plainProducts.dcr_panel_brand,
    dcrPanelSize: plainProducts.dcrPanelSize ?? plainProducts.dcr_panel_size,
    dcrPanelQuantity: plainProducts.dcrPanelQuantity ?? plainProducts.dcr_panel_quantity,
    nonDcrPanelBrand: plainProducts.nonDcrPanelBrand ?? plainProducts.non_dcr_panel_brand,
    nonDcrPanelSize: plainProducts.nonDcrPanelSize ?? plainProducts.non_dcr_panel_size,
    nonDcrPanelQuantity: plainProducts.nonDcrPanelQuantity ?? plainProducts.non_dcr_panel_quantity,
    inverterType: plainProducts.inverterType ?? plainProducts.inverter_type,
    inverterBrand: plainProducts.inverterBrand ?? plainProducts.inverter_brand,
    inverterSize: plainProducts.inverterSize ?? plainProducts.inverter_size,
    structureType: plainProducts.structureType ?? plainProducts.structure_type,
    structureSize: plainProducts.structureSize ?? plainProducts.structure_size,
    meterBrand: plainProducts.meterBrand ?? plainProducts.meter_brand,
    acCableBrand: plainProducts.acCableBrand ?? plainProducts.ac_cable_brand,
    acCableSize: plainProducts.acCableSize ?? plainProducts.ac_cable_size,
    dcCableBrand: plainProducts.dcCableBrand ?? plainProducts.dc_cable_brand,
    dcCableSize: plainProducts.dcCableSize ?? plainProducts.dc_cable_size,
    acdb: plainProducts.acdb,
    dcdb: plainProducts.dcdb,
    hybridInverter: plainProducts.hybridInverter ?? plainProducts.hybrid_inverter,
    batteryCapacity: plainProducts.batteryCapacity ?? plainProducts.battery_capacity,
    batteryPrice:
      plainProducts.batteryPrice !== undefined && plainProducts.batteryPrice !== null
        ? Number(plainProducts.batteryPrice)
        : plainProducts.battery_price !== undefined && plainProducts.battery_price !== null
          ? Number(plainProducts.battery_price)
          : null,
    centralSubsidy: Number((plainProducts.centralSubsidy ?? plainProducts.central_subsidy) || 0),
    stateSubsidy: Number((plainProducts.stateSubsidy ?? plainProducts.state_subsidy) || 0),
    ...(panels.length > 0 ? { customPanels: panels } : {}),
    ...quotationProductPdfDisplayApiFields(plainProducts as any)
  };
}

function resolveSystemKwForApi(
  merged: ReturnType<typeof quotationProductsApiFields> | null,
  customPanels: unknown[] | null | undefined,
  quotationSystemType: string | null | undefined,
  storedSystemKw?: unknown
): number {
  const computed = computeSystemKwFromProducts(merged, customPanels, quotationSystemType);
  if (storedSystemKw !== undefined && storedSystemKw !== null && storedSystemKw !== '') {
    const stored = Number(storedSystemKw);
    if (Number.isFinite(stored) && stored > 0) {
      return Math.round(stored * 100) / 100;
    }
  }
  return computed;
}

/** Flatten panel fields to quotation root for clients that do not read nested `products`. */
export function quotationPanelRootApiFields(
  merged: ReturnType<typeof quotationProductsApiFields> | null
) {
  if (!merged) return {};
  const pick = (camel: keyof typeof merged, snake: string) => {
    const v = merged[camel];
    if (v === undefined || v === null) return {};
    return { [camel]: v, [snake]: v };
  };
  return {
    ...pick('systemType', 'system_type'),
    ...pick('panelSize', 'panel_size'),
    ...pick('panelQuantity', 'panel_quantity'),
    ...pick('dcrPanelSize', 'dcr_panel_size'),
    ...pick('dcrPanelQuantity', 'dcr_panel_quantity'),
    ...pick('nonDcrPanelSize', 'non_dcr_panel_size'),
    ...pick('nonDcrPanelQuantity', 'non_dcr_panel_quantity'),
    ...pick('inverterSize', 'inverter_size'),
    ...pick('structureSize', 'structure_size')
  };
}

/** List/detail: products + aliases + systemKw + optional root panel flatten. */
export function quotationProductEnrichmentFields(
  products: Record<string, unknown> | null | undefined,
  customPanels?: unknown[] | null,
  quotationSystemType?: string | null,
  storedSystemKw?: unknown
) {
  const listFields = quotationProductListApiFields(
    products,
    customPanels,
    quotationSystemType,
    storedSystemKw
  );
  return {
    ...listFields,
    ...quotationPanelRootApiFields(listFields.products)
  };
}

/** List/detail aliases for frontend `lib/merge-quotation-products.ts`. */
export function quotationProductListApiFields(
  products: Record<string, unknown> | null | undefined,
  customPanels?: unknown[] | null,
  quotationSystemType?: string | null,
  storedSystemKw?: unknown
) {
  const merged = quotationProductsApiFields(products, customPanels);
  const systemKw = resolveSystemKwForApi(merged, customPanels, quotationSystemType, storedSystemKw);
  const systemSize = formatSystemSizeKw(systemKw);
  if (!merged) {
    return {
      products: null,
      quotationProduct: null,
      quotationProducts: [] as ReturnType<typeof quotationProductsApiFields>[],
      systemKw,
      system_kw: systemKw,
      systemSize,
      system_size: systemSize
    };
  }
  return {
    products: merged,
    quotationProduct: merged,
    quotationProducts: [merged],
    systemKw,
    system_kw: systemKw,
    systemSize,
    system_size: systemSize
  };
}

export function quotationPaymentApiFields(q: Record<string, unknown>) {
  const paymentMode = (q.paymentMode ?? q.payment_mode ?? null) as string | null;
  const paymentType = (
    q.filePaymentType ??
    q.file_payment_type ??
    q.paymentType ??
    q.payment_type ??
    paymentMode ??
    null
  ) as string | null;
  const bankName = (q.bankName ?? q.bank_name ?? null) as string | null;
  const bankIfsc = (q.bankIfsc ?? q.bank_ifsc ?? null) as string | null;
  return {
    paymentMode,
    payment_mode: paymentMode,
    paymentType,
    payment_type: paymentType,
    bankName,
    bank_name: bankName,
    bankIfsc,
    bank_ifsc: bankIfsc
  };
}

/**
 * Subsidy cheque, file-login workflow, approval timestamp, status history (admin + detail APIs).
 */
export function quotationAdminMetadataFields(q: Record<string, unknown>) {
  const subsidyChequeDetails = (q.subsidyChequeDetails ?? q.subsidy_cheque_details ?? null) as string | null;
  const fileLoginStatus = (q.fileLoginStatus ?? q.file_login_status ?? null) as string | null;
  const filePaymentType = (q.filePaymentType ?? q.file_payment_type ?? null) as string | null;
  const fileBankName = (q.fileBankName ?? q.file_bank_name ?? null) as string | null;
  const fileBankIfsc = (q.fileBankIfsc ?? q.file_bank_ifsc ?? null) as string | null;
  const fileSubsidyChequeDetails = (q.fileSubsidyChequeDetails ?? q.file_subsidy_cheque_details ?? null) as string | null;
  const fileLoginAt = toIsoStringOrNull(q.fileLoginAt ?? q.file_login_at);
  const statusApprovedAt = toIsoStringOrNull(q.statusApprovedAt ?? q.status_approved_at);
  const approvedAt = toIsoStringOrNull(q.approvedAt ?? q.approved_at ?? statusApprovedAt);
  const installationReadyForInstaller = Boolean(
    q.installationReadyForInstaller ?? q.installation_ready_for_installer ?? false
  );
  const installationReleasedAt = toIsoStringOrNull(
    q.installationReleasedAt ?? q.installation_released_at
  );
  const installationScheduledAt = toDateOnlyStringOrNull(
    q.installationScheduledAt ?? q.installation_scheduled_at
  );
  const installationTeamId = (q.installationTeamId ?? q.installation_team_id ?? null) as string | null;
  const statusHistory = readStatusHistoryFromRow(q);
  const subsidyCheques = readSubsidyChequesFromRow(q);
  return {
    subsidyChequeDetails,
    subsidy_cheque_details: subsidyChequeDetails,
    subsidyCheques,
    subsidy_cheques: subsidyCheques,
    fileLoginStatus,
    file_login_status: fileLoginStatus,
    filePaymentType,
    file_payment_type: filePaymentType,
    fileBankName,
    file_bank_name: fileBankName,
    fileBankIfsc,
    file_bank_ifsc: fileBankIfsc,
    fileSubsidyChequeDetails,
    file_subsidy_cheque_details: fileSubsidyChequeDetails,
    fileLoginAt,
    file_login_at: fileLoginAt,
    statusApprovedAt,
    status_approved_at: statusApprovedAt,
    approvedAt,
    approved_at: approvedAt,
    installationReadyForInstaller,
    installation_ready_for_installer: installationReadyForInstaller,
    installationReleasedAt,
    installation_released_at: installationReleasedAt,
    installationScheduledAt,
    installation_scheduled_at: installationScheduledAt,
    installationTeamId,
    installation_team_id: installationTeamId,
    statusHistory,
    status_history: statusHistory
  };
}
