'use strict';

/** §E.2 — ensure call_remark columns are TEXT (≥ 4000 chars), not VARCHAR overflow. */
module.exports = {
  async up(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();

    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        ALTER TABLE "dealer_lead_assignments"
          ALTER COLUMN "callRemark" TYPE TEXT;
        ALTER TABLE "calling_action_history"
          ALTER COLUMN "callRemark" TYPE TEXT;
      `);
      return;
    }

    if (dialect === 'mysql' || dialect === 'mariadb') {
      await queryInterface.sequelize.query(`
        ALTER TABLE dealer_lead_assignments
          MODIFY COLUMN callRemark LONGTEXT NULL;
        ALTER TABLE calling_action_history
          MODIFY COLUMN callRemark LONGTEXT NULL;
      `);
    }
  },

  async down() {
    // Non-destructive: keep TEXT on rollback.
  }
};
