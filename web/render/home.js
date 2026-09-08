const {escapeHtml,renderShell}=require('./shell');
const {renderSemanticFactMarkers}=require('./semantic-facts');
const {renderContextLens}=require('./context-lens');
const {renderStructuralSpine}=require('./trellis-line');

function publicationCard(item){
  const p=item.publication??{};
  const body=p.content?.body??'';
  return `<div class="trellis-item">${renderStructuralSpine({position:'middle'})}<article class="feed-card publication-card"><header class="card-meta"><a class="actor-link" href="/actors/${encodeURIComponent(p.author_actor_id)}"><span class="node-mark" aria-hidden="true">●</span>${escapeHtml(p.author_actor_id)}</a><span>${escapeHtml(item.sort?.recorded_at)}</span></header><div class="publication-kind eyebrow">${escapeHtml(p.publication_type||'Publication')}</div><a class="card-link" href="/publications/${encodeURIComponent(item.source_ref)}"><p>${escapeHtml(body)}</p></a><footer><span class="pill">${escapeHtml(p.visibility)}</span><span class="muted">${escapeHtml(p.visible_reply_count??0)} replies</span></footer></article></div>`;
}

function activityCard(item){
  const a=item.activity??{};
  const facts=Object.entries(a).filter(([k])=>k!=='type').map(([k,v])=>`${escapeHtml(k)}: ${escapeHtml(v)}`).join(' · ');
  return `<div class="trellis-item">${renderStructuralSpine({position:'middle'})}<article class="feed-card activity-card"><p class="eyebrow">Social activity</p><h2>${escapeHtml(a.type)}</h2><p>${facts}</p><footer><span class="muted">${escapeHtml(item.sort?.recorded_at)}</span></footer></article></div>`;
}

function renderHomePage(feed){
  const items=(feed?.items??[]).map(i=>i.item_type==='publication'?publicationCard(i):activityCard(i)).join('');
  const lead=`<header class="page-head observatory-head"><p class="eyebrow">Public Trellis</p><h1>Public graph activity</h1><p>Chronological public state visible to an anonymous viewer. No fabricated identity, no personalized ranking.</p><div class="status-row"><span class="pill">Public view</span><span class="pill">Chronological</span></div></header>`;
  const main=`<section class="feed-list">${items||'<div class="empty-state"><span class="empty-node" aria-hidden="true">○</span><h2>No public activity yet</h2><p>Nothing is synthesized to make the network appear active.</p><a href="/discover">Explore public identities →</a></div>'}</section>`;
  const context=renderContextLens({
    label:'Context Lens',
    title:'Public view',
    summaryRows:[['Viewer','Anonymous'],['Ordering','Chronological']],
    inspectionRows:[['Algorithm',feed?.algorithm_ref],['Projection',feed?.projection_version],['Snapshot',feed?.snapshot_ref]],
    machineHref:'/api/public/feed',
    machineLabel:'Machine representation'
  });
  return renderShell({title:'Home',active:'/',lead,main,context,semanticFacts:renderSemanticFactMarkers('public_feed',feed)});
}
module.exports={renderHomePage};
