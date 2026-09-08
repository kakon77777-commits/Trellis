const {escapeHtml,renderShell}=require('./shell');
const {renderSemanticFactMarkers}=require('./semantic-facts');
const {renderContextLens}=require('./context-lens');

function renderReference(ref){
  if(!ref)return'';
  if(ref.status==='unavailable')return '<section class="reference-card reference-unavailable"><p class="eyebrow">Reference</p><h2>Reference unavailable</h2><p>This reference is not available in the current viewer context.</p></section>';
  if(ref.status==='withdrawn')return `<section class="reference-card reference-withdrawn"><p class="eyebrow">Reference</p><h2>Publication withdrawn</h2><p class="mono">${escapeHtml(ref.publication_id)}</p></section>`;
  const href=`/publications/${encodeURIComponent(ref.publication_id)}`;
  return `<section class="reference-card reference-active"><p class="eyebrow">Referenced publication</p><div class="reference-node"><span class="node-mark" aria-hidden="true">●</span><div><strong>${escapeHtml(ref.author_actor_id??'Publication')}</strong><p>${escapeHtml(ref.preview??'')}</p><a href="${href}">Open publication ↗</a></div></div></section>`;
}

function renderReplies(surface){
  const replies=surface.visible_replies??[];
  if(!replies.length)return '<p class="muted">No visible replies.</p>';
  return `<div class="reply-tree" data-parent-publication-id="${escapeHtml(surface.publication_id)}">${replies.map(r=>`<article class="reply-edge" data-reply-publication-id="${escapeHtml(r.publication_id)}"><span class="reply-branch" aria-hidden="true">└─</span><div><p class="eyebrow">Reply</p><a href="${escapeHtml(r.detail_ref??`/publications/${encodeURIComponent(r.publication_id)}`)}">${escapeHtml(r.publication_id)}</a><p class="muted">by ${escapeHtml(r.author_actor_id)}</p></div></article>`).join('')}</div>`;
}

function renderReactionSummary(summary={}){
  const entries=Object.entries(summary).filter(([,n])=>Number(n)>0);
  if(!entries.length)return'';
  return `<section class="reaction-summary"><div class="section-head"><h2>Reactions</h2><span>Visible aggregate</span></div><div class="reaction-grid">${entries.map(([k,n])=>`<span class="reaction-stat"><strong>${escapeHtml(k)}</strong><span>${escapeHtml(n)}</span></span>`).join('')}</div></section>`;
}

function renderPublicationPage(surface){
  const active=surface.lifecycle==='active';
  const body=active&&surface.content?`<div class="publication-body">${escapeHtml(surface.content.body)}</div>`:'<div class="publication-body withdrawn">Withdrawn publication</div>';
  const lead=`<header class="publication-detail observatory-publication publication-lead"><div class="publication-head"><p class="eyebrow">${escapeHtml(surface.publication_type??'Publication')}</p><h1>${active?'Publication':'Withdrawn publication'}</h1><a class="actor-link" href="/actors/${encodeURIComponent(surface.author_actor_id)}"><span class="node-mark" aria-hidden="true">●</span>${escapeHtml(surface.author_actor_id)}</a></div></header>`;
  const main=`<article class="publication-detail observatory-publication publication-content">${renderReference(surface.reference_context)}${body}${renderReactionSummary(surface.reaction_summary)}<section class="reply-section"><div class="section-head"><h2>Replies</h2><span>${escapeHtml(surface.visible_reply_count??0)} visible</span></div>${renderReplies(surface)}</section></article>`;
  const inspection=[['Publication ID',surface.publication_id],['Type',surface.publication_type],['Revision',surface.content?.revision??'—'],['Projection',surface.projection_version],['Viewer scope',surface.viewer_scope]];
  if(surface.reference_context?.status)inspection.push(['Reference state',surface.reference_context.status]);
  const context=renderContextLens({label:'Context Lens',title:'Publication',summaryRows:[['Lifecycle',surface.lifecycle],['Visibility',surface.visibility],['Viewer',surface.viewer_scope]],inspectionRows:inspection,machineHref:`/api/publications/${encodeURIComponent(surface.publication_id)}`,machineLabel:'Machine representation'});
  return renderShell({title:surface.publication_id,lead,main,context,semanticFacts:renderSemanticFactMarkers('publication',surface)});
}
module.exports={renderReference,renderPublicationPage};
