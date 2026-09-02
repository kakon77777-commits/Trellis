const registry = require('../schemas/publication-policy.v0.1.json');

function resolvePublicationPolicy(type) {
  if (!registry.types[type]) throw new Error('UNKNOWN_PUBLICATION_TYPE');
  return {
    publication_policy_ref: registry.policy_ref,
    visibility_policy_ref: registry.visibility_policy_ref,
    allowed_visibility: [...registry.visibility.allowed]
  };
}

module.exports = { resolvePublicationPolicy };
