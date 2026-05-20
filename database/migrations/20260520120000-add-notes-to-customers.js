'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const [rows] = await queryInterface.sequelize.query(
      "SELECT to_regclass('public.customers') AS table_name;"
    );
    if (!rows?.[0]?.table_name) return;

    const table = await queryInterface.describeTable('customers');
    if (!table.notes) {
      await queryInterface.addColumn('customers', 'notes', {
        type: Sequelize.TEXT,
        allowNull: true
      });
    }
  },

  async down(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(
      "SELECT to_regclass('public.customers') AS table_name;"
    );
    if (!rows?.[0]?.table_name) return;

    const table = await queryInterface.describeTable('customers');
    if (table.notes) {
      await queryInterface.removeColumn('customers', 'notes');
    }
  }
};
