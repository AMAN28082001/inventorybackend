/**
 * Admin Product Needed — installation-pending brand aggregates.
 * Spec: BACKEND_ADMIN_PRODUCT_NEEDED.ts / BACKEND_CHANGES_HANDOFF.md §13
 */

const N = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const str = (v: unknown): string => String(v ?? '').trim();

export function isAsPerTheSet(value: unknown): boolean {
  const s = str(value).toLowerCase().replace(/\s+/g, ' ');
  return s === 'as per the set' || s === 'as per set';
}

/** Normalize wattage labels → "540W". Pass through "As per the set". */
export function normalizeWattageSize(size: unknown): string {
  const s = str(size);
  if (!s) return '';
  if (isAsPerTheSet(s)) return 'As per the set';
  const m = s.match(/(\d+(?:\.\d+)?)\s*w/i);
  if (m) return `${m[1]}W`;
  if (/^\d+(\.\d+)?$/.test(s)) return `${s}W`;
  return s;
}

export function normalizeKwSize(size: unknown): string {
  const s = str(size);
  if (!s) return '';
  if (isAsPerTheSet(s)) return 'As per the set';
  const m = s.match(/(\d+(?:\.\d+)?)\s*kw/i);
  if (m) return `${m[1]}kW`;
  return s;
}

/** Pending Installation only — exclude partial / approved / metering / baldev. */
export const INSTALLATION_PENDING_STATUSES = ['pending_installer', 'installer_in_progress'] as const;

const EXCLUDED_STATUSES = new Set([
  'installer_partial_approved',
  'installer_approved',
  'installer_rejected',
  'pending_baldev',
  'baldev_approved',
  'baldev_rejected',
  'pending_metering',
  'metering_in_progress',
  'metering_approved',
  'meter_installation_pending',
  'mco',
  'completed'
]);

export function isReleasedToInstaller(q: Record<string, unknown>): boolean {
  return (
    q.installationReadyForInstaller === true ||
    q.installation_ready_for_installer === true ||
    q.installationReleasedAt != null ||
    q.installation_released_at != null ||
    INSTALLATION_PENDING_STATUSES.includes(
      str(q.installationStatus || q.installation_status) as (typeof INSTALLATION_PENDING_STATUSES)[number]
    )
  );
}

export type ProductNeededScope = 'installation_pending' | 'file_login';

const FILE_LOGIN_STATUSES = ['already_login', 'login_now'] as const;

export function parseProductNeededScope(query: {
  scope?: unknown;
  tab?: unknown;
}): ProductNeededScope {
  const raw = str(query.scope || query.tab).toLowerCase();
  if (raw === 'file_login' || raw === 'file-login') return 'file_login';
  return 'installation_pending';
}

function quotationStatusValue(q: Record<string, unknown>): string {
  return str(q.status || q.quotationStatus || q.quotation_status).toLowerCase();
}

export function isProductNeededRejected(q: Record<string, unknown>): boolean {
  const status = quotationStatusValue(q);
  return status === 'rejected' || status === 'reject';
}

export function hasFileLoginRecorded(q: Record<string, unknown>): boolean {
  const status = str(q.fileLoginStatus || q.file_login_status).toLowerCase();
  if (FILE_LOGIN_STATUSES.includes(status as (typeof FILE_LOGIN_STATUSES)[number])) return true;
  const at = q.fileLoginAt ?? q.file_login_at;
  return at != null && str(at) !== '';
}

/** File login recorded, quotation not approved, never rejected. */
export function isQuotationEligibleForProductNeededFileLogin(q: Record<string, unknown>): boolean {
  if (isProductNeededRejected(q)) return false;
  const status = quotationStatusValue(q);
  if (status === 'approved' || status === 'completed') return false;
  return hasFileLoginRecorded(q);
}

