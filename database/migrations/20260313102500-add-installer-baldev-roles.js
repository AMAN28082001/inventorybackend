'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
        ALTER TABLE users ADD CONSTRAINT users_role_check
        CHECK (role IN ('super-admin', 'super-admin-manager', 'admin', 'agent', 'account', 'installer', 'baldev', 'confirmation'));
      `);
      return;
    }

    await queryInterface.sequelize.query(`
      ALTER TABLE users
      MODIFY COLUMN role ENUM(
        'super-admin',
        'super-admin-manager',
        'admin',
        'agent',
        'account',
        'installer',
        'baldev',
        'confirmation'
      ) NOT NULL
    `);
  },

  async down(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
        ALTER TABLE users ADD CONSTRAINT users_role_check
        CHECK (role IN ('super-admin', 'super-admin-manager', 'admin', 'agent', 'account'));
      `);
      return;
    }

    await queryInterface.sequelize.query(`
      ALTER TABLE users
      MODIFY COLUMN role ENUM(
        'super-admin',
        'super-admin-manager',
        'admin',
        'agent',
        'account'
      ) NOT NULL
    `);
  }
};
