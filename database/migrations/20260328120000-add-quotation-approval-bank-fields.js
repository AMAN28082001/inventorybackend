'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('quotations', 'bankName', {
      type: Sequelize.STRING(255),
      allowNull: true
    });
    await queryInterface.addColumn('quotations', 'bankIfsc', {
      type: Sequelize.STRING(11),
      allowNull: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('quotations', 'bankName');
    await queryInterface.removeColumn('quotations', 'bankIfsc');
  }
};
