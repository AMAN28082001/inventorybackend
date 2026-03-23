'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const keys = ['product_catalog', 'pricing_tables'];
    const [rows] = await queryInterface.sequelize.query(
      `SELECT "configKey", "configValue" FROM system_config WHERE "configKey" IN (:keys)`,
      { replacements: { keys } }
    );

    const replaceDeep = (input) => {
      if (Array.isArray(input)) {
        return input.map(replaceDeep);
      }
      if (input && typeof input === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(input)) {
          out[k] = replaceDeep(v);
        }
        return out;
      }
      if (typeof input === 'string') {
        return input.replace(/\b545W\b/g, '550W');
      }
      return input;
    };

    for (const row of rows || []) {
      try {
        const parsed = JSON.parse(row.configValue);
        const updated = replaceDeep(parsed);
        await queryInterface.sequelize.query(
          `UPDATE system_config SET "configValue" = :value, "updatedAt" = NOW() WHERE "configKey" = :key`,
          {
            replacements: {
              key: row.configKey,
              value: JSON.stringify(updated)
            }
          }
        );
      } catch (_err) {
        // Ignore invalid JSON configs and continue.
      }
    }
  },

  async down(queryInterface) {
    const keys = ['product_catalog', 'pricing_tables'];
    const [rows] = await queryInterface.sequelize.query(
      `SELECT "configKey", "configValue" FROM system_config WHERE "configKey" IN (:keys)`,
      { replacements: { keys } }
    );

    const replaceDeep = (input) => {
      if (Array.isArray(input)) {
        return input.map(replaceDeep);
      }
      if (input && typeof input === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(input)) {
          out[k] = replaceDeep(v);
        }
        return out;
      }
      if (typeof input === 'string') {
        return input.replace(/\b550W\b/g, '545W');
      }
      return input;
    };

    for (const row of rows || []) {
      try {
        const parsed = JSON.parse(row.configValue);
        const updated = replaceDeep(parsed);
        await queryInterface.sequelize.query(
          `UPDATE system_config SET "configValue" = :value, "updatedAt" = NOW() WHERE "configKey" = :key`,
          {
            replacements: {
              key: row.configKey,
              value: JSON.stringify(updated)
            }
          }
        );
      } catch (_err) {
        // Ignore invalid JSON configs and continue.
      }
    }
  }
};
