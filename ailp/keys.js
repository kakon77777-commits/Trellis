const { signDocument } = require('./canonical');

// Matches the naming convention already established in CTCL-ITR's signed
// examples/ailp_reference_scenario.json (rp:trellis / key:rp:trellis) rather
// than inventing a new one for production.
const RELYING_PARTY_ID = 'rp:trellis';
const RP_KEY_ID = 'key:rp:trellis';

// The private key never lives in source or config -- it is a Worker secret
// (AILP_RP_PRIVATE_KEY_JWK, provisioned via `wrangler secret put`, piped from
// a file, never echoed or committed). This function only ever sees it inside
// a live request's `env`.
function loadRpSigningKey(env) {
  const raw = env && env.AILP_RP_PRIVATE_KEY_JWK;
  if (!raw) throw new Error('AILP_RP_PRIVATE_KEY_JWK_MISSING');
  const privateJwk = JSON.parse(raw);
  const publicJwk = { kty: privateJwk.kty, crv: privateJwk.crv, x: privateJwk.x };
  return {
    keyId: RP_KEY_ID,
    relyingPartyId: RELYING_PARTY_ID,
    publicJwk,
    sign(document) {
      return signDocument(document, privateJwk, { keyId: RP_KEY_ID });
    }
  };
}

module.exports = { RELYING_PARTY_ID, RP_KEY_ID, loadRpSigningKey };
