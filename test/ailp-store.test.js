const test = require('node:test');
const assert = require('node:assert/strict');
const { openMigratedDatabase } = require('../db/sqlite');
const { SQLiteAsyncAdapter } = require('../storage/sqlite-adapter');
const { AilpStore, isUniqueConstraintError } = require('../ailp/store');

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

// commitAuthenticateTransaction replaced the standalone consumeChallenge +
// separate putObject/putRecognition/putSession/appendSecurityEvent call
// sequence that used to live in ailp/routes.js. The single-use/idempotent-
// replay semantics once tested here directly against consumeChallenge are
// now exercised at the route layer (test/ailp-routes-e2e.test.js: "same
// challenge + same proof replay is idempotent", "same challenge + a
// DIFFERENT proof is rejected"); what belongs at this layer is the
// atomicity guarantee itself, below.
function fullAuthenticateTransactionArgs(overrides = {}) {
  return {
    challengeId: 'challenge:1', proofDigest: 'sha256:proofA', resultRef: 'session:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    runtimeCertificateDigest: 'sha256:cert1', runtimeCertificateJson: '{"k":"runtime_certificate"}', runtimeId: 'runtime:1',
    authenticationReceiptDigest: 'sha256:authr1', authenticationReceiptJson: '{"k":"authentication_receipt"}',
    recognitionReceiptDigest: 'sha256:recr1', recognitionReceiptJson: '{"k":"recognition_receipt"}',
    aiIdentityId: 'ai:atomic-test', assuranceProfileJson: '{"identity_key_possession":true}',
    sessionGrantDigest: 'sha256:grant1', sessionGrantJson: '{"k":"session_grant"}',
    session: {
      sessionId: 'session:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', identityEpoch: 1, runtimeId: 'runtime:1',
      runtimeKeyThumbprint: 'sha256:thumb1', runtimeCertificateRef: 'sha256:cert1',
      sessionClass: 'identity_only', origin: 'https://trellis.aispaces.app'
    },
    securityEventDetailsJson: '{"runtime_id":"runtime:1"}',
    authenticateResponseDigest: 'sha256:resp1', authenticateResponseJson: '{"k":"authenticate_response"}',
    at: '2026-09-10T00:00:00Z', expiresAt: '2026-09-10T00:10:00Z',
    ...overrides
  };
}

test('commitAuthenticateTransaction: a successful call commits every artifact of a login in one pass', async () => {
  const { db, store } = makeStore();
  try {
    await store.putChallenge({ challengeId: 'challenge:1', requestDigest: 'sha256:req', challengeJson: '{}', issuedAt: '2026-09-10T00:00:00Z', expiresAt: '2026-09-10T00:10:00Z' });
    const args = fullAuthenticateTransactionArgs();
    const results = await store.commitAuthenticateTransaction(args);
    assert.equal(Number(results[0].changes), 1, 'challenge consumption UPDATE did not report affecting a row');

    const challenge = await store.getChallenge('challenge:1');
    assert.equal(challenge.consumed_proof_digest, args.proofDigest);
    assert.equal(challenge.result_ref, args.resultRef);
    assert.ok(await store.getObject(args.runtimeCertificateDigest), 'runtime_certificate missing');
    assert.ok(await store.getObject(args.authenticationReceiptDigest), 'authentication_receipt missing');
    assert.ok(await store.getObject(args.recognitionReceiptDigest), 'recognition_receipt missing');
    assert.ok(await store.getObject(args.sessionGrantDigest), 'session_grant missing');
    assert.ok(await store.getObject(args.authenticateResponseDigest), 'authenticate_response missing');
    assert.ok(await store.getRecognition(args.aiIdentityId), 'ailp_recognition_current projection missing');
    assert.ok(await store.getSession(args.session.sessionId), 'ailp_sessions row missing');
    const events = await store.listSecurityEvents(args.aiIdentityId);
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, 'login_success');
  } finally {
    db.close();
  }
});

