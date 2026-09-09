const { createHash, createPublicKey, createPrivateKey, sign: cryptoSign, verify: cryptoVerify } = require('node:crypto');

class AILPError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function validateCanonicalDomain(value) {
  if (value === null) return;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return;
  if (t === 'number') {
    if (!Number.isInteger(value) || !Number.isFinite(value)) throw new AILPError('UNSUPPORTED_CANONICAL_JSON');
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) validateCanonicalDomain(item);
    return;
  }
  if (t === 'object') {
    for (const key of Object.keys(value)) {
      if (!/^[\x00-\x7F]*$/.test(key)) throw new AILPError('UNSUPPORTED_CANONICAL_JSON');
      validateCanonicalDomain(value[key]);
    }
    return;
  }
  throw new AILPError('UNSUPPORTED_CANONICAL_JSON');
}

function serializeCanonical(value) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') return String(value);
  if (Array.isArray(value)) return '[' + value.map(serializeCanonical).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + serializeCanonical(value[k])).join(',') + '}';
}

// AILP v0.1 constrained-JCS: ASCII member names + integer-or-bool-or-string-or-null
// values only (no floats). Within that domain this matches RFC 8785/JCS byte for
// byte, and must stay byte-identical with CTCL-ITR's Python `canonical_json`
// (src/ctcl_itr/ailp.py) -- this is a wire protocol contract, not a style choice.
// Deliberately NOT the same function as core/canonical-json.js: that one allows
// non-ASCII keys and arbitrary floats, which would silently diverge from the
// Python reference and break cross-language signature verification.
function canonicalJson(value) {
  validateCanonicalDomain(value);
  return Buffer.from(serializeCanonical(value), 'utf8');
}

function b64urlEncode(buf) {
  return buf.toString('base64url');
}

function b64urlDecode(str) {
  if (typeof str !== 'string') throw new AILPError('INVALID_BASE64URL');
  try {
    return Buffer.from(str, 'base64url');
  } catch (e) {
    throw new AILPError('INVALID_BASE64URL');
  }
}

function publicKeyFromJwk(jwk) {
  if (!jwk || typeof jwk !== 'object' || jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') {
    throw new AILPError('UNSUPPORTED_VERIFICATION_METHOD');
  }
  try {
    return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, format: 'jwk' });
  } catch (e) {
    throw new AILPError('UNSUPPORTED_VERIFICATION_METHOD');
  }
}

function privateKeyFromJwk(jwk) {
  if (!jwk || typeof jwk !== 'object' || jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.d !== 'string' || typeof jwk.x !== 'string') {
    throw new AILPError('UNSUPPORTED_VERIFICATION_METHOD');
  }
  try {
    return createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x, d: jwk.d }, format: 'jwk' });
  } catch (e) {
    throw new AILPError('UNSUPPORTED_VERIFICATION_METHOD');
  }
}

function unsignedDocument(document) {
  const copy = { ...document };
  delete copy.signature;
  return copy;
}

function signDocument(document, privateKeyJwk, { keyId }) {
  if (!keyId) throw new AILPError('INVALID_KEY_ID');
  if (document && document.signature !== undefined) throw new AILPError('DOCUMENT_ALREADY_SIGNED');
  const payload = { ...document };
  const key = privateKeyFromJwk(privateKeyJwk);
  const signature = cryptoSign(null, canonicalJson(payload), key);
  payload.signature = { algorithm: 'Ed25519', key_id: keyId, value: b64urlEncode(signature) };
  return payload;
}

function verifyDocumentSignature(document, publicJwk, { expectedKeyId } = {}) {
  const signature = document && document.signature;
  if (!signature || typeof signature !== 'object' || signature.algorithm !== 'Ed25519') {
    throw new AILPError('SIGNATURE_MISSING');
  }
  if (expectedKeyId != null && signature.key_id !== expectedKeyId) {
    throw new AILPError('SIGNATURE_KEY_MISMATCH');
  }
  if (typeof signature.value !== 'string') throw new AILPError('SIGNATURE_MISSING');
  const key = publicKeyFromJwk(publicJwk);
  const ok = cryptoVerify(null, canonicalJson(unsignedDocument(document)), key, b64urlDecode(signature.value));
  if (!ok) throw new AILPError('SIGNATURE_INVALID');
}

function digestDocument(document) {
  return 'sha256:' + createHash('sha256').update(canonicalJson(document)).digest('hex');
}

function keyThumbprint(publicJwk) {
  const material = { crv: publicJwk && publicJwk.crv, kty: publicJwk && publicJwk.kty, x: publicJwk && publicJwk.x };
  return 'sha256:' + createHash('sha256').update(canonicalJson(material)).digest('hex');
}

module.exports = {
  AILPError,
  canonicalJson,
  b64urlEncode,
  b64urlDecode,
  publicKeyFromJwk,
  privateKeyFromJwk,
  signDocument,
  verifyDocumentSignature,
  digestDocument,
  keyThumbprint
};
