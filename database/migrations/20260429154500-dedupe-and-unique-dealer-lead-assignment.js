'use strict';

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;
    const dialect = sequelize.getDialect();

    if (dialect === 'postgres') {
      await sequelize.query(`
        DELETE FROM "dealer_lead_assignments" d
        USING "dealer_lead_assignments" newer
        WHERE d."leadId" = newer."leadId"
          AND (
            newer."assignedAt" > d."assignedAt"
            OR (
              newer."assignedAt" = d."assignedAt"
              AND newer."createdAt" > d."createdAt"
            )
          );
      `);

      await sequelize.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_indexes
            WHERE schemaname = current_schema()
              AND tablename = 'dealer_lead_assignments'
              AND indexname = 'uniq_dealer_lead_assignments_lead_id'
          ) THEN
            CREATE UNIQUE INDEX "uniq_dealer_lead_assignments_lead_id"
            ON "dealer_lead_assignments" ("leadId");
          END IF;
        END $$;
      `);
      return;
    }

    if (dialect === 'mysql' || dialect === 'mariadb') {
      await sequelize.query(`
        DELETE d FROM dealer_lead_assignments d
        JOIN dealer_lead_assignments newer
          ON d.leadId = newer.leadId
         AND (
           newer.assignedAt > d.assignedAt
           OR (newer.assignedAt = d.assignedAt AND newer.createdAt > d.createdAt)
         );
      `);

      const [rows] = await sequelize.query(`
        SELECT COUNT(1) AS c
        FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name = 'dealer_lead_assignments'
          AND index_name = 'uniq_dealer_lead_assignments_lead_id';
      `);
      const count = Array.isArray(rows) ? Number(rows[0]?.c || 0) : 0;
      if (count === 0) {
        await sequelize.query(`
          CREATE UNIQUE INDEX uniq_dealer_lead_assignments_lead_id
          ON dealer_lead_assignments (leadId);
        `);
      }
    }
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;
    const dialect = sequelize.getDialect();

    if (dialect === 'postgres') {
      await sequelize.query(`
        DROP INDEX IF EXISTS "uniq_dealer_lead_assignments_lead_id";
      `);
      return;
    }

    if (dialect === 'mysql' || dialect === 'mariadb') {
      await sequelize.query(`
        DROP INDEX uniq_dealer_lead_assignments_lead_id ON dealer_lead_assignments;
      `).catch(() => {});
    }
  }
};
