const { createHash, randomUUID } = require('node:crypto');

function makeId(prefix) {
  return `${prefix}:${randomUUID()}`;
}

function deriveId(prefix, seed) {
  const digest = createHash('sha256').update(String(seed), 'utf8').digest('hex').slice(0, 24);
  return `${prefix}:${digest}`;
}

module.exports = { makeId, deriveId };
