'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('quotations');

    if (!table.installationReadyForInstaller) {
      await queryInterface.addColumn('quotations', 'installationReadyForInstaller', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      });
    }

    if (!table.installationReleasedAt) {
      await queryInterface.addColumn('quotations', 'installationReleasedAt', {
        type: Sequelize.DATE,
        allowNull: true
      });
    }

    const indexes = await queryInterface.showIndex('quotations');
    const hasReleaseIndex = indexes.some((idx) => idx.name === 'quotations_installation_ready_idx');
    if (!hasReleaseIndex) {
      await queryInterface.addIndex('quotations', ['installationReadyForInstaller'], {
        name: 'quotations_installation_ready_idx'
      });
    }
  },

  async down(queryInterface) {
    const indexes = await queryInterface.showIndex('quotations');
    const hasReleaseIndex = indexes.some((idx) => idx.name === 'quotations_installation_ready_idx');
    if (hasReleaseIndex) {
      await queryInterface.removeIndex('quotations', 'quotations_installation_ready_idx');
    }

    const table = await queryInterface.describeTable('quotations');
    if (table.installationReleasedAt) {
      await queryInterface.removeColumn('quotations', 'installationReleasedAt');
    }
    if (table.installationReadyForInstaller) {
      await queryInterface.removeColumn('quotations', 'installationReadyForInstaller');
    }
  }
};
