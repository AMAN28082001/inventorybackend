"use strict";
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("product_serial_numbers", "dispatched_to_admin_id", {
      type: Sequelize.STRING(50),
      allowNull: true
    });
    await queryInterface.addColumn("product_serial_numbers", "dispatched_at", {
      type: Sequelize.DATE,
      allowNull: true
    });
    await queryInterface.addColumn("product_serial_numbers", "sale_id", {
      type: Sequelize.STRING(50),
      allowNull: true
    });
    await queryInterface.addColumn("product_serial_numbers", "sale_item_id", {
      type: Sequelize.STRING(50),
      allowNull: true
    });

    await queryInterface.addIndex("product_serial_numbers", ["sale_id"], {
      name: "idx_product_serial_numbers_sale_id"
    });
    await queryInterface.addIndex("product_serial_numbers", ["sale_item_id"], {
      name: "idx_product_serial_numbers_sale_item_id"
    });
    await queryInterface.addIndex("product_serial_numbers", ["dispatched_to_admin_id"], {
      name: "idx_product_serial_numbers_dispatched_to_admin_id"
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("product_serial_numbers", "idx_product_serial_numbers_dispatched_to_admin_id");
    await queryInterface.removeIndex("product_serial_numbers", "idx_product_serial_numbers_sale_item_id");
    await queryInterface.removeIndex("product_serial_numbers", "idx_product_serial_numbers_sale_id");
    await queryInterface.removeColumn("product_serial_numbers", "sale_item_id");
    await queryInterface.removeColumn("product_serial_numbers", "sale_id");
    await queryInterface.removeColumn("product_serial_numbers", "dispatched_at");
    await queryInterface.removeColumn("product_serial_numbers", "dispatched_to_admin_id");
  }
};
