'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('quotation_payment_phases');
    if (!table.note) {
      await queryInterface.addColumn('quotation_payment_phases', 'note', {
        type: Sequelize.TEXT,
        allowNull: true
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('quotation_payment_phases');
    if (table.note) {
      await queryInterface.removeColumn('quotation_payment_phases', 'note');
    }
  }
};
