const { openDatabase } = require('../../db/sqlite');

function createTestDatabase() {
  return openDatabase(':memory:');
}

module.exports = { createTestDatabase };
