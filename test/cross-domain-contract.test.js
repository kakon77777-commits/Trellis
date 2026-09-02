const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { createCommunity } = require('../community/service');
const { requestMembership, approveMembership } = require('../community/membership');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');

function ctx(db,store,actor,extra={}){return {db,eventStore:store,principalActorId:actor,capabilityGrants:[],evaluatedAt:'2026-09-02T14:00:00Z',...extra};}
function reg(store,a){registerActor({command_id:`cmd:reg-${a}`,idempotency_key:`idem:reg-${a}`,principal_id:`principal:${a}`,entity_id:a},{eventStore:store,authorize:evaluateAuthority});}
function pub(id,a,o={}){return {command_id:`cmd:${id}`,idempotency_key:`idem:${id}`,principal_id:`principal:${a}`,publication_id:`pub:${id}`,author_actor_id:a,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[],...o};}
function setupMember(db,store,a,c){
  reg(store,a); createCommunity({command_id:`cmd:create-${c}`,idempotency_key:`idem:create-${c}`,principal_id:`principal:${c}`,community_id:c},{eventStore:store,authorize:evaluateAuthority});
  const r=requestMembership({command_id:`cmd:join-${a}-${c}`,idempotency_key:`idem:join-${a}-${c}`,principal_id:`principal:${a}`,actor_id:a,community_id:c},ctx(db,store,a));
  approveMembership({command_id:`cmd:approve-${a}-${c}`,idempotency_key:`idem:approve-${a}-${c}`,principal_id:`principal:${c}`,relationship_id:r.relationship_id,community_id:c,expected_version:1},ctx(db,store,c));
  rebuildRelationshipProjection(db,store); return r.relationship_id;
}

test('X1-X3 contract registry declares all current inheriting domains', () => {
  const contract = require('../foundation/cross-domain-contract');
  assert.equal(contract.CONTRACT_REF,'trellis-foundation-cross-domain:0.1');
  for(const domain of ['profile','relationship_surface','community','discovery','publication']) {
    assert.deepEqual(contract.INHERITORS[domain],['X1','X2','X3']);
  }
});

test('X1 canonical visibility is a ceiling: policy narrows public but cannot widen private', () => {
  const { createPublication } = require('../publication/service');
  const { rebuildPublicationProjection } = require('../publication/projector');
  const { loadPublicationSurface } = require('../publication/read-service');
  const db=createTestDatabase(); const store=new SQLiteEventStore(db); reg(store,'actor:A'); reg(store,'actor:B');
  createPublication(pub('x1-public','actor:A'),ctx(db,store,'actor:A'));
  createPublication(pub('x1-private','actor:A',{visibility:'private'}),ctx(db,store,'actor:A'));
  rebuildPublicationProjection(db,store);
  assert.equal(loadPublicationSurface({publicationId:'pub:x1-public',viewerContext:{viewer_actor_id:'actor:B'},db,eventStore:store,disclosurePolicy:()=> 'deny'}),null);
  assert.equal(loadPublicationSurface({publicationId:'pub:x1-private',viewerContext:{viewer_actor_id:'actor:B'},db,eventStore:store,disclosurePolicy:()=> 'allow'}),null);
  assert.equal(store.readStream('publication','pub:x1-private')[0].payload.visibility,'private');
});

test('X2 social membership alone cannot authorize Community Publication', () => {
  const { createPublication } = require('../publication/service');
  const db=createTestDatabase(); const store=new SQLiteEventStore(db); setupMember(db,store,'actor:A','community:C');
  const command=pub('x2','actor:A',{scope_ref:'community:C',visibility:'scope_members'});
  assert.throws(() => createPublication(command,ctx(db,store,'actor:A')), error=>error&&error.code==='POLICY_DENIED');
  const before=db.prepare("SELECT COUNT(*) AS n FROM canonical_events WHERE stream_type='relationship'").get().n;
  const grant={active:true,principal_id:'principal:actor:A',capability:'publication:create',scope_ref:'community:C'};
  createPublication(command,ctx(db,store,'actor:A',{capabilityGrants:[grant]}));
  const after=db.prepare("SELECT COUNT(*) AS n FROM canonical_events WHERE stream_type='relationship'").get().n;
  assert.equal(after,before);
});

test('X3 viewer-invisible private reply cannot change viewer-visible parent surface', () => {
  const { createPublication } = require('../publication/service');
  const { rebuildPublicationProjection, projectPublicationStream } = require('../publication/projector');
  const { loadPublicationSurface } = require('../publication/read-service');
  const db=createTestDatabase(); const store=new SQLiteEventStore(db);
  for(const a of ['actor:A','actor:B','actor:C']) reg(store,a);
  createPublication(pub('x3-parent','actor:A'),ctx(db,store,'actor:A'));
  rebuildPublicationProjection(db,store);
  const before=loadPublicationSurface({publicationId:'pub:x3-parent',viewerContext:{viewer_actor_id:'actor:B'},db,eventStore:store});
  createPublication(pub('x3-hidden','actor:C',{visibility:'private',reply_to_ref:'pub:x3-parent'}),ctx(db,store,'actor:C'));
  projectPublicationStream(db,store,'pub:x3-hidden');
  const after=loadPublicationSurface({publicationId:'pub:x3-parent',viewerContext:{viewer_actor_id:'actor:B'},db,eventStore:store});
  assert.deepEqual(after,before);
});
