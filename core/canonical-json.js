function normalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('NON_JSON_NUMBER');
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (child === undefined || typeof child === 'function' || typeof child === 'symbol') {
        throw new TypeError('NON_JSON_VALUE');
      }
      out[key] = normalize(child);
    }
    return out;
  }
  throw new TypeError('NON_JSON_VALUE');
}

function canonicalStringify(value) {
  return JSON.stringify(normalize(value));
}

module.exports = { canonicalStringify };
