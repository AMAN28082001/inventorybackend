'use strict';

/** Quotation products: earthing wire size (As per the set / 2mm / 4mm / 6mm / custom). */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('quotation_products', 'earthingWireSize', {
      type: Sequelize.STRING(100),
      allowNull: true,
      defaultValue: null
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('quotation_products', 'earthingWireSize');
  }
};
