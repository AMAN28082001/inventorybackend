const { Sequelize } = require('sequelize');
require('dotenv').config();

const shouldUseSSL = (process.env.DB_SSL || '').toLowerCase() === 'true';
const allowUnauthorized =
  (process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() !== 'false';

const sequelize = new Sequelize(
  process.env.DB_NAME || 'chairbord_solar',
  process.env.DB_USER || 'postgres',
  process.env.DB_PASSWORD || '',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
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

// Test database connection
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ PostgreSQL database connected successfully');
  } catch (error) {
    console.error('❌ Database connection error:', error.message);
  }
};

testConnection();

module.exports = sequelize;
