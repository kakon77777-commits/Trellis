const test = require('node:test');
const assert = require('node:assert/strict');

test('active social trust and delegation never authorize a protected capability', () => {
  const { evaluateAuthority } = require('../authority/policy');
  const socialRelationships = [
    { relationship_type: 'trusts', lifecycle: 'active', source_entity_id: 'actor:A', target_entity_id: 'actor:B' },
    { relationship_type: 'delegates_to', lifecycle: 'active', source_entity_id: 'actor:A', target_entity_id: 'actor:B' }
  ];

  const receipt = evaluateAuthority({
    command_id: 'cmd:protected-deny',
    principal_id: 'principal:B',
    actor_id: 'actor:B',
    principal_actor_id: 'actor:B',
    requested_action: 'protected.execute',
    aggregate_id: 'repository:R',
    capability: 'github:write',
    scope_ref: 'repository:R',
    social_relationships: socialRelationships,
    capability_grants: [],
    evaluated_at: '2026-09-02T07:30:00.000Z'
  });

  assert.equal(receipt.decision, 'deny');
});

test('explicit authority-domain capability grant can authorize protected action', () => {
  const { evaluateAuthority } = require('../authority/policy');
  const receipt = evaluateAuthority({
    command_id: 'cmd:protected-allow',
    principal_id: 'principal:B',
    actor_id: 'actor:B',
    principal_actor_id: 'actor:B',
    requested_action: 'protected.execute',
    aggregate_id: 'repository:R',
    capability: 'github:write',
    scope_ref: 'repository:R',
    social_relationships: [],
    capability_grants: [{
      principal_id: 'principal:B',
      capability: 'github:write',
      scope_ref: 'repository:R',
      active: true
    }],
    evaluated_at: '2026-09-02T07:30:00.000Z'
  });

  assert.equal(receipt.decision, 'allow');
});
