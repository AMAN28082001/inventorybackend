'use strict';

/** Quotation products: earthing wire brand (JMP / Polycab / Havells / custom / As per the set). */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('quotation_products', 'earthingWireBrand', {
      type: Sequelize.STRING(100),
      allowNull: true,
      defaultValue: null
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('quotation_products', 'earthingWireBrand');
  }
};
