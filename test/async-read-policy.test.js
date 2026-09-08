const test=require('node:test');
const assert=require('node:assert/strict');
const {createTestDatabase}=require('./helpers/test-db');
const {SQLiteAsyncAdapter}=require('../storage/sqlite-adapter');
const {AsyncSqlEventStore}=require('../events/async-sql-event-store');
const {evaluateAuthority}=require('../authority/policy');
const {registerActor}=require('../entity/service');
const {setDisplayName}=require('../profile/product-commands');
const {projectActorProfile}=require('../profile/projector');
const {buildActorProfile}=require('../profile/read-service');

function setup(){
  const raw=createTestDatabase();
  const sql=new SQLiteAsyncAdapter(raw);
  let tick=0;
  const eventStore=new AsyncSqlEventStore(sql,{now:()=>`2026-09-08T01:00:${String(tick++).padStart(2,'0')}.000Z`,token:()=>`task2-token-${tick}`});
  return{raw,sql,eventStore};
}
function ctx(system,actorId){return{db:system.sql,sql:system.sql,eventStore:system.eventStore,authorize:evaluateAuthority,principalActorId:actorId,capabilityGrants:[],evaluatedAt:'2026-09-08T01:00:00.000Z'};}

test('profile viewer-safe read is Promise-only over AsyncSqlPort',async()=>{
  const system=setup();
  await registerActor({command_id:'reg:A',idempotency_key:'reg:A',principal_id:'principal:actor:A',entity_id:'actor:A'},{eventStore:system.eventStore,authorize:evaluateAuthority});
  await setDisplayName({command_id:'name:A',idempotency_key:'name:A',principal_id:'principal:actor:A',actor_id:'actor:A',value:'Alpha',visibility:'public'},ctx(system,'actor:A'));
  await projectActorProfile(system.sql,system.eventStore,'actor:A');

  const readPromise=buildActorProfile({actorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db:system.sql,eventStore:system.eventStore});
  assert.equal(typeof readPromise?.then,'function','persistence-dependent read must be Promise-only');
  const profile=await readPromise;
  assert.equal(profile.actor_id,'actor:A');
  assert.equal(profile.presentation.display_name.value,'Alpha');
});

const {createCommunity}=require('../community/service');
const {setCommunityName}=require('../community/product-commands');
const {buildCommunitySurface}=require('../community/read-service');

test('community viewer-safe read is Promise-only over AsyncSqlPort',async()=>{
  const system=setup();
  await createCommunity({command_id:'community:C',idempotency_key:'community:C',principal_id:'principal:community:C',community_id:'community:C'},{eventStore:system.eventStore,authorize:evaluateAuthority});
  await setCommunityName({command_id:'community:name:C',idempotency_key:'community:name:C',principal_id:'principal:community:C',community_id:'community:C',value:'Commons'},ctx(system,'community:C'));
  const readPromise=buildCommunitySurface({communityId:'community:C',viewerContext:{},db:system.sql,eventStore:system.eventStore});
  assert.equal(typeof readPromise?.then,'function');
  const surface=await readPromise;
  assert.equal(surface.community_id,'community:C');
  assert.equal(surface.presentation.name.value,'Commons');
});

const {createPublication}=require('../publication/service');
const {projectPublicationStream}=require('../publication/projector');
const {createReaction}=require('../reaction/service');
const {projectReactionStream}=require('../reaction/projector');
const {loadPublicationSurface}=require('../publication/read-service');

test('publication and reaction viewer-safe read is Promise-only over AsyncSqlPort',async()=>{
  const system=setup();
  for(const actor of ['actor:A','actor:B']) await registerActor({command_id:`reg:${actor}`,idempotency_key:`reg:${actor}`,principal_id:`principal:${actor}`,entity_id:actor},{eventStore:system.eventStore,authorize:evaluateAuthority});
  await createPublication({command_id:'pub:P',idempotency_key:'pub:P',principal_id:'principal:actor:A',publication_id:'pub:P',author_actor_id:'actor:A',publication_type:'post',body:'hello',visibility:'public',audience_actor_ids:[]},ctx(system,'actor:A'));
  await projectPublicationStream(system.sql,system.eventStore,'pub:P');
  const reaction=await createReaction({command_id:'reaction:B',idempotency_key:'reaction:B',principal_id:'principal:actor:B',actor_id:'actor:B',publication_id:'pub:P',reaction_type:'like'},ctx(system,'actor:B'));
  await projectReactionStream(system.sql,system.eventStore,reaction.reaction_id);
  const readPromise=loadPublicationSurface({publicationId:'pub:P',viewerContext:{viewer_actor_id:'actor:B'},db:system.sql,eventStore:system.eventStore});
  assert.equal(typeof readPromise?.then,'function');
  const surface=await readPromise;
  assert.equal(surface.publication_id,'pub:P');
  assert.equal(surface.reaction_summary.like,1);
  assert.equal(surface.viewer_reaction.reaction_type,'like');
});

