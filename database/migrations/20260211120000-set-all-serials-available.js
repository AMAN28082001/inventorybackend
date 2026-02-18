"use strict";
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE product_serial_numbers
      SET status = 'available'
    `);
  },

  async down() {
    // No-op: cannot reliably restore previous statuses
  }
};
