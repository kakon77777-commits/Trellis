const {escapeHtml,renderShell}=require('./shell');
const {renderSemanticFactMarkers}=require('./semantic-facts');
const {renderContextLens}=require('./context-lens');
const {renderSemanticEdge}=require('./trellis-line');
const {renderGraphList}=require('./graph-list');
const {renderNodeBadge}=require('./node-badge');

const ACTOR_GRAPH_PREVIEW_LIMIT=8;

function claim(label,claim){return claim?`<div class="profile-field"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(claim.value)}</dd></div>`:'';}
function edgeLabels(edge,actorId,title){
  const source=edge.source_entity_id===actorId?title:edge.source_entity_id;
  const target=edge.target_entity_id===actorId?title:edge.target_entity_id;
  return{sourceLabel:source,targetLabel:target,directed:false};
}
function renderProfilePage(profile){
  const p=profile.presentation??{};
  const title=p.display_name?.value??profile.actor_id;
  const aliases=(p.aliases??[]).map(x=>`<span class="pill">${escapeHtml(x.value)}</span>`).join('');
  const allEdges=profile.social?.visible_relationships??[];
  const previewEdges=allEdges.slice(0,ACTOR_GRAPH_PREVIEW_LIMIT);
  const graph=previewEdges.map(edge=>renderSemanticEdge(edge,edgeLabels(edge,profile.actor_id,title))).join('');
  const previewList=renderGraphList(previewEdges,{title:'Graph as text',idPrefix:'actor-graph'});
  const fullList=allEdges.length>previewEdges.length?`<details class="graph-full-list"><summary>View all ${escapeHtml(allEdges.length)} visible relationships</summary>${renderGraphList(allEdges,{title:'All visible relationships',idPrefix:'actor-all',idAttribute:'data-full-edge-id'})}</details>`:'';
  const hero=`<header class="profile-hero observatory-profile-hero"><div class="avatar-fallback" aria-hidden="true">${escapeHtml(String(title).slice(0,1).toUpperCase())}</div><div><p class="eyebrow">Actor</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(p.bio?.value??'')}</p></div></header>`;
  const presentation=`<section><h2>Public presentation</h2><dl class="profile-fields">${claim('Website',p.website)}${claim('Avatar URL',p.avatar_url)}</dl>${aliases?`<div class="alias-block"><h3>Aliases</h3><div class="pill-row">${aliases}</div></div>`:''}</section>`;
  const visible=`<section class="visible-trellis"><div class="section-head"><h2>Visible Trellis</h2><span>${escapeHtml(allEdges.length)} visible relationships</span></div>${previewEdges.length?`<p class="muted">Showing ${escapeHtml(previewEdges.length)} of ${escapeHtml(allEdges.length)} visible relationships</p><div class="graph-visual actor-graph-preview">${graph}</div><details class="graph-fallback"><summary>View graph as text</summary>${previewList}</details>${fullList}`:'<div class="empty-state"><h3>No visible relationships</h3><p>No relation edge is rendered without a viewer-safe relationship.</p></div>'}</section>`;
  const lead=hero;
  const main=`${presentation}${visible}`;
  const context=renderContextLens({label:'Context Lens',title:'Actor view',summaryRows:[['Viewer',profile.viewer_scope??'public'],['Identity boundary','Actor ≠ runtime'],['Visible relations',profile.social?.visible_relationship_count??allEdges.length]],inspectionRows:[['Actor ID',profile.actor_id],['Projection',profile.projection_version],['Viewer scope',profile.viewer_scope]],machineHref:`/api/actors/${encodeURIComponent(profile.actor_id)}`,machineLabel:'Machine representation'});
  return renderShell({title,lead,main,context,semanticFacts:renderSemanticFactMarkers('actor',profile)});
}
module.exports={ACTOR_GRAPH_PREVIEW_LIMIT,renderProfilePage};
