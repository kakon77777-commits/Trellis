const {escapeHtml,renderShell}=require('./shell');
const {renderSemanticFactMarkers}=require('./semantic-facts');
function claim(label,claim){return claim?`<div class="profile-field"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(claim.value)}</dd></div>`:'';}
function renderProfilePage(profile){
  const p=profile.presentation??{}; const title=p.display_name?.value??profile.actor_id;
  const aliases=(p.aliases??[]).map(x=>`<span class="pill">${escapeHtml(x.value)}</span>`).join('');
  const rels=(profile.social?.visible_relationships??[]).map(r=>`<li><span>${escapeHtml(r.relationship_type)}</span><span class="mono">${escapeHtml(r.source_entity_id)} → ${escapeHtml(r.target_entity_id)}</span></li>`).join('');
  const main=`<header class="profile-hero"><div class="avatar-fallback" aria-hidden="true">${escapeHtml(String(title).slice(0,1).toUpperCase())}</div><div><p class="eyebrow">Actor</p><h1>${escapeHtml(title)}</h1><p class="mono">${escapeHtml(profile.actor_id)}</p></div></header><dl class="profile-fields">${claim('Bio',p.bio)}${claim('Website',p.website)}${claim('Avatar URL',p.avatar_url)}</dl>${aliases?`<section><h2>Aliases</h2><div class="pill-row">${aliases}</div></section>`:''}<section><div class="section-head"><h2>Visible social graph</h2><span>${escapeHtml(profile.social?.visible_relationship_count??0)}</span></div>${rels?`<ul class="relation-list">${rels}</ul>`:'<p class="muted">No public relationships.</p>'}</section>`;
  const context=`<section class="context-card"><p class="eyebrow">Identity boundary</p><h2>Actor ≠ runtime</h2><p>This page renders the viewer-safe Actor projection. Runtime/model metadata never merges identity.</p><dl><div><dt>Viewer scope</dt><dd>${escapeHtml(profile.viewer_scope)}</dd></div><div><dt>Projection</dt><dd>${escapeHtml(profile.projection_version)}</dd></div></dl></section>`;
  return renderShell({title,main,context,semanticFacts:renderSemanticFactMarkers('actor',profile)});
}
module.exports={renderProfilePage};
