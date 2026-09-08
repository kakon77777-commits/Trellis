const {escapeHtml,renderShell}=require('./shell');
const {renderSemanticFactMarkers}=require('./semantic-facts');
const {renderContextLens}=require('./context-lens');
const {renderNodeBadge}=require('./node-badge');

function actorCard(a){
  const label=a.presentation?.display_name?.value??a.actor_id;
  const bio=a.presentation?.bio?.value??'';
  return `<article class="entity-card observatory-node-card">${renderNodeBadge({kind:'actor',label,href:a.detail_ref??`/actors/${encodeURIComponent(a.actor_id)}`,meta:'Actor'})}<p>${escapeHtml(bio||a.actor_id)}</p><a class="card-action" href="${escapeHtml(a.detail_ref??`/actors/${encodeURIComponent(a.actor_id)}`)}">View profile ↗</a></article>`;
}

function communityCard(c){
  const label=c.presentation?.name?.value??c.community_id;
  const description=c.presentation?.description?.value??'Public community';
  const count=c.membership?.visible_member_count??0;
  const href=c.detail_ref??`/communities/${encodeURIComponent(c.community_id)}`;
  return `<article class="entity-card observatory-node-card">${renderNodeBadge({kind:'community',label,href,meta:'Community'})}<p>${escapeHtml(description)}</p><p class="muted">${escapeHtml(count)} visible members</p><a class="card-action" href="${escapeHtml(href)}">Open community ↗</a></article>`;
}

function renderExplorePage(directory){
  const actors=(directory?.actors??[]).map(actorCard).join('');
  const communities=(directory?.communities??[]).map(communityCard).join('');
  const actorCount=(directory?.actors??[]).length;
  const communityCount=(directory?.communities??[]).length;
  const lead=`<header class="page-head observatory-head"><p class="eyebrow">Explore public Trellis</p><h1>Public identities and communities</h1><p>Visible public nodes in a deterministic directory. No recommendation or personalized relevance is implied.</p><nav class="directory-jump" aria-label="Directory sections"><a href="#actors">Actors ${actorCount}</a><a href="#communities">Communities ${communityCount}</a></nav></header>`;
  const main=`<section id="actors"><div class="section-head"><h2>Actors</h2><span>${actorCount}</span></div><div class="entity-grid">${actors||'<p class="muted">No public Actor presentations.</p>'}</div></section><section id="communities"><div class="section-head"><h2>Communities</h2><span>${communityCount}</span></div><div class="entity-grid">${communities||'<p class="muted">No public Communities.</p>'}</div></section>`;
  const context=renderContextLens({
    label:'Context Lens',
    title:'Public-by-construction',
    summaryRows:[['Viewer','Anonymous'],['Order','Alphabetical'],['Index','Public-by-construction']],
    inspectionRows:[['Algorithm',directory?.algorithm_ref],['Projection',directory?.projection_version],['Snapshot',directory?.snapshot_ref],['Actor inclusion','Public presentation required'],['Community inclusion','discoverability = public']],
    machineHref:'/api/public/directory',
    machineLabel:'Machine representation'
  });
  return renderShell({title:'Discover',active:'/discover',lead,main,context,semanticFacts:renderSemanticFactMarkers('public_directory',directory)});
}
module.exports={renderExplorePage};
