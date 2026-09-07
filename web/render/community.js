const {escapeHtml,renderShell}=require('./shell');
const {renderSemanticFactMarkers}=require('./semantic-facts');
function edgeVisual(edge){return `<div class="graph-edge" data-graph-edge-id="${escapeHtml(edge.relationship_id)}"><span class="graph-node">${escapeHtml(edge.source_entity_id)}</span><span class="graph-line">${escapeHtml(edge.relationship_type)}</span><span class="graph-node">${escapeHtml(edge.target_entity_id)}</span></div>`;}
function edgeFallback(edge){return `<li data-graph-fallback-id="${escapeHtml(edge.relationship_id)}"><strong>${escapeHtml(edge.relationship_type)}</strong>: ${escapeHtml(edge.source_entity_id)} → ${escapeHtml(edge.target_entity_id)}</li>`;}
function renderCommunityPage(surface){
  const p=surface.presentation??{}; const title=p.name?.value??surface.community_id;
  const members=(surface.membership?.visible_members??[]).map(m=>`<li><a href="/actors/${encodeURIComponent(m.actor_id)}">${escapeHtml(m.actor_id)}</a></li>`).join('');
  const edges=surface.local_graph?.visible_scoped_relationships??[];
  const main=`<header class="page-head"><p class="eyebrow">Community · ${escapeHtml(surface.discoverability)}</p><h1>${escapeHtml(title)}</h1><p class="mono">${escapeHtml(surface.community_id)}</p><p>${escapeHtml(p.description?.value??'')}</p></header><section><div class="section-head"><h2>Members</h2><span>${escapeHtml(surface.membership?.visible_member_count??0)}</span></div>${members?`<ul class="member-list">${members}</ul>`:'<p class="muted">No public members.</p>'}</section><section><div class="section-head"><h2>Local graph</h2><span>${escapeHtml(surface.local_graph?.visible_relationship_count??0)}</span></div><div class="graph-visual" aria-hidden="true">${edges.map(edgeVisual).join('')}</div><details class="graph-fallback"><summary>Graph as text</summary><ul>${edges.map(edgeFallback).join('')}</ul></details></section>`;
  const context=`<section class="context-card"><p class="eyebrow">Community context</p><h2>${escapeHtml(title)}</h2><p>Only the Community projection's viewer-visible members and scoped relationships are rendered.</p><dl><div><dt>Viewer scope</dt><dd>${escapeHtml(surface.viewer_scope)}</dd></div><div><dt>Projection</dt><dd>${escapeHtml(surface.projection_version)}</dd></div></dl></section>`;
  return renderShell({title,main,context,semanticFacts:renderSemanticFactMarkers('community',surface)});
}
module.exports={renderCommunityPage,edgeVisual,edgeFallback};
