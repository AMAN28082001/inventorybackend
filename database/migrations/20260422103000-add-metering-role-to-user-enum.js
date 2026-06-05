'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
          ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'metering';
        ELSIF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_users_role') THEN
          ALTER TYPE "enum_users_role" ADD VALUE IF NOT EXISTS 'metering';
        END IF;
      END
      $$;
    `);
  },

  async down() {
    // PostgreSQL enum values are not easily removable in down migrations.
  }
};
