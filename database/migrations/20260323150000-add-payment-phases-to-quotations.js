'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('quotations', 'paymentPhases', {
      type: Sequelize.JSONB,
      allowNull: true
    });

    await queryInterface.addColumn('quotations', 'paymentPlanUpdatedBy', {
      type: Sequelize.STRING(50),
      allowNull: true
    });

    await queryInterface.addColumn('quotations', 'paymentPlanUpdatedAt', {
      type: Sequelize.DATE,
      allowNull: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('quotations', 'paymentPlanUpdatedAt');
    await queryInterface.removeColumn('quotations', 'paymentPlanUpdatedBy');
    await queryInterface.removeColumn('quotations', 'paymentPhases');
  }
};
