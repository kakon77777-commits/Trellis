const { createHash } = require('node:crypto');
const { canonicalStringify } = require('./canonical-json');

function computeEventHash(eventWithoutHash, prevEventHash) {
  const material = canonicalStringify({
    hash_scheme: 'sha256-canonical-json-v1',
    prev_event_hash: prevEventHash ?? null,
    event: eventWithoutHash
  });
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

module.exports = { computeEventHash };
