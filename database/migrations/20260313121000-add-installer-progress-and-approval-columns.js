'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('quotations', 'approvedAt', {
      type: Sequelize.DATE,
      allowNull: true
    });

    await queryInterface.addColumn('quotations', 'installerInProgressAt', {
      type: Sequelize.DATE,
      allowNull: true
    });

    await queryInterface.addColumn('quotations', 'installerApprovedAt', {
      type: Sequelize.DATE,
      allowNull: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('quotations', 'installerApprovedAt');
    await queryInterface.removeColumn('quotations', 'installerInProgressAt');
    await queryInterface.removeColumn('quotations', 'approvedAt');
  }
};
