class EventStore {
  append() {
    throw new Error('NOT_IMPLEMENTED');
  }

  readStream() {
    throw new Error('NOT_IMPLEMENTED');
  }

  readEvent() {
    throw new Error('NOT_IMPLEMENTED');
  }

  lookupIdempotency() {
    throw new Error('NOT_IMPLEMENTED');
  }

  verifyHashChain() {
    throw new Error('NOT_IMPLEMENTED');
  }
}

module.exports = { EventStore };
