'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();

    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(
        "ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'super-admin-manager';"
      ).catch(() => {});
    } else {
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

    // Update check constraint if present (Postgres)
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
        ALTER TABLE users ADD CONSTRAINT users_role_check 
        CHECK (role IN ('super-admin', 'super-admin-manager', 'admin', 'agent', 'account'));
      `);
    }

    const username = process.env.SUPER_ADMIN_MANAGER_USERNAME;
    const password = process.env.SUPER_ADMIN_MANAGER_PASSWORD;
    const name = process.env.SUPER_ADMIN_MANAGER_NAME || 'Product Manager';
    const createdById = process.env.SUPER_ADMIN_MANAGER_CREATED_BY_ID || null;

    if (username && password) {
      const bcrypt = require('bcryptjs');
      const { v4: uuidv4 } = require('uuid');
      const hashedPassword = await bcrypt.hash(password, 10);

      await queryInterface.sequelize.query(
        `INSERT INTO users (id, username, password, name, role, is_active, created_by_id, created_by_name, created_at, updated_at)
         VALUES (:id, :username, :password, :name, 'super-admin-manager', true, :created_by_id, :created_by_name, NOW(), NOW())
         ON CONFLICT (username) DO NOTHING`,
        {
          replacements: {
            id: uuidv4(),
            username,
            password: hashedPassword,
            name,
            created_by_id: createdById,
            created_by_name: 'super-admin'
          }
        }
      );
    }
  },

  async down(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
        ALTER TABLE users ADD CONSTRAINT users_role_check 
        CHECK (role IN ('super-admin', 'admin', 'agent', 'account'));
      `);
    } else {
      await queryInterface.sequelize.query(`
        ALTER TABLE users 
        MODIFY COLUMN role ENUM(
          'super-admin',
          'admin',
          'agent',
          'account'
        ) NOT NULL
      `);
    }
  }
};
