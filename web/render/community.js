const {escapeHtml,renderShell}=require('./shell');
const {renderSemanticFactMarkers}=require('./semantic-facts');
const {renderContextLens}=require('./context-lens');
const {renderSemanticEdge}=require('./trellis-line');
const {renderGraphList}=require('./graph-list');
const {renderNodeBadge}=require('./node-badge');

const COMMUNITY_GRAPH_PREVIEW_LIMIT=12;

function edgeVisual(edge){
  return `<div class="community-edge" data-graph-edge-id="${escapeHtml(edge.relationship_id)}">${renderSemanticEdge(edge,{directed:false})}</div>`;
}
function edgeFallback(edge){
  return `<li data-graph-fallback-id="${escapeHtml(edge.relationship_id)}"><strong>${escapeHtml(edge.relationship_type)}</strong>: ${escapeHtml(edge.source_entity_id)} → ${escapeHtml(edge.target_entity_id)}</li>`;
}
function renderMembers(surface){
  const members=surface.membership?.visible_members??[];
  if(!members.length)return '<p class="muted">No visible members.</p>';
  return `<div class="member-grid">${members.map(m=>renderNodeBadge({kind:'actor',label:m.actor_id,href:`/actors/${encodeURIComponent(m.actor_id)}`,meta:'Actor'})).join('')}</div>`;
}
function renderCommunityPage(surface){
  const p=surface.presentation??{};
  const title=p.name?.value??surface.community_id;
  const allEdges=surface.local_graph?.visible_scoped_relationships??[];
  const previewEdges=allEdges.slice(0,COMMUNITY_GRAPH_PREVIEW_LIMIT);
  const count=surface.local_graph?.visible_relationship_count??allEdges.length;
  const previewGraph=previewEdges.map(edgeVisual).join('');
  const previewFallback=previewEdges.length?`<details class="graph-fallback"><summary>View graph as text</summary><ul>${previewEdges.map(edgeFallback).join('')}</ul></details>`:'';
  const fullList=allEdges.length?`<details class="graph-full-list"><summary>View all ${escapeHtml(allEdges.length)} visible relationships</summary>${renderGraphList(allEdges,{title:'All visible relationships',idPrefix:'community-all',idAttribute:'data-full-edge-id'})}</details>`:'';
  const graphSection=allEdges.length
    ? `<section class="community-local-graph"><div class="section-head"><h2>Local Trellis</h2><span>${escapeHtml(count)} visible relationships</span></div><p class="muted">Showing ${escapeHtml(previewEdges.length)} of ${escapeHtml(allEdges.length)} visible relationships</p><div class="graph-visual community-graph-preview" aria-label="Visible local graph">${previewGraph}</div>${previewFallback}${fullList}</section>`
    : `<section class="community-local-graph"><div class="section-head"><h2>Local Trellis</h2><span>0 visible relationships</span></div><div class="empty-state"><span class="node-mark" aria-hidden="true">◇</span><h3>No visible local relationships</h3><p>The absence of visible edges does not assert that no other relationships exist.</p></div></section>`;
  const lead=`<header class="page-head observatory-head"><p class="eyebrow">Community · ${escapeHtml(surface.discoverability)}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(p.description?.value??'')}</p><div class="status-row"><span class="pill">${escapeHtml(surface.discoverability)}</span><span class="pill">${escapeHtml(surface.membership?.visible_member_count??0)} visible members</span></div></header>`;
  const main=`<section><div class="section-head"><h2>Members</h2><span>${escapeHtml(surface.membership?.visible_member_count??0)} visible members</span></div>${renderMembers(surface)}</section>${graphSection}`;
  const context=renderContextLens({label:'Context Lens',title:'Community',summaryRows:[['Discoverability',surface.discoverability],['Viewer',surface.viewer_scope],['Visible members',surface.membership?.visible_member_count??0],['Visible relations',count]],inspectionRows:[['Community ID',surface.community_id],['Projection',surface.projection_version],['Graph source','viewer-visible scoped relationships']],machineHref:`/api/communities/${encodeURIComponent(surface.community_id)}`,machineLabel:'Machine representation'});
  return renderShell({title,lead,main,context,semanticFacts:renderSemanticFactMarkers('community',surface)});
}
module.exports={COMMUNITY_GRAPH_PREVIEW_LIMIT,renderCommunityPage,edgeVisual,edgeFallback};
