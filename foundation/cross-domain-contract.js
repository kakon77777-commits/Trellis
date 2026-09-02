const CONTRACT_REF = 'trellis-foundation-cross-domain:0.1';
const INVARIANTS = Object.freeze({
  X1: 'canonical_visibility_ceiling',
  X2: 'descriptive_state_does_not_grant_authority',
  X3: 'viewer_noninterference'
});
const INHERITORS = Object.freeze({
  profile: Object.freeze(['X1','X2','X3']),
  relationship_surface: Object.freeze(['X1','X2','X3']),
  community: Object.freeze(['X1','X2','X3']),
  discovery: Object.freeze(['X1','X2','X3']),
  publication: Object.freeze(['X1','X2','X3'])
});
module.exports = { CONTRACT_REF, INVARIANTS, INHERITORS };
