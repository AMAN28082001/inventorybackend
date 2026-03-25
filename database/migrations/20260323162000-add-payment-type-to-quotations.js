'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('quotations', 'paymentType', {
      type: Sequelize.STRING(10),
      allowNull: true
    });

    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        ALTER TABLE quotations
        ADD CONSTRAINT quotations_payment_type_check
        CHECK ("paymentType" IN ('loan', 'cash', 'mix') OR "paymentType" IS NULL);
      `);
      await queryInterface.sequelize.query(`
        UPDATE quotations
        SET "paymentType" = CASE
          WHEN "paymentMode" IN ('loan', 'cash', 'mix') THEN "paymentMode"
          ELSE NULL
        END
        WHERE "paymentType" IS NULL;
      `);
    } else {
      await queryInterface.sequelize.query(`
        UPDATE quotations
        SET paymentType = CASE
          WHEN paymentMode IN ('loan', 'cash', 'mix') THEN paymentMode
          ELSE NULL
        END
        WHERE paymentType IS NULL;
      `);
    }
  },

  async down(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        ALTER TABLE quotations
        DROP CONSTRAINT IF EXISTS quotations_payment_type_check;
      `);
    }
    await queryInterface.removeColumn('quotations', 'paymentType');
  }
};
