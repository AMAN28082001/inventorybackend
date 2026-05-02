'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('quotations');

    if (!table.installationScheduledAt) {
      await queryInterface.addColumn('quotations', 'installationScheduledAt', {
        type: Sequelize.DATEONLY,
        allowNull: true
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('quotations');
    if (table.installationScheduledAt) {
      await queryInterface.removeColumn('quotations', 'installationScheduledAt');
    }
  }
};
