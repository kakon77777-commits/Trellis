const test = require('node:test');
const assert = require('node:assert/strict');

const PREVIOUS_DOMAINS = Object.freeze([
  'profile',
  'relationship_surface',
  'community',
  'discovery',
  'publication',
  'feed',
  'reaction',
  'notification',
  'preference'
]);

const EXPECTED_CLASSES = Object.freeze({
  profile: 'derived_projection',
  relationship_surface: 'derived_projection',
  community: 'canonical',
  discovery: 'derived_projection',
  publication: 'canonical',
  feed: 'derived_projection',
  reaction: 'canonical',
  notification: 'canonical',
  preference: 'canonical',
  consumption: 'operational'
});

test('Foundation v0.2 registry classifies canonical, derived, and operational state explicitly', () => {
  const contract = require('../foundation/cross-domain-contract');
  assert.equal(contract.CONTRACT_REF, 'trellis-foundation-cross-domain:0.2');
  assert.deepEqual(contract.STATE_CLASSES, ['canonical','derived_projection','operational']);

  for (const [domain, stateClass] of Object.entries(EXPECTED_CLASSES)) {
    assert.equal(contract.CONTRACT_REGISTRY[domain].state_class, stateClass, domain);
    for (const field of ['canonical_contracts','derived_contracts','operational_contracts']) {
      assert.ok(Array.isArray(contract.CONTRACT_REGISTRY[domain][field]), `${domain}:${field}`);
    }
  }
});

test('registry migration preserves X1 X2 X3 effective inheritance for every pre-Consumption domain', () => {
  const { effectiveContracts } = require('../foundation/cross-domain-contract');
  for (const domain of PREVIOUS_DOMAINS) {
    assert.deepEqual(effectiveContracts(domain), ['X1','X2','X3'], domain);
  }
});

test('Consumption is operational and inherits X2 X3 without claiming canonical X1', () => {
  const { CONTRACT_REGISTRY, effectiveContracts } = require('../foundation/cross-domain-contract');
  assert.deepEqual(CONTRACT_REGISTRY.consumption, {
    state_class: 'operational',
    canonical_contracts: [],
    derived_contracts: [],
    operational_contracts: ['X2','X3']
  });
  assert.deepEqual(effectiveContracts('consumption'), ['X2','X3']);
});

test('contract lists are class-aligned and canonical domains include X1', () => {
  const { CONTRACT_REGISTRY } = require('../foundation/cross-domain-contract');
  for (const [domain, entry] of Object.entries(CONTRACT_REGISTRY)) {
    if (entry.state_class === 'canonical') {
      assert.deepEqual(entry.derived_contracts, [], domain);
      assert.deepEqual(entry.operational_contracts, [], domain);
      assert.ok(entry.canonical_contracts.includes('X1'), domain);
    } else if (entry.state_class === 'derived_projection') {
      assert.deepEqual(entry.canonical_contracts, [], domain);
      assert.deepEqual(entry.operational_contracts, [], domain);
    } else if (entry.state_class === 'operational') {
      assert.deepEqual(entry.canonical_contracts, [], domain);
      assert.deepEqual(entry.derived_contracts, [], domain);
    } else {
      assert.fail(`unknown state class: ${domain}:${entry.state_class}`);
    }
  }
});
