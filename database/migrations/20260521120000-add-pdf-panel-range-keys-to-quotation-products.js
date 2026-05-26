'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('quotation_products', 'pdfPanelRangeKey', {
      type: Sequelize.STRING(80),
      allowNull: true,
      comment: 'PDF-only panel range preset (single/DCR/non-DCR scope per systemType)'
    });
    await queryInterface.addColumn('quotation_products', 'pdfDcrPanelRangeKey', {
      type: Sequelize.STRING(80),
      allowNull: true,
      comment: 'PDF-only panel range for BOTH — DCR line'
    });
    await queryInterface.addColumn('quotation_products', 'pdfNonDcrPanelRangeKey', {
      type: Sequelize.STRING(80),
      allowNull: true,
      comment: 'PDF-only panel range for BOTH — Non-DCR line'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('quotation_products', 'pdfNonDcrPanelRangeKey');
    await queryInterface.removeColumn('quotation_products', 'pdfDcrPanelRangeKey');
    await queryInterface.removeColumn('quotation_products', 'pdfPanelRangeKey');
  }
};
