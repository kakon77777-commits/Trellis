const REQUIRED_PROPOSAL_FIELDS = [
  'relationship_id',
  'source_entity_id',
  'target_entity_id',
  'relationship_type',
  'taxonomy_ref',
  'visibility',
  'visibility_policy_ref'
];

function validateProposalPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('INVALID_RELATIONSHIP_PROPOSAL');
  }
  for (const field of REQUIRED_PROPOSAL_FIELDS) {
    if (typeof payload[field] !== 'string' || payload[field].length === 0) {
      throw new TypeError(`INVALID_RELATIONSHIP_PROPOSAL:${field}`);
    }
  }
  if (payload.scope_ref !== undefined && payload.scope_ref !== null && typeof payload.scope_ref !== 'string') {
    throw new TypeError('INVALID_RELATIONSHIP_PROPOSAL:scope_ref');
  }
  return payload;
}

module.exports = { validateProposalPayload };
