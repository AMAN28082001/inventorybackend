'use strict';

/**
 * Non-DCR Waaree 125kW @ ₹35,62,500 + catalog allow 125kW / 705W.
 * Merges into existing system_config JSON — does not drop other rows.
 */

const NON_DCR_WAAREE_125KW_PRICING = {
  systemSize: '125kW',
  phase: '3-Phase',
  inverterSize: '125kW',
  panelType: 'Waaree',
  price: 3562500
};

const NON_DCR_WAAREE_125KW_SYSTEM_CONFIG = {
  systemType: 'non-dcr',
  systemSize: '125kW',
  phase: '3-Phase',
  panelBrand: 'Waaree',
  panelSize: '580W',
  inverterBrand: 'Vsole/Xwatt',
  inverterSize: '125kW',
  inverterType: 'String Inverter',
  structureType: 'GI Structure',
  structureSize: '125kW',
  meterBrand: 'L&T',
  acCableBrand: 'Polycab',
  acCableSize: 'As per Set',
  dcCableBrand: 'Polycab',
  dcCableSize: 'As per Set',
  acdb: 'Havells (3-Phase)',
  dcdb: 'Havells (3-Phase)'
};

const parseConfig = (raw) => {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const normSize = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

const isWaaree = (value) =>
  String(value || '')
    .trim()
    .toLowerCase() === 'waaree';

const hasPricingRow = (rows) =>
  Array.isArray(rows) &&
  rows.some(
    (row) =>
      row &&
      normSize(row.systemSize) === '125kw' &&
      normSize(row.phase).includes('3') &&
      isWaaree(row.panelType)
  );

const hasConfigRow = (rows) =>
  Array.isArray(rows) &&
  rows.some(
    (row) =>
      row &&
      String(row.systemType || '')
        .trim()
        .toLowerCase()
        .replace(/_/g, '-') === 'non-dcr' &&
      normSize(row.systemSize) === '125kw' &&
      normSize(row.phase).includes('3') &&
      isWaaree(row.panelBrand)
  );

const mergeUnique = (list, extras) => {
  const out = [];
  const seen = new Set();
  for (const item of [...(Array.isArray(list) ? list : []), ...extras]) {
    const s = String(item || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
};

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(
      `SELECT "configKey", "configValue" FROM system_config
       WHERE "configKey" IN ('pricing_tables', 'product_catalog')`
    );

    const byKey = new Map((rows || []).map((row) => [row.configKey, row]));

    const pricingRow = byKey.get('pricing_tables');
    if (pricingRow) {
      const payload = parseConfig(pricingRow.configValue);
      if (payload && typeof payload === 'object') {
        const nonDcr = Array.isArray(payload.nonDcr) ? payload.nonDcr : [];
        const systemConfigs = Array.isArray(payload.systemConfigs)
          ? payload.systemConfigs
          : Array.isArray(payload.systemConfigurations)
            ? payload.systemConfigurations
            : [];
        if (!hasPricingRow(nonDcr)) nonDcr.push(NON_DCR_WAAREE_125KW_PRICING);
        if (!hasConfigRow(systemConfigs)) systemConfigs.push(NON_DCR_WAAREE_125KW_SYSTEM_CONFIG);
        payload.nonDcr = nonDcr;
        payload.systemConfigs = systemConfigs;
        payload.systemConfigurations = systemConfigs;
        await queryInterface.sequelize.query(
          `UPDATE system_config
           SET "configValue" = :configValue, "updatedAt" = NOW()
           WHERE "configKey" = 'pricing_tables'`,
          { replacements: { configValue: JSON.stringify(payload) } }
        );
      }
    }

    const catalogRow = byKey.get('product_catalog');
    if (catalogRow) {
      const catalog = parseConfig(catalogRow.configValue);
      if (catalog && typeof catalog === 'object') {
        catalog.panels = catalog.panels && typeof catalog.panels === 'object' ? catalog.panels : {};
        catalog.inverters =
          catalog.inverters && typeof catalog.inverters === 'object' ? catalog.inverters : {};
        catalog.structures =
          catalog.structures && typeof catalog.structures === 'object' ? catalog.structures : {};
        catalog.panels.sizes = mergeUnique(catalog.panels.sizes, ['700W', '705W']);
        catalog.inverters.sizes = mergeUnique(catalog.inverters.sizes, ['125kW']);
        catalog.structures.sizes = mergeUnique(catalog.structures.sizes, ['125kW']);
        await queryInterface.sequelize.query(
          `UPDATE system_config
           SET "configValue" = :configValue, "updatedAt" = NOW()
           WHERE "configKey" = 'product_catalog'`,
          { replacements: { configValue: JSON.stringify(catalog) } }
        );
      }
    }
  },

  async down(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(
      `SELECT "configKey", "configValue" FROM system_config WHERE "configKey" = 'pricing_tables'`
    );
    const row = rows && rows[0];
    if (!row) return;
    const payload = parseConfig(row.configValue);
    if (!payload || typeof payload !== 'object') return;
    const dropPricing = (list) =>
      (Array.isArray(list) ? list : []).filter(
        (item) =>
          !(
            item &&
            normSize(item.systemSize) === '125kw' &&
            isWaaree(item.panelType)
          )
      );
    const dropConfig = (list) =>
      (Array.isArray(list) ? list : []).filter(
        (item) =>
          !(
            item &&
            normSize(item.systemSize) === '125kw' &&
            isWaaree(item.panelBrand)
          )
      );
    payload.nonDcr = dropPricing(payload.nonDcr);
    payload.systemConfigs = dropConfig(payload.systemConfigs);
    payload.systemConfigurations = dropConfig(
      payload.systemConfigurations || payload.systemConfigs
    );
    await queryInterface.sequelize.query(
      `UPDATE system_config
       SET "configValue" = :configValue, "updatedAt" = NOW()
       WHERE "configKey" = 'pricing_tables'`,
      { replacements: { configValue: JSON.stringify(payload) } }
    );
  }
};
