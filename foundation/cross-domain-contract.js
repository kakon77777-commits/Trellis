const CONTRACT_REF = 'trellis-foundation-cross-domain:0.2';
const STATE_CLASSES = Object.freeze(['canonical','derived_projection','operational']);
const INVARIANTS = Object.freeze({
  X1: 'canonical_visibility_ceiling',
  X2: 'descriptive_state_does_not_grant_authority',
  X3: 'viewer_noninterference'
});

function entry(stateClass, contracts) {
  if (!STATE_CLASSES.includes(stateClass)) throw new TypeError('INVALID_STATE_CLASS');
  const inherited = Object.freeze([...contracts]);
  return Object.freeze({
    state_class: stateClass,
    canonical_contracts: stateClass === 'canonical' ? inherited : Object.freeze([]),
    derived_contracts: stateClass === 'derived_projection' ? inherited : Object.freeze([]),
    operational_contracts: stateClass === 'operational' ? inherited : Object.freeze([])
  });
}

// state_class classifies the domain boundary, not its event namespace.
// canonical: creates/owns an independently addressable canonical aggregate identity.
// derived_projection: owns no independent canonical aggregate identity/state.
// operational: owns mutable/retention-bounded non-canonical state.
const CONTRACT_REGISTRY = Object.freeze({
  profile: entry('derived_projection',['X1','X2','X3']),
  relationship_surface: entry('derived_projection',['X1','X2','X3']),
  community: entry('canonical',['X1','X2','X3']),
  discovery: entry('derived_projection',['X1','X2','X3']),
  publication: entry('canonical',['X1','X2','X3']),
  feed: entry('derived_projection',['X1','X2','X3']),
  reaction: entry('canonical',['X1','X2','X3']),
  notification: entry('canonical',['X1','X2','X3']),
  preference: entry('canonical',['X1','X2','X3']),
  consumption: entry('operational',['X2','X3'])
});

function effectiveContracts(domain) {
  const value = CONTRACT_REGISTRY[domain];
  if (!value) return [];
  if (value.state_class === 'canonical') return [...value.canonical_contracts];
  if (value.state_class === 'derived_projection') return [...value.derived_contracts];
  return [...value.operational_contracts];
}

module.exports = {
  CONTRACT_REF,
  STATE_CLASSES,
  INVARIANTS,
  CONTRACT_REGISTRY,
  effectiveContracts
};
