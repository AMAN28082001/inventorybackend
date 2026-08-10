'use strict';

/** §30 — Account Management Cost of site on quotations. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('quotations');
    if (!table.site_cost && !table.siteCost) {
      await queryInterface.addColumn('quotations', 'site_cost', {
        type: Sequelize.DECIMAL(14, 2),
        allowNull: true
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('quotations');
    if (table.site_cost) {
      await queryInterface.removeColumn('quotations', 'site_cost');
    }
  }
};
