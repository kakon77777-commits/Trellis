const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createTestDatabase } = require('./helpers/test-db');
const { AsyncSqlEventStore } = require('../events/async-sql-event-store');
const { renderPublicationPage } = require('../web/render/publication');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'production-validation-fixture-v1.js');

function loadFixtureModule() {
  delete require.cache[require.resolve(SCRIPT)];
  return require(SCRIPT);
}

function createSystem() {
  const db = createTestDatabase();
  const store = new AsyncSqlEventStore(db.sql, {
    now: () => '2026-09-08T16:00:00.000Z',
    token: (() => { let n = 0; return () => `pvf1-token-${++n}`; })()
  });
  return { db, sql: db.sql, store };
}

async function tableCount(sql, table) {
  const row = await sql.first(`SELECT COUNT(*) AS n FROM ${table}`);
  return row?.n ?? 0;
}

test('production validation fixture script exists and exports the bounded v1 API', () => {
  assert.equal(fs.existsSync(SCRIPT), true, 'fixture script must exist');
  const mod = loadFixtureModule();
  assert.equal(typeof mod.seedProductionValidationFixtureV1, 'function');
  assert.equal(typeof mod.verifyProductionValidationFixtureV1, 'function');
  assert.equal(typeof mod.PRODUCTION_VALIDATION_FIXTURE_V1, 'object');
});

test('fixture manifest has stable public, hidden, withdrawn, and never-created controls', () => {
  const { PRODUCTION_VALIDATION_FIXTURE_V1: f } = loadFixtureModule();
  assert.equal(f.schema, 'trellis-production-validation-fixture:v1');
  assert.equal(f.correlation_id, 'corr:trellis-production-validation-fixture:v1');
  assert.deepEqual(f.provenance_refs, ['trellis:production-validation-fixture:v1']);
  assert.deepEqual(Object.values(f.actors), [
    'actor:trellis-validation',
    'actor:trellis-validation-peer-a',
    'actor:trellis-validation-peer-b',
    'actor:trellis-validation-hidden'
  ]);
  assert.equal(f.communities.public, 'community:trellis-production-validation');
  assert.equal(f.communities.hidden, 'community:trellis-production-validation-hidden');
  assert.equal(f.publications.withdrawn_target, 'pub:trellis-validation-withdrawn-target');
  assert.equal(f.publications.hidden, 'pub:trellis-validation-hidden');
  assert.equal(f.publications.missing_control, 'pub:trellis-validation-never-created');
  const seededPublicationIds = Object.entries(f.publications)
    .filter(([key]) => key !== 'missing_control')
    .map(([, value]) => value);
  assert.equal(seededPublicationIds.includes(f.publications.missing_control), false);
});

test('seed and verify create a deterministic viewer-safe production validation world', async () => {
  const { sql, store } = createSystem();
  const {
    PRODUCTION_VALIDATION_FIXTURE_V1: f,
    seedProductionValidationFixtureV1,
    verifyProductionValidationFixtureV1
  } = loadFixtureModule();

  const seeded = await seedProductionValidationFixtureV1({ sql, eventStore: store });
  assert.equal(seeded.status, 'SEEDED');
  assert.equal(seeded.schema, f.schema);

  const report = await verifyProductionValidationFixtureV1({ sql, eventStore: store });
  assert.equal(report.status, 'PASS');
  assert.equal(report.schema, f.schema);
  assert.equal(report.directory.public_actor_ids.includes(f.actors.primary), true);
  assert.equal(report.directory.public_actor_ids.includes(f.actors.peer_a), true);
  assert.equal(report.directory.public_actor_ids.includes(f.actors.peer_b), true);
  assert.equal(report.directory.public_actor_ids.includes(f.actors.hidden), false);
  assert.equal(report.directory.public_community_ids.includes(f.communities.public), true);
  assert.equal(report.directory.public_community_ids.includes(f.communities.hidden), false);

  assert.equal(report.community.visible_member_count, 3);
  assert.deepEqual(report.community.visible_member_actor_ids, [f.actors.primary, f.actors.peer_a, f.actors.peer_b].sort());
  assert.equal(report.community.visible_scoped_relationship_count, 2);
  assert.deepEqual(report.community.visible_scoped_relationship_ids, Object.values(f.relationships.scoped).sort());

  assert.equal(report.publications.public.lifecycle, 'active');
  assert.equal(report.publications.xss.lifecycle, 'active');
  assert.equal(report.publications.reply.reference_status, 'active');
  assert.equal(report.publications.quote.reference_status, 'active');
  assert.equal(report.publications.withdrawn_target.lifecycle, 'withdrawn');
  assert.equal(report.publications.withdrawn_target.content_is_null, true);
  assert.equal(report.publications.reference_to_withdrawn.reference_status, 'withdrawn');
  assert.equal(report.publications.hidden.anonymous_surface_is_null, true);
  assert.equal(report.publications.missing_control.anonymous_surface_is_null, true);
  assert.equal(report.publications.hidden_and_missing_equivalent, true);

  assert.equal(report.integrity.append_batch_guard_count, 0);
  assert.equal(report.integrity.hash_chains_ok, true);
  assert.equal(report.integrity.projections_match_canonical, true);

  const xssHtml = renderPublicationPage(report._surfaces.xss);
  assert.doesNotMatch(xssHtml, /<script>alert\("trellis-production-validation"\)<\/script>/);
  assert.match(xssHtml, /&lt;script&gt;alert\(&quot;trellis-production-validation&quot;\)&lt;\/script&gt;/);
});

test('seeding v1 twice is idempotent and does not append duplicate canonical events', async () => {
  const { sql, store } = createSystem();
  const { seedProductionValidationFixtureV1, verifyProductionValidationFixtureV1 } = loadFixtureModule();

  await seedProductionValidationFixtureV1({ sql, eventStore: store });
  const firstEvents = await tableCount(sql, 'canonical_events');
  const firstReceipts = await tableCount(sql, 'command_receipts');

  const second = await seedProductionValidationFixtureV1({ sql, eventStore: store });
  const secondEvents = await tableCount(sql, 'canonical_events');
  const secondReceipts = await tableCount(sql, 'command_receipts');

  assert.equal(second.status, 'SEEDED');
  assert.equal(secondEvents, firstEvents);
  assert.equal(secondReceipts, firstReceipts);
  assert.equal((await verifyProductionValidationFixtureV1({ sql, eventStore: store })).status, 'PASS');
});
