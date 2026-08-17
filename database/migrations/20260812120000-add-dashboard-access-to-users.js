'use strict';

/** Admin Users tab — checkbox dashboard access on dealers + account_managers. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const dealers = await queryInterface.describeTable('dealers');
    if (!dealers.access) {
      await queryInterface.addColumn('dealers', 'access', {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: []
      });
    }

    const accountManagers = await queryInterface.describeTable('account_managers');
    if (!accountManagers.access) {
      await queryInterface.addColumn('account_managers', 'access', {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: []
      });
    }
  },

  async down(queryInterface) {
    const dealers = await queryInterface.describeTable('dealers');
    if (dealers.access) {
      await queryInterface.removeColumn('dealers', 'access');
    }

    const accountManagers = await queryInterface.describeTable('account_managers');
    if (accountManagers.access) {
      await queryInterface.removeColumn('account_managers', 'access');
    }
  }
};
