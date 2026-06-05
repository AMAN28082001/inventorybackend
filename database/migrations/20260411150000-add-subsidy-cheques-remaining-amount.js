'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('quotations', 'subsidyCheques', {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: []
    });
    await queryInterface.addColumn('quotations', 'remainingAmount', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('quotations', 'remainingAmount');
    await queryInterface.removeColumn('quotations', 'subsidyCheques');
  }
};
