'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('quotations');
    if (!table.systemHistory) {
      await queryInterface.addColumn('quotations', 'systemHistory', {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: []
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('quotations');
    if (table.systemHistory) {
      await queryInterface.removeColumn('quotations', 'systemHistory');
    }
  }
};