const {proposeRelationship}=require('../relationship/service');
const {projectRelationshipStream}=require('../projections/relationship-projector');
const {loadRelationshipDetail}=require('../relationship-surface/read-service');

test('relationship detail read is Promise-only over AsyncSqlPort',async()=>{
  const system=setup();
  for(const actor of ['actor:A','actor:B']) await registerActor({command_id:`relreg:${actor}`,idempotency_key:`relreg:${actor}`,principal_id:`principal:${actor}`,entity_id:actor},{eventStore:system.eventStore,authorize:evaluateAuthority});
  const rel=await proposeRelationship({command_id:'rel:A-B',idempotency_key:'rel:A-B',principal_id:'principal:actor:A',source_entity_id:'actor:A',target_entity_id:'actor:B',relationship_type:'follows',visibility:'public'},ctx(system,'actor:A'));
  await projectRelationshipStream(system.sql,system.eventStore,rel.relationship_id);
  const readPromise=loadRelationshipDetail({relationshipId:rel.relationship_id,viewerContext:{viewer_actor_id:'actor:B'},db:system.sql,eventStore:system.eventStore});
  assert.equal(typeof readPromise?.then,'function');
  const detail=await readPromise;
  assert.equal(detail.relationship_id,rel.relationship_id);
  assert.equal(detail.lifecycle,'active');
  assert.ok(detail.history.length>=1);
});

const {createPreference}=require('../preference/service');
const {loadPreferenceSurface}=require('../preference/read-service');
const {recordSeen}=require('../consumption/service');
const {loadConsumptionSurface}=require('../consumption/read-service');

test('preference and consumption owner reads are Promise-only over AsyncSqlPort',async()=>{
  const system=setup();
  for(const actor of ['actor:A','actor:B']) await registerActor({command_id:`ownerreg:${actor}`,idempotency_key:`ownerreg:${actor}`,principal_id:`principal:${actor}`,entity_id:actor},{eventStore:system.eventStore,authorize:evaluateAuthority});
  await createPublication({command_id:'ownerpub:P',idempotency_key:'ownerpub:P',principal_id:'principal:actor:B',publication_id:'pub:OwnerRead',author_actor_id:'actor:B',publication_type:'post',body:'hello',visibility:'public',audience_actor_ids:[]},ctx(system,'actor:B'));
  await projectPublicationStream(system.sql,system.eventStore,'pub:OwnerRead');
  await createPreference({command_id:'pref:bookmark',idempotency_key:'pref:bookmark',principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_type:'bookmark_publication',target:{publication_id:'pub:OwnerRead'}},ctx(system,'actor:A'));
  const prefPromise=loadPreferenceSurface({ownerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db:system.sql,eventStore:system.eventStore});
  assert.equal(typeof prefPromise?.then,'function');
  const prefSurface=await prefPromise;
  assert.equal(prefSurface.bookmarks[0].publication_id,'pub:OwnerRead');

  const grant={active:true,principal_id:'principal:surface',capability:'consumption:record',scope_ref:null};
  await recordSeen({command_id:'seen:owner',principal_id:'principal:surface',requested_consumer_actor_id:'actor:A',target:{publication_id:'pub:OwnerRead'}},{db:system.sql,sql:system.sql,eventStore:system.eventStore,recognizedViewerActorId:'actor:A',capabilityGrants:[grant],now:()=> '2026-09-08T01:30:00.000Z'});
  const consumptionPromise=loadConsumptionSurface({consumerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db:system.sql,eventStore:system.eventStore});
  assert.equal(typeof consumptionPromise?.then,'function');
  const consumptionSurface=await consumptionPromise;
  assert.equal(consumptionSurface.items[0].target_ref,'pub:OwnerRead');
});
