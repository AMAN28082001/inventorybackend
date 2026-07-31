'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('quotations');
    if (!table.sourceQuotationId) {
      await queryInterface.addColumn('quotations', 'sourceQuotationId', {
        type: Sequelize.STRING(50),
        allowNull: true
      });
    }
    if (!table.notes) {
      await queryInterface.addColumn('quotations', 'notes', {
        type: Sequelize.TEXT,
        allowNull: true
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('quotations');
    if (table.notes) {
      await queryInterface.removeColumn('quotations', 'notes');
    }
    if (table.sourceQuotationId) {
      await queryInterface.removeColumn('quotations', 'sourceQuotationId');
    }
  }
};
