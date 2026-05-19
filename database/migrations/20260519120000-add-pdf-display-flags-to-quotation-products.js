'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('quotation_products', 'pdfUsePanelSizeRange', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'When true, client PDF shows panel size range 540W-620W instead of exact panelSize'
    });
    await queryInterface.addColumn('quotation_products', 'pdfUseInverterBrandOptions', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'When true, client PDF shows multi-brand inverter line instead of exact inverterBrand'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('quotation_products', 'pdfUseInverterBrandOptions');
    await queryInterface.removeColumn('quotation_products', 'pdfUsePanelSizeRange');
  }
};
