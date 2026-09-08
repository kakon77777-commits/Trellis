class AsyncSqlPort {
  async first() { throw new Error('NOT_IMPLEMENTED'); }
  async all() { throw new Error('NOT_IMPLEMENTED'); }
  async run() { throw new Error('NOT_IMPLEMENTED'); }
  async batch() { throw new Error('NOT_IMPLEMENTED'); }
  session() { throw new Error('NOT_IMPLEMENTED'); }
}

module.exports = { AsyncSqlPort };
