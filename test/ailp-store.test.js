const test = require('node:test');
const assert = require('node:assert/strict');
const { openMigratedDatabase } = require('../db/sqlite');
const { SQLiteAsyncAdapter } = require('../storage/sqlite-adapter');
const { AilpStore } = require('../ailp/store');

function makeStore() {
  const db = openMigratedDatabase(':memory:');
  const store = new AilpStore(new SQLiteAsyncAdapter(db));
  return { db, store };
}

test('ailp_objects is immutable: UPDATE is rejected by the store trigger', async () => {
  const { db, store } = makeStore();
  try {
    await store.putObject({ digest: 'sha256:a', objectType: 'ai_identity_root', canonicalJson: '{}', createdAt: '2026-09-09T00:00:00Z' });
    await assert.rejects(
      () => store.sql.run(`UPDATE ailp_objects SET object_type='tampered' WHERE object_digest=?`, ['sha256:a']),
      /immutable/
    );
  } finally {
    db.close();
  }
});

test('ailp_objects is immutable: DELETE is rejected by the store trigger', async () => {
  const { db, store } = makeStore();
  try {
    await store.putObject({ digest: 'sha256:b', objectType: 'ai_identity_root', canonicalJson: '{}', createdAt: '2026-09-09T00:00:00Z' });
    await assert.rejects(() => store.sql.run(`DELETE FROM ailp_objects WHERE object_digest=?`, ['sha256:b']), /immutable/);
  } finally {
    db.close();
  }
});

test('ailp_security_events is append-only: UPDATE is rejected', async () => {
  const { db, store } = makeStore();
  try {
    await store.appendSecurityEvent({ eventType: 'login_success', subjectRef: 'ai:x', occurredAt: '2026-09-09T00:00:00Z', detailsJson: '{}' });
    await assert.rejects(() => store.sql.run(`UPDATE ailp_security_events SET event_type='tampered' WHERE seq=1`), /append-only/);
  } finally {
    db.close();
  }
});

test('ailp_security_events is append-only: DELETE is rejected', async () => {
  const { db, store } = makeStore();
  try {
    await store.appendSecurityEvent({ eventType: 'login_success', subjectRef: 'ai:x', occurredAt: '2026-09-09T00:00:00Z', detailsJson: '{}' });
    await assert.rejects(() => store.sql.run(`DELETE FROM ailp_security_events WHERE seq=1`), /append-only/);
  } finally {
    db.close();
  }
});

test('at most one active self-representation binding per identity', async () => {
  const { db, store } = makeStore();
  try {
    await store.putActorBinding({
      actorBindingReceiptRef: 'sha256:bind1', aiIdentityId: 'ai:x', actorId: 'actor:x1',
      bindingKind: 'self_representation', state: 'active', identityEpoch: 1, boundAt: '2026-09-09T00:00:00Z'
    });
    await assert.rejects(() => store.putActorBinding({
      actorBindingReceiptRef: 'sha256:bind2', aiIdentityId: 'ai:x', actorId: 'actor:x2',
      bindingKind: 'self_representation', state: 'active', identityEpoch: 1, boundAt: '2026-09-09T00:01:00Z'
    }));
  } finally {
    db.close();
  }
});

test('at most one active self-representation binding per actor (no two identities claiming the same actor)', async () => {
  const { db, store } = makeStore();
  try {
    await store.putActorBinding({
      actorBindingReceiptRef: 'sha256:bindA', aiIdentityId: 'ai:a', actorId: 'actor:shared',
      bindingKind: 'self_representation', state: 'active', identityEpoch: 1, boundAt: '2026-09-09T00:00:00Z'
    });
    await assert.rejects(() => store.putActorBinding({
      actorBindingReceiptRef: 'sha256:bindB', aiIdentityId: 'ai:b', actorId: 'actor:shared',
      bindingKind: 'self_representation', state: 'active', identityEpoch: 1, boundAt: '2026-09-09T00:01:00Z'
    }));
  } finally {
    db.close();
  }
});

test('challenge consumption is single-use but idempotent on an exact proof-digest replay', async () => {
  const { db, store } = makeStore();
  try {
    await store.putChallenge({ challengeId: 'challenge:1', requestDigest: 'sha256:req', challengeJson: '{}', issuedAt: '2026-09-09T00:00:00Z', expiresAt: '2026-09-09T00:10:00Z' });
    const first = await store.consumeChallenge('challenge:1', { proofDigest: 'sha256:proofA', resultRef: 'sha256:result1' });
    assert.equal(first.firstConsumption, true);
    const replay = await store.consumeChallenge('challenge:1', { proofDigest: 'sha256:proofA', resultRef: 'sha256:result1' });
    assert.equal(replay.firstConsumption, false);
    assert.equal(replay.resultRef, 'sha256:result1');
    await assert.rejects(
      () => store.consumeChallenge('challenge:1', { proofDigest: 'sha256:proofB', resultRef: 'sha256:result2' }),
      /AILP_CHALLENGE_PROOF_MISMATCH/
    );
  } finally {
    db.close();
  }
});

test('request replay guard: same (session_id, request_id) can only be recorded once', async () => {
  const { db, store } = makeStore();
  try {
    await store.putSession({
      sessionId: 'session:1', sessionGrantRef: 'sha256:grant', aiIdentityId: 'ai:x', identityEpoch: 1,
      runtimeId: 'runtime:1', runtimeKeyThumbprint: 'sha256:thumb', runtimeCertificateRef: 'sha256:cert', sessionClass: 'identity_only',
      origin: 'https://trellis.aispaces.app', state: 'active', issuedAt: '2026-09-09T00:00:00Z', expiresAt: '2026-09-09T00:10:00Z'
    });
    const first = await store.recordRequestOnce('session:1', 'request:1', 1788944490);
    assert.equal(first, true);
    const replay = await store.recordRequestOnce('session:1', 'request:1', 1788944490);
    assert.equal(replay, false);
  } finally {
    db.close();
  }
});

test('recordRequestOnce propagates a genuine persistence failure instead of misreporting it as a replay (found by Sol backtracing the canonical protocol)', async () => {
  const { db, store } = makeStore();
  try {
    // No session:does-not-exist row exists, so this insert fails on the
    // ailp_request_replay_guards -> ailp_sessions FOREIGN KEY, not on the
    // (session_id, request_id) UNIQUE constraint. A real infrastructure
    // fault must never come back looking like "this was a replay".
    await assert.rejects(
      () => store.recordRequestOnce('session:does-not-exist', 'request:1', 1788944490),
      (e) => !e.message.includes('UNIQUE constraint failed')
    );
  } finally {
    db.close();
  }
});

test('session revoke stops further use: revoking twice does not re-revoke and reports no-op', async () => {
  const { db, store } = makeStore();
  try {
    await store.putSession({
      sessionId: 'session:2', sessionGrantRef: 'sha256:grant2', aiIdentityId: 'ai:x', identityEpoch: 1,
      runtimeId: 'runtime:1', runtimeKeyThumbprint: 'sha256:thumb', runtimeCertificateRef: 'sha256:cert', sessionClass: 'identity_only',
      origin: 'https://trellis.aispaces.app', state: 'active', issuedAt: '2026-09-09T00:00:00Z', expiresAt: '2026-09-09T00:10:00Z'
    });
    const firstRevoke = await store.revokeSession('session:2', 'user_requested');
    assert.equal(firstRevoke, true);
    const secondRevoke = await store.revokeSession('session:2', 'user_requested');
    assert.equal(secondRevoke, false);
    const row = await store.getSession('session:2');
    assert.equal(row.state, 'revoked');
  } finally {
    db.close();
  }
});
