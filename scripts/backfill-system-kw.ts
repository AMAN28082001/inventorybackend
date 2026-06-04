/**
 * Backfill quotations.system_kw from quotation_products for existing rows.
 * Usage: npx ts-node scripts/backfill-system-kw.ts
 */
import dotenv from 'dotenv';
import sequelize from '../config/database';
import { Quotation } from '../models/index-quotation';
import { persistQuotationSystemKw } from '../utils/persistQuotationSystemKw';

dotenv.config();

async function main() {
  await sequelize.authenticate();
  const rows = await Quotation.findAll({
    attributes: ['id', 'systemType'],
    where: { status: 'approved' }
  });
  let updated = 0;
  for (const q of rows) {
    const kw = await persistQuotationSystemKw(q.id, q.systemType);
    if (kw > 0) updated += 1;
    console.log(q.id, 'systemKw=', kw);
  }
  console.log(`Done. ${updated}/${rows.length} approved quotations with systemKw > 0`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
