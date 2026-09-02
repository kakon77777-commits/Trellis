const taxonomy = require('../schemas/relationship-taxonomy.v0.1.json');
const policies = require('../schemas/relationship-policy.v0.1.json');

function resolveRelationshipPolicy(type, taxonomyRef = taxonomy.taxonomy_ref) {
  if (taxonomyRef !== taxonomy.taxonomy_ref) {
    throw new Error('UNKNOWN_TAXONOMY_REF');
  }
  if (!taxonomy.relations[type] || !policies.relations[type]) {
    throw new Error('UNKNOWN_RELATIONSHIP_TYPE');
  }
  return {
    taxonomy_ref: taxonomy.taxonomy_ref,
    relationship_policy_ref: policies.policy_ref,
    visibility_policy_ref: policies.visibility_policy_ref,
    ...policies.relations[type]
  };
}

function resolveVisibility({ requestedVisibility, policy }) {
  const visibility = requestedVisibility ?? policy.visibility.default;
  if (!policy.visibility.allowed.includes(visibility)) {
    throw new Error('VISIBILITY_NOT_ALLOWED');
  }
  return visibility;
}

module.exports = {
  resolveRelationshipPolicy,
  resolveVisibility
};
