const { AsyncSqlPort } = require('./port');
const { plainRow, plainRows, normalizeRunResult } = require('./results');

function prepared(binding, sql, params) {
  return binding.prepare(sql).bind(...(params ?? []));
}

class D1Adapter extends AsyncSqlPort {
  constructor(binding) {
    super();
    this.binding = binding;
  }

  async first(sql, params = []) {
    return plainRow(await prepared(this.binding, sql, params).first());
  }

  async all(sql, params = []) {
    const result = await prepared(this.binding, sql, params).all();
    return plainRows(result?.results ?? result);
  }

  async run(sql, params = []) {
    return normalizeRunResult(await prepared(this.binding, sql, params).run());
  }

  async batch(statements) {
    const preparedStatements = statements.map(entry => prepared(this.binding, entry.sql, entry.params ?? []));
    const results = await this.binding.batch(preparedStatements);
    return results.map(normalizeRunResult);
  }

  session({ consistency } = {}) {
    if (consistency !== undefined && consistency !== 'primary') {
      throw new TypeError(`UNSUPPORTED_CONSISTENCY:${consistency}`);
    }
    if (typeof this.binding.withSession === 'function') {
      return new D1Adapter(this.binding.withSession('first-primary'));
    }
    return new D1Adapter(this.binding);
  }
}

module.exports = { D1Adapter };
