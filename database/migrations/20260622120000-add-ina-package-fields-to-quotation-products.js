'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('quotation_products', 'panelType', {
      type: Sequelize.STRING(64),
      allowNull: true,
      comment: 'DCR pricing column key (e.g. INA) — survives native INA packages'
    });
    await queryInterface.addColumn('quotation_products', 'inaDcrPackage', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'True when quotation uses INA DCR package (panelBrand INA)'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('quotation_products', 'inaDcrPackage');
    await queryInterface.removeColumn('quotation_products', 'panelType');
  }
};
