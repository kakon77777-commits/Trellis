const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');

function reg(store, actor) {
  registerActor({command_id:`cmd:reg-${actor}`,idempotency_key:`idem:reg-${actor}`,principal_id:`principal:${actor}`,entity_id:actor},{eventStore:store,authorize:evaluateAuthority});
}
function ctx(db,store,actor){ return {db,eventStore:store,principalActorId:actor,capabilityGrants:[],evaluatedAt:'2026-09-02T12:00:00Z'}; }
function cmd(id,author,overrides={}){ return {command_id:`cmd:${id}`,idempotency_key:`idem:${id}`,principal_id:`principal:${author}`,publication_id:`pub:${id}`,author_actor_id:author,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[],...overrides}; }

function snapshot(db) {
  return db.prepare('SELECT * FROM publications_current ORDER BY publication_id').all();
}

test('Publication projection can be destroyed and rebuilt exactly from canonical history', () => {
  const { createPublication, revisePublication, withdrawPublication } = require('../publication/service');
  const { projectPublicationStream, rebuildPublicationProjection } = require('../publication/projector');
  const db=createTestDatabase(); const store=new SQLiteEventStore(db,{now:()=> '2026-09-02T12:00:01Z'});
  reg(store,'actor:A'); reg(store,'actor:B');
  createPublication(cmd('parent','actor:A'),ctx(db,store,'actor:A'));
  revisePublication({command_id:'cmd:rev-parent',idempotency_key:'idem:rev-parent',principal_id:'principal:actor:A',publication_id:'pub:parent',expected_version:1,body:'parent v2'},ctx(db,store,'actor:A'));
  createPublication(cmd('reply','actor:B',{reply_to_ref:'pub:parent'}),ctx(db,store,'actor:B'));
  withdrawPublication({command_id:'cmd:wd-parent',idempotency_key:'idem:wd-parent',principal_id:'principal:actor:A',publication_id:'pub:parent',expected_version:2},ctx(db,store,'actor:A'));

  projectPublicationStream(db,store,'pub:parent');
  projectPublicationStream(db,store,'pub:reply');
  const before=snapshot(db);
  assert.equal(before.length,2);
  assert.equal(before[0].publication_id,'pub:parent');
  assert.equal(before[0].lifecycle,'withdrawn');
  assert.equal(before[0].current_revision,2);

  db.exec('DELETE FROM publications_current');
  assert.equal(snapshot(db).length,0);
  rebuildPublicationProjection(db,store);
  assert.deepEqual(snapshot(db),before);
});
