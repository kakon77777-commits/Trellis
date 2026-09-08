const { createMembershipResolver } = require('../community/membership-read');
const { normalizePublicationRow, canViewPublication, publicationViewerScope } = require('./read-policy');
const { resolveReferenceContext } = require('./references');
const { availablePublicationActions } = require('./action-hints');
const { loadReactionSummary, loadViewerReaction } = require('../reaction/read-service');
const { reactionActionHints } = require('../reaction/action-hints');

async function loadPublicationRow(db,publicationId){return normalizePublicationRow(await db.first('SELECT * FROM publications_current WHERE publication_id = ?',[publicationId]));}
async function visibleReplies({publicationId,viewerContext,db,disclosurePolicy,membershipResolver}){
  const rows=(await db.all(`SELECT * FROM publications_current WHERE reply_to_ref = ? ORDER BY publication_id`,[publicationId])).map(normalizePublicationRow);
  return rows.filter(row=>canViewPublication(row,viewerContext,disclosurePolicy,membershipResolver)).map(row=>({publication_id:row.publication_id,author_actor_id:row.author_actor_id,lifecycle:row.lifecycle,detail_ref:`/publications/${encodeURIComponent(row.publication_id)}`}));
}
async function loadPublicationSurface({publicationId,viewerContext={},eventStore,db,disclosurePolicy,includeReactionDecoration=true}){
  const publication=await loadPublicationRow(db,publicationId);if(!publication)return null;
  const membershipResolver=await createMembershipResolver(db);
  if(!canViewPublication(publication,viewerContext,disclosurePolicy,membershipResolver))return null;
  const replies=await visibleReplies({publicationId,viewerContext,db,disclosurePolicy,membershipResolver});
  const referenceContext=await resolveReferenceContext({publication,viewerContext,db,disclosurePolicy,membershipResolver});
  const surface={
    publication_id:publication.publication_id,author_actor_id:publication.author_actor_id,publication_type:publication.publication_type,
    scope_ref:publication.scope_ref??null,visibility:publication.visibility,lifecycle:publication.lifecycle,
    withdrawal_reason:publication.lifecycle==='withdrawn'?publication.withdrawal_reason:null,
    content:publication.lifecycle==='active'?{revision:publication.current_revision,body:publication.current_body}:null,
    reference_context:referenceContext,visible_replies:replies,visible_reply_count:replies.length,
    available_actions:availablePublicationActions({publication,viewerContext}),
    execution_authority:{implied_by_publication_read:false,implied_by_social_membership:false},
    viewer_scope:publicationViewerScope(publication,viewerContext,membershipResolver),projection_version:'publication-surface:0.1'
  };
  if(publication.lifecycle==='active'&&includeReactionDecoration){
    const reactionInput={publicationId,viewerContext,eventStore,db,disclosurePolicy};
    surface.reaction_summary=(await loadReactionSummary(reactionInput))??{};
    surface.viewer_reaction=await loadViewerReaction(reactionInput);
    surface.reaction_actions=viewerContext.viewer_actor_id?reactionActionHints(surface.viewer_reaction):[];
  }
  return surface;
}
module.exports={loadPublicationSurface,loadPublicationRow,visibleReplies};