/** Same rules as frontend isQuotationEligibleForProductNeeded (installation pending). */
export function isQuotationEligibleForProductNeeded(q: Record<string, unknown>): boolean {
  if (isProductNeededRejected(q)) return false;
  if (quotationStatusValue(q) !== 'approved') return false;
  if (!isReleasedToInstaller(q)) return false;
  if (q.installerApprovedAt || q.installer_approved_at) return false;
  const inst = str(q.installationStatus || q.installation_status || 'pending_installer');
  if (EXCLUDED_STATUSES.has(inst)) return false;
  return (
    INSTALLATION_PENDING_STATUSES.includes(inst as (typeof INSTALLATION_PENDING_STATUSES)[number]) ||
    inst === '' ||
    inst === 'pending_installer'
  );
}

export function isQuotationEligibleForProductNeededScope(
  q: Record<string, unknown>,
  scope: ProductNeededScope
): boolean {
  if (isProductNeededRejected(q)) return false;
  if (scope === 'file_login') return isQuotationEligibleForProductNeededFileLogin(q);
  return isQuotationEligibleForProductNeeded(q);
}

export function resolveProductNeededDateColumn(
  dateField: unknown,
  scope: ProductNeededScope
): 'createdAt' | 'installationReleasedAt' | 'fileLoginAt' | 'statusApprovedAt' {
  const field = str(dateField).toLowerCase();
  if (field === 'created') return 'createdAt';
  if (field === 'file_login' || field === 'filelogin') return 'fileLoginAt';
  if (field === 'approved') return 'statusApprovedAt';
  if (field === 'installation_released') return 'installationReleasedAt';
  return scope === 'file_login' ? 'fileLoginAt' : 'installationReleasedAt';
}

function effectiveQty(quantity: unknown, sizeOrBrand: unknown): number {
  let qty = N(quantity);
  if (isAsPerTheSet(sizeOrBrand) && qty <= 0) return 1;
  return qty;
}

export type ProductNeededPanelLine = {
  brand: string;
  size: string;
  quantity: number;
  unit: 'sets' | 'panels';
  systemType: string | null;
  source: string;
  isAsPerTheSet: boolean;
};

export type ProductNeededInverterLine = {
  brand: string;
  size: string;
  quantity: number;
  unit: 'sets' | 'inverters';
  isAsPerTheSet: boolean;
};

export function buildPanelLines(products: Record<string, any> | null | undefined): ProductNeededPanelLine[] {
  const p = products || {};
  const lines: ProductNeededPanelLine[] = [];
  const push = ({
    brand,
    size,
    quantity,
    systemType,
    source
  }: {
    brand?: unknown;
    size?: unknown;
    quantity?: unknown;
    systemType?: string | null;
    source?: string;
  }) => {
    const b = str(brand);
    const rawSize = str(size);
    if (!b && !rawSize) return;
    const set = isAsPerTheSet(b) || isAsPerTheSet(rawSize);
    const sizeNorm = normalizeWattageSize(rawSize || (set ? 'As per the set' : ''));
    const qty = effectiveQty(quantity, set ? 'As per the set' : rawSize);
    lines.push({
      brand: b || 'Unknown',
      size: sizeNorm || (set ? 'As per the set' : ''),
      quantity: qty,
      unit: set ? 'sets' : 'panels',
      systemType: systemType || p.systemType || null,
      source: source || 'panel',
      isAsPerTheSet: set
    });
  };

  const systemType = str(p.systemType || p.system_type).toLowerCase();
  if (systemType === 'both') {
    push({
      brand: p.dcrPanelBrand ?? p.dcr_panel_brand ?? p.panelBrand,
      size: p.dcrPanelSize ?? p.dcr_panel_size,
      quantity: p.dcrPanelQuantity ?? p.dcr_panel_quantity,
      systemType: 'both-dcr',
      source: 'dcrPanel'
    });
    push({
      brand: p.nonDcrPanelBrand ?? p.non_dcr_panel_brand ?? p.panelBrand,
      size: p.nonDcrPanelSize ?? p.non_dcr_panel_size,
      quantity: p.nonDcrPanelQuantity ?? p.non_dcr_panel_quantity,
      systemType: 'both-nondcr',
      source: 'nonDcrPanel'
    });
  } else if (systemType === 'customize' && Array.isArray(p.customPanels || p.custom_panels)) {
    for (const row of p.customPanels || p.custom_panels) {
      push({
        brand: row.brand ?? row.panelBrand ?? p.panelBrand,
        size: row.size ?? row.panelSize,
        quantity: row.quantity ?? row.panelQuantity,
        systemType: 'customize',
        source: 'customPanel'
      });
    }
  } else {
    push({
      brand: p.panelBrand ?? p.panel_brand ?? p.dcrPanelBrand,
      size: p.panelSize ?? p.panel_size ?? p.dcrPanelSize,
      quantity: p.panelQuantity ?? p.panel_quantity ?? p.dcrPanelQuantity,
      systemType: systemType || null,
      source: 'panel'
    });
  }
  return lines;
}

