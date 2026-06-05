'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();

    // Backfill one historical record per existing assignment action so admin/HR reports
    // show existing data immediately after rollout.
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        INSERT INTO calling_action_history
          ("id", "leadId", "dealerId", "action", "callRemark", "actionAt", "nextFollowUpAt", "createdAt", "updatedAt")
        SELECT
          md5(random()::text || clock_timestamp()::text),
          d."leadId",
          d."dealerId",
          d."action"::text::"enum_calling_action_history_action",
          d."callRemark",
          d."actionAt",
          d."nextFollowUpAt",
          COALESCE(d."updatedAt", CURRENT_TIMESTAMP),
          COALESCE(d."updatedAt", CURRENT_TIMESTAMP)
        FROM dealer_lead_assignments d
        WHERE d."action" IS NOT NULL
          AND d."actionAt" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM calling_action_history h
            WHERE h."leadId" = d."leadId"
              AND h."dealerId" = d."dealerId"
              AND h."action"::text = d."action"::text
              AND h."actionAt" = d."actionAt"
          );
      `);
    } else {
      await queryInterface.sequelize.query(`
        INSERT INTO calling_action_history
          (id, leadId, dealerId, action, callRemark, actionAt, nextFollowUpAt, createdAt, updatedAt)
        SELECT
          REPLACE(UUID(), '-', ''),
          d.leadId,
          d.dealerId,
          d.action,
          d.callRemark,
          d.actionAt,
          d.nextFollowUpAt,
          COALESCE(d.updatedAt, CURRENT_TIMESTAMP),
          COALESCE(d.updatedAt, CURRENT_TIMESTAMP)
        FROM dealer_lead_assignments d
        WHERE d.action IS NOT NULL
          AND d.actionAt IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM calling_action_history h
            WHERE h.leadId = d.leadId
              AND h.dealerId = d.dealerId
              AND h.action = d.action
              AND h.actionAt = d.actionAt
          );
      `);
    }
  },

  async down() {
    // Intentionally no-op to avoid deleting legitimate history rows after backfill.
  }
};
