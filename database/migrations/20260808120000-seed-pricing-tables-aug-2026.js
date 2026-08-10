'use strict';

const fs = require('fs');
const path = require('path');

/**
 * §2.6 — Seed Aug 2026 FE pricing catalog into system_config.pricing_tables
 * Source: BACKEND_PRICING_TABLES_SEED.json (from create-quotation-flow lib/pricing-tables.ts)
 */
module.exports = {
  async up(queryInterface) {
    const seedPath = path.join(__dirname, '../../BACKEND_PRICING_TABLES_SEED.json');
    if (!fs.existsSync(seedPath)) {
      throw new Error(`Missing seed file: ${seedPath}`);
    }
    const raw = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    const payload = {
      dcr: Array.isArray(raw.dcr) ? raw.dcr : [],
      nonDcr: Array.isArray(raw.nonDcr) ? raw.nonDcr : [],
      both: Array.isArray(raw.both) ? raw.both : [],
      panels: Array.isArray(raw.panels) ? raw.panels : [],
      inverters: Array.isArray(raw.inverters) ? raw.inverters : [],
      structures: Array.isArray(raw.structures) ? raw.structures : [],
      meters: Array.isArray(raw.meters) ? raw.meters : [],
      cables: Array.isArray(raw.cables) ? raw.cables : [],
      acdb: Array.isArray(raw.acdb) ? raw.acdb : [],
      dcdb: Array.isArray(raw.dcdb) ? raw.dcdb : [],
      systemConfigs: Array.isArray(raw.systemConfigs)
        ? raw.systemConfigs
        : Array.isArray(raw.systemConfigurations)
          ? raw.systemConfigurations
          : [],
      meta: raw.meta || {
        effectiveFrom: '2026-08-04',
        validTill: '2026-08-31',
        source: 'lib/pricing-tables.ts'
      },
      effectiveFrom: (raw.meta && raw.meta.effectiveFrom) || '2026-08-04',
      effectiveTo: (raw.meta && raw.meta.validTill) || '2026-08-31',
      validTill: (raw.meta && raw.meta.validTill) || '2026-08-31'
    };

    if (!payload.dcr.length) {
      throw new Error('BACKEND_PRICING_TABLES_SEED.json has empty dcr[]');
    }

    const [existing] = await queryInterface.sequelize.query(
      `SELECT "configKey", "configValue" FROM system_config WHERE "configKey" = 'pricing_tables' LIMIT 1`
    );

    const configValue = JSON.stringify(payload);
    const now = new Date();

    if (existing && existing.length > 0) {
      let shouldReplace = true;
      try {
        const current =
          typeof existing[0].configValue === 'string'
            ? JSON.parse(existing[0].configValue)
            : existing[0].configValue;
        const dcr = Array.isArray(current?.dcr) ? current.dcr : [];
        const hasWaareeTopcon = dcr.some((r) => r && r.panelType === 'Waaree Topcon');
        // Keep Admin edits if already seeded with Aug 2026 Waaree Topcon.
        if (hasWaareeTopcon && dcr.length >= 90) {
          shouldReplace = false;
        }
      } catch {
        shouldReplace = true;
      }
      if (shouldReplace) {
        await queryInterface.sequelize.query(
          `UPDATE system_config
           SET "configValue" = :configValue,
               "dataType" = 'json',
               description = :description,
               category = 'pricing',
               "updatedAt" = :updatedAt
           WHERE "configKey" = 'pricing_tables'`,
          {
            replacements: {
              configValue,
              description:
                'Pricing tables (Aug 2026 FE seed — BACKEND_PRICING_TABLES_SEED.json)',
              updatedAt: now
            }
          }
        );
      }
      return;
    }

    await queryInterface.bulkInsert('system_config', [
      {
        configKey: 'pricing_tables',
        configValue,
        dataType: 'json',
        description: 'Pricing tables (Aug 2026 FE seed — BACKEND_PRICING_TABLES_SEED.json)',
        category: 'pricing',
        updatedAt: now
      }
    ]);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM system_config WHERE "configKey" = 'pricing_tables'`
    );
  }
};
