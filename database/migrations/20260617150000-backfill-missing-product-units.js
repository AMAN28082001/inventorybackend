'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Fill legacy rows where unit is null/empty using category-based defaults.
    await queryInterface.sequelize.query(`
      UPDATE products
      SET unit = CASE
        WHEN LOWER(COALESCE(category, '')) LIKE '%cable%' THEN 'Meters'
        WHEN LOWER(COALESCE(category, '')) LIKE '%wire%' THEN 'Meters'
        WHEN LOWER(COALESCE(category, '')) LIKE '%panel%' THEN 'Quantity'
        WHEN LOWER(COALESCE(category, '')) LIKE '%inverter%' THEN 'Quantity'
        WHEN LOWER(COALESCE(category, '')) LIKE '%meter%' THEN 'Quantity'
        WHEN LOWER(COALESCE(category, '')) LIKE '%acdb%' THEN 'Quantity'
        WHEN LOWER(COALESCE(category, '')) LIKE '%dcdb%' THEN 'Quantity'
        WHEN LOWER(COALESCE(category, '')) LIKE '%battery%' THEN 'Quantity'
        WHEN LOWER(COALESCE(category, '')) LIKE '%connector%' THEN 'Quantity'
        WHEN LOWER(COALESCE(category, '')) LIKE '%clamp%' THEN 'Quantity'
        WHEN LOWER(COALESCE(category, '')) LIKE '%bolt%' THEN 'Quantity'
        WHEN LOWER(COALESCE(category, '')) LIKE '%nut%' THEN 'Quantity'
        ELSE 'Quantity'
      END
      WHERE unit IS NULL OR TRIM(unit) = '';
    `);
  },

  async down() {
    // Non-destructive rollback: keep populated units.
  }
};

