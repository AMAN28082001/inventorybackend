'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('visits', 'visitTime', {
      type: Sequelize.STRING(32),
      allowNull: false
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('visits', 'visitTime', {
      type: Sequelize.TIME,
      allowNull: false
    });
  }
};
