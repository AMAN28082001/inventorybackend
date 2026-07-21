'use strict';

/**
 * Final Settlement stores the absolute INR write-off in `discount` (as well as
 * `discountAmount`). The legacy `discount` column was numeric(5,2) (max 999.99),
 * intended for a percentage — writing an absolute amount (e.g. 7000) into it
 * caused "numeric field overflow" and a 500 on settle. Widen it to match the
 * money columns (numeric(12,2)).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('quotations', 'discount', {
      type: Sequelize.DECIMAL(12, 2),
      defaultValue: 0
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('quotations', 'discount', {
      type: Sequelize.DECIMAL(5, 2),
      defaultValue: 0
    });
  }
};
