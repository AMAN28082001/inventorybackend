'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('calling_leads', 'mobileNormalized', {
      type: Sequelize.STRING(20),
      allowNull: true
    });

    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        UPDATE calling_leads
        SET "mobileNormalized" = RIGHT(REGEXP_REPLACE(COALESCE(mobile, ''), '\\D', '', 'g'), 10)
        WHERE "mobileNormalized" IS NULL
      `);
    } else {
      await queryInterface.sequelize.query(`
        UPDATE calling_leads
        SET mobileNormalized = mobile
        WHERE mobileNormalized IS NULL
      `);
    }

    await queryInterface.changeColumn('calling_leads', 'mobileNormalized', {
      type: Sequelize.STRING(20),
      allowNull: false
    });

    await queryInterface.addIndex('calling_leads', ['mobileNormalized'], {
      name: 'idx_calling_leads_mobile_normalized',
      unique: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('calling_leads', 'idx_calling_leads_mobile_normalized');
    await queryInterface.removeColumn('calling_leads', 'mobileNormalized');
  }
};
