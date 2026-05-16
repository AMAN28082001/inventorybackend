import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

const shouldUseSSL = (process.env.DB_SSL || '').toLowerCase() === 'true';
const allowUnauthorized =
  (process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() !== 'false';

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
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000
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

