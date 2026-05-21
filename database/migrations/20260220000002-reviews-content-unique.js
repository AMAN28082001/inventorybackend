'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex('reviews', ['content'], {
      unique: true,
      name: 'reviews_content_unique'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('reviews', 'reviews_content_unique');
  }
};
