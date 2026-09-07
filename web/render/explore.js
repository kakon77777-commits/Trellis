const {escapeHtml,renderShell}=require('./shell');
const {renderSemanticFactMarkers}=require('./semantic-facts');
function renderExplorePage(directory){
  const actors=(directory?.actors??[]).map(a=>`<a class="entity-card" href="/actors/${encodeURIComponent(a.actor_id)}"><p class="eyebrow">Actor</p><h2>${escapeHtml(a.presentation?.display_name?.value??a.actor_id)}</h2><p>${escapeHtml(a.presentation?.bio?.value??a.actor_id)}</p></a>`).join('');
  const communities=(directory?.communities??[]).map(c=>`<a class="entity-card" href="/communities/${encodeURIComponent(c.community_id)}"><p class="eyebrow">Community</p><h2>${escapeHtml(c.presentation?.name?.value??c.community_id)}</h2><p>${escapeHtml(c.presentation?.description?.value??'Public community')}</p></a>`).join('');
  const main=`<header class="page-head"><p class="eyebrow">Explore</p><h1>Public identities & communities</h1><p>This is a deterministic public directory, not personalized Discovery.</p></header><section><div class="section-head"><h2>Actors</h2><span>${(directory?.actors??[]).length}</span></div><div class="entity-grid">${actors||'<p class="muted">No public Actor presentations.</p>'}</div></section><section id="communities"><div class="section-head"><h2>Communities</h2><span>${(directory?.communities??[]).length}</span></div><div class="entity-grid">${communities||'<p class="muted">No public Communities.</p>'}</div></section>`;
  const context=`<section class="context-card"><p class="eyebrow">Directory</p><h2>Public-by-construction</h2><p>Unlisted Communities remain direct-reference only. Bare Actor registration is not enough for directory inclusion.</p><p class="mono">${escapeHtml(directory?.snapshot_ref)}</p></section>`;
  return renderShell({title:'Discover',active:'/discover',main,context,semanticFacts:renderSemanticFactMarkers('public_directory',directory)});
}
module.exports={renderExplorePage};
