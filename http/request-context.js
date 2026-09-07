const CLAIMED_QUERY_KEYS = new Set(['viewer_actor_id','subject_actor_id']);
const CLAIMED_HEADER_KEYS = new Set(['x-actor-id','x-viewer-actor-id','x-subject-actor-id']);
const CLAIMED_COOKIE_KEYS = new Set(['actor_id','viewer_actor_id','subject_actor_id']);

function headersObject(headers = {}) {
  if (headers && typeof headers.get === 'function') {
    const result = {};
    for (const key of [...CLAIMED_HEADER_KEYS, 'cookie']) {
      const value = headers.get(key);
      if (value != null) result[key] = value;
    }
    return result;
  }
  return Object.fromEntries(Object.entries(headers ?? {}).map(([key,value]) => [String(key).toLowerCase(), value]));
}

function cookieClaimsIdentity(cookieHeader) {
  if (typeof cookieHeader !== 'string') return false;
  return cookieHeader.split(';').some(part => {
    const [rawKey] = part.trim().split('=',1);
    return CLAIMED_COOKIE_KEYS.has(rawKey);
  });
}

function createPublicRequestContext(request = {}) {
  const url = new URL(request.url ?? '/', 'https://trellis.evemisslab.com');
  for (const key of CLAIMED_QUERY_KEYS) {
    if (url.searchParams.has(key)) throw new TypeError('CLIENT_CLAIMED_ACTOR_ID_NOT_ALLOWED');
  }
  const headers = headersObject(request.headers);
  for (const key of CLAIMED_HEADER_KEYS) {
    if (headers[key] != null) throw new TypeError('CLIENT_CLAIMED_ACTOR_ID_NOT_ALLOWED');
  }
  if (cookieClaimsIdentity(headers.cookie)) throw new TypeError('CLIENT_CLAIMED_ACTOR_ID_NOT_ALLOWED');
  return { viewerContext: {} };
}

module.exports = { createPublicRequestContext, cookieClaimsIdentity };