export function buildInverterLine(
  products: Record<string, any> | null | undefined
): ProductNeededInverterLine | null {
  const p = products || {};
  const brand = str(p.inverterBrand ?? p.inverter_brand);
  const size = str(p.inverterSize ?? p.inverter_size);
  if (!brand && !size) return null;
  const set = isAsPerTheSet(brand) || isAsPerTheSet(size);
  let qty = N(p.inverterQuantity ?? p.inverter_quantity);
  if (set && qty <= 0) qty = 1;
  else if (qty <= 0) qty = 1;
  return {
    brand: brand || 'Unknown',
    size: normalizeKwSize(size || (set ? 'As per the set' : '')),
    quantity: qty,
    unit: set ? 'sets' : 'inverters',
    isAsPerTheSet: set
  };
}

export type BrandAggregateSize = {
  size: string;
  quantity: number;
  jobCount: number;
  unit: string;
};

export type BrandAggregateCard = {
  brand: string;
  totalQuantity: number;
  jobCount: number;
  sizes: BrandAggregateSize[];
};

export type BrandAggregates = {
  jobCount: number;
  totalPanels: number;
  totalInverters: number;
  panels: BrandAggregateCard[];
  inverters: BrandAggregateCard[];
};

/**
 * Brand aggregates for Overview cards.
 * Two Adani jobs (540W×10, 620W×5) → ONE Adani card with two size lines.
 * Two Tata set jobs qty 0 → Tata card quantity 2 (sets).
 */
export function buildBrandAggregates(rows: Array<Record<string, any>>): BrandAggregates {
  const panelMap = new Map<string, Map<string, BrandAggregateSize>>();
  const inverterMap = new Map<string, Map<string, BrandAggregateSize>>();

  const bump = (
    map: Map<string, Map<string, BrandAggregateSize>>,
    brand: string,
    size: string,
    quantity: unknown,
    unit: string
  ) => {
    const b = brand || 'Unknown';
    const s = size || 'Unknown';
    if (!map.has(b)) map.set(b, new Map());
    const sizes = map.get(b)!;
    const prev = sizes.get(s) || { size: s, quantity: 0, jobCount: 0, unit };
    prev.quantity += N(quantity);
    prev.jobCount += 1;
    prev.unit = unit;
    sizes.set(s, prev);
  };

  for (const row of rows) {
    for (const line of row.panelLines || []) {
      bump(panelMap, line.brand, line.size, line.quantity, line.unit || 'panels');
    }
    if (row.inverterBrand) {
      const set = isAsPerTheSet(row.inverterBrand) || isAsPerTheSet(row.inverterSize);
      bump(
        inverterMap,
        row.inverterBrand,
        row.inverterSize || (set ? 'As per the set' : 'Unknown'),
        row.inverterQuantity ?? 1,
        set ? 'sets' : 'inverters'
      );
    }
  }

  const toCards = (map: Map<string, Map<string, BrandAggregateSize>>): BrandAggregateCard[] =>
    [...map.entries()]
      .map(([brand, sizes]) => {
        const sizeList = [...sizes.values()].sort((a, b) => a.size.localeCompare(b.size));
        return {
          brand,
          totalQuantity: sizeList.reduce((a, s) => a + s.quantity, 0),
          jobCount: sizeList.reduce((a, s) => a + s.jobCount, 0),
          sizes: sizeList
        };
      })
      .sort((a, b) => a.brand.localeCompare(b.brand));

  const panels = toCards(panelMap);
  const inverters = toCards(inverterMap);
  return {
    jobCount: rows.length,
    totalPanels: panels.reduce((a, c) => a + c.totalQuantity, 0),
    totalInverters: inverters.reduce((a, c) => a + c.totalQuantity, 0),
    panels,
    inverters
  };
}

