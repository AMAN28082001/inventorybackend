'use strict';

/** PDF-only: commercial set — hide subsidy on proposal PDF (§X). */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('quotation_products', 'pdfCommercialSet', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('quotation_products', 'pdfCommercialSet');
  }
};
