const { foldPublication } = require('./fold');
const MATERIALIZER_VERSION = 'publication-materializer:0.1';
function upsertPublicationStatement(state){return{sql:`
  INSERT INTO publications_current (
    publication_id, author_actor_id, publication_type, scope_ref,
    visibility, audience_actor_ids_json, reply_to_ref, quote_of_ref,
    publication_policy_ref, lifecycle, withdrawal_reason,
    current_revision, current_body, created_event_id, last_event_id,
    stream_version, materializer_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(publication_id) DO UPDATE SET
    author_actor_id=excluded.author_actor_id,publication_type=excluded.publication_type,scope_ref=excluded.scope_ref,
    visibility=excluded.visibility,audience_actor_ids_json=excluded.audience_actor_ids_json,reply_to_ref=excluded.reply_to_ref,
    quote_of_ref=excluded.quote_of_ref,publication_policy_ref=excluded.publication_policy_ref,lifecycle=excluded.lifecycle,
    withdrawal_reason=excluded.withdrawal_reason,current_revision=excluded.current_revision,current_body=excluded.current_body,
    created_event_id=excluded.created_event_id,last_event_id=excluded.last_event_id,stream_version=excluded.stream_version,
    materializer_version=excluded.materializer_version`,params:[state.publication_id,state.author_actor_id,state.publication_type,state.scope_ref??null,state.visibility,JSON.stringify(state.audience_actor_ids??[]),state.reply_to_ref??null,state.quote_of_ref??null,state.publication_policy_ref,state.lifecycle,state.withdrawal_reason??null,state.current_revision,state.current_body??'',state.created_event_id,state.last_event_id,state.stream_version,MATERIALIZER_VERSION]};}
async function projectPublicationStream(sql,eventStore,publicationId){const events=await eventStore.readStream('publication',publicationId);if(!events.length)return null;const state=foldPublication(events);await sql.batch([upsertPublicationStatement(state)]);return state;}
async function rebuildPublicationProjection(sql,eventStore){const rows=await sql.all(`SELECT DISTINCT stream_id FROM canonical_events WHERE stream_type='publication' ORDER BY stream_id`);const statements=[{sql:'DELETE FROM publications_current',params:[]}];for(const row of rows){const events=await eventStore.readStream('publication',row.stream_id);if(events.length)statements.push(upsertPublicationStatement(foldPublication(events)));}await sql.batch(statements);}
module.exports={MATERIALIZER_VERSION,upsertPublicationStatement,projectPublicationStream,rebuildPublicationProjection};
