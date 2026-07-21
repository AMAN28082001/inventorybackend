'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('quotations');
    if (!table.finalSettlementBy) {
      await queryInterface.addColumn('quotations', 'finalSettlementBy', {
        type: Sequelize.STRING(50),
        allowNull: true
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('quotations');
    if (table.finalSettlementBy) {
      await queryInterface.removeColumn('quotations', 'finalSettlementBy');
    }
  }
};
