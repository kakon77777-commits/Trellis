const { createTestDatabase } = require('./test-db');
const { SQLiteEventStore } = require('../../events/sqlite-event-store');
const { evaluateAuthority } = require('../../authority/policy');
const { registerActor } = require('../../entity/service');
const { createCommunity } = require('../../community/service');
const { setDisplayName } = require('../../profile/product-commands');
const { setCommunityName, setCommunityDiscoverability } = require('../../community/product-commands');
const { proposeRelationship, activateRelationship } = require('../../relationship/service');
const { rebuildRelationshipProjection } = require('../../projections/relationship-projector');
const { createPublication } = require('../../publication/service');
const { rebuildPublicationProjection } = require('../../publication/projector');

function ctx(db,store,actor,extra={}) { return {db,eventStore:store,authorize:evaluateAuthority,principalActorId:actor,capabilityGrants:[],evaluatedAt:'2026-09-07T17:00:00Z',...extra}; }
function reg(store,id){registerActor({command_id:`reg:${id}`,idempotency_key:`reg:${id}`,principal_id:`principal:${id}`,entity_id:id},{eventStore:store,authorize:evaluateAuthority});}
function actorName(db,store,id,value,visibility='public'){setDisplayName({command_id:`name:${id}`,idempotency_key:`name:${id}`,principal_id:`principal:${id}`,actor_id:id,value,visibility},ctx(db,store,id));}
function community(db,store,id,name,discoverability='public'){
  createCommunity({command_id:`create:${id}`,idempotency_key:`create:${id}`,principal_id:`principal:${id}`,community_id:id},{eventStore:store,authorize:evaluateAuthority});
  setCommunityName({command_id:`cname:${id}`,idempotency_key:`cname:${id}`,principal_id:`principal:${id}`,community_id:id,value:name},ctx(db,store,id));
  if(discoverability!=='public') setCommunityDiscoverability({command_id:`disc:${id}`,idempotency_key:`disc:${id}`,principal_id:`principal:${id}`,community_id:id,value:discoverability},ctx(db,store,id));
}
function collab(db,store,source,target,suffix,visibility='public'){
  const p=proposeRelationship({command_id:`collab:${suffix}`,idempotency_key:`collab:${suffix}`,principal_id:`principal:${source}`,source_entity_id:source,target_entity_id:target,relationship_type:'collaborates_with',visibility},ctx(db,store,source));
  activateRelationship({command_id:`activate:${suffix}`,idempotency_key:`activate:${suffix}`,principal_id:`principal:${target}`,relationship_id:p.relationship_id,expected_version:1},ctx(db,store,target));
  return p.relationship_id;
}
function pub(db,store,id,author,extra={}){
  return createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${author}`,publication_id:`pub:${id}`,author_actor_id:author,publication_type:'post',body:extra.body??`body:${id}`,visibility:extra.visibility??'public',reply_to_ref:extra.reply_to_ref??null,scope_ref:extra.scope_ref??null,audience_actor_ids:extra.audience_actor_ids??[]},ctx(db,store,author,extra.context??{})).publication_id;
}
function setupWebSystem(){
  const db=createTestDatabase(); let tick=0;
  const store=new SQLiteEventStore(db,{now:()=>`2026-09-07T17:00:${String(tick++).padStart(2,'0')}Z`});
  for(const id of ['actor:A','actor:B','actor:H']) reg(store,id);
  actorName(db,store,'actor:A','Alpha'); actorName(db,store,'actor:B','Beta'); actorName(db,store,'actor:H','Hidden','private');
  community(db,store,'community:C','Commons','public'); community(db,store,'community:Cprivate','Secret','private');
  collab(db,store,'actor:A','actor:B','public');
  rebuildRelationshipProjection(db,store);
  pub(db,store,'p1','actor:A',{body:'Hello <script>alert(1)</script>'});
  pub(db,store,'p2','actor:B');
  pub(db,store,'reply','actor:B',{reply_to_ref:'pub:p1'});
  pub(db,store,'hidden','actor:H',{visibility:'private'});
  rebuildPublicationProjection(db,store);
  return {db,store};
}
function counts(db){
  const table=n=>db.prepare(`SELECT COUNT(*) AS n FROM ${n}`).get().n;
  return {
    events:table('canonical_events'), receipts:table('command_receipts'), preferences:table('preferences_current'),
    consumption:table('consumption_state'), notifications:table('notifications_current')
  };
}
module.exports={setupWebSystem,counts,ctx};
