'use strict';

/** §AK / §AL — office location + workflow field permissions on users; office on quotations. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const officeCol = {
      type: Sequelize.STRING(32),
      allowNull: true
    };
    const permissionsCol = {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {}
    };

    for (const table of ['account_managers', 'dealers', 'visitors']) {
      await queryInterface.addColumn(table, 'officeLocation', officeCol).catch(() => undefined);
      await queryInterface.addColumn(table, 'moduleFieldPermissions', permissionsCol).catch(() => undefined);
    }

    await queryInterface.addColumn('quotations', 'officeLocation', officeCol).catch(() => undefined);

    try {
      await queryInterface.sequelize.query(`
        UPDATE quotations q
        SET "officeLocation" = d."officeLocation"
        FROM dealers d
        WHERE q."dealerId" = d.id
          AND q."officeLocation" IS NULL
          AND d."officeLocation" IS NOT NULL
      `);
    } catch {
      // Non-fatal if dialect differs.
    }
  },

  async down(queryInterface) {
    for (const table of ['account_managers', 'dealers', 'visitors']) {
      await queryInterface.removeColumn(table, 'officeLocation').catch(() => undefined);
      await queryInterface.removeColumn(table, 'moduleFieldPermissions').catch(() => undefined);
    }
    await queryInterface.removeColumn('quotations', 'officeLocation').catch(() => undefined);
  }
};
