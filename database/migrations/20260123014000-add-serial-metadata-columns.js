'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('product_serial_numbers', 'product_name', {
      type: Sequelize.STRING(255),
      allowNull: true
    });

    await queryInterface.addColumn('product_serial_numbers', 'category', {
      type: Sequelize.STRING(255),
      allowNull: true
    });

    await queryInterface.sequelize.query(`
      UPDATE product_serial_numbers sn
      SET product_name = p.name,
          category = p.category
      FROM products p
      WHERE sn.product_id = p.id
        AND (sn.product_name IS NULL OR sn.category IS NULL)
    `);

    await queryInterface.changeColumn('product_serial_numbers', 'product_name', {
      type: Sequelize.STRING(255),
      allowNull: false
    });

    await queryInterface.changeColumn('product_serial_numbers', 'category', {
      type: Sequelize.STRING(255),
      allowNull: false
    });

    await queryInterface.addIndex('product_serial_numbers', ['product_name'], {
      name: 'idx_product_serial_numbers_product_name'
    });
    await queryInterface.addIndex('product_serial_numbers', ['category'], {
      name: 'idx_product_serial_numbers_category'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('product_serial_numbers', 'idx_product_serial_numbers_product_name');
    await queryInterface.removeIndex('product_serial_numbers', 'idx_product_serial_numbers_category');
    await queryInterface.removeColumn('product_serial_numbers', 'category');
    await queryInterface.removeColumn('product_serial_numbers', 'product_name');
  }
};
