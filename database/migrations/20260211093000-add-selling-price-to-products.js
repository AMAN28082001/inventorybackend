'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('products', 'selling_price', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: true
    });

    await queryInterface.sequelize.query(`
      UPDATE products
      SET selling_price = unit_price
      WHERE selling_price IS NULL AND unit_price IS NOT NULL
    `);

    await queryInterface.addIndex('products', ['selling_price'], {
      name: 'idx_products_selling_price'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('products', 'idx_products_selling_price');
    await queryInterface.removeColumn('products', 'selling_price');
  }
};
