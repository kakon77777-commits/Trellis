const { canViewPublication, normalizePublicationRow } = require('../publication/read-policy');
const { createMembershipResolver } = require('../community/membership-read');

function normalizeReactionRow(row){
  if(!row)return null;
  return{...row,audience_actor_ids:Array.isArray(row.audience_actor_ids)?row.audience_actor_ids:JSON.parse(row.audience_actor_ids_json??'[]')};
}
async function resolveReadableActiveTarget({publicationId,viewerContext={},db,disclosurePolicy}){
  const publication=normalizePublicationRow(await db.first('SELECT * FROM publications_current WHERE publication_id = ?',[publicationId]));
  if(!publication)return null;
  const membershipResolver=await createMembershipResolver(db);
  if(!canViewPublication(publication,viewerContext,disclosurePolicy,membershipResolver))return null;
  if(publication.lifecycle!=='active')return null;
  return publication;
}
module.exports={normalizeReactionRow,resolveReadableActiveTarget};
