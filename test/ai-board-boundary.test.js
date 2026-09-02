const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');

test('AI Board event becomes inert candidate without canonical mutation', () => {
  const { fromAiBoardEvent } = require('../bridge/ai-board-candidate');
  const db = createTestDatabase();
  const before = db.prepare('SELECT COUNT(*) AS n FROM canonical_events').get().n;

  const candidate = fromAiBoardEvent({
    event_id: 'aiboard:message:1',
    event_type: 'objection',
    actor_ref: 'actor:A',
    target_actor_ref: 'actor:B',
    scope_ref: 'project:X',
    evidence_refs: ['aiboard:message:1'],
    meta: { proposed_relationship_type: 'collaborates_with' },
    inference: { method: 'llm', confidence: 0.99 }
  });

  const after = db.prepare('SELECT COUNT(*) AS n FROM canonical_events').get().n;
  assert.equal(after, before);
  assert.equal(candidate.source_system, 'ai-board');
  assert.equal(candidate.candidate_type, 'relationship_evidence_candidate');
  assert.equal(candidate.proposed_relationship_type, 'collaborates_with');
  assert.equal(candidate.inference.confidence, 0.99);
  assert.equal(candidate.append, undefined);
  assert.equal(candidate.save, undefined);
  assert.equal(candidate.commit, undefined);
});

test('LLM confidence never promotes an AI Board candidate by itself', () => {
  const { fromAiBoardEvent } = require('../bridge/ai-board-candidate');
  const candidate = fromAiBoardEvent({
    event_id: 'aiboard:message:2',
    event_type: 'reply',
    actor_ref: 'actor:A',
    target_actor_ref: 'actor:B',
    inference: { method: 'llm', confidence: 1.0 }
  });

  assert.equal(candidate.inference.confidence, 1.0);
  assert.equal(candidate.promotion_status, 'unpromoted');
});

test('unsupported AI Board event can return null rather than inventing semantics', () => {
  const { fromAiBoardEvent } = require('../bridge/ai-board-candidate');
  assert.equal(fromAiBoardEvent({ event_type: 'unknown' }), null);
});
