'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const [[row]] = await queryInterface.sequelize.query(
      "SELECT to_regclass('public.customers') AS table_name;"
    );
    if (!row?.table_name) {
      return;
    }
    await queryInterface.changeColumn('customers', 'email', {
      type: Sequelize.STRING(255),
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    const [[row]] = await queryInterface.sequelize.query(
      "SELECT to_regclass('public.customers') AS table_name;"
    );
    if (!row?.table_name) {
      return;
    }
    await queryInterface.changeColumn('customers', 'email', {
      type: Sequelize.STRING(255),
      allowNull: false
    });
  }
};
