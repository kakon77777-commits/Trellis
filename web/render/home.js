const {escapeHtml,renderShell}=require('./shell');
const {renderSemanticFactMarkers}=require('./semantic-facts');
function publicationCard(item){
  const p=item.publication??{}; const body=p.content?.body??'';
  return `<article class="feed-card publication-card"><header class="card-meta"><a href="/actors/${encodeURIComponent(p.author_actor_id)}">${escapeHtml(p.author_actor_id)}</a><span>${escapeHtml(item.sort?.recorded_at)}</span></header><a class="card-link" href="/publications/${encodeURIComponent(item.source_ref)}"><h2>${escapeHtml(p.publication_type||'Publication')}</h2><p>${escapeHtml(body)}</p></a><footer><span class="pill">${escapeHtml(p.visibility)}</span><span class="muted">${escapeHtml(p.visible_reply_count??0)} replies</span></footer></article>`;
}
function activityCard(item){const a=item.activity??{};return `<article class="feed-card activity-card"><p class="eyebrow">Social activity</p><h2>${escapeHtml(a.type)}</h2><p>${Object.entries(a).filter(([k])=>k!=='type').map(([k,v])=>`${escapeHtml(k)}: ${escapeHtml(v)}`).join(' · ')}</p><footer><span class="muted">${escapeHtml(item.sort?.recorded_at)}</span></footer></article>`;}
function renderHomePage(feed){
  const items=(feed?.items??[]).map(i=>i.item_type==='publication'?publicationCard(i):activityCard(i)).join('');
  const main=`<header class="page-head"><p class="eyebrow">Public chronological feed</p><h1>The public Trellis</h1><p>Current anonymous-viewer-safe publications and social activity. No fabricated identity, no personalized ranking.</p></header><section class="feed-list">${items||'<div class="empty-state"><h2>No public activity yet</h2><p>Trellis does not manufacture demo social content in production.</p></div>'}</section>`;
  const context=`<section class="context-card"><p class="eyebrow">Feed contract</p><h2>Chronological · public</h2><dl><div><dt>Algorithm</dt><dd>${escapeHtml(feed?.algorithm_ref)}</dd></div><div><dt>Snapshot</dt><dd class="mono">${escapeHtml(feed?.snapshot_ref)}</dd></div></dl><p class="muted">The public homepage never impersonates an Actor to obtain personalized results.</p></section>`;
  return renderShell({title:'Home',active:'/',main,context,semanticFacts:renderSemanticFactMarkers('public_feed',feed)});
}
module.exports={renderHomePage};
