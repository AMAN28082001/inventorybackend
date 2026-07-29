import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

const shouldUseSSL = (process.env.DB_SSL || '').toLowerCase() === 'true';
const allowUnauthorized =
  (process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() !== 'false';
const poolMax = parseInt(process.env.DB_POOL_MAX || '20', 10);
const poolMin = parseInt(process.env.DB_POOL_MIN || '2', 10);
const poolAcquireMs = parseInt(process.env.DB_POOL_ACQUIRE_MS || '60000', 10);
const poolIdleMs = parseInt(process.env.DB_POOL_IDLE_MS || '15000', 10);

const sequelize = new Sequelize(
  process.env.DB_NAME || 'chairbord_solar',
  process.env.DB_USER || 'postgres',
  process.env.DB_PASSWORD || '',
  {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    dialect: 'postgres',
    logging: process.env.DB_LOGGING === 'true' ? console.log : false,
    pool: {
      max: Number.isFinite(poolMax) ? poolMax : 20,
      min: Number.isFinite(poolMin) ? poolMin : 2,
      acquire: Number.isFinite(poolAcquireMs) ? poolAcquireMs : 60000,
      idle: Number.isFinite(poolIdleMs) ? poolIdleMs : 15000
    },
    dialectOptions: shouldUseSSL
      ? {
          ssl: {
            require: true,
            rejectUnauthorized: allowUnauthorized
          }
        }
      : {}
  }
);

export default sequelize;

