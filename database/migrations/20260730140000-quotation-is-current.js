'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('quotations');

    if (!table.sourceQuotationId) {
      await queryInterface.addColumn('quotations', 'sourceQuotationId', {
        type: Sequelize.STRING(64),
        allowNull: true
      });
    }

    if (!table.isCurrent) {
      await queryInterface.addColumn('quotations', 'isCurrent', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      });
    }

    // Backfill: per customer, only the newest row is current.
    await queryInterface.sequelize.query(`
      UPDATE quotations SET "isCurrent" = false;
    `);
    await queryInterface.sequelize.query(`
      UPDATE quotations AS q
      SET "isCurrent" = true
      FROM (
        SELECT DISTINCT ON ("customerId") id
        FROM quotations
        ORDER BY "customerId", "createdAt" DESC NULLS LAST, id DESC
      ) AS newest
      WHERE q.id = newest.id;
    `);
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('quotations');
    if (table.isCurrent) {
      await queryInterface.removeColumn('quotations', 'isCurrent');
    }
    // Keep sourceQuotationId — added earlier; only remove isCurrent on down.
  }
};