test('commitAuthenticateTransaction: a failure on ANY statement rolls back the WHOLE transaction, including the challenge consumption -- a login attempt can never be left half-committed', async () => {
  const { db, store } = makeStore();
  try {
    await store.putChallenge({ challengeId: 'challenge:1', requestDigest: 'sha256:req', challengeJson: '{}', issuedAt: '2026-09-10T00:00:00Z', expiresAt: '2026-09-10T00:10:00Z' });
    // Pre-occupy the session_id this transaction will try to INSERT, so its
    // ailp_sessions write -- the second-to-last statement in the batch --
    // throws a real UNIQUE constraint violation. This is not a synthetic
    // fault injection: it is the exact failure shape a crashed-then-retried
    // authenticate would have produced under the old, non-atomic sequence.
    await store.putSession({
      sessionId: 'session:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', sessionGrantRef: 'sha256:pre-existing', aiIdentityId: 'ai:someone-else',
      identityEpoch: 1, runtimeId: 'runtime:pre', runtimeKeyThumbprint: 'sha256:pre', runtimeCertificateRef: 'sha256:pre',
      sessionClass: 'identity_only', origin: 'https://trellis.aispaces.app', state: 'active',
      issuedAt: '2026-09-10T00:00:00Z', expiresAt: '2026-09-10T00:10:00Z'
    });

    const args = fullAuthenticateTransactionArgs();
    await assert.rejects(() => store.commitAuthenticateTransaction(args), (e) => isUniqueConstraintError(e));

    // The challenge-consumption UPDATE (statement 1) would, in isolation,
    // have succeeded -- this is the crux of the test: it must NOT still be
    // committed after a later statement in the same batch throws.
    const challenge = await store.getChallenge('challenge:1');
    assert.equal(challenge.consumed_proof_digest, null, 'challenge was left consumed despite the transaction failing -- this is the exact wedge bug being fixed');
    assert.equal(challenge.result_ref, null);
    assert.equal(await store.getObject(args.runtimeCertificateDigest), null, 'runtime_certificate committed despite rollback');
    assert.equal(await store.getObject(args.authenticationReceiptDigest), null, 'authentication_receipt committed despite rollback');
    assert.equal(await store.getObject(args.recognitionReceiptDigest), null, 'recognition_receipt committed despite rollback');
    assert.equal(await store.getObject(args.sessionGrantDigest), null, 'session_grant committed despite rollback');
    assert.equal(await store.getObject(args.authenticateResponseDigest), null, 'authenticate_response committed despite rollback');
    assert.equal(await store.getRecognition(args.aiIdentityId), null, 'recognition projection committed despite rollback');
    assert.equal((await store.listSecurityEvents(args.aiIdentityId)).length, 0, 'security event committed despite rollback');

    // A genuine retry (e.g. after the caller resolves the id collision) can
    // now proceed cleanly -- the transaction did not leave the challenge
    // permanently poisoned.
    const retryArgs = fullAuthenticateTransactionArgs({
      resultRef: 'session:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      session: { ...fullAuthenticateTransactionArgs().session, sessionId: 'session:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }
    });
    const retryResults = await store.commitAuthenticateTransaction(retryArgs);
    assert.equal(Number(retryResults[0].changes), 1);
  } finally {
    db.close();
  }
});

test('commitAuthenticateTransaction: a genuine DB failure unrelated to any real duplicate is not a UNIQUE constraint error and must propagate as-is (never misclassified as replay)', async () => {
  const { db, store } = makeStore();
  try {
    await store.putChallenge({ challengeId: 'challenge:1', requestDigest: 'sha256:req', challengeJson: '{}', issuedAt: '2026-09-10T00:00:00Z', expiresAt: '2026-09-10T00:10:00Z' });
    // A null recognitionReceiptDigest violates ailp_recognition_current's
    // recognition_receipt_ref NOT NULL constraint (ailp_objects' own
    // object_digest PRIMARY KEY, notably, does NOT reject NULL here --
    // SQLite only treats PRIMARY KEY as implicitly NOT NULL for INTEGER
    // PRIMARY KEY columns -- so the failure has to be provoked on a column
    // with an explicit NOT NULL to get a real, non-UNIQUE error). This is a
    // schema/programming-error class of failure, completely different from
    // a UNIQUE collision.
    const args = fullAuthenticateTransactionArgs({ recognitionReceiptDigest: null });
    await assert.rejects(
      () => store.commitAuthenticateTransaction(args),
      (e) => !isUniqueConstraintError(e)
    );
    const challenge = await store.getChallenge('challenge:1');
    assert.equal(challenge.consumed_proof_digest, null, 'challenge was left consumed despite the transaction failing');
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
