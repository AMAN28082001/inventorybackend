'use strict';

const PROFILE_COLUMNS = [
  ['gender', (Sequelize) => ({ type: Sequelize.STRING(20), allowNull: true })],
  ['dateOfBirth', (Sequelize) => ({ type: Sequelize.DATEONLY, allowNull: true })],
  ['fatherName', (Sequelize) => ({ type: Sequelize.STRING(100), allowNull: true })],
  ['fatherContact', (Sequelize) => ({ type: Sequelize.STRING(15), allowNull: true })],
  ['governmentIdType', (Sequelize) => ({ type: Sequelize.STRING(50), allowNull: true })],
  ['governmentIdNumber', (Sequelize) => ({ type: Sequelize.STRING(50), allowNull: true })],
  ['addressStreet', (Sequelize) => ({ type: Sequelize.TEXT, allowNull: true })],
  ['addressCity', (Sequelize) => ({ type: Sequelize.STRING(100), allowNull: true })],
  ['addressState', (Sequelize) => ({ type: Sequelize.STRING(100), allowNull: true })],
  ['addressPincode', (Sequelize) => ({ type: Sequelize.STRING(6), allowNull: true })]
];

const addIfMissing = async (queryInterface, Sequelize, table, column, spec) => {
  const desc = await queryInterface.describeTable(table);
  if (desc[column]) return;
  await queryInterface.addColumn(table, column, spec(Sequelize));
};

/** Unified Users create/edit profile + visitor access (BACKEND_UNIFIED_USERS_AND_CITY_FILTER.md). */
module.exports = {
  async up(queryInterface, Sequelize) {
    for (const [name, spec] of PROFILE_COLUMNS) {
      await addIfMissing(queryInterface, Sequelize, 'account_managers', name, spec);
      await addIfMissing(queryInterface, Sequelize, 'visitors', name, spec);
    }
    await addIfMissing(queryInterface, Sequelize, 'account_managers', 'employeeId', (S) => ({
      type: S.STRING(50),
      allowNull: true
    }));
    await addIfMissing(queryInterface, Sequelize, 'visitors', 'access', (S) => ({
      type: S.JSONB,
      allowNull: false,
      defaultValue: []
    }));
    await addIfMissing(queryInterface, Sequelize, 'visitors', 'emailVerified', (S) => ({
      type: S.BOOLEAN,
      allowNull: false,
      defaultValue: false
    }));
  },

  async down(queryInterface) {
    const dropIfPresent = async (table, column) => {
      const desc = await queryInterface.describeTable(table);
      if (desc[column]) await queryInterface.removeColumn(table, column);
    };
    for (const [name] of PROFILE_COLUMNS) {
      await dropIfPresent('account_managers', name);
      await dropIfPresent('visitors', name);
    }
    await dropIfPresent('account_managers', 'employeeId');
    await dropIfPresent('visitors', 'access');
    await dropIfPresent('visitors', 'emailVerified');
  }
};
