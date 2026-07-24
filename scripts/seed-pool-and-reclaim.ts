import dotenv from 'dotenv';
dotenv.config();
import { Sequelize, QueryTypes } from 'sequelize';

const sequelize = new Sequelize(process.env.DB_NAME!, process.env.DB_USER!, process.env.DB_PASSWORD!, {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  dialect: 'postgres',
  logging: false,
  dialectOptions: process.env.DB_SSL === 'true' ? { ssl: { require: true, rejectUnauthorized: false } } : {},
});

const POOL = 'unassigned';
const HOURS = Number(process.env.CALLING_STUCK_ASSIGNMENT_HOURS || 4);

async function ensurePool() {
  const [existing] = await sequelize.query(`SELECT id FROM dealers WHERE id = :id LIMIT 1`, {
    replacements: { id: POOL },
    type: QueryTypes.SELECT
  });
  if (existing) {
    console.log('pool dealer already exists');
    return;
  }
  await sequelize.query(
    `
    INSERT INTO dealers (
      id, username, password, "firstName", "lastName", email, mobile, company,
      gender, "dateOfBirth", "fatherName", "fatherContact",
      "governmentIdType", "governmentIdNumber", "governmentIdImage",
      "addressStreet", "addressCity", "addressState", "addressPincode",
      role, "isActive", "emailVerified", "createdAt", "updatedAt"
    ) VALUES (
      :id, '__calling_pool_unassigned__', '!calling-pool-locked!',
      'Unassigned', 'Pool', 'calling-pool-unassigned@internal.invalid', '0000000001', 'SYSTEM',
      'Other', '1970-01-01', 'SYSTEM', '0000000001',
      'Passport', 'CALLING-POOL-UNASSIGNED', NULL,
      'SYSTEM', 'SYSTEM', 'SYSTEM', '000000',
      'dealer', false, false, NOW(), NOW()
    )
    `,
    { replacements: { id: POOL } }
  );
  console.log('created pool dealer');
}

async function reclaimAll() {
  const cutoff = new Date(Date.now() - HOURS * 60 * 60 * 1000);
  let total = 0;
  for (;;) {
    const [, meta] = await sequelize.query(
      `
      UPDATE "dealer_lead_assignments" AS dla
      SET
        "dealerId" = :pool,
        "status" = 'queued',
        "assignedAt" = NOW(),
        "action" = NULL,
        "callRemark" = NULL,
        "nextFollowUpAt" = NULL,
        "actionAt" = NULL,
        "updatedAt" = NOW()
      WHERE dla."id" IN (
        SELECT stuck."id"
        FROM "dealer_lead_assignments" AS stuck
        WHERE stuck."status" IN ('assigned', 'active', 'in_progress')
          AND LOWER(TRIM(stuck."dealerId")) NOT IN (
            'unassigned','null','none','-','na','n/a','pool','open'
          )
          AND COALESCE(stuck."actionAt", stuck."updatedAt", stuck."assignedAt") < :cutoff
          AND NOT EXISTS (
            SELECT 1 FROM "dealer_lead_assignments" AS newer
            WHERE newer."leadId" = stuck."leadId"
              AND (
                newer."assignedAt" > stuck."assignedAt"
                OR (newer."assignedAt" = stuck."assignedAt" AND newer."createdAt" > stuck."createdAt")
              )
          )
        ORDER BY stuck."assignedAt" ASC
        LIMIT 200
        FOR UPDATE SKIP LOCKED
      )
      `,
      { replacements: { pool: POOL, cutoff } }
    );
    const n = Number((meta as any)?.rowCount ?? 0);
    total += n;
    console.log('reclaimed batch', n);
    if (n < 200) break;
  }
  console.log('reclaimed total', total);
}

async function summary() {
  const rows = await sequelize.query(
    `
    SELECT status, COUNT(*)::int AS c
    FROM dealer_lead_assignments
    WHERE status IN ('assigned','in_progress','queued','active')
       OR "dealerId" = 'unassigned'
    GROUP BY status
    ORDER BY c DESC
    `,
    { type: QueryTypes.SELECT }
  );
  console.log('open summary', rows);

  const byDealer = await sequelize.query(
    `
    SELECT "dealerId", status, COUNT(*)::int AS c
    FROM dealer_lead_assignments
    WHERE status IN ('assigned','in_progress','queued','active')
    GROUP BY "dealerId", status
    ORDER BY c DESC
    LIMIT 20
    `,
    { type: QueryTypes.SELECT }
  );
  console.log('by dealer', byDealer);

  const harshita = 'dealer_a5f0b015-afa1-46f3-8481-bf0537f0a8db';
  const claimable = await sequelize.query(
    `
    SELECT dla.id, cl.name, cl.mobile, cl."batchId", dla.status, dla."dealerId"
    FROM dealer_lead_assignments dla
    JOIN calling_leads cl ON cl.id = dla."leadId"
    JOIN calling_lead_upload_batches b ON b.id = cl."batchId"
    WHERE dla.status IN ('queued','assigned','active')
      AND LOWER(TRIM(dla."dealerId")) IN ('unassigned','pool','open','none','null','na','n/a','-')
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(b."assignedDealers", '[]'::jsonb)) AS ad(value)
        WHERE jsonb_typeof(ad.value)='string'
          AND lower(trim(BOTH '"' FROM ad.value::text)) = lower(trim(:dealerId))
      )
    ORDER BY COALESCE(dla."assignedAt", dla."createdAt") ASC
    LIMIT 5
    `,
    { replacements: { dealerId: harshita }, type: QueryTypes.SELECT }
  );
  console.log('Harshita claimable pool', claimable);
}

async function main() {
  await sequelize.authenticate();
  await ensurePool();
  await reclaimAll();
  await summary();
  await sequelize.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