function dealerDisplayName(dealer: Record<string, any> | null | undefined): string | null {
  if (!dealer) return null;
  const n = [dealer.firstName, dealer.lastName].filter(Boolean).join(' ').trim();
  return n || dealer.username || dealer.name || null;
}

function resolveProductsBlob(quotation: Record<string, any>): Record<string, any> {
  if (quotation.products && typeof quotation.products === 'object' && !Array.isArray(quotation.products)) {
    // Sequelize hasOne may return model instance
    const p = quotation.products;
    return typeof p.toJSON === 'function' ? p.toJSON() : p;
  }
  if (quotation.quotationProduct && typeof quotation.quotationProduct === 'object') {
    const p = quotation.quotationProduct;
    return typeof p.toJSON === 'function' ? p.toJSON() : p;
  }
  if (Array.isArray(quotation.quotationProducts) && quotation.quotationProducts[0]) {
    const p = quotation.quotationProducts[0];
    return typeof p.toJSON === 'function' ? p.toJSON() : p;
  }
  return {};
}

export function serializeProductNeededRow(quotation: Record<string, any>) {
  const products = resolveProductsBlob(quotation);
  const panelLines = buildPanelLines(products);
  const inverter = buildInverterLine(products);
  const panelsSummary = panelLines.map((l) => `${l.brand} ${l.size} × ${l.quantity}`).join(', ');
  const systemKw =
    quotation.systemKw ??
    quotation.system_kw ??
    (products.systemSize || products.system_size || null);
  const customer = quotation.customer || {};
  const customerAddress =
    quotation.customerAddress ||
    customer.address ||
    [customer.streetAddress, customer.city, customer.state, customer.pincode]
      .map((part: unknown) => str(part))
      .filter(Boolean)
      .join(', ') ||
    null;

  return {
    quotationId: quotation.id,
    id: quotation.id,
    dealerId: quotation.dealerId || quotation.dealer_id || null,
    customerName:
      quotation.customerName ||
      [customer.firstName, customer.lastName].filter(Boolean).join(' ') ||
      null,
    customerMobile: quotation.phoneNumber || customer.mobile || null,
    customerAddress,
    dealerName: dealerDisplayName(quotation.dealer),
    systemKw: systemKw != null ? String(systemKw) : null,
    systemType: products.systemType || products.system_type || null,
    panels: panelsSummary,
    inverter: inverter ? `${inverter.brand}${inverter.size ? ` · ${inverter.size}` : ''}` : null,
    panelLines,
    inverterBrand: inverter?.brand || null,
    inverterSize: inverter?.size || null,
    inverterQuantity: inverter?.quantity ?? null,
    installationStatus: quotation.installationStatus || quotation.installation_status || 'pending_installer',
    installationReleasedAt: quotation.installationReleasedAt || quotation.installation_released_at || null,
    fileLoginAt: quotation.fileLoginAt || quotation.file_login_at || null,
    fileLoginStatus: quotation.fileLoginStatus || quotation.file_login_status || null,
    statusApprovedAt: quotation.statusApprovedAt || quotation.status_approved_at || null,
    quotationStatus: quotation.status,
    products
  };
}
